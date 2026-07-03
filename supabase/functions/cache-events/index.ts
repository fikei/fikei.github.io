// Supabase Edge Function: cache-events
// Accepts scraped events from the client, deduplicates via event_key, upserts to DB.
// Triggers enrichment for new events that have URLs.
// Also accepts sourceOutcomes for persistent health tracking.
//
// POST /functions/v1/cache-events
// Body: { events: Event[], sourceOutcomes?: SourceOutcome[] }
// Returns: { cached, updated, enrichQueued, healthUpdated, errors }

const VERSION = '1.5.1'
console.log(`[cache-events] v${VERSION} - chunked existence check + duplicate-proof inserts (unchunked .in() silently failed, killing batches)`)

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

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

// Generate SHA-256 event key matching the DB helper function
async function generateEventKey(source: string, date: string, name: string, venue: string): Promise<string> {
  const normalized = `${source}|${date}|${name.trim().toLowerCase()}|${venue.trim().toLowerCase()}`
  const data = new TextEncoder().encode(normalized)
  const hashBuffer = await crypto.subtle.digest('SHA-256', data)
  return Array.from(new Uint8Array(hashBuffer))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('')
}

// Source-agnostic key so the same event scraped from two sources can be
// merged in the UI. Strips diacritics (Café → cafe) and collapses whitespace;
// SQL backfill in migration 088 matches this except diacritics (converges on
// next scrape since updates rewrite the key).
function normalizeForKey(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim()
    .replace(/\s+/g, ' ')
}

async function generateCanonicalKey(date: string, name: string, venue: string): Promise<string> {
  const normalized = `${date}|${normalizeForKey(name)}|${normalizeForKey(venue)}`
  const data = new TextEncoder().encode(normalized)
  const hashBuffer = await crypto.subtle.digest('SHA-256', data)
  return Array.from(new Uint8Array(hashBuffer))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('')
}

interface ScrapedEvent {
  source: string
  date: string
  time?: string
  name: string
  venue: string
  address?: string
  city?: string
  genre?: string
  price?: string
  ages?: string
  promoter?: string
  url: string
  contentType?: string
}

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

// --- Source Health Upsert (mirrors domain_profiles pattern from create-pin) ---

function deriveStatus(successRate: number, consecutiveFailures: number, totalScrapes: number, countDegraded = false): string {
  if (totalScrapes === 0) return 'unknown'
  // Most recent scrape succeeded — source is working, show as healthy
  // Low historical rates don't matter if the source is currently functioning
  if (consecutiveFailures === 0) {
    if (countDegraded) return 'degraded'
    return 'healthy'
  }
  // Broken: persistent failure pattern
  if (consecutiveFailures >= 6) return 'broken'
  if (totalScrapes >= 5 && successRate < 0.3) return 'broken'
  if (totalScrapes >= 2 && successRate === 0) return 'broken' // never worked after 2+ scrapes
  // Degraded: concerning failure pattern
  if (consecutiveFailures >= 3) return 'degraded'
  if (totalScrapes >= 3 && successRate < 0.65) return 'degraded'
  if (consecutiveFailures >= 1 && successRate < 0.5) return 'degraded' // early warning
  // Event count degradation: source works but returns far fewer events than peak
  if (countDegraded) return 'degraded'
  // Healthy
  if (successRate >= 0.8) return 'healthy'
  if (totalScrapes === 1 && successRate === 1.0) return 'healthy'
  return 'unknown'
}

