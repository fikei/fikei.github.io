// Supabase Edge Function: scrape-discord-events
// Fetches messages from a Discord channel via bot token,
// applies heuristic pre-filter, then uses Claude Haiku to extract
// structured event data from free-form text.
//
// Supports server-side caching: events are stored in discord_event_cache
// and refreshed by cron every 4 hours. Client reads get cached results instantly.
//
// Actions:
//   POST { guildId, channelId }                     -> read cache (or scrape if stale/missing)
//   POST { action: "refresh", guildId, channelId }  -> force scrape + cache (for cron)
//   POST { action: "refresh-all" }                  -> refresh all cached channels (for cron)
//   POST { action: "export", channelId, after?, maxMessages? } -> raw message export (paginated, service-role only)
//
// Returns: { events: [...], meta: { ... }, cached: boolean }

const VERSION = '1.3.0'
console.log(`[scrape-discord-events] v${VERSION} - canonical store forwarding (posted_by, recommended_by, per-message attribution)`)

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const jsonHeaders = { ...corsHeaders, 'Content-Type': 'application/json' }

// Cache TTL: 4 hours (cron refreshes every 4h)
const CACHE_TTL_MS = 4 * 60 * 60 * 1000

// --- Supabase client ---

function getSupabase() {
  const url = Deno.env.get('SUPABASE_URL')!
  const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  return createClient(url, key)
}

// --- Cache operations ---

interface CacheRow {
  guild_id: string
  channel_id: string
  events: unknown[]
  meta: Record<string, unknown>
  last_message_id: string | null
  fetched_at: string
  expires_at: string
}

async function readCache(guildId: string, channelId: string): Promise<CacheRow | null> {
  const supabase = getSupabase()
  const { data, error } = await supabase
    .from('discord_event_cache')
    .select('*')
    .eq('guild_id', guildId)
    .eq('channel_id', channelId)
    .single()

  if (error || !data) return null
  return data as CacheRow
}

async function writeCache(
  guildId: string,
  channelId: string,
  events: unknown[],
  meta: Record<string, unknown>,
  lastMessageId?: string
): Promise<void> {
  const supabase = getSupabase()
  const now = new Date()
  const expiresAt = new Date(now.getTime() + CACHE_TTL_MS)

  const row = {
    guild_id: guildId,
    channel_id: channelId,
    events,
    meta,
    last_message_id: lastMessageId || null,
    fetched_at: now.toISOString(),
    expires_at: expiresAt.toISOString(),
  }

  const { error } = await supabase
    .from('discord_event_cache')
    .upsert(row, { onConflict: 'guild_id,channel_id' })

  if (error) {
    console.error('Cache write failed:', error.message)
  } else {
    console.log(`Cache written: ${guildId}/${channelId} | ${events.length} events, expires ${expiresAt.toISOString()}`)
  }
}

async function getAllCachedChannels(): Promise<Array<{ guild_id: string; channel_id: string }>> {
  const supabase = getSupabase()
  const { data, error } = await supabase
    .from('discord_event_cache')
    .select('guild_id, channel_id')

  if (error || !data) return []
  return data
}

function isCacheFresh(cache: CacheRow): boolean {
  return new Date(cache.expires_at) > new Date()
}

// --- Discord API helpers ---

const DISCORD_API = 'https://discord.com/api/v10'
const DISCORD_EPOCH = 1420070400000n // Jan 1, 2015

function dateToSnowflake(date: Date): string {
  const timestamp = BigInt(date.getTime()) - DISCORD_EPOCH
  return (timestamp << 22n).toString()
}

function messagePermalink(guildId: string, channelId: string, messageId: string): string {
  return `https://discord.com/channels/${guildId}/${channelId}/${messageId}`
}

interface DiscordMessage {
  id: string
  content: string
  author: { id: string; username: string; bot?: boolean }
  timestamp: string
  type: number
  message_reference?: { message_id?: string }
  embeds?: Array<{ title?: string; description?: string; url?: string; provider?: { name?: string } }>
  attachments?: Array<{ filename?: string; url?: string; content_type?: string }>
}

async function fetchDiscordMessages(
  channelId: string,
  botToken: string,
  afterSnowflake: string,
  limit = 100,
  retriesLeft = 3
): Promise<DiscordMessage[]> {
  const url = `${DISCORD_API}/channels/${channelId}/messages?limit=${limit}&after=${afterSnowflake}`
  const resp = await fetch(url, {
    headers: { Authorization: `Bot ${botToken}` },
  })

  if (resp.status === 429) {
    if (retriesLeft <= 0) throw new Error('Discord API 429: rate limit retries exhausted')
    const retryAfter = parseFloat(resp.headers.get('Retry-After') || '2')
    await new Promise(r => setTimeout(r, retryAfter * 1000))
    return fetchDiscordMessages(channelId, botToken, afterSnowflake, limit, retriesLeft - 1)
  }

  if (!resp.ok) {
    const body = await resp.text()
    throw new Error(`Discord API ${resp.status}: ${body}`)
  }

  return resp.json()
}

