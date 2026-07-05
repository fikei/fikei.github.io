// Supabase Edge Function: enrich-event
// Fetches event detail URLs to extract description, image, and tags.
// Called by cache-events for newly cached events.
//
// POST /functions/v1/enrich-event
// Body: { eventIds: string[] }   (batch up to 10)
// Returns: { processed, succeeded, failed, results }

const VERSION = '1.2.0'
console.log(`[enrich-event] v${VERSION} - authoritative source categories + full content-type taxonomy in AI prompt`)

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { DOMParser } from 'https://deno.land/x/deno_dom@v0.1.38/deno-dom-wasm.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

function jsonResponse(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

// Domains we can safely scrape for enrichment
const ALLOWED_DOMAINS = [
  '19hz.info',
  'roxie.com',
  'punchlinecomedyclub.com',
  'cobbscomedy.com',
  'screenslate.com',
  'eventbrite.com',
  'alamodrafthouse.com',
  'drafthouse.com',
  'dice.fm',
  'ra.co',
  'songkick.com',
  'garysguide.com',
  'bonobonetwork.com',
  'hyperallergic.com',
  'sfmoma.org',
  'famsf.org',
  'sfdesignweek.org',
  'citylights.com',
  'sfpl.org',
  'commonwealthclub.org',
  // Event platforms from the Agape curation feed (PRD source-architecture §4.1:
  // platform pages are the canonical fact source for Discord-announced events)
  'partiful.com',
  'lu.ma',
  'luma.com',
  'shotgun.live',
  'tixr.com',
  'seetickets.us',
  'meetup.com',
  'grayarea.org',
  'thelab.org',
  'bottomofthehill.com',
  'thechapelsf.com',
]

function isDomainAllowed(url: string): boolean {
  try {
    const hostname = new URL(url).hostname.toLowerCase()
    return ALLOWED_DOMAINS.some(d => hostname === d || hostname.endsWith('.' + d))
  } catch {
    return false
  }
}

interface EnrichResult {
  eventId: string
  success: boolean
  description?: string | null
  imageUrl?: string | null
  tags?: string[]
  genre?: string | null
  content_type?: string | null
  error?: string
}

const VALID_CONTENT_TYPES = ['music', 'dj-set', 'live-music', 'festival', 'film', 'comedy', 'theater', 'tech', 'social', 'art', 'design', 'literary', 'wellness', 'other']

async function fetchPage(url: string): Promise<string | null> {
  try {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 10_000)

    const resp = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
      },
      redirect: 'follow',
      signal: controller.signal,
    })

    clearTimeout(timeout)

    if (!resp.ok) return null
    const ct = resp.headers.get('content-type') || ''
    if (!ct.includes('text/html') && !ct.includes('application/xhtml')) return null

    return await resp.text()
  } catch {
    return null
  }
}

function extractMetadata(html: string, pageUrl: string): {
  description: string | null
  imageUrl: string | null
  tags: string[]
} {
  const doc = new DOMParser().parseFromString(html, 'text/html')
  if (!doc) return { description: null, imageUrl: null, tags: [] }

  // --- Description ---
  const metaDesc = doc.querySelector('meta[name="description"]')?.getAttribute('content')?.trim()
  const ogDesc = doc.querySelector('meta[property="og:description"]')?.getAttribute('content')?.trim()
  let firstP: string | null = null
  const pSelectors = [
    'article p', '.event-description p', '.description p',
    '.event-detail p', '.event-info p', 'main p', '.content p',
  ]
  for (const sel of pSelectors) {
    const el = doc.querySelector(sel)
    if (el) {
      const text = el.textContent?.trim()
      if (text && text.length > 30) {
        firstP = text.length > 500 ? text.substring(0, 500) + '...' : text
        break
      }
    }
  }
  const description = metaDesc || ogDesc || firstP || null

  // --- Image ---
  const ogImage = doc.querySelector('meta[property="og:image"]')?.getAttribute('content')?.trim()
  const twitterImage = doc.querySelector('meta[name="twitter:image"]')?.getAttribute('content')?.trim()

  let eventImage: string | null = null
  const imgSelectors = [
    '.event-image img', '.event-hero img', '.hero-image img',
    '.event-poster img', 'article img', '.event-detail img',
    'img[src*="event"]', 'img[src*="poster"]', 'img[src*="flyer"]',
  ]
  for (const sel of imgSelectors) {
    const el = doc.querySelector(sel)
    if (el) {
      const src = el.getAttribute('src') || el.getAttribute('data-src')
      if (src) { eventImage = src; break }
    }
  }

  let rawImageUrl = ogImage || twitterImage || eventImage
  let imageUrl: string | null = null
  if (rawImageUrl) {
    try {
      imageUrl = new URL(rawImageUrl, pageUrl).href
    } catch {
      imageUrl = rawImageUrl.startsWith('http') ? rawImageUrl : null
    }
  }

  // --- Tags ---
  const tags: string[] = []
  const keywords = doc.querySelector('meta[name="keywords"]')?.getAttribute('content')
  if (keywords) {
    for (const k of keywords.split(',')) {
      const t = k.trim().toLowerCase()
      if (t && t.length > 1 && t.length < 50 && !tags.includes(t)) tags.push(t)
    }
  }

  // Genre-specific selectors
  const genreSelectors = '.genre, .event-genre, [itemprop="genre"], .music-genre, .style, .event-style'
  doc.querySelectorAll(genreSelectors).forEach((el: Element) => {
    const t = el.textContent?.trim().toLowerCase()
    if (t && t.length > 1 && t.length < 50 && !tags.includes(t)) tags.push(t)
  })

  // General tag selectors
  const tagSelectors = '.tag, .category, [rel="tag"], .event-tag, .event-category'
  doc.querySelectorAll(tagSelectors).forEach((el: Element) => {
    const t = el.textContent?.trim().toLowerCase()
    if (t && t.length > 1 && t.length < 50 && !tags.includes(t)) tags.push(t)
  })

  return {
    description,
    imageUrl,
    tags: tags.slice(0, 10),
  }
}

