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

const VERSION = '1.28.0'
console.log(`[recruit-gmail] v${VERSION} — shared-account applicant email pipe + claim posts + reply intents`)

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { sharedAccessToken as accessToken, b64url, scheduleScreening, sendIntroEmail, sweepCalendars, SHARED_EMAIL, TZ } from '../_shared/recruit-schedule.ts'
import { upsertScreenerScheduler, editSchedulerSignedUp, notifyStuck, slotLabel, slotWhen, deriveSlots, buildMessage, postChannelEmbed, NOTES_CHANNEL_ID } from '../_shared/discord.ts'
import { record } from '../_shared/recruit-notify.ts'

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
  'https://www.googleapis.com/auth/spreadsheets.readonly', // application-sheet ingest
  'https://www.googleapis.com/auth/drive.readonly', // review comment threads on the application sheet
]

function db() {
  return createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
}

interface Extraction {
  windows: Array<{ date: string; start: string; end: string }>
  platform: { kind: string; handle?: string } | null
  timezone_note: string | null
  needs_human: boolean
  /* What the reply is actually about. Free to compute — this is the same Haiku
     call that was already reading the body for availability windows. `intent`
     routes; `intents` keeps everything the message was doing so the copy can
     say "sent times and asked something". */
  intent: string
  intents: string[]
  intent_confidence: number
  intent_summary: string | null
}
const INTENTS = ['availability', 'reschedule', 'plans_changed', 'withdrawing',
  'post_acceptance', 'question', 'info_provided', 'nudge', 'unclear']
// Below this a human reads the thread. Same discipline as detectAgreedTime:
// misrouting a withdrawal is worse than not routing it at all.
const INTENT_FLOOR = 0.6
const NO_EXTRACTION: Extraction = {
  windows: [], platform: null, timezone_note: null, needs_human: false,
  intent: 'unclear', intents: [], intent_confidence: 0, intent_summary: null,
}

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
5. "intent": what this reply is FOR, exactly one of:
   - "availability": offering times for a call.
   - "reschedule": moving or cancelling a call that is already arranged.
   - "plans_changed": their move-in date, budget, or length of stay has changed.
   - "withdrawing": no longer interested, found another place, pausing their search.
   - "post_acceptance": they are coming, and this is about lease, keys, move-in day, parking.
   - "question": asking us something (rent, rooms, housemates, process).
   - "info_provided": sending something we asked for (references, income, socials).
   - "nudge": following up, chasing an answer, "any update?".
   - "unclear": you cannot tell.
6. "intents": every one of the above that applies, most important first. A reply
   offering times AND asking about parking is ["availability","question"].
7. "confidence": 0-1, how sure you are of "intent". Be honest and be harsh —
   below 0.6 we route it to a human instead of acting on it. A polite,
   ambiguous message ("thanks, I'll think about it") is low confidence, not
   "withdrawing".
8. "summary": a SHORT THIRD-PERSON NOUN PHRASE that completes the sentence
   "they asked ___" or "they told us ___". Not a description of the email, not a
   quote, no leading capital, no trailing period.
   Good: "whether the room is furnished", "if full-time residency is possible",
         "that they can't move until July"
   Bad:  "Asking about the room." / "Interested in moving to SF; asking if
         full-time residency at Agape is possible." / "The applicant wants…"
   Max 90 characters. Empty string if there is no clear ask.

EMAIL START
${text.slice(0, 3000)}
EMAIL END
Return one JSON object: {"windows":..., "platform":..., "timezone_note":..., "needs_human":..., "intent":..., "intents":..., "confidence":..., "summary":...}. No prose.`
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
      ...normalizeIntent(obj, windows.length > 0),
    }
  } catch { return NO_EXTRACTION }
}

/* Turn the model's intent fields into something the ledger can trust.

   Two rules do the real work. The confidence floor sends anything shaky to
   'unclear', where a human reads it — the cost of a wrong 'withdrawing' is a
   live candidate archived. And the extraction outranks the classifier on its own
   turf: if we parsed real availability windows out of the message, then
   'availability' is one of its intents no matter what the label said. The parse
   is ground truth; the label is an opinion. */
function normalizeIntent(obj: Record<string, unknown>, hasWindows: boolean): {
  intent: string; intents: string[]; intent_confidence: number; intent_summary: string | null
} {
  const raw = String(obj.intent || '').toLowerCase().trim()
  const confidence = Math.max(0, Math.min(1, Number(obj.confidence) || 0))
  const list = (Array.isArray(obj.intents) ? obj.intents : [])
    .map((x) => String(x).toLowerCase().trim())
    .filter((x) => INTENTS.includes(x))

  let intent = INTENTS.includes(raw) ? raw : 'unclear'
  if (confidence < INTENT_FLOOR) intent = 'unclear'
  // Ground truth wins on its own turf.
  if (hasWindows && !list.includes('availability')) list.unshift('availability')
  if (hasWindows && intent === 'unclear') intent = 'availability'
  if (intent !== 'unclear' && !list.includes(intent)) list.unshift(intent)

  const summary = String(obj.summary || '').replace(/\s+/g, ' ').trim().slice(0, 120)
  return { intent, intents: [...new Set(list)].slice(0, 4), intent_confidence: confidence, intent_summary: summary || null }
}

/* Some calls get agreed entirely in the email thread — "Tuesday at 3 works!"
   — and no invite is ever sent. Nothing downstream sees them: no calendar
   event, so no Meet link, so no recording bot, and the row keeps showing
   "Review availability" for a call that's already on the books.

   This reads the tail of a thread and reports a time only when BOTH sides
   have converged on one. Deliberately strict: the cost of a false positive
   is a wrong calendar invite landing in an applicant's inbox. */
interface AgreedTime {
  agreed: boolean
  starts_at: string | null   // ISO 8601 with offset
  minutes: number | null
  quote: string | null       // the sentence that settles it
  confidence: 'high' | 'medium' | 'low'
}
const NO_AGREEMENT: AgreedTime = { agreed: false, starts_at: null, minutes: null, quote: null, confidence: 'low' }

async function detectAgreedTime(thread: Array<{ direction: string; sent_at: string; body_text: string | null; snippet: string | null }>): Promise<AgreedTime> {
  const key = Deno.env.get('RECRUIT_ANTHROPIC_API_KEY') || Deno.env.get('ANTHROPIC_API_KEY') || Deno.env.get('LADDER_ANTHROPIC_API_KEY')
  if (!key || thread.length < 2) return NO_AGREEMENT
  const transcript = thread.map((m) =>
    `[${m.direction === 'out' ? 'AGAPE' : 'APPLICANT'} · ${m.sent_at}]\n${(m.body_text || m.snippet || '').slice(0, 1500)}`,
  ).join('\n\n---\n\n')

  const prompt = `Today is ${new Date().toLocaleDateString('en-CA', { timeZone: TZ })} (${TZ}). Below is an email thread between Agape (a San Francisco co-living house) and a housing applicant.

