// Supabase Edge Function: scrape-events
// Server-side scraper for all non-Discord event sources.
// Runs on cron (every 2h) or manual trigger. Scrapes STOCK_SOURCES,
// pushes events to cache-events for dedup/upsert/enrichment,
// and tracks run metadata in scrape_runs table.
//
// Actions:
//   POST { action: "refresh-all" }                → scrape all sources
//   POST { action: "refresh", sourceId: "..." }   → scrape single source
//   POST { action: "status" }                     → return last run info

const VERSION = '1.1.0'
console.log(`[scrape-events] v${VERSION} - server-side event scraper`)

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

import { STOCK_SOURCES, type EventSource } from './sources.ts'
import type { ScrapedEvent } from './parsers/utils.ts'

// Parser imports
import { scrapeHtml } from './parsers/html.ts'
import { scrapeRA } from './parsers/ra.ts'
import { scrapeScreenSlate } from './parsers/screenslate.ts'
import { scrapeGarysGuide } from './parsers/garysguide.ts'
import { scrapeBonobo } from './parsers/bonobo.ts'
import { scrapeSFMOMA } from './parsers/sfmoma.ts'
import { scrapeIcal } from './parsers/ical.ts'
import { scrapeJson } from './parsers/json.ts'
import { scrapeRss } from './parsers/rss.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const jsonHeaders = { ...corsHeaders, 'Content-Type': 'application/json' }

// --- Concurrency limiter ---

function createSemaphore(limit: number) {
  let running = 0
  const queue: Array<() => void> = []

  return async function <T>(fn: () => Promise<T>): Promise<T> {
    if (running >= limit) {
      await new Promise<void>(resolve => queue.push(resolve))
    }
    running++
    try {
      return await fn()
    } finally {
      running--
      if (queue.length > 0) queue.shift()!()
    }
  }
}

// --- Parser dispatch ---

async function scrapeSource(source: EventSource): Promise<ScrapedEvent[]> {
  switch (source.type) {
    case 'html': return scrapeHtml(source)
    case 'ra': return scrapeRA(source)
    case 'screenslate': return scrapeScreenSlate(source)
    case 'garysguide': return scrapeGarysGuide(source)
    case 'bonobo': return scrapeBonobo(source)
    case 'sfmoma': return scrapeSFMOMA(source)
    case 'ical': return scrapeIcal(source)
    case 'json': return scrapeJson(source)
    case 'rss': return scrapeRss(source)
    default:
      console.log(`[scrape-events] Unknown source type: ${source.type} for ${source.id}`)
      return []
  }
}

// --- Source outcome interface (matches cache-events SourceOutcome) ---

interface SourceOutcome {
  sourceId: string
  sourceName: string
  sourceUrl: string
  sourceType: string
  eventCount: number
  ok: boolean
  errorReason?: string
  durationMs?: number
}

// --- Push events to cache-events ---

async function pushToCache(
  events: ScrapedEvent[],
  sourceOutcomes: SourceOutcome[],
  supabaseUrl: string,
  serviceKey: string,
): Promise<{ cached: number; updated: number; enrichQueued: number }> {
  // Format events to match ScrapedEvent interface expected by cache-events
  const formatted = events.map(ev => ({
    source: ev.source,
    date: ev.date,
    time: ev.time || undefined,
    name: ev.name,
    venue: ev.venue,
    address: ev.address || undefined,
    city: ev.city || undefined,
    genre: ev.genre || undefined,
    price: ev.price || undefined,
    ages: ev.ages || undefined,
    promoter: ev.promoter || undefined,
    url: ev.url,
    contentType: ev.contentType || undefined,
  }))

  // Send in batches of 400 (cache-events limit is 500)
  let totalCached = 0, totalUpdated = 0, totalEnrichQueued = 0

  for (let i = 0; i < formatted.length; i += 400) {
    const batch = formatted.slice(i, i + 400)
    const isLastBatch = i + 400 >= formatted.length

    try {
      const resp = await fetch(`${supabaseUrl}/functions/v1/cache-events`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${serviceKey}`,
        },
        body: JSON.stringify({
          events: batch,
          // Only send sourceOutcomes with the last batch
          sourceOutcomes: isLastBatch ? sourceOutcomes : undefined,
        }),
      })

      if (resp.ok) {
        const result = await resp.json()
        totalCached += result.cached || 0
        totalUpdated += result.updated || 0
        totalEnrichQueued += result.enrichQueued || 0
      } else {
        const errText = await resp.text()
        console.error(`[scrape-events] cache-events batch failed: ${resp.status} ${errText}`)
      }
    } catch (e) {
      console.error(`[scrape-events] cache-events call failed: ${(e as Error).message}`)
    }
  }

  // If no events but we have outcomes, still send outcomes
  if (formatted.length === 0 && sourceOutcomes.length > 0) {
    try {
      await fetch(`${supabaseUrl}/functions/v1/cache-events`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${serviceKey}`,
        },
        body: JSON.stringify({ events: [], sourceOutcomes }),
      })
    } catch (e) {
      console.error(`[scrape-events] health-only push failed: ${(e as Error).message}`)
    }
  }

  return { cached: totalCached, updated: totalUpdated, enrichQueued: totalEnrichQueued }
}