// --- AI Classification (Claude Haiku) ---
async function classifyWithAI(event: {
  name: string, venue: string, genre: string, content_type: string,
  description: string, tags: string[]
}): Promise<{ genre: string, content_type: string } | null> {
  const apiKey = Deno.env.get('ANTHROPIC_API_KEY')
  if (!apiKey) {
    console.log('[enrich-event] ANTHROPIC_API_KEY not set, skipping AI classification')
    return null
  }

  const desc = (event.description || '').substring(0, 300)
  const prompt = `You are classifying a live event. Given the event details below, return a JSON object with two fields:

1. "genre" — the music/art genre (e.g. "Techno", "House", "Hip-Hop", "Jazz", "Rock", "Comedy", "Film", "Indie", "Drum & Bass"). Use the most specific genre that fits. If multiple genres apply, comma-separate up to 3. Return "" if truly unknown.

2. "content_type" — one of: music, dj-set, live-music, festival, film, comedy, theater, tech, social, art, design, literary, wellness, other

Event name: ${event.name}
Venue: ${event.venue}
Current genre: ${event.genre || 'unknown'}
Current type: ${event.content_type || 'unknown'}
Description: ${desc}
Tags: ${event.tags.join(', ')}

Respond with JSON only: {"genre": "...", "content_type": "..."}`

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 150,
        messages: [{ role: 'user', content: prompt }],
      }),
    })

    if (!response.ok) {
      console.error('[enrich-event] AI API error:', response.status)
      return null
    }

    const data = await response.json()
    const text = data.content?.[0]?.text || ''
    const match = text.match(/\{[\s\S]*\}/)

    if (match) {
      const result = JSON.parse(match[0])
      // Validate content_type
      if (result.content_type && !VALID_CONTENT_TYPES.includes(result.content_type)) {
        result.content_type = ''
      }
      return {
        genre: typeof result.genre === 'string' ? result.genre : '',
        content_type: typeof result.content_type === 'string' ? result.content_type : '',
      }
    }
  } catch (e) {
    console.error('[enrich-event] AI classification error:', e)
  }

  return null
}