Decide whether they have MUTUALLY AGREED on one specific date and time for a call, with no invite yet sent.

Say agreed=true ONLY when all of these hold:
- One specific date AND clock time is settled (not a range, not "sometime Tuesday", not a list of options).
- Both sides have expressed assent — one proposed it and the other accepted, or one confirmed a time the other named.
- The time is in the future.
Say agreed=false for: offered availability nobody accepted yet, a proposal with no reply, a time that already passed, vague agreement ("looking forward to chatting!"), or anything you are unsure about. When in doubt, false — a wrong answer sends a real applicant a wrong calendar invite.

Return JSON:
{"agreed": bool,
 "starts_at": "YYYY-MM-DDTHH:MM:SS-07:00" (Pacific offset) or null,
 "minutes": integer duration if stated, else 30,
 "quote": the exact sentence that settles it, or null,
 "confidence": "high" | "medium" | "low"}

THREAD START
${transcript.slice(0, 12000)}
THREAD END
One JSON object. No prose.`

  const resp = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
    body: JSON.stringify({
      model: 'claude-haiku-4-5-20251001', max_tokens: 400,
      system: 'You detect firmly-agreed meeting times in email threads. You are conservative: unless both parties clearly settled on one specific date and time, you answer agreed=false. Respond with a single JSON object only.',
      messages: [{ role: 'user', content: prompt }],
    }),
  })
  if (!resp.ok) { console.warn(`detectAgreedTime: anthropic ${resp.status}`); return NO_AGREEMENT }
  const data = await resp.json()
  const out = (data.content || []).filter((b: any) => b.type === 'text').map((b: any) => b.text).join('')
  try {
    const o = JSON.parse(out.trim().replace(/^```json?\s*|\s*```$/g, ''))
    if (!o.agreed || !o.starts_at) return NO_AGREEMENT
    const when = new Date(o.starts_at)
    if (isNaN(when.getTime())) return NO_AGREEMENT
    return {
      agreed: true,
      starts_at: when.toISOString(),
      minutes: Number(o.minutes) > 0 && Number(o.minutes) <= 180 ? Number(o.minutes) : 30,
      quote: o.quote ? String(o.quote).slice(0, 300) : null,
      confidence: ['high', 'medium', 'low'].includes(o.confidence) ? o.confidence : 'low',
    }
  } catch { return NO_AGREEMENT }
}

/* Turn email-agreed times into real calendar events, so the Meet link
   exists and the recording bot has something to join. Runs inside the scan,
   which the 20-minute cron drives.

   OFF until switched on, because the invite is a real email to a real
   applicant chosen by a model. Enable with:
     insert into recruit_settings(key, value) values ('email_autoschedule', 'true')
       on conflict (key) do update set value = 'true';
   Pass dryRun to see what it WOULD book without touching anything. */
async function scheduleFromEmail(client: ReturnType<typeof db>, dryRun = false): Promise<{ made: number; proposals: any[] }> {
  const { data: flag } = await client.from('recruit_settings')
    .select('value').eq('key', 'email_autoschedule').maybeSingle()
  if (!dryRun && flag?.value !== true) return { made: 0, proposals: [] }

  // Live applicants with inbound mail and no call on the books.
  const { data: live } = await client.from('recruit_applicants')
    .select('id, first_name, last_name, email')
    .in('stage', ['review', 'candidate'])
  if (!live?.length) return { made: 0, proposals: [] }
  const { data: booked } = await client.from('recruit_screenings')
    .select('applicant_id').eq('kind', 'intro_call').in('status', ['scheduled', 'completed'])
  const haveCall = new Set((booked || []).map((r) => r.applicant_id))

  let made = 0
  const proposals: any[] = []
  for (const a of live) {
    if (haveCall.has(a.id) || !a.email?.includes('@')) continue
    const { data: thread } = await client.from('recruit_emails')
      .select('direction, sent_at, body_text, snippet')
      .eq('applicant_id', a.id).order('sent_at', { ascending: false }).limit(6)
    if (!thread?.length) continue
    const msgs = thread.slice().reverse()
    // Needs a real back-and-forth: one side talking to itself isn't a deal.
    if (!msgs.some((m) => m.direction === 'in') || !msgs.some((m) => m.direction === 'out')) continue

    const hit = await detectAgreedTime(msgs)
    if (!hit.agreed || hit.confidence === 'low' || !hit.starts_at) continue
    const when = new Date(hit.starts_at)
    if (when.getTime() < Date.now() || when.getTime() > Date.now() + 60 * 86400000) continue
    proposals.push({ applicant: `${a.first_name} ${a.last_name || ''}`.trim(), startsAt: when.toISOString(), minutes: hit.minutes, confidence: hit.confidence, quote: hit.quote })
    if (dryRun) continue

    try {
      const result = await scheduleScreening(client, {
        applicantId: a.id,
        startsAt: when,
        minutes: hit.minutes || 30,
        housemateUserId: null as unknown as string,
        housemateName: 'agreed by email',
        housemateEmail: '',
      })
      made++
      console.log(`[autoschedule] ${a.first_name} @ ${when.toISOString()} (${hit.confidence}) — ${hit.quote || 'no quote'}`)
      try {
        const { postResilient, NOTES_CHANNEL_ID: NOTES } = await import('../_shared/discord.ts')
        await postResilient(NOTES, {
          embeds: [{
            title: `Calendar invite sent — ${a.first_name} ${a.last_name || ''}`.trim(),
            description: [
              `A time was agreed over email, so the call is now on the house calendar and the recording bot will join.`,
              hit.quote ? `> ${hit.quote}` : null,
              result.meetLink ? `[Meet link](${result.meetLink})` : null,
              `If this is wrong, cancel the event on the calendar — nothing else was sent.`,
            ].filter(Boolean).join('\n\n'),
            color: 0x1D9E75,
          }],
        }, 'autoschedule')
      } catch { /* Discord down never blocks scheduling */ }
    } catch (err) {
      console.warn(`[autoschedule] ${a.id} failed: ${(err as Error).message}`)
    }
  }
  return { made, proposals }
}

// The manual→auto claim cutover is a settings toggle, not a deploy.
async function autoPostEnabled(client: ReturnType<typeof db>): Promise<boolean> {
  try {
    const { data } = await client.from('recruit_settings').select('value').eq('key', 'discord_auto_post').maybeSingle()
    return data?.value === true
  } catch { return false }
}

// After availability lands, post/refresh the claimable message in
// #recruiting-automation. Warn-only: Discord being down never breaks a scan.
async function postClaim(client: ReturnType<typeof db>, applicantId: string, extraction: Extraction): Promise<void> {
  if (!extraction.windows.length && !extraction.needs_human) return
  try {
    const { data: applicant } = await client.from('recruit_applicants')
      .select('first_name, why_agape, pronouns').eq('id', applicantId).maybeSingle()
    if (!applicant) return
    await upsertScreenerScheduler(client, {
      applicantId, firstName: applicant.first_name, whyLine: applicant.why_agape, pronouns: applicant.pronouns,
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

/* Which kind of recruit_screenings row a calendar event becomes.
   Only 'intro_call' drives the row state machine (Watch chips, recording
   bots, coverage reminders), so the default has to be the inert one — a
   house dinner misfiled as a call is a worse failure than a call misfiled
   as an event, which a human can reclassify.

   A video link is the strongest signal: intro calls are remote and
   everything on the house calendar that isn't is, by definition, in person. */
function classifyEvent(ev: any): 'intro_call' | 'visit' | 'house_event' {
  const title = String(ev.summary || '').toLowerCase()
  if (/\b(intro call|screening|phone screen|intro chat)\b/.test(title)) return 'intro_call'
  if (/\b(visit|tour|open house|walkthrough|come by|stop by)\b/.test(title)) return 'visit'
  // A video link is NOT sufficient on its own — the house calendar is full
  // of social events that happen to have a Meet link, and one of them
  // ("Peloton man doing what he Peloton can") sailed straight through the
  // first version of this rule. A screening is a small meeting: applicant,
  // a housemate or two, maybe the recording bot.
  const attendees = (ev.attendees || []).filter((x: any) => !x.resource).length
  if ((ev.hangoutLink || ev.conferenceData) && attendees > 0 && attendees <= 4) return 'intro_call'
  return 'house_event'
}

/* Hosts we recognise as "this is a recording". Deliberately a allowlist:
   scanning a chat channel for bare URLs would drag in every article anyone
   ever shared. tldv is the one the house actually uses. */
const RECORDING_HOSTS: Array<[RegExp, string]> = [
  [/(^|\.)tldv\.io$/i, 'tldv'],
  [/(^|\.)zoom\.us$/i, 'zoom'],
  [/(^|\.)fathom\.video$/i, 'fathom'],
  [/(^|\.)grain\.com$/i, 'grain'],
  [/(^|\.)loom\.com$/i, 'loom'],
  [/(^|\.)otter\.ai$/i, 'otter'],
  [/(^|\.)drive\.google\.com$/i, 'drive'],
  [/(^|\.)vimeo\.com$/i, 'vimeo'],
]

function sourceOf(url: string): string {
  try {
    const host = new URL(url).hostname
    return RECORDING_HOSTS.find(([re]) => re.test(host))?.[1] || host.replace(/^www\./, '')
  } catch { return 'link' }
}

function extractRecordingUrls(text: string): string[] {
  const out = new Set<string>()
  for (const raw of (text.match(/https?:\/\/[^\s<>()\[\]"']+/g) || [])) {
    const url = raw.replace(/[.,;:]+$/, '')
    try {
      if (RECORDING_HOSTS.some(([re]) => re.test(new URL(url).hostname))) out.add(url)
    } catch { /* not a URL we can parse */ }
  }
  return [...out]
}

function header(headers: Array<{ name: string; value: string }>, name: string): string {
  return headers.find((h) => h.name.toLowerCase() === name.toLowerCase())?.value || ''
}

/* One notification per classified reply. Reads the emails the scan just
   labelled and writes them to the ledger — the same table, sentences, and lanes
   everything else uses, so a reply reads like every other notification.

   'availability' is included deliberately: the claim post asks *someone* to take
   the call, while the digest line tells *the house* she replied. Two surfaces,
   two audiences, and suppressing the second because the first fired is how a
   house ends up unable to answer "did anyone ever get back to her?". */
/* For most intents the label carries everything: "wants to move their call" is
   the whole story and the thread has the rest. But for a question or a changed
   plan the CONTENT is the notification — "asked a question" tells a housemate
   nothing they can act on — so those splice the ask into the sentence itself.

   The summary is a clause meant to slot straight into the sentence ("whether
   the room is furnished"), so it goes in unquoted and lowercased. Anything that
   still arrives looking like a sentence — a capital first letter and a verb — is
   dropped rather than mangled into the middle of ours. */
function clause(s: string | null): string {
  const t = (s || '').replace(/\s+/g, ' ').trim().replace(/[.?!]+$/, '')
  if (!t || t.length > 90) return ''
  // A description, not a clause: "The applicant wants…", "Asking about…".
  if (/^(the applicant|asking|confirming|brief|interested|they |he |she )/i.test(t)) return ''
  return t.charAt(0).toLowerCase() + t.slice(1)
}
/* The offered times, as a housemate would say them: "Thu Jul 24, 9–11am · Fri
   2–5pm". A notification that says only "sent times for a call" makes the reader
   open the thread to learn the one fact they wanted, so the times go in the
   line.

   The date is dropped from a window that shares a day with the one before it,
   and the am/pm from a start that shares it with its own end — the same
   shortenings anyone makes when reading times aloud. */
function fmtWindows(windows: Array<{ date: string; start: string; end: string }>): string {
  if (!windows?.length) return ''
  const hhmm = (t: string, withMeridiem: boolean) => {
    const [h, m] = t.split(':').map(Number)
    const h12 = h % 12 === 0 ? 12 : h % 12
    return `${h12}${m ? `:${String(m).padStart(2, '0')}` : ''}${withMeridiem ? (h < 12 ? 'am' : 'pm') : ''}`
  }
  const dayLabel = (d: string) => new Date(`${d}T12:00:00Z`)
    .toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' })

  const parts: string[] = []
  let lastDay = ''
  for (const w of windows.slice(0, 3)) {
    const sameMeridiem = (Number(w.start.split(':')[0]) < 12) === (Number(w.end.split(':')[0]) < 12)
    const range = `${hhmm(w.start, !sameMeridiem)}\u2013${hhmm(w.end, true)}`
    parts.push(w.date === lastDay ? range : `${dayLabel(w.date)} ${range}`)
    lastDay = w.date
  }
  const more = windows.length > 3 ? ` and ${windows.length - 3} more` : ''
  return parts.join(' \u00b7 ') + more
}

const INTENT_SENTENCE: Record<string, (s: string | null) => string> = {
  availability:    (s) => s ? `{} is free ${s}.` : `{} sent times for a call.`,
  reschedule:      () => `{} wants to move their call.`,
  withdrawing:     () => `{} is no longer looking.`,
  post_acceptance: () => `{} is asking about moving in.`,
  info_provided:   () => `{} sent something over.`,
  nudge:           () => `{} is following up.`,
  plans_changed:   (s) => clause(s) ? `{} told us ${clause(s)}.` : `{}'s plans changed.`,
  question:        (s) => clause(s) ? `{} asked ${clause(s)}.` : `{} asked a question.`,
  // 'unclear' means the model couldn't summarise it either, so the sentence
  // stays plain and whatever it managed goes in the body for the Activity view.
  unclear:         () => `{} replied and it needs a read.`,
}
// Which lane each intent earns. The urgent three interrupt; the rest wait for
// the digest. A reschedule an hour before a call is not a tomorrow problem.
const INTENT_LANE: Record<string, 'now' | 'daily'> = {
  reschedule: 'now', withdrawing: 'now', plans_changed: 'now', post_acceptance: 'now',
  availability: 'daily', question: 'daily', info_provided: 'daily', nudge: 'daily', unclear: 'daily',
}

