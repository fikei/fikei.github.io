// Supabase Edge Function: recruit-gmail
// All applicant communication runs through ONE shared Google account
// (live.at.agapesf@gmail.com), regardless of who is signed into the app.
// Reuses the existing Google OAuth client (GOOGLE_CALENDAR_* secrets, same
// client gmail-auth uses) — the refresh token lives in recruit_gmail_account
// (service-role only; members never see it).
//
// POST /functions/v1/recruit-gmail   (Authorization: Bearer <user JWT>)
// Actions:
//   auth-url                  → { url } Google consent URL (state=agape-gmail)
//   connect { code }          → exchange + verify the account is the shared
//                               address, store refresh token
//   status                    → { connected, email, connectedAt }
//   send { applicantId, subject, body } → send via Gmail as the shared
//                               account, log to recruit_emails (direction out)
//   sync { applicantId }      → pull recent messages to/from the applicant's
//                               address into recruit_emails (direction in/out)

const VERSION = '1.0.0'
console.log(`[recruit-gmail] v${VERSION} — shared-account applicant email pipe`)

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}
const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })

const CLIENT_ID = Deno.env.get('GOOGLE_CALENDAR_CLIENT_ID')!
const CLIENT_SECRET = Deno.env.get('GOOGLE_CALENDAR_CLIENT_SECRET')!
// Same whitelisted redirect the ladder gmail flow uses; /ladder forwards
// state=agape-gmail callbacks to /applications/.
const REDIRECT_URI = Deno.env.get('GMAIL_OAUTH_REDIRECT_URI') || 'https://ctrl.rodeo/job/'
const SHARED_EMAIL = Deno.env.get('AGAPE_GMAIL_ADDRESS') || 'live.at.agapesf@gmail.com'
const SCOPES = [
  'https://www.googleapis.com/auth/gmail.readonly',
  'https://www.googleapis.com/auth/gmail.send',
]

function db() {
  return createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
}

async function accessToken(client: ReturnType<typeof db>): Promise<string> {
  const { data: acct } = await client.from('recruit_gmail_account').select('*').eq('id', 1).maybeSingle()
  if (!acct) throw new Error('Shared Gmail not connected yet')
  const resp = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: CLIENT_ID, client_secret: CLIENT_SECRET,
      refresh_token: acct.refresh_token, grant_type: 'refresh_token',
    }),
  })
  const tok = await resp.json()
  if (!resp.ok || !tok.access_token) throw new Error(`Token refresh failed: ${JSON.stringify(tok).slice(0, 180)}`)
  return tok.access_token
}