async function enrichSingleEvent(
  supabase: ReturnType<typeof createClient>,
  eventId: string,
  eventUrl: string,
  eventName: string,
  eventVenue: string,
  eventGenre: string,
  eventContentType: string,
  eventSourceId: string,
): Promise<EnrichResult> {
  await supabase
    .from('events')
    .update({ enrichment_status: 'processing' })
    .eq('id', eventId)

  if (!isDomainAllowed(eventUrl)) {
    await supabase
      .from('events')
      .update({ enrichment_status: 'skipped', enrichment_error: 'Domain not in allowlist' })
      .eq('id', eventId)
    return { eventId, success: false, error: 'Domain not allowed' }
  }

  const html = await fetchPage(eventUrl)
  if (!html) {
    await supabase
      .from('events')
      .update({ enrichment_status: 'failed', enrichment_error: 'Failed to fetch URL' })
      .eq('id', eventId)
    return { eventId, success: false, error: 'Failed to fetch' }
  }

  const metadata = extractMetadata(html, eventUrl)

  // AI classification — clean up genre and content type
  const aiResult = await classifyWithAI({
    name: eventName,
    venue: eventVenue,
    genre: eventGenre,
    content_type: eventContentType,
    description: metadata.description || '',
    tags: metadata.tags,
  })

  if (aiResult) {
    console.log(`[enrich-event] AI: "${eventName}" → genre="${aiResult.genre}" type="${aiResult.content_type}"`)
  }

  const hasData = metadata.description || metadata.imageUrl || metadata.tags.length > 0 || aiResult
  if (!hasData) {
    await supabase
      .from('events')
      .update({ enrichment_status: 'completed', enriched_at: new Date().toISOString() })
      .eq('id', eventId)
    return { eventId, success: true, description: null, imageUrl: null, tags: [] }
  }

  // Venue/community sources have an authoritative category — a curated art
  // calendar's events are art even when the AI reads them as "music" or
  // "other". Curation feeds (Agape) span categories, so their rows keep AI
  // classification; discovery/ticketing rows accept AI content_type too.
  let authoritativeType: string | null = null
  try {
    const { data: src } = await supabase
      .from('event_sources')
      .select('category, source_class')
      .eq('id', eventSourceId)
      .single()
    if (src && ['venue', 'community'].includes(src.source_class as string)) {
      authoritativeType = (src.category as string) || null
    }
  } catch { /* registry lookup is best-effort */ }

  const { error } = await supabase
    .from('events')
    .update({
      description: metadata.description,
      image_url: metadata.imageUrl,
      tags: metadata.tags.length > 0 ? metadata.tags : null,
      ...(aiResult?.genre ? { genre: aiResult.genre } : {}),
      ...(authoritativeType
        ? { content_type: authoritativeType }
        : (aiResult?.content_type ? { content_type: aiResult.content_type } : {})),
      enrichment_status: 'completed',
      enriched_at: new Date().toISOString(),
      enrichment_error: null,
    })
    .eq('id', eventId)

  if (error) {
    console.error(`[enrich-event] DB update failed for ${eventId}:`, error.message)
    return { eventId, success: false, error: error.message }
  }

  return {
    eventId,
    success: true,
    description: metadata.description,
    imageUrl: metadata.imageUrl,
    tags: metadata.tags,
    genre: aiResult?.genre || null,
    content_type: aiResult?.content_type || null,
  }
}

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  if (req.method !== 'POST') {
    return jsonResponse({ error: 'POST required' }, 405)
  }

  try {
    const { eventIds } = await req.json() as { eventIds: string[] }

    if (!eventIds || !Array.isArray(eventIds) || eventIds.length === 0) {
      return jsonResponse({ error: 'eventIds array required' }, 400)
    }

    if (eventIds.length > 10) {
      return jsonResponse({ error: 'Max 10 events per request' }, 400)
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    )

    // Recover events stuck in 'processing' for > 15 minutes (timed out)
    const fifteenMinAgo = new Date(Date.now() - 15 * 60 * 1000).toISOString()
    const { data: stuckEvents } = await supabase
      .from('events')
      .update({ enrichment_status: 'failed', enrichment_error: 'Timed out in processing state' })
      .eq('enrichment_status', 'processing')
      .lt('updated_at', fifteenMinAgo)
      .select('id')
    if (stuckEvents && stuckEvents.length > 0) {
      console.log(`[enrich-event] Recovered ${stuckEvents.length} stuck events from processing → failed`)
    }

    const { data: events, error: fetchErr } = await supabase
      .from('events')
      .select('id, url, name, venue, genre, content_type, source_id, enrichment_status')
      .in('id', eventIds)
      .in('enrichment_status', ['pending', 'failed'])

    if (fetchErr) {
      console.error('[enrich-event] Failed to fetch events:', fetchErr.message)
      return jsonResponse({ error: fetchErr.message }, 500)
    }

    if (!events || events.length === 0) {
      return jsonResponse({ processed: 0, succeeded: 0, failed: 0, results: [] })
    }

    console.log(`[enrich-event] Processing ${events.length} events`)

    const results: EnrichResult[] = []
    let succeeded = 0
    let failed = 0

    for (const event of events) {
      const result = await enrichSingleEvent(
        supabase, event.id, event.url,
        event.name || '', event.venue || '',
        event.genre || '', event.content_type || '',
        event.source_id || '',
      )
      results.push(result)
      if (result.success) succeeded++
      else failed++

      if (events.length > 1) {
        await new Promise(r => setTimeout(r, 500))
      }
    }

    console.log(`[enrich-event] Done: ${succeeded} succeeded, ${failed} failed`)

    return jsonResponse({
      processed: events.length,
      succeeded,
      failed,
      results,
    })
  } catch (err) {
    console.error('[enrich-event] Error:', err)
    return jsonResponse({ error: (err as Error).message }, 500)
  }
})