async function fetchAllMessages(
  channelId: string,
  botToken: string,
  lookbackDays: number,
  maxMessages = 200
): Promise<DiscordMessage[]> {
  const since = new Date()
  since.setDate(since.getDate() - lookbackDays)
  const afterSnowflake = dateToSnowflake(since)

  const all: DiscordMessage[] = []
  let after = afterSnowflake

  while (all.length < maxMessages) {
    const batch = await fetchDiscordMessages(channelId, botToken, after)
    if (batch.length === 0) break
    all.push(...batch)
    after = batch[batch.length - 1].id
    if (batch.length < 100) break
  }

  return all.slice(0, maxMessages)
}

// --- Heuristic pre-filter ---

const DATE_PATTERNS = [
  /\d{1,2}\/\d{1,2}/,
  /\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)\w*\s+\d{1,2}/i,
  /\b(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/i,
  /\b(tonight|tomorrow|this\s+(fri|sat|sun|week|weekend))\b/i,
]

const TIME_PATTERNS = [
  /\d{1,2}(:\d{2})?\s*(am|pm)/i,
  /\b(doors|starts?|show)\s+(at|@)\s*\d/i,
]

const PRICE_PATTERNS = [
  /\$\d+/,
  /\b(free|no cover|tickets?|presale|ga\b)/i,
]

const VENUE_PATTERNS = [
  /\b(at the|@)\b/i,
  /\b(venue|location|address)\s*:/i,
]

function scoreMessage(msg: DiscordMessage): number {
  const text = msg.content + ' ' + (msg.embeds || []).map(e => `${e.title || ''} ${e.description || ''}`).join(' ')
  let score = 0
  if (DATE_PATTERNS.some(p => p.test(text))) score += 3
  if (TIME_PATTERNS.some(p => p.test(text))) score += 2
  if (PRICE_PATTERNS.some(p => p.test(text))) score += 1
  if (VENUE_PATTERNS.some(p => p.test(text))) score += 1
  if (/https?:\/\//.test(text)) score += 1
  if (text.length > 50) score += 1
  if (msg.author.bot) score += 1
  if (msg.message_reference) score -= 2
  if (text.length < 20) score -= 2
  return score
}

const CANDIDATE_THRESHOLD = 4

// --- AI extraction ---

interface ExtractedEvent {
  date: string
  time: string
  name: string
  venue: string
  address: string
  city: string
  genre: string
  price: string
  ages: string
  promoter: string
  url: string
  msg?: number       // 1-based index of the source message within the batch
  postedBy?: string  // Discord author of the source message
}

function buildExtractionPrompt(messages: Array<{ content: string; timestamp: string; authorIsBot: boolean }>, today: string): string {
  const msgBlock = messages.map((m, i) => {
    const label = m.authorIsBot ? '[bot]' : ''
    return `--- Message ${i + 1} (posted ${m.timestamp}) ${label} ---\n${m.content}`
  }).join('\n\n')

  return `You are an event extraction system. Given Discord messages from a community channel, extract any events mentioned. Each event should be a structured object.

Rules:
- Only extract actual events (shows, meetups, parties, screenings, concerts, etc.)
- Skip messages that are just discussion, reactions, or questions about events
- If a message contains multiple events, extract each separately
- If a date is relative ("this Friday", "tomorrow"), resolve it relative to today: ${today}
- If no year is specified, assume the current year (${today.substring(0, 4)})
- If time is ambiguous, prefer evening (7-10pm) for nightlife/music, afternoon for other
- If venue/location is not mentioned, leave empty — do not guess
- Return an empty array if no events are found

Output ONLY a JSON array (no markdown, no explanation):
[{
  "msg": <number of the source message the event came from, e.g. 1>,
  "date": "YYYY-MM-DD",
  "time": "HH:MM" or "HH:MM-HH:MM" or "",
  "name": "event title",
  "venue": "venue name" or "",
  "address": "street address" or "",
  "city": "city name" or "",
  "genre": "comma-separated tags" or "",
  "price": "$XX" or "Free" or "TBA" or "",
  "ages": "All Ages" or "21+" or "",
  "promoter": "organizer name" or "",
  "url": "ticket or info URL" or ""
}]

Messages:

${msgBlock}`
}

async function extractEventsWithAI(
  candidates: DiscordMessage[],
  apiKey: string,
  guildId: string,
  channelId: string
): Promise<ExtractedEvent[]> {
  const today = new Date().toISOString().split('T')[0]
  const BATCH_SIZE = 15
  const allEvents: ExtractedEvent[] = []

  for (let i = 0; i < candidates.length; i += BATCH_SIZE) {
    const batch = candidates.slice(i, i + BATCH_SIZE)
    const messages = batch.map(m => ({
      content: m.content + (m.embeds?.length ? '\n' + m.embeds.map(e => `${e.title || ''}: ${e.description || ''}`).join('\n') : ''),
      timestamp: m.timestamp,
      authorIsBot: !!m.author.bot,
    }))

    const prompt = buildExtractionPrompt(messages, today)

    const resp = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 2048,
        messages: [{ role: 'user', content: prompt }],
      }),
    })

    if (!resp.ok) {
      const errText = await resp.text()
      console.error(`Claude API error: ${resp.status} ${errText}`)
      continue
    }

    const data = await resp.json()
    const text = data.content?.[0]?.text || ''

    try {
      const cleaned = text.replace(/^```(?:json)?\s*/m, '').replace(/\s*```$/m, '').trim()
      const parsed = JSON.parse(cleaned)

      if (Array.isArray(parsed)) {
        for (const event of parsed) {
          // Map the event back to its source message (1-based "msg" index)
          // for author attribution and a permalink URL fallback.
          const idx = typeof event.msg === 'number' ? event.msg - 1 : 0
          const srcMsg = batch[idx] || batch[0]
          if (srcMsg) {
            event.postedBy = srcMsg.author?.username || ''
            if (!event.url) {
              event.url = messagePermalink(guildId, channelId, srcMsg.id)
            }
          }
          delete event.msg
          allEvents.push(event)
        }
      }
    } catch (e) {
      console.error(`Failed to parse AI response: ${e.message}`, text.substring(0, 200))
    }
  }

  return allEvents
}

