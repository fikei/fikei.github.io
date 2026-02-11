// Supabase Edge Function: scrape-discord-events
// Fetches messages from a Discord channel via bot token,
// applies heuristic pre-filter, then uses Claude Haiku to extract
// structured event data from free-form text.
//
// POST /functions/v1/scrape-discord-events
// Body: { guildId, channelId, lookbackDays? }
// Returns: { events: [...], meta: { messagesScanned, candidateMessages, eventsExtracted, lookbackDays } }

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
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
  embeds?: Array<{ title?: string; description?: string }>
}

async function fetchDiscordMessages(
  channelId: string,
  botToken: string,
  afterSnowflake: string,
  limit = 100
): Promise<DiscordMessage[]> {
  const url = `${DISCORD_API}/channels/${channelId}/messages?limit=${limit}&after=${afterSnowflake}`
  const resp = await fetch(url, {
    headers: { Authorization: `Bot ${botToken}` },
  })

  if (resp.status === 429) {
    const retryAfter = parseFloat(resp.headers.get('Retry-After') || '2')
    await new Promise(r => setTimeout(r, retryAfter * 1000))
    return fetchDiscordMessages(channelId, botToken, afterSnowflake, limit)
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
    // Messages come newest-first from Discord; get oldest ID for next page
    after = batch[batch.length - 1].id
    if (batch.length < 100) break // no more pages
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

  // Date signals (+3)
  if (DATE_PATTERNS.some(p => p.test(text))) score += 3

  // Time signals (+2)
  if (TIME_PATTERNS.some(p => p.test(text))) score += 2

  // Price signals (+1)
  if (PRICE_PATTERNS.some(p => p.test(text))) score += 1

  // Venue/location signals (+1)
  if (VENUE_PATTERNS.some(p => p.test(text))) score += 1

  // URL present (+1)
  if (/https?:\/\//.test(text)) score += 1

  // Long message (+1)
  if (text.length > 50) score += 1

  // Bot/webhook (+1) — often automated event posts
  if (msg.author.bot) score += 1

  // Reply/thread (-2) — discussion, not announcement
  if (msg.message_reference) score -= 2

  // Very short (-2)
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
        model: 'claude-3-haiku-20240307',
        max_tokens: 2048,
        messages: [{ role: 'user', content: prompt }],
      }),
    })

    if (!resp.ok) {
      const errText = await resp.text()
      console.error(`Claude API error: ${resp.status} ${errText}`)
      continue // skip batch on error, don't fail entire scrape
    }

    const data = await resp.json()
    const text = data.content?.[0]?.text || ''

    try {
      // Strip markdown code fences if present
      const cleaned = text.replace(/^```(?:json)?\s*/m, '').replace(/\s*```$/m, '').trim()
      const parsed = JSON.parse(cleaned)

      if (Array.isArray(parsed)) {
        // Add Discord permalink as fallback URL
        for (const event of parsed) {
          if (!event.url && batch[0]) {
            event.url = messagePermalink(guildId, channelId, batch[0].id)
          }
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
  // Must have a date
  if (!event.date || !/^\d{4}-\d{2}-\d{2}$/.test(event.date)) return false

  // Must have a name
  if (!event.name || event.name.trim().length < 2) return false

  // Date must parse and be within reasonable range (not more than 1 year out)
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
      // Merge: prefer the more complete record
      for (const field of ['time', 'venue', 'address', 'city', 'genre', 'price', 'ages', 'promoter', 'url'] as const) {
        if (!existing[field] && event[field]) {
          (existing as Record<string, string>)[field] = event[field]
        }
      }
    }
  }

  return Array.from(seen.values())
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
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    const { guildId, channelId, lookbackDays: rawLookback } = body as {
      guildId?: string
      channelId?: string
      lookbackDays?: number
    }

    if (!guildId || !channelId) {
      return new Response(
        JSON.stringify({ error: 'guildId and channelId are required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    const lookbackDays = Math.min(Math.max(rawLookback || 7, 1), 30)

    const botToken = Deno.env.get('DISCORD_BOT_TOKEN')
    if (!botToken) {
      return new Response(
        JSON.stringify({ error: 'DISCORD_BOT_TOKEN not configured' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    const apiKey = Deno.env.get('ANTHROPIC_API_KEY')
    if (!apiKey) {
      return new Response(
        JSON.stringify({ error: 'ANTHROPIC_API_KEY not configured' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // 1. Fetch messages from Discord
    console.log(`Fetching messages from channel ${channelId} (${lookbackDays}d lookback)`)
    const messages = await fetchAllMessages(channelId, botToken, lookbackDays)
    console.log(`Fetched ${messages.length} messages`)

    // 2. Pre-filter with heuristic scoring
    const candidates = messages.filter(m => scoreMessage(m) >= CANDIDATE_THRESHOLD)
    console.log(`${candidates.length} candidates passed heuristic filter (threshold=${CANDIDATE_THRESHOLD})`)

    if (candidates.length === 0) {
      return new Response(
        JSON.stringify({
          events: [],
          meta: { messagesScanned: messages.length, candidateMessages: 0, eventsExtracted: 0, lookbackDays },
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // 3. AI extraction
    const rawEvents = await extractEventsWithAI(candidates, apiKey, guildId, channelId)
    console.log(`AI extracted ${rawEvents.length} raw events`)

    // 4. Validate and deduplicate
    const valid = rawEvents.filter(validateEvent)
    const events = deduplicateEvents(valid)
    console.log(`After validation: ${valid.length}, after dedup: ${events.length}`)

    return new Response(
      JSON.stringify({
        events,
        meta: {
          messagesScanned: messages.length,
          candidateMessages: candidates.length,
          eventsExtracted: events.length,
          lookbackDays,
        },
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
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
      { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})