// --- Scrape run tracking ---

async function createRun(supabase: ReturnType<typeof createClient>, triggeredBy: string): Promise<string | null> {
  const { data, error } = await supabase
    .from('scrape_runs')
    .insert({ triggered_by: triggeredBy })
    .select('id')
    .single()

  if (error) {
    console.error(`[scrape-events] Failed to create run: ${error.message}`)
    return null
  }
  return data.id
}

async function completeRun(
  supabase: ReturnType<typeof createClient>,
  runId: string,
  stats: {
    sourcesAttempted: number
    sourcesSucceeded: number
    sourcesFailed: number
    eventsTotal: number
    eventsNew: number
    eventsUpdated: number
    errorLog: Array<{ sourceId: string; error: string }>
  },
): Promise<void> {
  const { error } = await supabase
    .from('scrape_runs')
    .update({
      completed_at: new Date().toISOString(),
      sources_attempted: stats.sourcesAttempted,
      sources_succeeded: stats.sourcesSucceeded,
      sources_failed: stats.sourcesFailed,
      events_total: stats.eventsTotal,
      events_new: stats.eventsNew,
      events_updated: stats.eventsUpdated,
      error_log: stats.errorLog,
    })
    .eq('id', runId)

  if (error) {
    console.error(`[scrape-events] Failed to complete run: ${error.message}`)
  }
}

// --- Main scrape orchestration ---

async function scrapeAll(triggeredBy: string): Promise<Record<string, unknown>> {
  const supabaseUrl = Deno.env.get('SUPABASE_URL')!
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  const supabase = createClient(supabaseUrl, serviceKey)

  const runId = await createRun(supabase, triggeredBy)
  const semaphore = createSemaphore(5)

  const allEvents: ScrapedEvent[] = []
  const sourceOutcomes: SourceOutcome[] = []
  const errorLog: Array<{ sourceId: string; error: string }> = []
  let sourcesSucceeded = 0
  let sourcesFailed = 0

  console.log(`[scrape-events] Starting refresh-all: ${STOCK_SOURCES.length} sources, concurrency=5`)

  const results = await Promise.allSettled(
    STOCK_SOURCES.map(source =>
      semaphore(async () => {
        const start = Date.now()
        try {
          // Add delay for fragile sources to avoid burst patterns
          if (['sfmoma', 'ra'].includes(source.type)) {
            await new Promise(r => setTimeout(r, 2000))
          }

          const events = await scrapeSource(source)
          const durationMs = Date.now() - start

          console.log(`[scrape-events] ${source.id}: ${events.length} events (${durationMs}ms)`)

          sourceOutcomes.push({
            sourceId: source.id,
            sourceName: source.name,
            sourceUrl: source.url,
            sourceType: source.type,
            eventCount: events.length,
            ok: true,
            errorReason: events.length === 0 ? 'zero_results' : undefined,
            durationMs,
          })

          if (events.length > 0) {
            allEvents.push(...events)
            sourcesSucceeded++
          } else {
            // Zero results is ok but noteworthy
            sourcesSucceeded++
          }

          return { source, events, ok: true }
        } catch (err) {
          const durationMs = Date.now() - start
          const msg = (err as Error).message || 'Unknown error'
          console.error(`[scrape-events] ${source.id} FAILED (${durationMs}ms): ${msg}`)

          sourceOutcomes.push({
            sourceId: source.id,
            sourceName: source.name,
            sourceUrl: source.url,
            sourceType: source.type,
            eventCount: 0,
            ok: false,
            errorReason: classifyError(msg),
            durationMs,
          })

          errorLog.push({ sourceId: source.id, error: msg })
          sourcesFailed++

          return { source, events: [], ok: false, error: msg }
        }
      })
    )
  )

  console.log(`[scrape-events] Scraping complete: ${sourcesSucceeded} succeeded, ${sourcesFailed} failed, ${allEvents.length} total events`)

  // Push all events to cache-events
  const cacheResult = await pushToCache(allEvents, sourceOutcomes, supabaseUrl, serviceKey)
  console.log(`[scrape-events] Cache: ${cacheResult.cached} new, ${cacheResult.updated} updated, ${cacheResult.enrichQueued} enrich queued`)

  // Complete run tracking
  if (runId) {
    await completeRun(supabase, runId, {
      sourcesAttempted: STOCK_SOURCES.length,
      sourcesSucceeded,
      sourcesFailed,
      eventsTotal: allEvents.length,
      eventsNew: cacheResult.cached,
      eventsUpdated: cacheResult.updated,
      errorLog,
    })
  }

  return {
    sourcesAttempted: STOCK_SOURCES.length,
    sourcesSucceeded,
    sourcesFailed,
    eventsTotal: allEvents.length,
    eventsNew: cacheResult.cached,
    eventsUpdated: cacheResult.updated,
    enrichQueued: cacheResult.enrichQueued,
    errorLog: errorLog.length > 0 ? errorLog : undefined,
    runId,
  }
}

