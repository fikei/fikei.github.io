// Supabase Edge Function: recruit-watch
// Public playback for a recording, by capability link (verify_jwt=false in
// config.toml). Discord posts link here instead of Recall's presigned URL,
// which died within hours.
//
// GET /recruit-watch?t=<share_token>        → { title, when, summary, url }
//   url is a 6-hour signed URL for the archived copy in recruit-recordings.
//
// The token IS the credential: 32 random bytes from migration 135, unique,
// and revocable by setting share_token = NULL. No applicant identifiers are
// returned beyond what the recording itself shows, and a bad or revoked
// token is indistinguishable from a missing one (404 either way).

const VERSION = '1.0.0'
console.log(`[recruit-watch] v${VERSION} — capability-link recording playback`)

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}
const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })

function db() {
  return createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  try {
    const token = new URL(req.url).searchParams.get('t') || ''
    // Shape check first — never let a malformed token reach a query.
    if (!/^[0-9a-f]{64}$/.test(token)) return json({ error: 'Not found' }, 404)

    const client = db()
    const { data: screening } = await client.from('recruit_screenings')
      .select('id, applicant_id, housemate_name, starts_at, recording_summary, recording_path')
      .eq('share_token', token).maybeSingle()

    let title: string, when: string | null, summary: string | null, path: string | null
    if (screening) {
      const { data: applicant } = await client.from('recruit_applicants')
        .select('first_name, last_name').eq('id', screening.applicant_id).maybeSingle()
      const name = `${applicant?.first_name || 'Applicant'} ${applicant?.last_name || ''}`.trim()
      title = `${name} × ${screening.housemate_name || 'Agape'} — Intro Call`
      when = screening.starts_at
      summary = screening.recording_summary
      path = screening.recording_path
    } else {
      const { data: event } = await client.from('recruit_recorded_events')
        .select('title, starts_at, recording_summary, recording_path')
        .eq('share_token', token).maybeSingle()
      if (!event) return json({ error: 'Not found' }, 404)
      title = event.title || 'Agape call'
      when = event.starts_at
      summary = event.recording_summary
      path = event.recording_path
    }

    if (!path) {
      return json({ title, when, summary, url: null, reason: 'Recording is still processing, or was lost before we archived it.' })
    }
    const { data: signed, error } = await client.storage
      .from('recruit-recordings').createSignedUrl(path, 6 * 3600)
    if (error || !signed?.signedUrl) return json({ error: 'Could not open the recording' }, 500)

    return json({ title, when, summary, url: signed.signedUrl })
  } catch (err) {
    console.error('[recruit-watch] error:', (err as Error).message)
    return json({ error: 'Something went wrong' }, 500)
  }
})
