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

const VERSION = '1.1.0'
console.log(`[recruit-watch] v${VERSION} — capability-link recording playback, short tokens, nameless titles`)

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
    // 20 hex is the current short form (~80 bits); 64 hex is the legacy form.
    // A 20-char token also opens a legacy recording by matching the first 20
    // chars of its stored 64-char token, so any old link can be re-shared
    // short and any clipped-but-long-enough copy still works.
    if (!/^[0-9a-f]{20}$/.test(token) && !/^[0-9a-f]{64}$/.test(token)) {
      return json({ error: 'Not found' }, 404)
    }

    const client = db()
    // deno-lint-ignore no-explicit-any
    const byToken = (q: any) =>
      token.length === 64 ? q.eq('share_token', token) : q.like('share_token', `${token}%`)

    const { data: screenings } = await byToken(
      client.from('recruit_screenings')
        .select('id, starts_at, recording_summary, recording_path'),
    ).limit(1)
    const screening = screenings?.[0]

    // Titles are deliberately nameless: this page is reachable by anyone
    // holding the link, so it identifies the call, not the people on it.
    let title: string, when: string | null, summary: string | null, path: string | null
    if (screening) {
      title = 'Agape intro call'
      when = screening.starts_at
      summary = screening.recording_summary
      path = screening.recording_path
    } else {
      const { data: events } = await byToken(
        client.from('recruit_recorded_events')
          .select('starts_at, recording_summary, recording_path'),
      ).limit(1)
      const event = events?.[0]
      if (!event) return json({ error: 'Not found' }, 404)
      title = 'Agape call'
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
