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

const VERSION = '1.8.0'
console.log(`[scrape-events] v${VERSION} - seetickets-wp parser (The Chapel, Rickshaw Stop server-rendered cards)`)

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
import { scrapeEventbriteOrg } from './parsers/eventbrite-org.ts'
import { scrapeAta } from './parsers/ata.ts'
import { scrapeBottomOfTheHill } from './parsers/bottomofthehill.ts'
import { scrapeSeeticketsWp } from './parsers/seetickets-wp.ts'
import { scrapeJson } from './parsers/json.ts'
import { scrapeRss } from './parsers/rss.ts'
import { scrapeFamsf } from './parsers/famsf.ts'
import { scrapeSfpl } from './parsers/sfpl.ts'
import { scrapeCommonwealth } from './parsers/commonwealth.ts'

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

// --- Source registry ---
// Sources live in the event_sources table so adding one of an existing
// parser type is an INSERT, not a deploy. STOCK_SOURCES remains as the
// fallback if the table is unreachable or empty.

async function loadSources(supabase: ReturnType<typeof createClient>): Promise<EventSource[]> {
  try {
    const { data, error } = await supabase
      .from('event_sources')
      .select('id, name, category, type, url, region, description')
      .eq('enabled', true)
      // Curation feeds (type=discord) are scraped by scrape-discord-events,
      // kicked at the end of this run — not by this dispatcher. Including
      // them here would log a zero-result outcome every run and drive their
      // source_health to 'broken'.
      .neq('type', 'discord')

    if (error || !data || data.length === 0) {
      console.log(`[scrape-events] Registry unavailable (${error?.message || 'empty'}), falling back to STOCK_SOURCES`)
      return STOCK_SOURCES
    }
    return data as EventSource[]
  } catch (e) {
    console.log(`[scrape-events] Registry load failed (${(e as Error).message}), falling back to STOCK_SOURCES`)
    return STOCK_SOURCES
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
    case 'eventbrite-org': return scrapeEventbriteOrg(source)
    case 'ata': return scrapeAta(source)
    case 'bottomofthehill': return scrapeBottomOfTheHill(source)
    case 'seetickets-wp': return scrapeSeeticketsWp(source)
    case 'json': return scrapeJson(source)
    case 'rss': return scrapeRss(source)
    case 'famsf': return scrapeFamsf(source)
    case 'sfpl': return scrapeSfpl(source)
    case 'commonwealth': return scrapeCommonwealth(source)
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

// The Supabase edge platform validates Authorization: Bearer <token> at the
// gateway and requires a valid JWT. Env service/anon keys may be in the new
// non-JWT "sb_secret_" format, so we fall back to the public anon JWT for
// internal function-to-function calls (overridable via INTERNAL_ANON_JWT).
// Callee functions use their own service role for DB writes, so no
// permission escalation is possible with this token.
function internalJwt(): string {
  return Deno.env.get('INTERNAL_ANON_JWT')
    || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InlmaHVkd2FrcGd6c3dpeWxoZmJoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njk4MTE3ODYsImV4cCI6MjA4NTM4Nzc4Nn0.bemC-CPA2vkoM5P4P-tmsPQ1RPr4ifPa5iginUXPKLI'
}

// --- Push events to cache-events ---

async function pushToCache(
  events: ScrapedEvent[],
  sourceOutcomes: SourceOutcome[],
  supabaseUrl: string,
  _serviceKey: string,
): Promise<{ cached: number; updated: number; enrichQueued: number; batchErrors: string[] }> {
  const serviceKey = internalJwt()
  void _serviceKey
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
    description: ev.description || undefined,
  }))

  // Send in batches of 400 (cache-events limit is 500). Source outcomes ride
  // with the first batch; if that request fails they're retried as a
  // health-only push at the end so a single failed batch can't lose a whole
  // run's health tracking.
  let totalCached = 0, totalUpdated = 0, totalEnrichQueued = 0
  let outcomesDelivered = false
  const batchErrors: string[] = []

  for (let i = 0; i < formatted.length; i += 400) {
    const batch = formatted.slice(i, i + 400)
    const attachOutcomes = !outcomesDelivered && sourceOutcomes.length > 0

    try {
      const resp = await fetch(`${supabaseUrl}/functions/v1/cache-events`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${serviceKey}`,
        },
        body: JSON.stringify({
          events: batch,
          sourceOutcomes: attachOutcomes ? sourceOutcomes : undefined,
        }),
      })

      if (resp.ok) {
        const result = await resp.json()
        totalCached += result.cached || 0
        totalUpdated += result.updated || 0
        totalEnrichQueued += result.enrichQueued || 0
        if (attachOutcomes) outcomesDelivered = true
      } else {
        const errText = await resp.text()
        console.error(`[scrape-events] cache-events batch failed: ${resp.status} ${errText}`)
        batchErrors.push(`batch ${i / 400 + 1} (${batch.length} events): HTTP ${resp.status} ${errText.slice(0, 200)}`)
      }
    } catch (e) {
      console.error(`[scrape-events] cache-events call failed: ${(e as Error).message}`)
      batchErrors.push(`batch ${i / 400 + 1} (${batch.length} events): ${(e as Error).message}`)
    }
  }

  // Health-only push if outcomes never made it (no events, or first batch failed)
  if (!outcomesDelivered && sourceOutcomes.length > 0) {
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

  return { cached: totalCached, updated: totalUpdated, enrichQueued: totalEnrichQueued, batchErrors }
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
  const sources = await loadSources(supabase)
  const semaphore = createSemaphore(5)

  const allEvents: ScrapedEvent[] = []
  const sourceOutcomes: SourceOutcome[] = []
  const errorLog: Array<{ sourceId: string; error: string }> = []
  let sourcesSucceeded = 0
  let sourcesFailed = 0

  console.log(`[scrape-events] Starting refresh-all: ${sources.length} sources, concurrency=5`)

  const results = await Promise.allSettled(
    sources.map(source =>
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
  // Batch failures mean scraped events were dropped — record them in the run
  for (const be of cacheResult.batchErrors) {
    errorLog.push({ sourceId: '_cache-batch', error: be })
  }

  // Complete run tracking
  if (runId) {
    await completeRun(supabase, runId, {
      sourcesAttempted: sources.length,
      sourcesSucceeded,
      sourcesFailed,
      eventsTotal: allEvents.length,
      eventsNew: cacheResult.cached,
      eventsUpdated: cacheResult.updated,
      errorLog,
    })
  }

  // Post-run housekeeping: purge stale events/caches/runs (the cleanup
  // functions existed since migrations 009/010/039 but nothing invoked them).
  let maintenance: unknown = null
  try {
    const { data, error } = await supabase.rpc('run_events_maintenance')
    if (error) {
      console.error(`[scrape-events] Maintenance failed: ${error.message}`)
    } else {
      maintenance = data
      console.log(`[scrape-events] Maintenance: ${JSON.stringify(data)}`)
    }
  } catch (e) {
    console.error(`[scrape-events] Maintenance error: ${(e as Error).message}`)
  }

  // Kick the Discord scraper (it has no cron of its own; its 4h cache TTL
  // makes an every-2h kick a no-op half the time). Fire-and-forget.
  try {
    fetch(`${supabaseUrl}/functions/v1/scrape-discord-events`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${internalJwt()}`,
      },
      body: JSON.stringify({ action: 'refresh-all' }),
    }).catch(err => console.error(`[scrape-events] Discord trigger failed: ${err.message}`))
  } catch (e) {
    console.error(`[scrape-events] Discord trigger error: ${(e as Error).message}`)
  }

  return {
    sourcesAttempted: sources.length,
    sourcesSucceeded,
    sourcesFailed,
    eventsTotal: allEvents.length,
    eventsNew: cacheResult.cached,
    eventsUpdated: cacheResult.updated,
    enrichQueued: cacheResult.enrichQueued,
    maintenance,
    errorLog: errorLog.length > 0 ? errorLog : undefined,
    runId,
  }
}

