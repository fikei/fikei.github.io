// Supabase Edge Function: cache-events
// Accepts scraped events from the client, deduplicates via event_key, upserts to DB.
// Triggers enrichment for new events that have URLs.
//
// POST /functions/v1/cache-events
// Body: { events: Event[] }
// Returns: { cached, updated, enrichQueued, errors }

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

// Generate MD5 event key matching the DB helper function
async function generateEventKey(source: string, date: string, name: string, venue: string): Promise<string> {
  const normalized = `${source}|${date}|${name.trim().toLowerCase()}|${venue.trim().toLowerCase()}`
  const data = new TextEncoder().encode(normalized)
  const hashBuffer = await crypto.subtle.digest('MD5', data)
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

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  if (req.method !== 'POST') {
    return jsonResponse({ error: 'POST required' }, 405)
  }

  try {
    const { events } = await req.json() as { events: ScrapedEvent[] }

    if (!events || !Array.isArray(events) || events.length === 0) {
      return jsonResponse({ error: 'events array required' }, 400)
    }

    if (events.length > 500) {
      return jsonResponse({ error: 'Max 500 events per request' }, 400)
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    const supabase = createClient(supabaseUrl, supabaseKey)

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
      return jsonResponse({ cached: 0, updated: 0, enrichQueued: 0, errors: ['No valid events'] })
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

    console.log(`[cache-events] cached=${cached} updated=${updated} enrichQueued=${enrichQueued} errors=${errors.length}`)

    return jsonResponse({ cached, updated, enrichQueued, errors: errors.length > 0 ? errors : undefined })
  } catch (err) {
    console.error('[cache-events] Error:', err)
    return jsonResponse({ error: (err as Error).message }, 500)
  }
})