function b64url(s: string): string {
  return btoa(unescape(encodeURIComponent(s))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function header(headers: Array<{ name: string; value: string }>, name: string): string {
  return headers.find((h) => h.name.toLowerCase() === name.toLowerCase())?.value || ''
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const token = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '')
    const client = db()
    const { data: userData, error: userErr } = await client.auth.getUser(token)
    if (userErr || !userData?.user) return json({ error: 'Not authenticated' }, 401)
    const { data: membership } = await client.from('user_discord_membership')
      .select('is_recruiting_member, discord_username').eq('user_id', userData.user.id).maybeSingle()
    if (!membership?.is_recruiting_member) return json({ error: 'Not a recruiting member' }, 403)

    const body = await req.json().catch(() => ({}))
    const action = body.action

    if (action === 'auth-url') {
      const url = 'https://accounts.google.com/o/oauth2/v2/auth?' + new URLSearchParams({
        client_id: CLIENT_ID,
        redirect_uri: REDIRECT_URI,
        response_type: 'code',
        scope: SCOPES.join(' '),
        access_type: 'offline',
        prompt: 'consent',
        login_hint: SHARED_EMAIL,
        state: 'agape-gmail',
      })
      return json({ url })
    }

    if (action === 'connect') {
      const resp = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          code: String(body.code || ''), client_id: CLIENT_ID, client_secret: CLIENT_SECRET,
          redirect_uri: REDIRECT_URI, grant_type: 'authorization_code',
        }),
      })
      const tok = await resp.json()
      if (!resp.ok || !tok.refresh_token) return json({ error: `Exchange failed: ${JSON.stringify(tok).slice(0, 180)}` }, 400)
      // verify the connected mailbox is the shared house account
      const prof = await (await fetch('https://gmail.googleapis.com/gmail/v1/users/me/profile', {
        headers: { Authorization: `Bearer ${tok.access_token}` },
      })).json()
      if ((prof.emailAddress || '').toLowerCase() !== SHARED_EMAIL) {
        return json({ error: `Wrong account: signed into ${prof.emailAddress}. Connect ${SHARED_EMAIL}.` }, 400)
      }
      // find the requester's display name for attribution
      const { data: rp } = await client.from('recruit_profiles').select('display_name').eq('user_id', userData.user.id).maybeSingle()
      const { error } = await client.from('recruit_gmail_account').upsert({
        id: 1, email: SHARED_EMAIL, refresh_token: tok.refresh_token,
        connected_by_name: rp?.display_name || membership.discord_username || null,
        connected_at: new Date().toISOString(),
      })
      if (error) return json({ error: error.message }, 500)
      return json({ connected: true, email: SHARED_EMAIL })
    }

    if (action === 'status') {
      const { data: acct } = await client.from('recruit_gmail_account')
        .select('email, connected_by_name, connected_at').eq('id', 1).maybeSingle()
      return json(acct ? { connected: true, ...acct } : { connected: false })
    }

    if (action === 'send') {
      const { data: applicant } = await client.from('recruit_applicants').select('*').eq('id', String(body.applicantId || '')).maybeSingle()
      if (!applicant?.email?.includes('@')) return json({ error: 'Applicant has no email' }, 400)
      const subject = String(body.subject || '').slice(0, 300)
      const text = String(body.body || '').slice(0, 10000)
      if (!subject || !text) return json({ error: 'Subject and body required' }, 400)

      const at = await accessToken(client)
      // RFC 2047 encode the subject for safety with unicode
      const encSubject = `=?UTF-8?B?${b64url(subject).replace(/-/g, '+').replace(/_/g, '/')}?=`
      const raw = [
        `From: Agape <${SHARED_EMAIL}>`,
        `To: ${applicant.email}`,
        `Subject: ${encSubject}`,
        'MIME-Version: 1.0',
        'Content-Type: text/plain; charset=UTF-8',
        '',
        text,
      ].join('\r\n')
      const resp = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
        method: 'POST',
        headers: { Authorization: `Bearer ${at}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ raw: b64url(raw) }),
      })
      const sent = await resp.json()
      if (!resp.ok) return json({ error: `Send failed: ${JSON.stringify(sent).slice(0, 180)}` }, 500)

      const { data: rp } = await client.from('recruit_profiles').select('display_name').eq('user_id', userData.user.id).maybeSingle()
      await client.from('recruit_emails').upsert({
        applicant_id: applicant.id, gmail_id: sent.id, thread_id: sent.threadId,
        direction: 'out', subject, snippet: text.slice(0, 180), body_text: text,
        from_email: SHARED_EMAIL, to_email: applicant.email,
        sent_by_name: rp?.display_name || membership.discord_username || null,
        sent_at: new Date().toISOString(),
      }, { onConflict: 'gmail_id' })
      console.log(`sent → ${applicant.email} (${sent.id})`)
      return json({ sent: true, gmailId: sent.id })
    }

    if (action === 'sync') {
      const { data: applicant } = await client.from('recruit_applicants').select('*').eq('id', String(body.applicantId || '')).maybeSingle()
      if (!applicant?.email?.includes('@')) return json({ error: 'Applicant has no email' }, 400)
      const at = await accessToken(client)
      const q = `from:${applicant.email} OR to:${applicant.email}`
      const list = await (await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages?q=${encodeURIComponent(q)}&maxResults=25`, {
        headers: { Authorization: `Bearer ${at}` },
      })).json()
      let added = 0
      for (const m of (list.messages || [])) {
        const { data: existing } = await client.from('recruit_emails').select('id').eq('gmail_id', m.id).maybeSingle()
        if (existing) continue
        const msg = await (await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${m.id}?format=metadata&metadataHeaders=Subject&metadataHeaders=From&metadataHeaders=To&metadataHeaders=Date`, {
          headers: { Authorization: `Bearer ${at}` },
        })).json()
        const hs = msg.payload?.headers || []
        const from = header(hs, 'From')
        const direction = from.toLowerCase().includes(SHARED_EMAIL) ? 'out' : 'in'
        await client.from('recruit_emails').upsert({
          applicant_id: applicant.id, gmail_id: msg.id, thread_id: msg.threadId,
          direction, subject: header(hs, 'Subject').slice(0, 300),
          snippet: (msg.snippet || '').slice(0, 300),
          from_email: from.slice(0, 200), to_email: header(hs, 'To').slice(0, 200),
          sent_at: new Date(Number(msg.internalDate) || Date.now()).toISOString(),
        }, { onConflict: 'gmail_id' })
        added++
      }
      const { data: rows } = await client.from('recruit_emails')
        .select('*').eq('applicant_id', applicant.id).order('sent_at', { ascending: false }).limit(50)
      return json({ synced: added, emails: rows || [] })
    }

    return json({ error: 'Unknown action' }, 400)
  } catch (err) {
    console.error('recruit-gmail error:', (err as Error).message)
    return json({ error: (err as Error).message }, 500)
  }
})
