// analytics-dashboard — admin-only aggregate feed for ctrl.rodeo/analytics
// GET/POST /functions/v1/analytics-dashboard   (Authorization: Bearer <user JWT>)
// Body (optional): { days?: number }
// Response: { version, generatedAt, summary, accounts, people, auth }
// Access: only ADMIN_EMAILS may call; everyone else gets 403.

import { createClient } from 'jsr:@supabase/supabase-js@2'
import { logServerError } from '../_shared/telemetry.ts'

const VERSION = '1.3.0'
console.log(`[analytics-dashboard] v${VERSION} - admin-only analytics aggregates`)

const ADMIN_EMAILS = ['fike101@gmail.com']

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  )

  const authHeader = req.headers.get('Authorization') ?? ''
  const token = authHeader.replace(/^Bearer\s+/i, '')
  const { data: userData, error: userError } = await supabase.auth.getUser(token)
  if (userError || !userData?.user) {
    return json({ error: 'unauthorized' }, 401)
  }
  const email = (userData.user.email ?? '').toLowerCase()
  if (!ADMIN_EMAILS.includes(email)) {
    console.log(`[analytics-dashboard] v${VERSION} - forbidden for ${email}`)
    return json({ error: 'forbidden' }, 403)
  }

  let days = 30
  if (req.method === 'POST') {
    try {
      const body = await req.json()
      const n = Number(body?.days)
      if (Number.isFinite(n)) days = Math.min(Math.max(Math.round(n), 1), 365)
    } catch (_) { /* empty body is fine */ }
  }

  try {
  const [summaryRes, accountsRes, peopleRes, authRes] = await Promise.all([
    supabase.rpc('analytics_summary', { days }),
    supabase.rpc('analytics_account_stats'),
    supabase.rpc('analytics_people', { days }),
    // Sign-in attempts. Failures were previously visible only to the person
    // they happened to, which is how a whole house went uninvestigated.
    supabase.from('recruit_auth_events')
      .select('at, event, discord_username, discord_user_id, detail, channel, in_app_browser')
      .gte('at', new Date(Date.now() - days * 86400_000).toISOString())
      .order('at', { ascending: false }).limit(300),
  ])
  if (summaryRes.error) {
    console.error(`[analytics-dashboard] v${VERSION} - summary error:`, summaryRes.error)
    return json({ error: 'summary_failed', details: summaryRes.error.message }, 500)
  }
  if (accountsRes.error) {
    console.error(`[analytics-dashboard] v${VERSION} - accounts error:`, accountsRes.error)
    return json({ error: 'accounts_failed', details: accountsRes.error.message }, 500)
  }
  if (peopleRes.error) {
    console.error(`[analytics-dashboard] v${VERSION} - people error:`, peopleRes.error)
    return json({ error: 'people_failed', details: peopleRes.error.message }, 500)
  }

  return json({
    version: VERSION,
    generatedAt: new Date().toISOString(),
    summary: summaryRes.data,
    accounts: accountsRes.data,
    people: peopleRes.data,
    auth: authRes.error ? { error: authRes.error.message, events: [] } : { events: authRes.data || [] },
  })
  } catch (err) {
    console.error(`[analytics-dashboard] v${VERSION} - unhandled:`, (err as Error).message)
    await logServerError(supabase, 'analytics-dashboard', err)
    return json({ error: 'internal', details: (err as Error).message }, 500)
  }
})