async function scrapeSingle(sourceId: string): Promise<Record<string, unknown>> {
  const supabaseUrl = Deno.env.get('SUPABASE_URL')!
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  const supabase = createClient(supabaseUrl, serviceKey)

  const sources = await loadSources(supabase)
  const source = sources.find(s => s.id === sourceId)
  if (!source) {
    return { error: `Source not found: ${sourceId}` }
  }

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

  const sources = await loadSources(supabase)
  return { runs: data || [], totalSources: sources.length }
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
// Verifies the caller has service_role privileges via:
// 1. Direct match against SUPABASE_SERVICE_ROLE_KEY
// 2. JWT payload role === 'service_role'

function requireServiceRole(req: Request): Response | null {
  const authHeader = req.headers.get('authorization')
  if (!authHeader) {
    return new Response(JSON.stringify({ error: 'Missing authorization header' }), {
      status: 401,
      headers: jsonHeaders,
    })
  }

  const token = authHeader.replace('Bearer ', '')

  // Direct match against service role key
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (serviceKey && token === serviceKey) return null

  // Check if it's a JWT with service_role claim
  try {
    const parts = token.split('.')
    if (parts.length === 3) {
      const payload = JSON.parse(atob(parts[1]))
      if (payload.role === 'service_role') return null
    }
  } catch (_e) { /* not a valid JWT */ }

  return new Response(JSON.stringify({ error: 'Forbidden — service role key required' }), {
    status: 403,
    headers: jsonHeaders,
  })
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
