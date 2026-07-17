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

const VERSION = '1.2.0'
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
  'https://www.googleapis.com/auth/calendar.events', // screening-call invites
]
const TZ = 'America/Los_Angeles' 

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

// Extract availability windows from an applicant's reply (Haiku).
async function extractAvailability(text: string): Promise<Array<{ date: string; start: string; end: string }>> {
  const key = Deno.env.get('ANTHROPIC_API_KEY') || Deno.env.get('LADDER_ANTHROPIC_API_KEY')
  if (!key || !text.trim()) return []
  const prompt = `Today is ${new Date().toLocaleDateString('en-CA', { timeZone: TZ })} (${TZ}).
Extract every availability window this person offers for a call. Resolve relative days ("next Tuesday") to dates. Assume ${TZ} unless stated. If they give a day with no hours, use 09:00-18:00. Ignore anything that is not availability.
EMAIL START
${text.slice(0, 3000)}
EMAIL END
Return exactly: [{"date":"YYYY-MM-DD","start":"HH:MM","end":"HH:MM"}] — [] if none.`
  const resp = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
    body: JSON.stringify({
      model: 'claude-haiku-4-5-20251001', max_tokens: 400,
      system: 'You extract meeting availability from emails. Respond with a JSON array only.',
      messages: [{ role: 'user', content: prompt }],
    }),
  })
  if (!resp.ok) return []
  const data = await resp.json()
  const out = (data.content || []).filter((b: Record<string, unknown>) => b.type === 'text').map((b: Record<string, unknown>) => b.text).join('')
  try {
    const arr = JSON.parse(out.trim().replace(/^```json?\s*|\s*```$/g, ''))
    return Array.isArray(arr) ? arr.filter((w) => /^\d{4}-\d{2}-\d{2}$/.test(w.date) && /^\d{2}:\d{2}$/.test(w.start) && /^\d{2}:\d{2}$/.test(w.end)).slice(0, 10) : []
  } catch { return [] }
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
        const msg = await (await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${m.id}?format=full`, {
          headers: { Authorization: `Bearer ${at}` },
        })).json()
        const hs = msg.payload?.headers || []
        const from = header(hs, 'From')
        const direction = from.toLowerCase().includes(SHARED_EMAIL) ? 'out' : 'in'
        // best-effort plain-text body (availability extraction needs it)
        let bodyText = ''
        // deno-lint-ignore no-explicit-any
        const walk = (part: any) => {
          if (!part) return
          if (part.mimeType === 'text/plain' && part.body?.data) {
            try { bodyText += atob(String(part.body.data).replace(/-/g, '+').replace(/_/g, '/')) } catch { /* */ }
          }
          for (const sub of (part.parts || [])) walk(sub)
        }
        walk(msg.payload || {})
        await client.from('recruit_emails').upsert({
          applicant_id: applicant.id, gmail_id: msg.id, thread_id: msg.threadId,
          direction, subject: header(hs, 'Subject').slice(0, 300),
          snippet: (msg.snippet || '').slice(0, 300),
          body_text: bodyText.slice(0, 8000),
          from_email: from.slice(0, 200), to_email: header(hs, 'To').slice(0, 200),
          sent_at: new Date(Number(msg.internalDate) || Date.now()).toISOString(),
        }, { onConflict: 'gmail_id' })
        added++
        if (direction === 'in' && bodyText.trim()) {
          const { data: existingAv } = await client.from('recruit_availability')
            .select('source_gmail_id').eq('applicant_id', applicant.id).maybeSingle()
          if (existingAv?.source_gmail_id !== msg.id) {
            const windows = await extractAvailability(bodyText)
            if (windows.length) {
              await client.from('recruit_availability').upsert({
                applicant_id: applicant.id, windows, source_gmail_id: msg.id,
                updated_at: new Date().toISOString(),
              })
            }
          }
        }
      }
      const [{ data: rows }, { data: avail }, { data: screenings }] = await Promise.all([
        client.from('recruit_emails').select('*').eq('applicant_id', applicant.id).order('sent_at', { ascending: false }).limit(50),
        client.from('recruit_availability').select('*').eq('applicant_id', applicant.id).maybeSingle(),
        client.from('recruit_screenings').select('*').eq('applicant_id', applicant.id).order('starts_at', { ascending: false }),
      ])
      return json({ synced: added, emails: rows || [], availability: avail || null, screenings: screenings || [] })
    }

    if (action === 'schedule') {
      const { data: applicant } = await client.from('recruit_applicants').select('*').eq('id', String(body.applicantId || '')).maybeSingle()
      if (!applicant?.email?.includes('@')) return json({ error: 'Applicant has no email' }, 400)
      const startsAt = new Date(String(body.startsAt || ''))
      if (isNaN(startsAt.getTime()) || startsAt < new Date()) return json({ error: 'Pick a future start time' }, 400)
      const endsAt = new Date(startsAt.getTime() + (Number(body.minutes) || 30) * 60000)

      const { data: rp } = await client.from('recruit_profiles').select('display_name').eq('user_id', userData.user.id).maybeSingle()
      const housemateName = rp?.display_name || membership.discord_username || 'an Agape housemate'
      const housemateEmail = (userData.user.email || '').toLowerCase()

      const at = await accessToken(client)
      const event = {
        summary: `Agape screening call — ${applicant.first_name} ${applicant.last_name} × ${housemateName}`,
        description: `Get-to-know-you call with ${applicant.first_name} (Agape application), scheduled from their offered availability.`,
        start: { dateTime: startsAt.toISOString(), timeZone: TZ },
        end: { dateTime: endsAt.toISOString(), timeZone: TZ },
        attendees: [
          { email: applicant.email },
          ...(housemateEmail.includes('@') ? [{ email: housemateEmail }] : []),
        ],
        conferenceData: { createRequest: { requestId: crypto.randomUUID(), conferenceSolutionKey: { type: 'hangoutsMeet' } } },
        reminders: { useDefault: true },
      }
      const resp = await fetch('https://www.googleapis.com/calendar/v3/calendars/primary/events?sendUpdates=all&conferenceDataVersion=1', {
        method: 'POST',
        headers: { Authorization: `Bearer ${at}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(event),
      })
      const created = await resp.json()
      if (!resp.ok) return json({ error: `Calendar failed: ${JSON.stringify(created).slice(0, 200)} — if this mentions scopes, reconnect the shared Gmail to grant calendar access` }, 500)
      // deno-lint-ignore no-explicit-any
      const meet = created.conferenceData?.entryPoints?.find((e: any) => e.entryPointType === 'video')?.uri || created.hangoutLink || null
      const { data: row, error } = await client.from('recruit_screenings').insert({
        applicant_id: applicant.id, housemate_user_id: userData.user.id,
        housemate_name: housemateName, housemate_email: housemateEmail,
        starts_at: startsAt.toISOString(), ends_at: endsAt.toISOString(),
        gcal_event_id: created.id, meet_link: meet, status: 'scheduled',
      }).select().single()
      if (error) return json({ error: error.message }, 500)
      console.log(`screening ${applicant.id} x ${housemateName} @ ${startsAt.toISOString()}`)
      return json({ scheduled: true, screening: row })
    }

    return json({ error: 'Unknown action' }, 400)
  } catch (err) {
    console.error('recruit-gmail error:', (err as Error).message)
    return json({ error: (err as Error).message }, 500)
  }
})
