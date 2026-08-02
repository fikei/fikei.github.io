// analytics-alerts — error-spike watchdog for ctrl.rodeo analytics.
// POST /functions/v1/analytics-alerts   (X-Cron-Nonce or X-Cron-Secret)
// Cron: every 30 min (migration 158). Looks at the last 60 minutes of
// analytics_events; DMs Ian via the recruiting bot when something is wrong.
//
// Alert conditions (deduped via analytics_alerts, one DM per kind per 6h):
//   error_spike   — ≥3 client errors in the window
//   server_error  — ≥1 edge-function error in the window
//
// No new secrets: nonce handshake from migration 123, DISCORD_BOT_TOKEN and
// the alert user id already exist for the recruiting automations.

import { createClient } from 'jsr:@supabase/supabase-js@2'
import { dmUser } from '../_shared/discord.ts'

const VERSION = '1.0.0'
console.log(`[analytics-alerts] v${VERSION} - error-spike watchdog`)

const ALERT_DISCORD_USER_ID = Deno.env.get('ALERT_DISCORD_USER_ID') || '853782600082522152' // Ian
const CLIENT_ERROR_THRESHOLD = 3
const COOLDOWN_HOURS = 6

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-cron-nonce, x-cron-secret',
}
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })

function db() {
  return createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  const client = db()

  // Same handshake as recruit-gmail /scan: burn a one-time nonce minted by
  // the pg_cron tick; X-Cron-Secret honoured if CRON_SECRET is ever set.
  const secret = Deno.env.get('CRON_SECRET')
  let authorized = Boolean(secret) && req.headers.get('x-cron-secret') === secret
  const nonce = req.headers.get('x-cron-nonce')
  if (!authorized && nonce && /^[0-9a-f-]{36}$/i.test(nonce)) {
    const { data: burned } = await client.from('recruit_cron_nonce')
      .delete().eq('nonce', nonce)
      .gte('created_at', new Date(Date.now() - 10 * 60000).toISOString())
      .select().maybeSingle()
    authorized = Boolean(burned)
  }
  if (!authorized) return json({ error: 'unauthorized' }, 401)

  try {
    const since = new Date(Date.now() - 60 * 60000).toISOString()
    const { data: recent, error } = await client.from('analytics_events')
      .select('type, app, path, message')
      .in('type', ['error', 'server_error'])
      .gte('occurred_at', since)
    if (error) throw new Error(`query failed: ${error.message}`)

    const clientErrors = (recent || []).filter((r) => r.type === 'error')
    const serverErrors = (recent || []).filter((r) => r.type === 'server_error')

    const fired: string[] = []
    const cooldownCutoff = new Date(Date.now() - COOLDOWN_HOURS * 3600_000).toISOString()

    const shouldSend = async (kind: string): Promise<boolean> => {
      const { data } = await client.from('analytics_alerts')
        .select('id').eq('kind', kind).gte('sent_at', cooldownCutoff).limit(1)
      return !data?.length
    }
    const topLines = (rows: Array<{ app: string; message: string | null }>): string => {
      const counts = new Map<string, number>()
      for (const r of rows) {
        const key = `${r.app}: ${(r.message || 'unknown').slice(0, 120)}`
        counts.set(key, (counts.get(key) || 0) + 1)
      }
      return [...counts.entries()]
        .sort((a, b) => b[1] - a[1]).slice(0, 5)
        .map(([line, n]) => `• ${n}× ${line}`).join('\n')
    }

    if (clientErrors.length >= CLIENT_ERROR_THRESHOLD && await shouldSend('error_spike')) {
      await dmUser(ALERT_DISCORD_USER_ID,
        `⚠️ ctrl.rodeo: ${clientErrors.length} client errors in the last hour.\n` +
        `${topLines(clientErrors)}\n` +
        `→ https://ctrl.rodeo/analytics/#errors`)
      await client.from('analytics_alerts').insert({ kind: 'error_spike', detail: `${clientErrors.length} client errors` })
      fired.push('error_spike')
    }
    if (serverErrors.length >= 1 && await shouldSend('server_error')) {
      await dmUser(ALERT_DISCORD_USER_ID,
        `🚨 ctrl.rodeo: ${serverErrors.length} edge-function error(s) in the last hour.\n` +
        `${topLines(serverErrors)}\n` +
        `→ https://ctrl.rodeo/analytics/#errors`)
      await client.from('analytics_alerts').insert({ kind: 'server_error', detail: `${serverErrors.length} server errors` })
      fired.push('server_error')
    }

    return json({ version: VERSION, window_minutes: 60, client_errors: clientErrors.length, server_errors: serverErrors.length, fired })
  } catch (err) {
    console.error(`[analytics-alerts] v${VERSION} -`, (err as Error).message)
    return json({ error: (err as Error).message }, 500)
  }
})
