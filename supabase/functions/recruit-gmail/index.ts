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

const VERSION = '1.8.2'
console.log(`[recruit-gmail] v${VERSION} — shared-account applicant email pipe + Discord claim posts`)

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { sharedAccessToken as accessToken, b64url, scheduleScreening, sendIntroEmail, SHARED_EMAIL, TZ } from '../_shared/recruit-schedule.ts'
import { upsertClaimMessage, editClaimMessageClaimed, notifyStuck, slotLabel, slotWhen, deriveSlots, buildMessage } from '../_shared/discord.ts'

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
const SCOPES = [
  'https://www.googleapis.com/auth/gmail.readonly',
  'https://www.googleapis.com/auth/gmail.send',
  'https://www.googleapis.com/auth/calendar.events', // screening-call invites
]

function db() {
  return createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
}

interface Extraction {
  windows: Array<{ date: string; start: string; end: string }>
  platform: { kind: string; handle?: string } | null
  timezone_note: string | null
  needs_human: boolean
}
const NO_EXTRACTION: Extraction = { windows: [], platform: null, timezone_note: null, needs_human: false }

// Extract scheduling info from an applicant's reply (Haiku, v2 prompt):
// availability windows in PT, platform requests (IG/WhatsApp/phone),
// timezone conversions, and a needs_human flag for unparseable replies.
async function extractAvailability(text: string): Promise<Extraction> {
  // Recruiting has its own key (own workspace + cap); shared/Ladder keys are
  // emergency fallbacks only.
  const key = Deno.env.get('RECRUIT_ANTHROPIC_API_KEY') || Deno.env.get('ANTHROPIC_API_KEY') || Deno.env.get('LADDER_ANTHROPIC_API_KEY')
  if (!key || !text.trim()) return NO_EXTRACTION
  const prompt = `Today is ${new Date().toLocaleDateString('en-CA', { timeZone: TZ })} (${TZ}). You are extracting scheduling information from an email a housing applicant sent to Agape (San Francisco, Pacific time).

Extract:
1. "windows": every availability window they offer, as [{"date":"YYYY-MM-DD","start":"HH:MM","end":"HH:MM"}] in Pacific time.
   - Resolve relative days ("next Tuesday", "the 25th") to concrete dates, never in the past.
   - If they name their own timezone or location ("I'm in Europe", "CET", "9 hour difference"), convert to Pacific. When they say "morning your time" they mean Pacific morning — take them at their word.
   - Vague day-parts map to: morning 09:00-12:00, afternoon 12:00-17:00, evening 17:00-21:00, a bare day 09:00-18:00.
   - Windows must be >=30 minutes. Cap at 10.
2. "platform": if they request a specific medium (Instagram video, WhatsApp, phone, "not video"), return {"kind":..., "handle":...}; else null. Default assumption is Google Meet — only capture explicit requests.
3. "timezone_note": one short string when a conversion happened ("applicant is in Europe, +9h from PT — windows converted"), else null.
4. "needs_human": true when the email is clearly about scheduling but you cannot produce at least one concrete window (e.g. "whenever works!", a Calendly link, questions instead of times) — a human will read the thread instead. If the email is not about scheduling at all, return windows [] and needs_human false.

EMAIL START
${text.slice(0, 3000)}
EMAIL END
Return one JSON object: {"windows":..., "platform":..., "timezone_note":..., "needs_human":...}. No prose.`
  const resp = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
    body: JSON.stringify({
      model: 'claude-haiku-4-5-20251001', max_tokens: 600,
      system: 'You extract scheduling information from emails. Respond with a single JSON object only.',
      messages: [{ role: 'user', content: prompt }],
    }),
  })
  if (!resp.ok) { console.warn(`extractAvailability: anthropic ${resp.status} ${(await resp.text()).slice(0, 300)}`); return NO_EXTRACTION }
  const data = await resp.json()
  const out = (data.content || []).filter((b: Record<string, unknown>) => b.type === 'text').map((b: Record<string, unknown>) => b.text).join('')
  try {
    const obj = JSON.parse(out.trim().replace(/^```json?\s*|\s*```$/g, ''))
    const windows = (Array.isArray(obj.windows) ? obj.windows : [])
      // deno-lint-ignore no-explicit-any
      .filter((w: any) => /^\d{4}-\d{2}-\d{2}$/.test(w.date) && /^\d{2}:\d{2}$/.test(w.start) && /^\d{2}:\d{2}$/.test(w.end) && w.start < w.end)
      .slice(0, 10)
    return {
      windows,
      platform: obj.platform?.kind ? { kind: String(obj.platform.kind).slice(0, 40), ...(obj.platform.handle ? { handle: String(obj.platform.handle).replace(/^@/, '').slice(0, 60) } : {}) } : null,
      timezone_note: obj.timezone_note ? String(obj.timezone_note).slice(0, 200) : null,
      needs_human: Boolean(obj.needs_human) && !windows.length,
    }
  } catch { return NO_EXTRACTION }
}