async function scrapeSingle(sourceId: string): Promise<Record<string, unknown>> {
  const source = STOCK_SOURCES.find(s => s.id === sourceId)
  if (!source) {
    return { error: `Source not found: ${sourceId}` }
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

  const start = Date.now()
  try {
    const events = await scrapeSource(source)
    const durationMs = Date.now() - start

    console.log(`[scrape-events] ${source.id}: ${events.length} events (${durationMs}ms)`)

    const outcome: SourceOutcome = {
      sourceId: source.id,
      sourceName: source.name,
      sourceUrl: source.url,
      sourceType: source.type,
      eventCount: events.length,
      ok: true,
      errorReason: events.length === 0 ? 'zero_results' : undefined,
      durationMs,
    }

    const cacheResult = await pushToCache(events, [outcome], supabaseUrl, serviceKey)

    return {
      sourceId: source.id,
      eventsScraped: events.length,
      eventsNew: cacheResult.cached,
      eventsUpdated: cacheResult.updated,
      enrichQueued: cacheResult.enrichQueued,
      durationMs,
    }
  } catch (err) {
    const durationMs = Date.now() - start
    const msg = (err as Error).message || 'Unknown error'

    const outcome: SourceOutcome = {
      sourceId: source.id,
      sourceName: source.name,
      sourceUrl: source.url,
      sourceType: source.type,
      eventCount: 0,
      ok: false,
      errorReason: classifyError(msg),
      durationMs,
    }

    await pushToCache([], [outcome], supabaseUrl, serviceKey)

    return { sourceId: source.id, error: msg, durationMs }
  }
}

async function getStatus(): Promise<Record<string, unknown>> {
  const supabaseUrl = Deno.env.get('SUPABASE_URL')!
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  const supabase = createClient(supabaseUrl, serviceKey)

  const { data } = await supabase
    .from('scrape_runs')
    .select('*')
    .order('started_at', { ascending: false })
    .limit(5)

  return { runs: data || [], totalSources: STOCK_SOURCES.length }
}

function classifyError(msg: string): string {
  const m = msg.toLowerCase()
  if (m.includes('timeout') || m.includes('aborted')) return 'timeout'
  if (m.includes('403') || m.includes('forbidden') || m.includes('blocked')) return 'blocked'
  if (m.includes('404') || m.includes('not found')) return 'missing'
  if (m.includes('500') || m.includes('502') || m.includes('503')) return 'server'
  if (m.includes('parse') || m.includes('unexpected token')) return 'parse'
  return 'unknown'
}

// --- Auth: service-role only ---

function requireServiceRole(req: Request): Response | null {
  const authHeader = req.headers.get('authorization')
  if (!authHeader) {
    return new Response(JSON.stringify({ error: 'Missing authorization header' }), {
      status: 401,
      headers: jsonHeaders,
    })
  }

  const token = authHeader.replace('Bearer ', '')
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (!serviceKey || token !== serviceKey) {
    return new Response(JSON.stringify({ error: 'Forbidden — service role key required' }), {
      status: 403,
      headers: jsonHeaders,
    })
  }

  return null // auth passed
}

// --- Handler ---

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'POST required' }), {
      status: 405,
      headers: jsonHeaders,
    })
  }

  // Require service role key for all actions
  const authError = requireServiceRole(req)
  if (authError) return authError

  try {
    const body = await req.json() as { action?: string; sourceId?: string }
    const action = body.action || 'refresh-all'

    if (action === 'status') {
      const result = await getStatus()
      return new Response(JSON.stringify(result), { headers: jsonHeaders })
    }

    if (action === 'refresh' && body.sourceId) {
      const result = await scrapeSingle(body.sourceId)
      return new Response(JSON.stringify(result), {
        status: result.error ? 500 : 200,
        headers: jsonHeaders,
      })
    }

    if (action === 'refresh-all') {
      const result = await scrapeAll('manual')
      return new Response(JSON.stringify(result), { headers: jsonHeaders })
    }

    return new Response(JSON.stringify({ error: `Unknown action: ${action}` }), {
      status: 400,
      headers: jsonHeaders,
    })
  } catch (err) {
    console.error('[scrape-events] Handler error:', err)
    return new Response(JSON.stringify({ error: (err as Error).message }), {
      status: 500,
      headers: jsonHeaders,
    })
  }
})