// --- Post-extraction validation ---

function validateEvent(event: ExtractedEvent): boolean {
  if (!event.date || !/^\d{4}-\d{2}-\d{2}$/.test(event.date)) return false
  if (!event.name || event.name.trim().length < 2) return false
  const d = new Date(event.date)
  if (isNaN(d.getTime())) return false
  const oneYearOut = new Date()
  oneYearOut.setFullYear(oneYearOut.getFullYear() + 1)
  if (d > oneYearOut) return false
  return true
}

function deduplicateEvents(events: ExtractedEvent[]): ExtractedEvent[] {
  const seen = new Map<string, ExtractedEvent>()
  for (const event of events) {
    const key = `${event.date}|${event.name.toLowerCase().replace(/[^a-z0-9]/g, '')}|${(event.venue || '').toLowerCase().replace(/[^a-z0-9]/g, '')}`
    const existing = seen.get(key)
    if (!existing) {
      seen.set(key, event)
    } else {
      for (const field of ['time', 'venue', 'address', 'city', 'genre', 'price', 'ages', 'promoter', 'url'] as const) {
        if (!existing[field] && event[field]) {
          (existing as Record<string, string>)[field] = event[field]
        }
      }
    }
  }
  return Array.from(seen.values())
}

// --- Full scrape pipeline (fetches Discord, runs AI, writes cache) ---

async function scrapeAndCache(
  guildId: string,
  channelId: string,
  lookbackDays: number
): Promise<{ events: ExtractedEvent[]; meta: Record<string, unknown> }> {
  const botToken = Deno.env.get('DISCORD_BOT_TOKEN')
  if (!botToken) throw new Error('DISCORD_BOT_TOKEN not configured')
  const apiKey = Deno.env.get('ANTHROPIC_API_KEY')
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY not configured')

  console.log(`Scraping channel ${channelId} (${lookbackDays}d lookback)`)
  const messages = await fetchAllMessages(channelId, botToken, lookbackDays)
  console.log(`Fetched ${messages.length} messages`)

  const candidates = messages.filter(m => scoreMessage(m) >= CANDIDATE_THRESHOLD)
  console.log(`${candidates.length} candidates passed heuristic filter`)

  let events: ExtractedEvent[] = []
  const meta: Record<string, unknown> = {
    messagesScanned: messages.length,
    candidateMessages: candidates.length,
    eventsExtracted: 0,
    lookbackDays,
    scrapedAt: new Date().toISOString(),
  }

  if (candidates.length > 0) {
    const rawEvents = await extractEventsWithAI(candidates, apiKey, guildId, channelId)
    console.log(`AI extracted ${rawEvents.length} raw events`)
    const valid = rawEvents.filter(validateEvent)
    events = deduplicateEvents(valid)
    console.log(`After validation: ${valid.length}, after dedup: ${events.length}`)
    meta.eventsExtracted = events.length
  }

  const lastMessageId = messages.length > 0 ? messages[0].id : undefined
  await writeCache(guildId, channelId, events, meta, lastMessageId)

  // Forward into the canonical event store (PRD event-source-architecture).
  // cache-events computes visibility from the source's class ('curation' →
  // private), runs the dedup ladder, and triggers enrichment.
  try {
    const forwarded = await forwardToCanonicalStore(events)
    meta.canonicalStore = forwarded
  } catch (err) {
    console.error('Canonical store forward failed:', (err as Error).message)
    meta.canonicalStore = { error: (err as Error).message }
  }

  return { events, meta }
}