// After availability lands, post/refresh the claimable message in
// #recruiting-interviews. Warn-only: Discord being down never breaks a scan.
async function postClaim(client: ReturnType<typeof db>, applicantId: string, extraction: Extraction): Promise<void> {
  if (!extraction.windows.length && !extraction.needs_human) return
  try {
    const { data: applicant } = await client.from('recruit_applicants')
      .select('first_name, why_agape').eq('id', applicantId).maybeSingle()
    if (!applicant) return
    await upsertClaimMessage(client, {
      applicantId, firstName: applicant.first_name, whyLine: applicant.why_agape,
      windows: extraction.windows, platform: extraction.platform,
      timezoneNote: extraction.timezone_note, needsHuman: extraction.needs_human,
    })
  } catch (err) {
    console.warn(`claim post failed for ${applicantId}: ${(err as Error).message}`)
  }
}

// 96h stuck-metric: one channel nudge per unclaimed post. Piggybacks on scan
// (the app triggers scans regularly) — no extra cron infrastructure.
async function remindStuckPosts(client: ReturnType<typeof db>): Promise<void> {
  try {
    const cutoff = new Date(Date.now() - 96 * 3600 * 1000).toISOString()
    const { data: stuck } = await client.from('recruit_claim_posts')
      .select('applicant_id, discord_channel_id, discord_message_id, posted_at')
      .eq('status', 'open').is('reminded_at', null).lt('posted_at', cutoff).limit(5)
    for (const post of (stuck || [])) {
      const { data: applicant } = await client.from('recruit_applicants')
        .select('first_name').eq('id', post.applicant_id).maybeSingle()
      await notifyStuck(post.discord_channel_id, post.discord_message_id, applicant?.first_name || 'An applicant')
      await client.from('recruit_claim_posts')
        .update({ reminded_at: new Date().toISOString(), updated_at: new Date().toISOString() })
        .eq('applicant_id', post.applicant_id)
      console.log(`stuck reminder sent for ${post.applicant_id} (open since ${post.posted_at})`)
    }
  } catch (err) {
    console.warn(`stuck reminder sweep failed: ${(err as Error).message}`)
  }
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
            const extraction = await extractAvailability(bodyText)
            if (extraction.windows.length) {
              await client.from('recruit_availability').upsert({
                applicant_id: applicant.id, windows: extraction.windows, source_gmail_id: msg.id,
                updated_at: new Date().toISOString(),
              })
            }
            // Auto-post to Discord is off for now — a recruiter triggers the
            // claim post from the app (claim-preview/claim-post actions).
            // await postClaim(client, applicant.id, extraction)
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
      const applicantId = String(body.applicantId || '')
      const startsAt = new Date(String(body.startsAt || ''))
      if (isNaN(startsAt.getTime()) || startsAt < new Date()) return json({ error: 'Pick a future start time' }, 400)

      const { data: rp } = await client.from('recruit_profiles').select('display_name, group_email').eq('user_id', userData.user.id).maybeSingle()
      const housemateName = rp?.display_name || membership.discord_username || 'an Agape housemate'
      // Google Group address preferred — it's the email residents actually read.
      const housemateEmail = (rp?.group_email || userData.user.email || '').toLowerCase().trim()

      let result
      try {
        result = await scheduleScreening(client, {
          applicantId, startsAt, minutes: Number(body.minutes) || 30,
          housemateUserId: userData.user.id, housemateName, housemateEmail,
        })
      } catch (err) {
        const msg = (err as Error).message
        return json({ error: msg }, msg === 'Applicant has no email' ? 400 : 500)
      }

      // App-side booking closes any open Discord claim post for this applicant.
      try {
        const label = slotLabel(startsAt)
        const { data: post } = await client.from('recruit_claim_posts')
          .update({
            status: 'claimed', claimed_by_user_id: userData.user.id,
            claimed_slot: { start: startsAt.toISOString(), label },
            claimed_at: new Date().toISOString(), updated_at: new Date().toISOString(),
          })
          .eq('applicant_id', applicantId).in('status', ['open', 'manual'])
          .select('discord_channel_id, discord_message_id').maybeSingle()
        if (post) {
          const { data: dm } = await client.from('user_discord_membership')
            .select('discord_user_id').eq('user_id', userData.user.id).maybeSingle()
          if (dm?.discord_user_id) {
            const applicantName = `${result.applicant.first_name} ${result.applicant.last_name || ''}`.trim()
            await editClaimMessageClaimed(post.discord_channel_id, post.discord_message_id, dm.discord_user_id, applicantName, applicantId, slotWhen(startsAt))
          }
        }
      } catch (err) {
        console.warn(`claim post close failed for ${applicantId}: ${(err as Error).message}`)
      }

      try {
        await sendIntroEmail(client, result.applicant, housemateName, housemateEmail, startsAt, result.meetLink)
      } catch (err) {
        console.warn(`intro email failed for ${applicantId}: ${(err as Error).message}`)
      }

      console.log(`screening ${applicantId} x ${housemateName} @ ${startsAt.toISOString()}`)
      return json({ scheduled: true, screening: result.screening })
    }

    if (action === 'claim-preview' || action === 'claim-post') {
      // Manual Discord trigger: preview composes the exact message; post
      // sends it. The extraction rides back from preview to post so Haiku
      // runs once. Future cutover: re-enable the auto postClaim calls.
      const applicantId = String(body.applicantId || '')
      const { data: applicant } = await client.from('recruit_applicants')
        .select('id, first_name, why_agape').eq('id', applicantId).maybeSingle()
      if (!applicant) return json({ error: 'unknown applicant' }, 404)
      let extraction: Extraction = body.extraction && Array.isArray(body.extraction.windows)
        ? body.extraction as Extraction
        : NO_EXTRACTION
      if (!body.extraction) {
        const { data: latest } = await client.from('recruit_emails')
          .select('body_text').eq('applicant_id', applicantId).eq('direction', 'in')
          .order('sent_at', { ascending: false }).limit(1).maybeSingle()
        if (!latest?.body_text?.trim()) return json({ error: 'no inbound email to read times from' }, 400)
        extraction = await extractAvailability(latest.body_text)
        if (!extraction.windows.length && !extraction.needs_human) extraction = { ...extraction, needs_human: true }
      }
      const input = {
        applicantId, firstName: applicant.first_name, whyLine: applicant.why_agape,
        windows: extraction.windows, platform: extraction.platform,
        timezoneNote: extraction.timezone_note, needsHuman: extraction.needs_human,
      }
      const slots = extraction.needs_human ? [] : deriveSlots(extraction.windows)
      const message = buildMessage(input, slots)
      if (action === 'claim-preview') {
        return json({ preview: message, slotLabels: slots.map((sl) => sl.label), extraction })
      }
      const row = await upsertClaimMessage(client, input)
      return json({ posted: !!row, alreadyClaimed: !row })
    }

    if (action === 'scan') {
      // Inbox-wide sweep: match recent inbound mail to applicants so the app
      // can badge replies without opening each Emails tab.
      const at = await accessToken(client)
      const { data: allApplicants } = await client.from('recruit_applicants').select('id, email')
      const byEmail = new Map((allApplicants || [])
        .filter((a) => a.email?.includes('@'))
        .map((a) => [a.email.toLowerCase(), a.id]))
      // Thread fallback: people reply from addresses other than the one on
      // their application. Any message in a thread we've already matched
      // belongs to that applicant, regardless of From/To.
      const { data: knownThreads } = await client.from('recruit_emails').select('thread_id, applicant_id')
      const byThread = new Map((knownThreads || [])
        .filter((r) => r.thread_id)
        .map((r) => [r.thread_id, r.applicant_id]))
      const list = await (await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages?q=' + encodeURIComponent('newer_than:14d') + '&maxResults=60', {
        headers: { Authorization: `Bearer ${at}` },
      })).json()
      let matched = 0
      const replied = new Set<string>()
      for (const m of (list.messages || [])) {
        const { data: existing } = await client.from('recruit_emails').select('id').eq('gmail_id', m.id).maybeSingle()
        if (existing) continue
        const msg = await (await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${m.id}?format=full`, {
          headers: { Authorization: `Bearer ${at}` },
        })).json()
        const hs = msg.payload?.headers || []
        const from = header(hs, 'From')
        const to = header(hs, 'To')
        const direction = from.toLowerCase().includes(SHARED_EMAIL) ? 'out' : 'in'
        const counterpart = (direction === 'in' ? from : to).toLowerCase()
        const applicantId = [...byEmail.entries()].find(([em]) => counterpart.includes(em))?.[1]
          || byThread.get(msg.threadId)
        if (!applicantId) continue
        if (!byThread.has(msg.threadId)) byThread.set(msg.threadId, applicantId)
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
          applicant_id: applicantId, gmail_id: msg.id, thread_id: msg.threadId,
          direction, subject: header(hs, 'Subject').slice(0, 300),
          snippet: (msg.snippet || '').slice(0, 300),
          body_text: bodyText.slice(0, 8000),
          from_email: from.slice(0, 200), to_email: to.slice(0, 200),
          sent_at: new Date(Number(msg.internalDate) || Date.now()).toISOString(),
        }, { onConflict: 'gmail_id' })
        matched++
        if (direction === 'in') {
          replied.add(applicantId)
          if (bodyText.trim()) {
            const extraction = await extractAvailability(bodyText)
            if (extraction.windows.length) {
              await client.from('recruit_availability').upsert({
                applicant_id: applicantId, windows: extraction.windows, source_gmail_id: msg.id,
                updated_at: new Date().toISOString(),
              })
            }
            // manual-trigger era: no auto post (see claim-preview/claim-post)
            // await postClaim(client, applicantId, extraction)
          }
        }
      }
      // Availability backfill: extraction normally runs when a message first
      // lands, but replies matched late (thread fallback) or from before an
      // extraction fix slip through. For each applicant whose LATEST inbound
      // was never extracted, run it from the stored body. Empty extractions
      // are stored too (windows []) so a non-scheduling reply is marked
      // processed and Haiku doesn't re-read it every scan. Capped per scan.
      let backfilled = 0
      try {
        const { data: avRows } = await client.from('recruit_availability').select('applicant_id, source_gmail_id')
        const avBy = new Map((avRows || []).map((r) => [r.applicant_id, r.source_gmail_id]))
        const { data: inbound } = await client.from('recruit_emails')
          .select('applicant_id, gmail_id, body_text, sent_at')
          .eq('direction', 'in').order('sent_at', { ascending: false }).limit(60)
        const seen = new Set<string>()
        for (const r of (inbound || [])) {
          if (seen.has(r.applicant_id)) continue
          seen.add(r.applicant_id)
          if (backfilled >= 5) break
          if (avBy.get(r.applicant_id) === r.gmail_id) continue // latest already processed
          if (!r.body_text?.trim()) continue
          const { data: sched } = await client.from('recruit_screenings')
            .select('id').eq('applicant_id', r.applicant_id).eq('status', 'scheduled').limit(1).maybeSingle()
          if (sched) continue // call already booked — nothing to extract for
          const extraction = await extractAvailability(r.body_text)
          await client.from('recruit_availability').upsert({
            applicant_id: r.applicant_id, windows: extraction.windows,
            source_gmail_id: r.gmail_id, updated_at: new Date().toISOString(),
          })
          // manual-trigger era: no auto post (see claim-preview/claim-post)
          backfilled++
          console.log(`availability backfill: ${r.applicant_id} → ${extraction.windows.length} windows`)
        }
      } catch (err) {
        console.warn(`availability backfill failed: ${(err as Error).message}`)
      }

      // Manual-scheduling pickup: a human who jumps in and sends a calendar
      // invite from the shared account bypasses the app's schedule action.
      // Sweep upcoming events; any attendee matching an applicant — by their
      // application address OR any address they've written from — becomes a
      // screenings row (deduped by event id, so app-booked calls are skipped).
      let manualPickups = 0
      try {
        const { data: altRows } = await client.from('recruit_emails').select('applicant_id, from_email').eq('direction', 'in')
        const altByEmail = new Map<string, string>()
        for (const r of (altRows || [])) {
          const m = String(r.from_email || '').toLowerCase().match(/[a-z0-9._%+-]+@[a-z0-9.-]+/)
          if (m) altByEmail.set(m[0], r.applicant_id)
        }
        const timeMin = new Date().toISOString()
        const timeMax = new Date(Date.now() + 45 * 86400000).toISOString()
        const cal = await (await fetch(`https://www.googleapis.com/calendar/v3/calendars/primary/events?timeMin=${encodeURIComponent(timeMin)}&timeMax=${encodeURIComponent(timeMax)}&singleEvents=true&maxResults=100`, {
          headers: { Authorization: `Bearer ${at}` },
        })).json()
        for (const ev of (cal.items || [])) {
          if (!ev.attendees?.length || !ev.start?.dateTime) continue
          let aid: string | null = null
          for (const att of ev.attendees) {
            const em = String(att.email || '').toLowerCase()
            aid = byEmail.get(em) || altByEmail.get(em) || null
            if (aid) break
          }
          if (!aid) continue
          const { data: existingEv } = await client.from('recruit_screenings').select('id').eq('gcal_event_id', ev.id).maybeSingle()
          if (existingEv) continue
          await client.from('recruit_screenings').insert({
            applicant_id: aid,
            starts_at: ev.start.dateTime,
            ends_at: ev.end?.dateTime || ev.start.dateTime,
            gcal_event_id: ev.id,
            meet_link: ev.hangoutLink || null,
            housemate_name: ev.organizer?.displayName || (ev.organizer?.email === SHARED_EMAIL ? 'the house' : ev.organizer?.email) || 'scheduled manually',
            status: 'scheduled',
          })
          manualPickups++
          console.log(`manual screening picked up: ${aid} @ ${ev.start.dateTime}`)
        }
      } catch (err) {
        console.warn(`calendar sweep failed: ${(err as Error).message}`)
      }

      await remindStuckPosts(client)
      console.log(`scan: ${matched} new messages matched, ${replied.size} applicants replied, ${manualPickups} manual screenings picked up, ${backfilled} availability backfills`)
      return json({ matched, replied: [...replied], manualPickups, backfilled })
    }

    return json({ error: 'Unknown action' }, 400)
  } catch (err) {
    console.error('recruit-gmail error:', (err as Error).message)
    return json({ error: (err as Error).message }, 500)
  }
})
