// analytics-dashboard — admin-only aggregate feed for ctrl.rodeo/analytics
// GET/POST /functions/v1/analytics-dashboard   (Authorization: Bearer <user JWT>)
// Body (optional): { days?: number }
// Response: { version, generatedAt, summary, accounts }
// Access: only ADMIN_EMAILS may call; everyone else gets 403.

import { createClient } from 'jsr:@supabase/supabase-js@2'

const VERSION = '1.0.0'
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

  const [summaryRes, accountsRes] = await Promise.all([
    supabase.rpc('analytics_summary', { days }),
    supabase.rpc('analytics_account_stats'),
  ])
  if (summaryRes.error) {
    console.error(`[analytics-dashboard] v${VERSION} - summary error:`, summaryRes.error)
    return json({ error: 'summary_failed', details: summaryRes.error.message }, 500)
  }
  if (accountsRes.error) {
    console.error(`[analytics-dashboard] v${VERSION} - accounts error:`, accountsRes.error)
    return json({ error: 'accounts_failed', details: accountsRes.error.message }, 500)
  }

  return json({
    version: VERSION,
    generatedAt: new Date().toISOString(),
    summary: summaryRes.data,
    accounts: accountsRes.data,
  })
})
