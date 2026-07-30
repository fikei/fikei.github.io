// Supabase Edge Function: recruit-availability
// PUBLIC (deployed with --no-verify-jwt): the applicant-facing endpoint for
// the /applications/schedule/ page. Auth = knowledge of the per-applicant
// schedule_token (migration 118). Applicants can read their own first name
// + saved windows, and submit new windows. Nothing else is exposed.
//
// POST { token }                      → { firstName, windows }
// POST { token, windows: [...] }      → save; { saved: true, windows }

const VERSION = '1.2.5'
console.log(`[recruit-availability] v${VERSION} — public applicant availability endpoint + Discord claim post`)

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { upsertScreenerScheduler } from '../_shared/discord.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}
const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })

function db() {
  return createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const body = await req.json().catch(() => ({}))
    const token = String(body.token || '')
    if (!UUID_RE.test(token)) return json({ error: 'Invalid link' }, 400)

    const client = db()
    const { data: applicant } = await client.from('recruit_applicants')
      .select('id, first_name').eq('schedule_token', token).maybeSingle()
    if (!applicant) return json({ error: 'Invalid link' }, 404)

    if (Array.isArray(body.windows)) {
      const windows = body.windows
        .filter((w: Record<string, unknown>) =>
          /^\d{4}-\d{2}-\d{2}$/.test(String(w.date)) &&
          /^\d{2}:\d{2}$/.test(String(w.start)) &&
          /^\d{2}:\d{2}$/.test(String(w.end)) &&
          String(w.start) < String(w.end))
        .slice(0, 14)
        .map((w: Record<string, unknown>) => ({ date: w.date, start: w.start, end: w.end }))
      if (!windows.length) return json({ error: 'Add at least one time window' }, 400)
      const { error } = await client.from('recruit_availability').upsert({
        applicant_id: applicant.id, windows, source_gmail_id: 'self-service',
        updated_at: new Date().toISOString(),
      })
      if (error) return json({ error: 'Could not save — try again' }, 500)
      console.log(`availability saved for ${applicant.id} (${windows.length} windows)`)

      // Post/refresh the claimable message in #recruiting-automation.
      // Warn-only: Discord being down never blocks the applicant's save.
      try {
        const { data: full } = await client.from('recruit_applicants')
          .select('why_agape, pronouns').eq('id', applicant.id).maybeSingle()
        await upsertScreenerScheduler(client, {
          applicantId: applicant.id, firstName: applicant.first_name,
          whyLine: full?.why_agape || null, pronouns: full?.pronouns || null,
          windows, platform: null, timezoneNote: null, needsHuman: false,
        })
      } catch (err) {
        console.warn(`claim post failed for ${applicant.id}: ${(err as Error).message}`)
      }

      return json({ saved: true, windows })
    }

    const { data: avail } = await client.from('recruit_availability')
      .select('windows').eq('applicant_id', applicant.id).maybeSingle()
    return json({ firstName: applicant.first_name, windows: avail?.windows || [] })
  } catch (err) {
    console.error('recruit-availability error:', (err as Error).message)
    return json({ error: 'Something went wrong' }, 500)
  }
})