async function upsertSourceHealth(
  supabase: ReturnType<typeof createClient>,
  outcome: SourceOutcome,
): Promise<void> {
  const isSuccess = outcome.ok && outcome.eventCount > 0
  const outcomeKey = isSuccess ? 'success'
    : (outcome.ok && outcome.eventCount === 0) ? 'zero_results'
    : (outcome.errorReason || 'unknown')

  const { data: existing } = await supabase
    .from('source_health')
    .select('*')
    .eq('source_id', outcome.sourceId)
    .single()

  if (existing) {
    const outcomesSeen = existing.outcomes_seen || {}
    outcomesSeen[outcomeKey] = (outcomesSeen[outcomeKey] || 0) + 1

    // Track peak event count (stored in JSONB to avoid migration).
    // The peak decays 0.5% per successful scrape (~34%/week at 12 scrapes/day)
    // so a listing-volume high from months ago doesn't flag the source as
    // degraded forever — count_drop should mean "recent drop", not
    // "smaller than the all-time record".
    const previousPeak = outcomesSeen.peak_event_count || 0
    if (isSuccess) {
      outcomesSeen.peak_event_count = Math.round(Math.max(outcome.eventCount, previousPeak * 0.995) * 10) / 10
    }
    const peakCount = outcomesSeen.peak_event_count || 0

    // Detect event count degradation: source returns >0 events but far fewer than peak
    // Threshold: >50% drop from peak, and peak must be meaningful (>20 events)
    const countDegraded = isSuccess && peakCount > 20 && outcome.eventCount < peakCount * 0.5
    if (countDegraded) {
      outcomesSeen.count_drop = (outcomesSeen.count_drop || 0) + 1
      console.log(`[cache-events] Count degradation: ${outcome.sourceId} returned ${outcome.eventCount} vs peak ${peakCount} (${Math.round(outcome.eventCount / peakCount * 100)}%)`)
    }

    const total = existing.total_scrapes + 1
    const successCount = existing.success_count + (isSuccess ? 1 : 0)
    const zeroCount = existing.zero_result_count + (outcomeKey === 'zero_results' ? 1 : 0)
    const errorCount = existing.error_count + (!outcome.ok ? 1 : 0)
    const successRate = total > 0 ? successCount / total : 1.0
    const consecutiveFailures = isSuccess ? 0 : existing.consecutive_failures + 1
    const status = deriveStatus(successRate, consecutiveFailures, total, countDegraded)

    await supabase.from('source_health').update({
      source_name: outcome.sourceName,
      source_url: outcome.sourceUrl,
      source_type: outcome.sourceType,
      outcomes_seen: outcomesSeen,
      total_scrapes: total,
      success_count: successCount,
      zero_result_count: zeroCount,
      error_count: errorCount,
      success_rate: successRate,
      consecutive_failures: consecutiveFailures,
      last_failure_reason: isSuccess ? existing.last_failure_reason : (outcome.errorReason || outcomeKey),
      last_failure_at: isSuccess ? existing.last_failure_at : new Date().toISOString(),
      last_success_at: isSuccess ? new Date().toISOString() : existing.last_success_at,
      last_success_event_count: isSuccess ? outcome.eventCount : existing.last_success_event_count,
      status,
      last_scraped_at: new Date().toISOString(),
    }).eq('source_id', outcome.sourceId)
  } else {
    const outcomesSeen: Record<string, unknown> = { [outcomeKey]: 1 }
    // Track peak event count from first scrape
    if (isSuccess && outcome.eventCount > 0) {
      outcomesSeen.peak_event_count = outcome.eventCount
    }
    await supabase.from('source_health').insert({
      source_id: outcome.sourceId,
      source_name: outcome.sourceName,
      source_url: outcome.sourceUrl,
      source_type: outcome.sourceType,
      outcomes_seen: outcomesSeen,
      total_scrapes: 1,
      success_count: isSuccess ? 1 : 0,
      zero_result_count: outcomeKey === 'zero_results' ? 1 : 0,
      error_count: !outcome.ok ? 1 : 0,
      success_rate: isSuccess ? 1.0 : 0.0,
      consecutive_failures: isSuccess ? 0 : 1,
      last_failure_reason: isSuccess ? null : (outcome.errorReason || outcomeKey),
      last_failure_at: isSuccess ? null : new Date().toISOString(),
      last_success_at: isSuccess ? new Date().toISOString() : null,
      last_success_event_count: isSuccess ? outcome.eventCount : null,
      status: 'unknown',
      last_scraped_at: new Date().toISOString(),
    })
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
    const body = await req.json() as { events?: ScrapedEvent[]; sourceOutcomes?: SourceOutcome[] }
    const events = body.events
    const sourceOutcomes = body.sourceOutcomes

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    const supabase = createClient(supabaseUrl, supabaseKey)

    // --- Process source health outcomes (if provided) ---
    let healthUpdated = 0
    if (sourceOutcomes && Array.isArray(sourceOutcomes) && sourceOutcomes.length > 0) {
      for (const outcome of sourceOutcomes) {
        if (!outcome.sourceId) continue
        try {
          await upsertSourceHealth(supabase, outcome)
          healthUpdated++
        } catch (err) {
          console.error(`[cache-events] Health upsert failed for ${outcome.sourceId}:`, (err as Error).message)
        }
      }
      console.log(`[cache-events] Health: updated ${healthUpdated}/${sourceOutcomes.length} sources`)
    }

    // --- If no events, return health-only result ---
    if (!events || !Array.isArray(events) || events.length === 0) {
      if (healthUpdated > 0) {
        return jsonResponse({ cached: 0, updated: 0, enrichQueued: 0, healthUpdated })
      }
      return jsonResponse({ error: 'events array required' }, 400)
    }

    if (events.length > 500) {
      return jsonResponse({ error: 'Max 500 events per request' }, 400)
    }

    let cached = 0
    let updated = 0
    const newEventIds: string[] = []
    const errors: string[] = []

    // Build rows with event keys
    const rows = await Promise.all(events.map(async (ev) => {
      if (!ev.source || !ev.date || !ev.name || !ev.venue || !ev.url) return null
      const eventKey = await generateEventKey(ev.source, ev.date, ev.name, ev.venue)
      const canonicalKey = await generateCanonicalKey(ev.date, ev.name, ev.venue)
      return {
        event_key: eventKey,
        canonical_key: canonicalKey,
        source_id: ev.source,
        date: ev.date,
        time: ev.time || null,
        name: ev.name,
        venue: ev.venue,
        address: ev.address || null,
        city: ev.city || null,
        genre: ev.genre || null,
        price: ev.price || null,
        ages: ev.ages || null,
        promoter: ev.promoter || null,
        url: ev.url,
        content_type: ev.contentType || null,
        description: ev.description || null,
        scraped_at: new Date().toISOString(),
      }
    }))

    const validRows = rows.filter(Boolean) as Record<string, unknown>[]

    if (validRows.length === 0) {
      return jsonResponse({ cached: 0, updated: 0, enrichQueued: 0, healthUpdated, errors: ['No valid events'] })
    }

    // Check which event_keys already exist. Chunked: .in() with 400 64-char
    // keys builds a ~26KB URL that the gateway rejects — and that failure was
    // silently swallowed, routing every row to insert, where the whole batch
    // died on the unique constraint. Months of scrapes were lost this way.
    const keys = validRows.map(r => r.event_key as string)
    const existingMap = new Map<string, { id: string; enrichment_status: string }>()
    for (let i = 0; i < keys.length; i += 100) {
      const chunk = keys.slice(i, i + 100)
      const { data: existing, error: existErr } = await supabase
        .from('events')
        .select('event_key, id, enrichment_status')
        .in('event_key', chunk)
      if (existErr) {
        // Not fatal: unmatched rows fall through to the insert path, which
        // ignores duplicates — worst case their scraped_at doesn't refresh.
        console.error(`[cache-events] Existence check chunk failed: ${existErr.message}`)
        errors.push(`Existence check: ${existErr.message}`)
        continue
      }
      for (const row of existing || []) {
        existingMap.set(row.event_key, { id: row.id, enrichment_status: row.enrichment_status })
      }
    }

    // Split into inserts and updates. De-dupe within batch by event_key so a
    // single intra-batch collision doesn't abort the whole insert (Postgres
    // unique-constraint violation kills a multi-row insert atomically).
    const seenKeys = new Set<string>()
    const toInsert: Record<string, unknown>[] = []
    const toUpdate: Record<string, unknown>[] = []
    for (const r of validRows) {
      const k = r.event_key as string
      if (existingMap.has(k)) { toUpdate.push(r); continue }
      if (seenKeys.has(k)) continue
      seenKeys.add(k)
      toInsert.push(r)
    }

    // Batch insert new events. ignoreDuplicates makes this immune to a stale
    // existence check — conflicting rows are skipped, never a batch-killing
    // constraint violation.
    if (toInsert.length > 0) {
      const { data: inserted, error: insertErr } = await supabase
        .from('events')
        .upsert(toInsert, { onConflict: 'event_key', ignoreDuplicates: true })
        .select('id, url, enrichment_status')

      if (insertErr) {
        console.error('[cache-events] Insert error:', insertErr.message)
        errors.push(`Insert: ${insertErr.message}`)
      } else {
        cached = inserted?.length || 0
        if (inserted) {
          for (const row of inserted) {
            if (row.url && row.enrichment_status === 'pending') {
              newEventIds.push(row.id)
            }
          }
        }
      }
    }

    // Refresh existing events with ONE bulk upsert per batch. The previous
    // per-row update loop (up to 400 sequential round-trips) blew the edge
    // function's time budget, so every batch after the first 504'd and its
    // events were silently lost — sources late in the run never refreshed.
    // Only scraper-owned columns are included; enrichment-owned columns
    // (description, image_url, tags, genre, content_type, enrichment_*) are
    // omitted so the upsert can't clobber AI-enriched values.
    if (toUpdate.length > 0) {
      const patchRows = toUpdate.map(row => ({
        event_key: row.event_key,
        canonical_key: row.canonical_key,
        source_id: row.source_id,
        date: row.date,
        time: row.time,
        name: row.name,
        venue: row.venue,
        address: row.address,
        city: row.city,
        price: row.price,
        ages: row.ages,
        promoter: row.promoter,
        url: row.url,
        scraped_at: row.scraped_at,
      }))
      const { data: upserted, error: upsertErr } = await supabase
        .from('events')
        .upsert(patchRows, { onConflict: 'event_key' })
        .select('id')

      if (upsertErr) {
        errors.push(`Bulk update: ${upsertErr.message}`)
      } else {
        updated = upserted?.length || patchRows.length
      }
    }

    // Trigger enrichment for new events (fire-and-forget, batch of up to 10)
    let enrichQueued = 0
    if (newEventIds.length > 0) {
      const batches = []
      for (let i = 0; i < newEventIds.length; i += 10) {
        batches.push(newEventIds.slice(i, i + 10))
      }

      for (const batch of batches) {
        try {
          fetch(`${supabaseUrl}/functions/v1/enrich-event`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${supabaseKey}`,
            },
            body: JSON.stringify({ eventIds: batch }),
          }).catch(err => {
            console.error('[cache-events] Enrich trigger failed:', err.message)
          })
          enrichQueued += batch.length
        } catch (err) {
          console.error('[cache-events] Failed to trigger enrichment:', err)
        }
      }
    }

    console.log(`[cache-events] cached=${cached} updated=${updated} enrichQueued=${enrichQueued} healthUpdated=${healthUpdated} errors=${errors.length}`)

    return jsonResponse({ cached, updated, enrichQueued, healthUpdated, errors: errors.length > 0 ? errors : undefined })
  } catch (err) {
    console.error('[cache-events] Error:', err)
    return jsonResponse({ error: (err as Error).message }, 500)
  }
})
