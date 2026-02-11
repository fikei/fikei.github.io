// Supabase Edge Function: enrich-event
// Fetches event detail URLs to extract description, image, and tags.
// Called by cache-events for newly cached events.
//
// POST /functions/v1/enrich-event
// Body: { eventIds: string[] }   (batch up to 10)
// Returns: { processed, succeeded, failed, results }

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
  error?: string
}

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

  const tagSelectors = '.tag, .genre, .category, [rel="tag"], .event-tag, .event-category'
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

async function enrichSingleEvent(
  supabase: ReturnType<typeof createClient>,
  eventId: string,
  eventUrl: string
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

  const hasData = metadata.description || metadata.imageUrl || metadata.tags.length > 0
  if (!hasData) {
    await supabase
      .from('events')
      .update({ enrichment_status: 'completed', enriched_at: new Date().toISOString() })
      .eq('id', eventId)
    return { eventId, success: true, description: null, imageUrl: null, tags: [] }
  }

  const { error } = await supabase
    .from('events')
    .update({
      description: metadata.description,
      image_url: metadata.imageUrl,
      tags: metadata.tags.length > 0 ? metadata.tags : null,
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

    const { data: events, error: fetchErr } = await supabase
      .from('events')
      .select('id, url, enrichment_status')
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
      const result = await enrichSingleEvent(supabase, event.id, event.url)
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
