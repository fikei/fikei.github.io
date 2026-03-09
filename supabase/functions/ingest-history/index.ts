// Supabase Edge Function: ingest-history
// Receives batched browsing history events from the Chrome extension.
// Raw URLs are NEVER received — client sends only url_hash, canonical_domain,
// page_title, referrer_domain, session_id, visited_at, source, device_id.
//
// POST /functions/v1/ingest-history
// Authorization: Bearer <user_access_token>
// Body: { events: HistoryEvent[] }
// Returns: { inserted: number, skipped: number }

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const VERSION = '1.0.0'
console.log(`[ingest-history] v${VERSION} - privacy-first browsing history ingestion`)

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface HistoryEvent {
  device_id: string
  visited_at: string
  canonical_domain: string
  url_hash: string
  page_title?: string
  referrer_domain?: string
  session_id: string
  source: 'history' | 'navigation'
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

function err(message: string, status = 400) {
  return json({ error: message }, status)
}

async function getUserId(req: Request): Promise<string | null> {
  const authHeader = req.headers.get('authorization')
  if (!authHeader) return null

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_ANON_KEY')!,
    { global: { headers: { Authorization: authHeader } } }
  )

  const { data: { user } } = await supabase.auth.getUser()
  return user?.id ?? null
}

function getServiceClient() {
  return createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  )
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    // Authenticate
    const userId = await getUserId(req)
    if (!userId) return err('Unauthorized', 401)

    // Parse body
    const body = await req.json()
    const events: HistoryEvent[] = body.events
    if (!Array.isArray(events) || events.length === 0) {
      return err('events must be a non-empty array')
    }

    if (events.length > 200) {
      return err('Batch too large (max 200 events)')
    }

    // Validate each event
    const rows = []
    for (const e of events) {
      if (!e.device_id || !e.visited_at || !e.canonical_domain ||
          !e.url_hash || !/^[0-9a-f]{64}$/.test(e.url_hash) ||
          !e.session_id ||
          (e.source !== 'history' && e.source !== 'navigation')) {
        continue  // skip invalid events silently
      }

      rows.push({
        user_id: userId,
        device_id: e.device_id,
        visited_at: e.visited_at,
        canonical_domain: e.canonical_domain.toLowerCase().slice(0, 253),
        url_hash: e.url_hash,
        page_title: e.page_title ? e.page_title.slice(0, 100) : null,
        referrer_domain: e.referrer_domain ? e.referrer_domain.toLowerCase().slice(0, 253) : null,
        session_id: e.session_id,
        source: e.source,
      })
    }

    if (rows.length === 0) {
      return err('No valid events in batch')
    }

    // Insert with ON CONFLICT DO NOTHING (dedup on user_id, url_hash)
    const db = getServiceClient()
    const { count, error: insertError } = await db
      .from('browsing_history')
      .upsert(rows, {
        onConflict: 'user_id,url_hash',
        ignoreDuplicates: true,
        count: 'exact'
      })

    if (insertError) {
      console.error('[ingest-history] insert error:', insertError)
      return err('Insert failed', 500)
    }

    const inserted = count ?? 0
    const skipped = rows.length - inserted
    console.log(`[ingest-history] batch=${rows.length} inserted=${inserted} skipped=${skipped} user=${userId}`)

    return json({ inserted, skipped })

  } catch (e) {
    console.error('[ingest-history] unhandled error:', e)
    return err('Internal server error', 500)
  }
})