async function recordReplyIntents(client: ReturnType<typeof db>): Promise<number> {
  const since = new Date(Date.now() - 7 * 86400000).toISOString()
  const { data: rows } = await client.from('recruit_emails')
    .select('id, applicant_id, intent, intents, intent_summary, sent_at')
    .eq('direction', 'in').not('intent', 'is', null).gte('sent_at', since)
    .order('sent_at', { ascending: false }).limit(40)
  if (!rows?.length) return 0

  // Only people still in the funnel: mail from an archived applicant is logged
  // as email and is nobody's task.
  const ids = [...new Set(rows.map((r) => r.applicant_id))]
  const [{ data: live }, { data: avail }] = await Promise.all([
    client.from('recruit_applicants').select('id, first_name, last_name, stage')
      .in('id', ids).in('stage', ['review', 'candidate']),
    // The windows we parsed out of these very replies — the times themselves are
    // what the house wants to see, not the fact that times exist.
    client.from('recruit_availability').select('applicant_id, windows').in('applicant_id', ids),
  ])
  const byId = new Map((live || []).map((a) => [a.id, a]))
  const windowsBy = new Map((avail || []).map((r) => [r.applicant_id, r.windows || []]))

  /* Availability gets one notification per person — their latest offer only.
     recruit_availability stores a single current set of windows per applicant,
     so an older reply rendered with those windows would advertise times the
     person never named on that day. Keeping the newest reply means the line and
     the times always agree; when they send new times, updated_at moves and the
     next day's key fires with the new ones. */
  const newestAvailability = new Map<string, string>()
  for (const r of rows) {
    if (r.intent !== 'availability') continue
    const prev = newestAvailability.get(r.applicant_id)
    if (!prev || String(r.sent_at) > prev) newestAvailability.set(r.applicant_id, String(r.sent_at))
  }

  const notes = rows.filter((r) => byId.has(r.applicant_id)
      && (r.intent !== 'availability' || newestAvailability.get(r.applicant_id) === String(r.sent_at)))
    .map((r) => {
    const a = byId.get(r.applicant_id)!
    const intent = String(r.intent)
    const also = (r.intents || []).filter((x: string) => x !== intent)
    return {
      kind: `reply_${intent}`,
      subject_type: 'applicant' as const,
      subject_id: r.applicant_id,
      subject_label: a.first_name,
      lane: INTENT_LANE[intent] || 'daily',
      /* Per message, not per person — two questions deserve two answers.

         Except availability, which collapses to one entry per person per day.
         Arranging a call is a back-and-forth ("Tuesday?" / "or Wednesday" / "any
         time after 5") and every leg of it parses as availability: one real
         thread produced eight identical "sent times for a call" lines. The house
         needs to know she replied, once — the thread has the rest, and the claim
         post is already tracking the actual scheduling. */
      dedupe_key: intent === 'availability'
        ? `reply_availability:${r.applicant_id}:${String(r.sent_at).slice(0, 10)}`
        : `reply:${r.id}`,
      payload: {
        title: `${a.first_name} ${a.last_name || ''}`.trim(),
        sentence: (INTENT_SENTENCE[intent] || INTENT_SENTENCE.unclear)(
          // Availability speaks in times; every other intent speaks in words.
          intent === 'availability' ? fmtWindows(windowsBy.get(r.applicant_id)) : r.intent_summary),
        body: [
          // Only repeat the summary where the sentence didn't already use it.
          ['plans_changed', 'question'].includes(intent) && clause(r.intent_summary)
            ? null : r.intent_summary,
          also.length ? `also ${also.join(', ')}` : null,
        ].filter(Boolean).join(' · ') || undefined,
        section: 'Replies',
        links: [{ label: 'Read the thread', url: `https://ctrl.rodeo/applications/?a=${encodeURIComponent(r.applicant_id)}` }],
      },
    }
  })
  const made = await record(client, notes)
  if (made) console.log(`reply intents: ${made} notification(s) recorded`)
  return made
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const client = db()

    // Cron path: /scan runs the same inbox+calendar sweep the app triggers,
    // but on a schedule so row states stay current when nobody has the app
    // open. Same secretless handshake recruit-discord/remind uses — a
    // one-time nonce minted by the pg_cron tick, delete-on-use (migration
    // 123), with X-Cron-Secret honoured if CRON_SECRET is ever configured.
    const reqUrl = new URL(req.url)
    const isCron = reqUrl.pathname.endsWith('/scan') || reqUrl.pathname.endsWith('/classify-backfill')
    // /scan?dry=1 — report what email-autoschedule WOULD book and change
    // nothing else. Read-only, same nonce gate; exists so the detector can be
    // audited before anyone turns it on.
    const cronDryRun = isCron && reqUrl.searchParams.get('dry') === '1'
    if (isCron) {
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
    }

    /* POST /classify-backfill?limit=40[&record=1]
       Run the intent classifier over inbound email we already have.

       This is how shadow mode earns its keep: instead of guessing at a
       confidence floor, label a few dozen real replies and look at what the
       model actually did. Notifications are NOT created by default — an old
       reply is history, and turning a year of archived mail into a channel full
       of stale asks would be worse than useless. Pass record=1 only to also
       write ledger rows for people still in the funnel. */
    if (reqUrl.pathname.endsWith('/classify-backfill')) {
      const limit = Math.min(Number(reqUrl.searchParams.get('limit')) || 40, 120)
      const record_ = reqUrl.searchParams.get('record') === '1'
      const { data: rows } = await client.from('recruit_emails')
        .select('id, gmail_id, applicant_id, subject, body_text, snippet, sent_at, intent')
        .eq('direction', 'in').is('intent', null)
        .order('sent_at', { ascending: false }).limit(limit)
      if (!rows?.length) return json({ classified: 0, note: 'nothing left to classify' })

      let classified = 0
      const results: Array<Record<string, unknown>> = []
      for (const r of rows) {
        const body = (r.body_text || r.snippet || '').trim()
        if (!body) continue
        const ex = await extractAvailability(body)
        await client.from('recruit_emails').update({
          intent: ex.intent, intents: ex.intents,
          intent_confidence: ex.intent_confidence, intent_summary: ex.intent_summary,
          intent_at: new Date().toISOString(),
        }).eq('id', r.id)
        classified++
        results.push({
          applicant: r.applicant_id, sent_at: r.sent_at, subject: (r.subject || '').slice(0, 60),
          intent: ex.intent, intents: ex.intents,
          confidence: ex.intent_confidence, summary: ex.intent_summary,
        })
      }
      const recorded = record_ ? await recordReplyIntents(client) : 0
      console.log(`classify-backfill: ${classified} labelled, ${recorded} notification(s)`)
      return json({ classified, recorded, results })
    }

    const token = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '')
    let userData: any = null
    let membership: any = null
    if (!isCron) {
      const u = await client.auth.getUser(token)
      if (u.error || !u.data?.user) return json({ error: 'Not authenticated' }, 401)
      userData = u.data
      const m = await client.from('user_discord_membership')
        .select('is_recruiting_member, discord_username').eq('user_id', userData.user.id).maybeSingle()
      membership = m.data
      if (!membership?.is_recruiting_member) return json({ error: 'Not a recruiting member' }, 403)
    }

    const body = isCron ? {} as Record<string, unknown> : await req.json().catch(() => ({}))
    const action = isCron ? (cronDryRun ? 'autoschedule-preview' : 'scan') : (body as any).action

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

    if (action === 'send-update') {
      // Rejection-queue send: same pipe as 'send', plus stamps
      // update_email_sent_at and closes the stage to 'archived'.
      const { data: applicant } = await client.from('recruit_applicants').select('*').eq('id', String(body.applicantId || '')).maybeSingle()
      if (!applicant?.email?.includes('@')) return json({ error: 'Applicant has no email' }, 400)
      const subject = String(body.subject || '').slice(0, 300)
      const text = String(body.body || '').slice(0, 10000)
      if (!subject || !text) return json({ error: 'Subject and body required' }, 400)
      const at = await accessToken(client)
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
      await client.from('recruit_emails').upsert({
        applicant_id: applicant.id, gmail_id: sent.id, thread_id: sent.threadId,
        direction: 'out', subject, snippet: text.slice(0, 180), body_text: text,
        from_email: SHARED_EMAIL, to_email: applicant.email,
        sent_by_name: 'update queue', sent_at: new Date().toISOString(),
      }, { onConflict: 'gmail_id' })
      await client.from('recruit_applicants')
        .update({ update_email_sent_at: new Date().toISOString(), stage: 'archived' })
        .eq('id', applicant.id)
      return json({ sent: true })
    }

    if (action === 'send') {
      const { data: applicant } = await client.from('recruit_applicants').select('*').eq('id', String(body.applicantId || '')).maybeSingle()
      if (!applicant?.email?.includes('@')) return json({ error: 'Applicant has no email' }, 400)
      // Outreach can never reach someone who has been archived. 'send-update'
      // is the only channel left for them, and it carries no invitation.
      if (applicant.stage === 'rejected' || applicant.stage === 'archived') {
        return json({ error: 'They are archived — only their update email can be sent' }, 409)
      }
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
            if (await autoPostEnabled(client)) await postClaim(client, applicant.id, extraction)
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
          .select('discord_channel_id, discord_message_id, mirror_channel_id, mirror_message_id').maybeSingle()
        if (post) {
          const { data: dm } = await client.from('user_discord_membership')
            .select('discord_user_id').eq('user_id', userData.user.id).maybeSingle()
          if (dm?.discord_user_id) {
            const applicantName = `${result.applicant.first_name} ${result.applicant.last_name || ''}`.trim()
            await editSchedulerSignedUp(post, dm.discord_user_id, applicantName, applicantId, slotWhen(startsAt))
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

    if (action === 'link-recording') {
      // Attach an orphaned recorded call to an applicant: clone it into
      // recruit_screenings (the surface the app already renders — Watch chip,
      // notes) and stamp the recorded-event row so it stops counting as
      // unlinked. Idempotent per event via the gcal_event_id dedup.
      const gcalEventId = String(body.gcalEventId || '')
      const applicantId = String(body.applicantId || '')
      const { data: rec } = await client.from('recruit_recorded_events')
        .select('*').eq('gcal_event_id', gcalEventId).maybeSingle()
      if (!rec) return json({ error: 'unknown recorded event' }, 404)
      const { data: applicant } = await client.from('recruit_applicants')
        .select('id, first_name').eq('id', applicantId).maybeSingle()
      if (!applicant) return json({ error: 'unknown applicant' }, 404)
      const { data: dupe } = await client.from('recruit_screenings')
        .select('id').eq('gcal_event_id', gcalEventId).maybeSingle()
      if (!dupe) {
        const past = new Date(rec.ends_at || rec.starts_at) < new Date()
        const { error: insErr } = await client.from('recruit_screenings').insert({
          applicant_id: applicantId,
          starts_at: rec.starts_at,
          ends_at: rec.ends_at || rec.starts_at,
          gcal_event_id: rec.gcal_event_id,
          meet_link: rec.meet_link,
          housemate_name: 'linked manually',
          status: past ? 'completed' : 'scheduled',
          recall_bot_id: rec.recall_bot_id,
          recall_status: rec.recall_status,
          recording_summary: rec.recording_summary,
          recording_posted_at: rec.recording_posted_at,
        })
        if (insErr) return json({ error: insErr.message }, 500)
      }
      await client.from('recruit_recorded_events')
        .update({ applicant_id: applicantId }).eq('gcal_event_id', gcalEventId)
      return json({ linked: true, applicantId, firstName: applicant.first_name })
    }

    if (action === 'attach-recording') {
      // Paste a tldv/Zoom/Drive link onto an applicant. p_url null detaches.
      const url = body.url === null ? null : String(body.url || '').trim()
      const applicantId = String(body.applicantId || '')
      if (url && !/^https?:\/\//i.test(url)) return json({ error: 'Recording link must start with http(s)://' }, 400)
      const { data: rp } = await client.from('recruit_profiles')
        .select('display_name').eq('user_id', userData.user.id).maybeSingle()
      const { data: screeningId, error } = await client.rpc('recruit_attach_recording', {
        p_applicant: applicantId,
        p_url: url,
        p_source: url ? sourceOf(url) : null,
        p_name: rp?.display_name || membership.discord_username || null,
        p_screening: body.screeningId ? String(body.screeningId) : null,
      })
      if (error) return json({ error: error.message }, 400)
      // Close out any Discord lead that pointed at this URL.
      if (url) {
        await client.from('recruit_recording_leads')
          .update({ resolved_applicant_id: applicantId }).eq('url', url)
      }
      return json({ attached: true, screeningId })
    }

    if (action === 'autoschedule-preview') {
      // What the email-agreed-time detector WOULD book. Reads only.
      const out = await scheduleFromEmail(client, true)
      return json({ proposals: out.proposals })
    }

    if (action === 'recording-leads') {
      const { data } = await client.from('recruit_recording_leads')
        .select('*').is('resolved_applicant_id', null).is('dismissed_at', null)
        .order('posted_at', { ascending: false }).limit(50)
      return json({ leads: data || [] })
    }

    if (action === 'dismiss-lead') {
      await client.from('recruit_recording_leads')
        .update({ dismissed_at: new Date().toISOString() }).eq('id', String(body.leadId || ''))
      return json({ dismissed: true })
    }

    if (action === 'scan-recordings') {
      // Harvest recording links posted in the recruiting channels and guess
      // who each one is about. Guesses are SUGGESTIONS — a wrong recording
      // on someone's profile is worse than no recording, so nothing attaches
      // without a human picking the applicant.
      const { fetchChannelMessages, NOTES_CHANNEL_ID: NOTES, AUTOMATION_CHANNEL_ID } =
        await import('../_shared/discord.ts')
      const channels = [...new Set([
        Deno.env.get('RECRUITING_PING_CHANNEL_ID') || NOTES,
        AUTOMATION_CHANNEL_ID,
      ].filter(Boolean))] as string[]
      const sinceIso = new Date(Date.now() - 180 * 86400000).toISOString()

      const { data: people } = await client.from('recruit_applicants')
        .select('id, first_name, last_name')
      const { data: existingLeads } = await client.from('recruit_recording_leads').select('url')
      const seen = new Set((existingLeads || []).map((r) => r.url))
      const { data: attached } = await client.from('recruit_screenings')
        .select('external_recording_url').not('external_recording_url', 'is', null)
      for (const r of (attached || [])) seen.add(r.external_recording_url)

      let found = 0
      for (const channelId of channels) {
        let messages: any[] = []
        try {
          messages = await fetchChannelMessages(channelId, { limit: 400, sinceIso })
        } catch (err) {
          console.warn(`[recordings] cannot read channel ${channelId}: ${(err as Error).message}`)
          continue
        }
        for (const m of messages) {
          const text = [m.content || '', ...(m.embeds || []).flatMap((e: any) =>
            [e.title, e.description, e.url, ...((e.fields || []).map((f: any) => `${f.name} ${f.value}`))])]
            .filter(Boolean).join('\n')
          for (const url of extractRecordingUrls(text)) {
            if (seen.has(url)) continue
            seen.add(url)
            // Match on a full name first, then a distinctive first name —
            // "Sam" in a channel with two Sams stays unattributed on purpose.
            const hay = text.toLowerCase()
            let suggested: string | null = null
            for (const p of (people || [])) {
              const full = `${p.first_name || ''} ${p.last_name || ''}`.trim().toLowerCase()
              if (full && full.includes(' ') && hay.includes(full)) { suggested = p.id; break }
            }
            if (!suggested) {
              const firstHits = (people || []).filter((p) => {
                const f = String(p.first_name || '').toLowerCase()
                return f.length > 2 && new RegExp(`\\b${f.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`).test(hay)
              })
              if (firstHits.length === 1) suggested = firstHits[0].id
            }
            await client.from('recruit_recording_leads').upsert({
              url, source: sourceOf(url), channel_id: channelId, message_id: m.id,
              posted_at: m.timestamp, author_name: m.author?.global_name || m.author?.username || null,
              context: text.replace(/\s+/g, ' ').slice(0, 400),
              suggested_applicant_id: suggested,
            }, { onConflict: 'url' })
            found++
          }
        }
      }
      console.log(`[recordings] ${found} new link(s) across ${channels.length} channel(s)`)
      return json({ found })
    }

    if (action === 'unlinked-recordings') {
      // Feed for the app's link modal: swept calls with no applicant.
      const { data } = await client.from('recruit_recorded_events')
        .select('gcal_event_id, title, starts_at, recording_summary')
        .is('applicant_id', null)
        .order('starts_at', { ascending: false }).limit(25)
      return json({ recordings: data || [] })
    }

    // 'scheduler-*' is the current vocabulary; 'claim-*' stays accepted so a
    // browser holding a cached app.js keeps working after this rename.
    if (action === 'scheduler-preview' || action === 'scheduler-post' || action === 'claim-preview' || action === 'claim-post') {
      const isPreview = action === 'scheduler-preview' || action === 'claim-preview'
      // Manual Discord trigger: preview composes the exact message; post
      // sends it. The extraction rides back from preview to post so Haiku
      // runs once. Future cutover: re-enable the auto postClaim calls.
      const applicantId = String(body.applicantId || '')
      const { data: applicant } = await client.from('recruit_applicants')
        .select('id, first_name, why_agape, pronouns').eq('id', applicantId).maybeSingle()
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
        applicantId, firstName: applicant.first_name, whyLine: applicant.why_agape, pronouns: applicant.pronouns,
        windows: extraction.windows, platform: extraction.platform,
        timezoneNote: extraction.timezone_note, needsHuman: extraction.needs_human,
      }
      const slots = extraction.needs_human ? [] : deriveSlots(extraction.windows)
      const message = buildMessage(input, slots)
      if (isPreview) {
        return json({ preview: message, slotLabels: slots.map((sl) => sl.label), extraction })
      }
      const row = await upsertScreenerScheduler(client, input)
      return json({ posted: !!row, alreadySignedUp: !row, alreadyClaimed: !row })
    }

    if (action === 'archive-now') {
      // Force the archive for unarchived recordings and surface real errors
      // (the cron sweep only logs them).
      const { data: rows } = await client.from('recruit_screenings')
        .select('id, recall_bot_id').eq('recall_status', 'done').is('recording_path', null)
        .not('recall_bot_id', 'is', null)
      const { getBotResult, archiveVideoToStorage } = await import('../_shared/recall.ts')
      const out = []
      for (const r of (rows || [])) {
        try {
          const bot = await getBotResult(r.recall_bot_id)
          if (!bot.videoUrl) { out.push({ id: r.id, skipped: bot.statusCode }); continue }
          const path = await archiveVideoToStorage(client, bot.videoUrl, `screenings/${r.id}.mp4`)
          await client.from('recruit_screenings').update({ recording_path: path }).eq('id', r.id)
          out.push({ id: r.id, archived: path })
        } catch (err) {
          out.push({ id: r.id, error: (err as Error).message })
        }
      }
      return json({ results: out })
    }

    if (action === 'relink-recordings') {
      // Repair old notes whose 🎥 link is an expired Recall URL.
      const { relinkRecordingPosts } = await import('../_shared/discord.ts')
      const out = await relinkRecordingPosts(async (applicantId, title) => {
        if (applicantId) {
          const { data } = await client.from('recruit_screenings')
            .select('share_token').eq('applicant_id', applicantId)
            .not('share_token', 'is', null).not('recording_path', 'is', null)
            .order('starts_at', { ascending: false }).limit(1).maybeSingle()
          if (data?.share_token) return data.share_token
        }
        // No profile link: "<First> × <Resident> — Intro Call notes" or
        // "<Title> — meeting notes". Try the applicant's first name, then
        // the recorded-event title.
        const stem = title.replace(/ — (Intro Call|meeting) notes$/, '').trim()
        const first = stem.split('×')[0].trim().replace(/'s Intro Call$/, '')
        if (first) {
          const { data: app } = await client.from('recruit_applicants')
            .select('id').ilike('first_name', first).limit(2)
          if (app?.length === 1) {
            const { data } = await client.from('recruit_screenings')
              .select('share_token').eq('applicant_id', app[0].id)
              .not('share_token', 'is', null).not('recording_path', 'is', null)
              .order('starts_at', { ascending: false }).limit(1).maybeSingle()
            if (data?.share_token) return data.share_token
          }
        }
        const { data: ev } = await client.from('recruit_recorded_events')
          .select('share_token').eq('title', stem)
          .not('share_token', 'is', null).not('recording_path', 'is', null)
          .limit(1).maybeSingle()
        return ev?.share_token || null
      })
      return json(out)
    }

    if (action === 'recording-link') {
      // Our permanent storage copy first; Recall (short-lived presigned URL)
      // only as fallback for recordings not yet archived.
      const { data: s } = await client.from('recruit_screenings')
        .select('id, recall_bot_id, recording_path').eq('id', String(body.screeningId || '')).maybeSingle()
      if (!s?.recall_bot_id && !s?.recording_path) return json({ error: 'No recording for this call' }, 404)
      if (s.recording_path) {
        const { data: signed, error: signErr } = await client.storage
          .from('recruit-recordings').createSignedUrl(s.recording_path, 6 * 3600)
        if (!signErr && signed?.signedUrl) return json({ url: signed.signedUrl, source: 'archive' })
      }
      const { getBotResult } = await import('../_shared/recall.ts')
      const bot = await getBotResult(s.recall_bot_id)
      if (!bot.videoUrl) return json({ error: 'Recording not ready (or has been purged)' }, 404)
      return json({ url: bot.videoUrl, source: 'recall' })
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
      const { data: knownThreads } = await client.from('recruit_emails').select('thread_id, applicant_id, gmail_id')
      const byThread = new Map((knownThreads || [])
        .filter((r) => r.thread_id)
        .map((r) => [r.thread_id, r.applicant_id]))
      // One set instead of a SELECT per message. This is what makes a wider
      // window affordable: the old per-message existence check meant 60 round
      // trips a run, so the cap had to stay small and mail older than the cap
      // was simply never seen.
      const knownIds = new Set((knownThreads || []).map((r) => r.gmail_id).filter(Boolean))
      // Cron runs sweep wider than the app's opportunistic scan: a quiet
      // stretch with nobody opening the app used to leave a permanent hole.
      const windowDays = isCron ? 60 : 14
      const pageCap = isCron ? 400 : 100
      const messages: Array<{ id: string }> = []
      let pageToken = ''
      do {
        const url = 'https://gmail.googleapis.com/gmail/v1/users/me/messages?q=' +
          encodeURIComponent(`newer_than:${windowDays}d`) + '&maxResults=100' +
          (pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : '')
        const page = await (await fetch(url, { headers: { Authorization: `Bearer ${at}` } })).json()
        messages.push(...(page.messages || []))
        pageToken = page.nextPageToken || ''
      } while (pageToken && messages.length < pageCap)
      let matched = 0
      const replied = new Set<string>()
      for (const m of messages) {
        if (knownIds.has(m.id)) continue
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
            // The same extraction already knows what the reply was about.
            await client.from('recruit_emails').update({
              intent: extraction.intent, intents: extraction.intents,
              intent_confidence: extraction.intent_confidence,
              intent_summary: extraction.intent_summary,
              intent_at: new Date().toISOString(),
            }).eq('gmail_id', msg.id)
            if (await autoPostEnabled(client)) await postClaim(client, applicantId, extraction)
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
          // Same call, same cost: label the reply while we have it open.
          await client.from('recruit_emails').update({
            intent: extraction.intent, intents: extraction.intents,
            intent_confidence: extraction.intent_confidence,
            intent_summary: extraction.intent_summary,
            intent_at: new Date().toISOString(),
          }).eq('gmail_id', r.gmail_id)
          if ((extraction.windows.length || extraction.needs_human) && await autoPostEnabled(client)) await postClaim(client, r.applicant_id, extraction)
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
        // People who left the funnel don't need their calendar mined. This
        // also stops long-dead test records from collecting house events.
        const { data: goneRows } = await client.from('recruit_applicants')
          .select('id').in('stage', ['rejected', 'archived'])
        const gone = new Set((goneRows || []).map((r) => r.id))
        const { data: altRows } = await client.from('recruit_emails').select('applicant_id, from_email').eq('direction', 'in')
        const altByEmail = new Map<string, string>()
        for (const r of (altRows || [])) {
          const m = String(r.from_email || '').toLowerCase().match(/[a-z0-9._%+-]+@[a-z0-9.-]+/)
          if (m) altByEmail.set(m[0], r.applicant_id)
        }
        // Look back as well as forward: an event that already happened is
        // exactly the thing the app failed to notice at the time.
        const timeMin = new Date(Date.now() - 60 * 86400000).toISOString()
        const timeMax = new Date(Date.now() + 45 * 86400000).toISOString()
        const { data: seenEvents } = await client.from('recruit_screenings')
          .select('gcal_event_id').not('gcal_event_id', 'is', null)
        const seenIds = new Set((seenEvents || []).map((r) => r.gcal_event_id))

        for (const calendarId of sweepCalendars()) {
          const resp = await fetch(`https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events?timeMin=${encodeURIComponent(timeMin)}&timeMax=${encodeURIComponent(timeMax)}&singleEvents=true&maxResults=250`, {
            headers: { Authorization: `Bearer ${at}` },
          })
          if (!resp.ok) {
            // A calendar the shared account can't read shouldn't kill the
            // sweep for the ones it can.
            console.warn(`[calendar] cannot read ${calendarId} (${resp.status}) — skipping`)
            continue
          }
          const cal = await resp.json()
          for (const ev of (cal.items || [])) {
            if (!ev.attendees?.length || !ev.start?.dateTime) continue
            if (ev.status === 'cancelled') continue
            let aid: string | null = null
            for (const att of ev.attendees) {
              const em = String(att.email || '').toLowerCase()
              aid = byEmail.get(em) || altByEmail.get(em) || null
              if (aid) break
            }
            if (!aid || gone.has(aid)) continue
            if (seenIds.has(ev.id)) continue
            seenIds.add(ev.id)
            const past = new Date(ev.end?.dateTime || ev.start.dateTime) < new Date()
            await client.from('recruit_screenings').insert({
              applicant_id: aid,
              starts_at: ev.start.dateTime,
              ends_at: ev.end?.dateTime || ev.start.dateTime,
              gcal_event_id: ev.id,
              calendar_id: calendarId,
              title: String(ev.summary || '').slice(0, 300),
              kind: classifyEvent(ev),
              meet_link: ev.hangoutLink || null,
              housemate_name: ev.organizer?.displayName || (ev.organizer?.email === SHARED_EMAIL ? 'the house' : ev.organizer?.email) || 'scheduled manually',
              status: past ? 'completed' : 'scheduled',
            })
            manualPickups++
            console.log(`calendar pickup [${classifyEvent(ev)}] on ${calendarId}: ${aid} @ ${ev.start.dateTime}`)
          }
        }
      } catch (err) {
        console.warn(`calendar sweep failed: ${(err as Error).message}`)
      }

      // Phase B: ping the Recruiting Society channel about new applications —
      // stage 'review', no votes yet, never pinged. One post per applicant;
      // a batch of 4+ collapses into a single digest.
      let pinged = 0
      try {
        // New applications go to the members channel; the audit copy lands in
        // #recruiting-automation automatically.
        const pingChannel = Deno.env.get('RECRUITING_PING_CHANNEL_ID') || NOTES_CHANNEL_ID
        if (pingChannel) {
          // Only genuinely new applications — a 14-day floor keeps switching
          // this on from dumping the historical backlog into the channel.
          const pingFloor = new Date(Date.now() - 14 * 86400000).toISOString()
          const { data: fresh } = await client.from('recruit_applicants')
            .select('id, first_name, last_name, residency, move_in, why_agape')
            .eq('stage', 'review').is('discord_ping_at', null).gte('submitted_at', pingFloor)
            .order('submitted_at', { ascending: false }).limit(12)
          const { data: votedRows } = await client.from('recruit_votes').select('applicant_id')
          const voted = new Set((votedRows || []).map((v) => v.applicant_id))
          const toPing = (fresh || []).filter((a) => !voted.has(a.id))
          const appLink = (id: string) => `https://ctrl.rodeo/applications/?a=${encodeURIComponent(id)}`
          if (toPing.length > 3) {
            const lines = toPing.map((a) => `• [${a.first_name} ${a.last_name || ''}](${appLink(a.id)})`).join('\n')
            await postChannelEmbed(pingChannel, `📥 **${toPing.length} new applications** are ready for votes:\n${lines}`,
              0x378add, `${toPing.length} new applications`,
              [{ label: 'Open the inbox', url: 'https://ctrl.rodeo/applications/?view=inbox' }])
          } else {
            for (const a of toPing) {
              const track = /short/i.test(a.residency || '') ? 'Sublet' : 'Full-time'
              const why = (a.why_agape || '').trim().replace(/\s+/g, ' ').slice(0, 140)
              await postChannelEmbed(pingChannel,
                `📥 **${a.first_name} ${a.last_name || ''}** applied — ${track}${a.move_in ? ` · ${String(a.move_in).slice(0, 60)}` : ''}\n` +
                (why ? `_${why}_\n` : '') +
                '', 0x378add, `New application — ${a.first_name}`,
                [{ label: `Review ${a.first_name}`, url: appLink(a.id) },
                 { label: 'Open the inbox', url: 'https://ctrl.rodeo/applications/?view=inbox' }])
            }
          }
          if (toPing.length) {
            await client.from('recruit_applicants')
              .update({ discord_ping_at: new Date().toISOString() })
              .in('id', toPing.map((a) => a.id))
            pinged = toPing.length
          }
        }
      } catch (err) {
        console.warn(`new-application ping failed: ${(err as Error).message}`)
      }

      // Classified replies become notifications. Each intent is its own kind, so
      // each has its own lane and its own entry in notify_muted — the four
      // consequential ones ship muted (shadow mode) until the confidence
      // distribution has been read against real replies.
      try { await recordReplyIntents(client) } catch (err) {
        console.warn(`reply-intent notifications failed: ${(err as Error).message}`)
      }

      await remindStuckPosts(client)
      // Last: calls agreed purely in email get a real calendar event, so the
      // Meet link exists and the bot cron has something to join. Runs after
      // the calendar sweep so anything already on a calendar is known.
      let autoScheduled = 0
      try { autoScheduled = (await scheduleFromEmail(client)).made } catch (err) {
        console.warn(`email autoschedule failed: ${(err as Error).message}`)
      }
      console.log(`scan: ${matched} new messages matched, ${replied.size} applicants replied, ${manualPickups} manual screenings picked up, ${backfilled} availability backfills, ${autoScheduled} scheduled from email`)
      return json({ matched, replied: [...replied], manualPickups, backfilled, pinged, autoScheduled })
    }

    return json({ error: 'Unknown action' }, 400)
  } catch (err) {
    console.error('recruit-gmail error:', (err as Error).message)
    return json({ error: (err as Error).message }, 500)
  }
})
