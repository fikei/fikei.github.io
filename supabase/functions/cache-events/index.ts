// Supabase Edge Function: cache-events
// Accepts scraped events from the client, deduplicates via event_key, upserts to DB.
// Triggers enrichment for new events that have URLs.
// Also accepts sourceOutcomes for persistent health tracking.
//
// POST /functions/v1/cache-events
// Body: { events: Event[], sourceOutcomes?: SourceOutcome[] }
// Returns: { cached, updated, enrichQueued, healthUpdated, errors }

const VERSION = '1.2.0'
console.log(`[cache-events] v${VERSION} - responsive status derivation`)

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

// --- Source Health Upsert (mirrors domain_profiles pattern from enrich-link) ---

function deriveStatus(successRate: number, consecutiveFailures: number, totalScrapes: number): string {
  if (totalScrapes === 0) return 'unknown'
  // Broken: persistent failure pattern
  if (consecutiveFailures >= 6) return 'broken'
  if (totalScrapes >= 5 && successRate < 0.3) return 'broken'
  if (totalScrapes >= 2 && successRate === 0) return 'broken' // never worked after 2+ scrapes
  // Degraded: concerning failure pattern
  if (consecutiveFailures >= 3) return 'degraded'
  if (totalScrapes >= 3 && successRate < 0.65) return 'degraded'
  if (consecutiveFailures >= 1 && successRate < 0.5) return 'degraded' // early warning
  // Healthy: consistent success
  if (successRate >= 0.8 && consecutiveFailures === 0) return 'healthy'
  if (totalScrapes === 1 && successRate === 1.0) return 'healthy' // first scrape succeeded
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

    const total = existing.total_scrapes + 1
    const successCount = existing.success_count + (isSuccess ? 1 : 0)
    const zeroCount = existing.zero_result_count + (outcomeKey === 'zero_results' ? 1 : 0)
    const errorCount = existing.error_count + (!outcome.ok ? 1 : 0)
    const successRate = total > 0 ? successCount / total : 1.0
    const consecutiveFailures = isSuccess ? 0 : existing.consecutive_failures + 1
    const status = deriveStatus(successRate, consecutiveFailures, total)

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
    const outcomesSeen = { [outcomeKey]: 1 }
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
      return {
        event_key: eventKey,
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
        scraped_at: new Date().toISOString(),
      }
    }))

    const validRows = rows.filter(Boolean) as Record<string, unknown>[]

    if (validRows.length === 0) {
      return jsonResponse({ cached: 0, updated: 0, enrichQueued: 0, healthUpdated, errors: ['No valid events'] })
    }

    // Check which event_keys already exist
    const keys = validRows.map(r => r.event_key as string)
    const { data: existing } = await supabase
      .from('events')
      .select('event_key, id, enrichment_status')
      .in('event_key', keys)

    const existingMap = new Map<string, { id: string; enrichment_status: string }>()
    if (existing) {
      for (const row of existing) {
        existingMap.set(row.event_key, { id: row.id, enrichment_status: row.enrichment_status })
      }
    }

    // Split into inserts and updates
    const toInsert = validRows.filter(r => !existingMap.has(r.event_key as string))
    const toUpdate = validRows.filter(r => existingMap.has(r.event_key as string))

    // Batch insert new events
    if (toInsert.length > 0) {
      const { data: inserted, error: insertErr } = await supabase
        .from('events')
        .insert(toInsert)
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

    // Batch update existing events (refresh scraped_at)
    if (toUpdate.length > 0) {
      for (const row of toUpdate) {
        const { error: updateErr } = await supabase
          .from('events')
          .update({ scraped_at: row.scraped_at })
          .eq('event_key', row.event_key)

        if (updateErr) {
          errors.push(`Update ${row.event_key}: ${updateErr.message}`)
        } else {
          updated++
        }
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