const AGAPE_SOURCE_ID = 'discord-agape-events'

async function forwardToCanonicalStore(events: ExtractedEvent[]): Promise<Record<string, unknown>> {
  if (events.length === 0) return { cached: 0, updated: 0 }
  const supabaseUrl = Deno.env.get('SUPABASE_URL')!
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

  const payload = events.map(ev => ({
    source: AGAPE_SOURCE_ID,
    date: ev.date,
    time: ev.time || '',
    name: ev.name,
    venue: ev.venue || 'TBA',
    address: ev.address || '',
    city: ev.city || 'San Francisco',
    genre: ev.genre || '',
    price: ev.price || '',
    ages: ev.ages || '',
    promoter: ev.promoter || '',
    url: ev.url,
    postedBy: ev.postedBy || '',
    recommendedBy: ['agape'],
  }))

  const resp = await fetch(`${supabaseUrl}/functions/v1/cache-events`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${serviceKey}`,
    },
    body: JSON.stringify({
      events: payload,
      sourceOutcomes: [{
        sourceId: AGAPE_SOURCE_ID,
        sourceName: 'Agape #events',
        sourceUrl: 'discord://agape/#events',
        sourceType: 'discord',
        eventCount: events.length,
        ok: true,
      }],
    }),
  })
  if (!resp.ok) {
    throw new Error(`cache-events ${resp.status}: ${(await resp.text()).slice(0, 200)}`)
  }
  const result = await resp.json()
  console.log(`Canonical store: cached=${result.cached} updated=${result.updated}`)
  return { cached: result.cached, updated: result.updated, enrichQueued: result.enrichQueued }
}

// --- Main handler ---

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    let body: Record<string, unknown>
    try {
      body = await req.json()
    } catch {
      return new Response(
        JSON.stringify({ error: 'Request body must be valid JSON with guildId and channelId' }),
        { status: 400, headers: jsonHeaders }
      )
    }

    const action = (body.action as string) || 'read'

    // --- refresh-all: cron refreshes every cached channel ---
    if (action === 'refresh-all') {
      const channels = await getAllCachedChannels()
      if (channels.length === 0) {
        return new Response(
          JSON.stringify({ refreshed: 0, message: 'No cached channels to refresh' }),
          { headers: jsonHeaders }
        )
      }

      const lookbackDays = Math.min(Math.max((body.lookbackDays as number) || 7, 1), 30)
      const results: Array<{ guildId: string; channelId: string; events: number; error?: string }> = []

      for (const ch of channels) {
        try {
          const result = await scrapeAndCache(ch.guild_id, ch.channel_id, lookbackDays)
          results.push({ guildId: ch.guild_id, channelId: ch.channel_id, events: result.events.length })
        } catch (err) {
          const msg = err instanceof Error ? err.message : 'Unknown error'
          console.error(`Failed to refresh ${ch.guild_id}/${ch.channel_id}: ${msg}`)
          results.push({ guildId: ch.guild_id, channelId: ch.channel_id, events: 0, error: msg })
        }
      }

      return new Response(
        JSON.stringify({ refreshed: results.length, results }),
        { headers: jsonHeaders }
      )
    }

    // --- export: raw message dump for analysis (service-role only) ---
    if (action === 'export') {
      // Gateway (verify_jwt) has already validated the JWT signature;
      // here we only require that the caller's role is service_role.
      const authHeader = req.headers.get('Authorization') || ''
      let role = ''
      try {
        const token = authHeader.replace(/^Bearer\s+/i, '')
        const payload = JSON.parse(atob(token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')))
        role = payload.role || ''
      } catch { /* not a JWT */ }
      if (role !== 'service_role') {
        return new Response(
          JSON.stringify({ error: 'export requires service role key' }),
          { status: 403, headers: jsonHeaders }
        )
      }

      const botToken = Deno.env.get('DISCORD_BOT_TOKEN')
      if (!botToken) throw new Error('DISCORD_BOT_TOKEN not configured')

      const exportChannelId = body.channelId as string
      if (!exportChannelId) {
        return new Response(
          JSON.stringify({ error: 'channelId is required' }),
          { status: 400, headers: jsonHeaders }
        )
      }

      const maxMessages = Math.min(Math.max((body.maxMessages as number) || 500, 1), 1000)
      let after = (body.after as string) || '0'
      const raw: DiscordMessage[] = []

      try {
        while (raw.length < maxMessages) {
          const batch = await fetchDiscordMessages(exportChannelId, botToken, after)
          if (batch.length === 0) break
          // Discord returns newest-first within a page when using `after`; sort ascending
          batch.sort((a, b) => (BigInt(a.id) < BigInt(b.id) ? -1 : 1))
          raw.push(...batch)
          after = batch[batch.length - 1].id
          if (batch.length < 100) break
        }
      } catch (err) {
        // Surface the raw Discord error so callers can distinguish
        // bad-token (401) from not-invited/missing-access (403)
        const msg = err instanceof Error ? err.message : String(err)
        return new Response(
          JSON.stringify({ error: `Discord fetch failed: ${msg}` }),
          { status: 502, headers: jsonHeaders }
        )
      }

      const messages = raw.slice(0, maxMessages).map(m => ({
        id: m.id,
        timestamp: m.timestamp,
        author: m.author?.username || '',
        bot: !!m.author?.bot,
        content: m.content,
        embeds: (m.embeds || []).map(e => ({
          title: e.title || '',
          description: (e.description || '').slice(0, 500),
          url: e.url || '',
          provider: e.provider?.name || '',
        })),
        attachments: (m.attachments || []).map(a => ({
          filename: a.filename || '',
          content_type: a.content_type || '',
          url: a.url || '',
        })),
        reply: !!m.message_reference,
      }))

      const done = messages.length < maxMessages
      return new Response(
        JSON.stringify({
          count: messages.length,
          done,
          nextAfter: messages.length > 0 ? messages[messages.length - 1].id : after,
          messages,
        }),
        { headers: jsonHeaders }
      )
    }

    // --- All other actions need guildId + channelId ---
    const { guildId, channelId, lookbackDays: rawLookback } = body as {
      guildId?: string
      channelId?: string
      lookbackDays?: number
    }

    if (!guildId || !channelId) {
      return new Response(
        JSON.stringify({ error: 'guildId and channelId are required' }),
        { status: 400, headers: jsonHeaders }
      )
    }

    const lookbackDays = Math.min(Math.max(rawLookback || 7, 1), 30)

    // --- refresh: force scrape + cache for a single channel ---
    if (action === 'refresh') {
      const result = await scrapeAndCache(guildId, channelId, lookbackDays)
      return new Response(
        JSON.stringify({ ...result, cached: false }),
        { headers: jsonHeaders }
      )
    }

    // --- read (default): serve from cache, scrape if stale/missing ---
    const cache = await readCache(guildId, channelId)

    if (cache && isCacheFresh(cache)) {
      console.log(`Cache hit: ${guildId}/${channelId} | ${(cache.events as unknown[]).length} events`)
      return new Response(
        JSON.stringify({
          events: cache.events,
          meta: { ...cache.meta, cachedAt: cache.fetched_at },
          cached: true,
        }),
        { headers: jsonHeaders }
      )
    }

    // Cache miss or stale — scrape live and cache
    console.log(`Cache ${cache ? 'stale' : 'miss'}: ${guildId}/${channelId}, scraping live`)
    const result = await scrapeAndCache(guildId, channelId, lookbackDays)
    return new Response(
      JSON.stringify({ ...result, cached: false }),
      { headers: jsonHeaders }
    )

  } catch (err) {
    console.error('scrape-discord-events error:', err)

    const message = err instanceof Error ? err.message : 'Unknown error'
    const isDiscordAuth = message.includes('401') || message.includes('403')
    const status = isDiscordAuth ? 403 : 500
    const error = isDiscordAuth
      ? 'Bot cannot access this channel. Ensure the bot is invited and has Read Message History permission.'
      : message

    return new Response(
      JSON.stringify({ error }),
      { status, headers: jsonHeaders }
    )
  }
})
