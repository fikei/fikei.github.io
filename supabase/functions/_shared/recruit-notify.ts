// Shared: the recruiting notification ledger — detect, log, broadcast.
//
// Phase 2 adds the active candidate's own journey (needs_input, placement
// landing, the three call moments, the decision clock, promotion) alongside
// Phase 1's backlog detectors. Every line is one prose sentence with the
// subject hyperlinked inside it.
//
// One table (recruit_notifications, migration 142) is both the running log and
// the dispatch queue. A row is written by detect() before anything is
// delivered, so the log is complete whether or not the house is ever told, and
// each surface is a stamp on the row:
//
//   log_at       → #recruiting-automation, unbatched, muted or not. This IS the
//                  log's Discord half, not a mirror of the members channel.
//   members_at   → the house channel, batched by lane (now / daily / weekly).
//   escalated_at → posted for audience 'oncall'. Its own column: an escalation
//                  is not a house post, and the log must not say so.
//   dm_at        → a DM, only where ownership is real (a call's claimer).
//
// Routing is currently automation-only (notify_house_posts = false): the house
// channel gets nothing while the detectors earn trust. Lanes, audiences, and
// stamps still behave exactly as designed, so flipping the setting changes only
// the destination.
//
// On-call is a channel, not a person: the members of #recruiting-automation are
// on-call, so audience 'oncall' just posts there — no mention, no user id to
// configure, nothing to keep current.
//
// Detection is pure and idempotent — every kind's query is "what is true right
// now", and dedupe_key UNIQUE turns a repeat into a no-op. Running the tick
// twice in a row changes nothing.

import { AUTOMATION_CHANNEL_ID } from './discord.ts'
import { ACTIONS, KINDS, icon, label, loadCopyOverrides, renderCopy } from './recruit-copy.ts'
import type { CopyVars } from './recruit-copy.ts'

const TZ = 'America/Los_Angeles'
const APP = 'https://ctrl.rodeo/applications/'

/* Where house-wide notifications and digests go.

   For now: nowhere but #recruiting-automation. Everything this module emits —
   the log, escalations, Now-lane posts, and the digests — lands in that one
   channel while the system earns trust, so a wrong detector can't spam the
   channel the whole house reads. Flip `notify_house_posts` to true in
   recruit_settings to start splitting house-wide traffic out to the members
   channel; no deploy required.

   Note this is not the same as muting: the rows, lanes, audiences, and stamps
   all behave exactly as designed, so turning the split on later changes only
   the destination, not the logic. */
const houseChannel = (settings: NotifySettings) =>
  settings.housePosts
    ? (Deno.env.get('RECRUITING_PING_CHANNEL_ID') || AUTOMATION_CHANNEL_ID)
    : AUTOMATION_CHANNEL_ID

/* ---- sending -------------------------------------------------------------

   This module does its own Discord posting rather than borrowing
   postChannelEmbed / postResilient, for two reasons the first live run made
   obvious:

   1. **Rate limits.** A first tick over a backlog emits a dozen-plus lines to
      one channel. Discord allows ~5 messages per 5s per channel, so an
      unpaced burst 429s partway through — on the live test, one log line and
      all three escalations silently failed. Every send here is paced and
      retries once on an explicit 429.

   2. **No cross-channel fallback.** postResilient retries a failed post in the
      *other* recruiting channel, which for a log line means recruiting noise
      landing in the channel the whole house reads — precisely what
      notify_house_posts = false exists to prevent. Here a failed send throws,
      the row keeps its null stamp, and the next tick retries it. A late
      notification beats one in the wrong room. */

const SEND_GAP_MS = 1200          // ~0.8 msg/s: comfortably inside 5-per-5s
let lastSendAt = 0

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

let allowedChannel: string = AUTOMATION_CHANNEL_ID

/* The single channel this module may post to on this tick. Set once per tick
   from settings. While notify_house_posts is false that is
   #recruiting-automation and nothing else — enforced here rather than trusted
   at each call site, so no future detector, fallback, or refactor can leak a
   recruiting notification into the channel the whole house reads. */
export function setAllowedChannel(settings: NotifySettings): void {
  allowedChannel = houseChannel(settings)
}

async function send(channelId: string, payload: Record<string, unknown>): Promise<void> {
  if (channelId !== allowedChannel) {
    throw new Error(`[notify] refusing to post to ${channelId}: only ${allowedChannel} is permitted`)
  }
  const token = Deno.env.get('DISCORD_BOT_TOKEN')
  if (!token) throw new Error('DISCORD_BOT_TOKEN not set')
  const wait = lastSendAt + SEND_GAP_MS - Date.now()
  if (wait > 0) await sleep(wait)

  for (let attempt = 0; attempt < 2; attempt++) {
    lastSendAt = Date.now()
    const resp = await fetch(`https://discord.com/api/v10/channels/${channelId}/messages`, {
      method: 'POST',
      headers: { Authorization: `Bot ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
    if (resp.ok) { await resp.body?.cancel(); return }
    const text = await resp.text()
    if (resp.status === 429 && attempt === 0) {
      // Discord tells us exactly how long to wait; honour it rather than guess.
      const retryAfter = Number(JSON.parse(text || '{}').retry_after || 1) * 1000
      console.warn(`[notify] 429 from Discord, waiting ${Math.round(retryAfter)}ms`)
      await sleep(retryAfter + 250)
      continue
    }
    throw new Error(`Discord ${resp.status}: ${text.slice(0, 200)}`)
  }
}

/* Every message this module sends is an embed, because only embeds render
   [text](url) — and the whole point is that the relevant words in the
   notification ARE the link — not a bare URL, and not a button underneath
   repeating a destination the text already carries.

   No mentions, ever. An escalation posts to #recruiting-automation, whose
   members are on-call by definition, so the message already reaches exactly the
   people it is for. A mention on top of that adds nothing but a phone buzz, and
   a channel that buzzes gets muted — which would cost far more than a late
   reply. Escalation shows up as a distinct kind and its own log entry, not as a
   louder noise. */
const sendEmbed = (channelId: string, description: string) =>
  send(channelId, { embeds: [{ description: description.slice(0, 3900), color: 0x378add }] })

export interface Notification {
  kind: string
  subject_type: 'applicant' | 'listing' | 'stay' | 'house'
  subject_id: string | null
  subject_label: string
  audience?: 'house' | 'oncall' | 'person' | 'none'
  /* The housemate on the hook for this, when one is known — the screener who
     took the call, the reviewer who asked for a second read, whoever opened the
     listing. Recorded on the row as well as named in the sentence, so the log
     can answer "what is Kate on the hook for". Unowned is the common case and
     is often the news itself. */
  owner?: { name: string; userId?: string | null } | null
  recipient_id?: string | null
  lane?: 'now' | 'daily' | 'weekly'
  dedupe_key: string
  payload: {
    /* The notification, as one brief declarative sentence, with `{}` marking
       where the subject goes. The subject is substituted as a hyperlink into
       the app, so the sentence reads normally and the name is the way in:
       "{} has been waiting 24 days for a review." Sentences, not labelled
       fields — a housemate reads a line of prose faster than they parse
       "Waiting on a review · Chloe Revery". */
    /* Which sentence to say, and what to say it with. record() resolves these
       against recruit_copy and writes the finished line into `sentence`, so a
       delivered notification keeps the exact words it was sent with even if the
       template is edited afterwards. */
    copy?: string
    vars?: CopyVars
    sentence?: string
    title: string     // the subject on its own, for the Activity view and digest rows
    body?: string     // any detail that doesn't belong in the sentence
    section?: string
    links?: Array<{ label: string; url: string }>
  }
  due_at?: string
  /* The house was already told by whoever owns this notification's original
     call site (recruit-gmail's scan posts new applications itself). The ledger
     row is then purely the log entry, so it is stamped delivered on write and
     no lane picks it up. */
  already_broadcast?: boolean
}

// deno-lint-ignore no-explicit-any
type DB = any

// ---- settings --------------------------------------------------------------

interface NotifySettings {
  enabled: boolean
  digestHour: number
  muted: Set<string>
  housePosts: boolean
}

async function loadSettings(db: DB): Promise<NotifySettings> {
  const { data } = await db.from('recruit_settings').select('key, value')
    .in('key', ['notify_enabled', 'notify_digest_hour', 'notify_muted', 'notify_house_posts'])
  const map = new Map((data || []).map((r: { key: string; value: unknown }) => [r.key, r.value]))
  return {
    enabled: map.get('notify_enabled') !== false,
    digestHour: Number(map.get('notify_digest_hour') ?? 8),
    muted: new Set(Array.isArray(map.get('notify_muted')) ? map.get('notify_muted') as string[] : []),
    // Opt-in, not opt-out: silence in the house channel is the safe default.
    housePosts: map.get('notify_house_posts') === true,
  }
}

// ---- dates -----------------------------------------------------------------

// Pacific "today" as YYYY-MM-DD. All the horizons below are date-typed columns
// compared against house-local days, not UTC instants — a room emptying "in 45
// days" is a calendar fact.
export function ptToday(now = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(now)
}
export function ptPlusDays(days: number, now = new Date()): string {
  return ptToday(new Date(now.getTime() + days * 86400000))
}
function ptParts(now = new Date()): { hour: number; weekday: string; date: string } {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', {
    timeZone: TZ, hour12: false, hour: '2-digit', weekday: 'short',
  }).formatToParts(now).map((x) => [x.type, x.value]))
  return { hour: Number(p.hour) % 24, weekday: String(p.weekday), date: ptToday(now) }
}
function daysUntil(isoDate: string, now = new Date()): number {
  const today = new Date(`${ptToday(now)}T00:00:00Z`).getTime()
  return Math.round((new Date(`${isoDate}T00:00:00Z`).getTime() - today) / 86400000)
}
const applicantLink = (id: string) => `${APP}?a=${encodeURIComponent(id)}`
const viewLink = (v: string) => `${APP}?view=${v}`

/* "2026-08-01" → "Aug 1". Notifications are read by people, and an ISO date in
   a sentence makes them read like a database dump. The year appears only when
   it isn't this one. */
function fmtDay(isoDate: string, now = new Date()): string {
  const d = new Date(`${isoDate}T12:00:00Z`)
  const thisYear = Number(ptToday(now).slice(0, 4))
  return d.toLocaleDateString('en-US', {
    month: 'short', day: 'numeric', timeZone: 'UTC',
    ...(d.getUTCFullYear() === thisYear ? {} : { year: 'numeric' }),
  })
}

/* Applicants write their move-in date as prose ("I start my job August 24th but
   I am flexible on whenever a room opens up"). Truncating that at 60 characters
   produced "...whenever a r" in the channel. Take the first clause instead, and
   cut on a word boundary if it's still long — a notification needs the gist,
   and the profile has the full answer. */
function shortPhrase(text: string | null | undefined, max = 34): string {
  const first = String(text || '').replace(/\s+/g, ' ').trim().split(/[,.;(]|\bbut\b|\bthough\b/)[0].trim()
  if (!first) return ''
  if (first.length <= max) return first
  const cut = first.slice(0, max)
  const space = cut.lastIndexOf(' ')
  return cut.slice(0, space > max * 0.5 ? space : max).trim() + '…'
}

/* Move-in answers are free prose in the applicant's own voice: "asap
   (august/sept)", "I start my job August 24th but I'm flexible", "Flexible",
   "september 1st". Dropping any of those into a sentence after "wanting"
   produces something ungrammatical about half the time ("wanting I start my job
   August 24th"), so this only speaks when it can do so cleanly:

     vague          → "with flexible timing" / "as soon as possible"
     a date         → "from September 1st"
     a whole clause → nothing at all

   The third case is the important one. A notification that omits the date still
   reads correctly, and the profile has their exact words one tap away — whereas
   a mangled sentence makes the whole channel look automated and untrustworthy. */
const MONTHS = /^(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec|\d|early|mid|late|the\b)/i

function moveInClause(text: string | null | undefined): string {
  const phrase = shortPhrase(text, 28)
  if (!phrase) return ''
  const low = phrase.toLowerCase()
  if (/^(asap|immediately|right away|now)\b/.test(low)) return 'as soon as possible'
  if (/^(flexible|anytime|any time|whenever|open|tbd|flex)\b/.test(low)) return 'with flexible timing'
  if (MONTHS.test(phrase)) {
    // "september 1st" → "September 1st"; their capitalisation shouldn't leak.
    return `from ${phrase.charAt(0).toUpperCase()}${phrase.slice(1)}`
  }
  return ''
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`

/* A real person's name, or nothing.

   Calls swept off the shared calendar carry the organiser's display name, which
   is "Agape Internal Calendar" or "the house" — not somebody who can be on the
   hook for anything. Every detector runs its candidate owner through here, so
   they all agree on what counts as a person and no sentence ever claims a
   calendar is taking a call. */
function personName(raw: unknown): string | null {
  const name = String(raw || '').trim()
  if (!name) return null
  if (/calendar|the house|^scheduled|@/i.test(name)) return null
  return name
}

// ---- write -----------------------------------------------------------------

/* Insert notifications, ignoring any whose dedupe_key already exists. The
   ledger row is written here — before any delivery — which is what makes the
   log complete by construction rather than a record of what Discord accepted.

   `muted` is stamped at write time from settings so the log shows what the
   house's config did to each entry, and so unmuting a kind doesn't retroactively
   broadcast a fortnight of history. */
export async function record(db: DB, rows: Notification[]): Promise<number> {
  if (!rows.length) return 0
  const { muted } = await loadSettings(db)
  /* Resolve wording here, once, at the moment the row is written — not at send
     time. A delivered notification then keeps the exact words it went out with
     even if someone edits the template afterwards, which is what makes the log
     an honest record of what the house was told rather than of what it would be
     told today. */
  const overrides = await loadCopyOverrides(db)
  const payload = rows.map((n) => ({
    kind: n.kind,
    subject_type: n.subject_type,
    subject_id: n.subject_id,
    subject_label: n.subject_label,
    audience: n.audience || 'house',
    recipient_id: n.recipient_id || null,
    owner_name: n.owner?.name || null,
    owner_user_id: n.owner?.userId || null,
    lane: n.lane || 'daily',
    dedupe_key: n.dedupe_key,
    payload: {
      ...n.payload,
      /* {subject} renders as the literal slot `{}`, never as the name. The
         subject is the hyperlink — oneLine() and the app's Activity view both
         substitute `{}` with the linked name at display time, which is the only
         moment the URL is known. Rendering the name here produced sentences
         with nothing to click: correct words, dead line.

         Forced here rather than asked of each detector, because thirty-odd
         call sites passing `subject: '{}'` by convention is thirty-odd chances
         to pass the name instead — which is exactly what happened. */
      sentence: n.payload.copy
        ? renderCopy(n.payload.copy, { ...(n.payload.vars || {}), subject: '{}' }, overrides)
        : n.payload.sentence,
    },
    due_at: n.due_at || new Date().toISOString(),
    muted: muted.has(n.kind),
    ...(n.already_broadcast ? { members_at: new Date().toISOString() } : {}),
  }))
  const { data, error } = await db.from('recruit_notifications')
    .upsert(payload, { onConflict: 'dedupe_key', ignoreDuplicates: true })
    .select('id')
  if (error) {
    console.warn(`[notify] record failed: ${error.message}`)
    return 0
  }
  return (data || []).length
}

/* Clear unsent notifications for a subject+kind. The reset half of the dedupe
   idiom: when a date moves, the notification it produced is no longer true, so
   the row is deleted and the new date earns a fresh one. Only ever deletes
   rows that were never delivered — a notification the house has already seen
   is history and stays in the log. */
export async function resetPending(db: DB, kind: string, subjectId: string): Promise<void> {
  await db.from('recruit_notifications').delete()
    .eq('kind', kind).eq('subject_id', subjectId)
    .is('log_at', null).is('members_at', null).is('escalated_at', null).is('dm_at', null)
}

// ---- detect ----------------------------------------------------------------

/* A1 — new application. Already posted by recruit-gmail's scan; this records
   the ledger row so the log has it too. Keyed on discord_ping_at, which the
   scan stamps, so the log picks up exactly what was announced. */
async function detectNewApplications(db: DB): Promise<Notification[]> {
  const since = new Date(Date.now() - 3 * 86400000).toISOString()
  const { data } = await db.from('recruit_applicants')
    .select('id, first_name, last_name, residency, move_in, discord_ping_at')
    .not('discord_ping_at', 'is', null).gte('discord_ping_at', since)
  return (data || []).map((a: Record<string, string>) => ({
    kind: 'application_new',
    subject_type: 'applicant' as const,
    subject_id: a.id,
    subject_label: a.first_name,
    lane: 'now' as const,
    dedupe_key: `application_new:${a.id}`,
    payload: {
      // The kind's label already says "New application" — the title is just
      // who, and the body is the two facts that decide whether to read on.
      title: `${a.first_name} ${a.last_name || ''}`.trim(),
      copy: moveInClause(a.move_in) ? 'application_new.timed' : 'application_new',
      vars: {
        subject: fullName(a),
        track: /short/i.test(a.residency || '') ? 'a sublet' : 'a full-time room',
        timing: moveInClause(a.move_in),
      },
      section: 'New applications',
      links: [{ label: ACTIONS.review, url: applicantLink(a.id) }],
    },
    // recruit-gmail's scan already posted this one; the row is the log entry.
    already_broadcast: true,
  }))
}

/* A2 — waiting on a review. One read decides under the v3.40 model, so this is
   never "waiting on a quorum"; it is waiting on one person, any person.
   Escalates at 5 days into its own notification in #recruiting-automation,
   whose members are on-call.

   The clock is COALESCE(discord_ping_at, submitted_at), NOT the ping alone.
   Keying on the ping was wrong in a way only the live data showed: 50 of the 53
   applications sitting in review were never pinged at all (the ping's 14-day
   floor exists so switching it on wouldn't dump the backlog), so a
   ping-keyed detector would have reported "nothing waiting" while 53
   applications waited. Nobody having been told is worse than having been told
   and ignored, not better.

   The 30-day window is what keeps that honest without flooding: an application
   from March is not a notification, it is backlog, and it gets one counted line
   from detectReviewBacklog instead of fifty rows. */
const REVIEW_RECENT_DAYS = 30

async function detectReviewStalled(db: DB): Promise<Notification[]> {
  const { data: pending } = await db.from('recruit_applicants')
    .select('id, first_name, last_name, submitted_at, discord_ping_at')
    .eq('stage', 'review')
    .gte('submitted_at', new Date(Date.now() - REVIEW_RECENT_DAYS * 86400000).toISOString())
  if (!pending?.length) return []
  const { data: voted } = await db.from('recruit_votes')
    .select('applicant_id').in('applicant_id', pending.map((a: { id: string }) => a.id))
  const hasVote = new Set((voted || []).map((v: { applicant_id: string }) => v.applicant_id))

  const out: Notification[] = []
  for (const a of pending) {
    if (hasVote.has(a.id)) continue
    const knownAt = new Date(a.discord_ping_at || a.submitted_at).getTime()
    const days = Math.floor((Date.now() - knownAt) / 86400000)
    if (days < 2) continue   // 48h of grace before it counts as stalled
    // Two steps, two dedupe keys: the daily digest line, then the escalation.
    // The escalation is a second notification, not a repeat of the first.
    const step = days >= 5 ? 'escalated' : 'waiting'
    out.push({
      kind: 'review_stalled',
      subject_type: 'applicant',
      subject_id: a.id,
      subject_label: a.first_name,
      audience: step === 'escalated' ? 'oncall' : 'house',
      lane: step === 'escalated' ? 'now' : 'daily',
      dedupe_key: `review_stalled:${a.id}:${step}`,
      payload: {
        title: `${a.first_name} ${a.last_name || ''}`.trim(),
        copy: 'review_stalled',
        vars: { subject: fullName(a), days: plural(days, 'day') },
        section: 'Needs a review',
        links: [{ label: ACTIONS.review, url: applicantLink(a.id) }],
      },
    })
  }
  return out
}

/* A2b — the review backlog, as one number. Applications older than the
   stalled-window that nobody has ever reviewed. Fifty of these exist right now,
   and fifty notifications would bury everything else in the log on day one — so
   the backlog is a single weekly line carrying the count, keyed on the ISO week
   so it says its piece once and waits.

   subject_type 'house': it is not about any one applicant. Clicking through
   goes to the Inbox, where they already sit. */
async function detectReviewBacklog(db: DB): Promise<Notification[]> {
  const floor = new Date(Date.now() - REVIEW_RECENT_DAYS * 86400000).toISOString()
  const { data: old } = await db.from('recruit_applicants')
    .select('id').eq('stage', 'review').lt('submitted_at', floor)
  if (!old?.length) return []
  const { data: voted } = await db.from('recruit_votes')
    .select('applicant_id').in('applicant_id', old.map((a: { id: string }) => a.id))
  const hasVote = new Set((voted || []).map((v: { applicant_id: string }) => v.applicant_id))
  const n = old.filter((a: { id: string }) => !hasVote.has(a.id)).length
  if (!n) return []

  // ISO week key: one mention per week however the count moves.
  const d = new Date()
  const thursday = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - ((d.getUTCDay() + 6) % 7) + 3))
  const week = Math.ceil(((thursday.getTime() - Date.UTC(thursday.getUTCFullYear(), 0, 1)) / 86400000 + 1) / 7)
  return [{
    kind: 'review_backlog',
    subject_type: 'house',
    subject_id: null,
    subject_label: 'Inbox backlog',
    lane: 'weekly',
    dedupe_key: `review_backlog:${thursday.getUTCFullYear()}-W${week}`,
    payload: {
      title: `${plural(n, 'application')}`,
      copy: 'review_backlog',
      vars: { subject: plural(n, 'application'), window: REVIEW_RECENT_DAYS },
      section: 'Backlog',
      links: [{ label: ACTIONS.inbox, url: viewLink('inbox') }],
    },
  }]
}

/* No "update email owed" detector, deliberately.
   An earlier draft chased the house for an update email to everyone rejected or
   archived. That inverted the actual policy: a declined, passed, or archived
   applicant is *closed*, and the house owes them nothing. Nagging about a debt
   that doesn't exist is worse than saying nothing — it trains people to ignore
   the channel. Sending an update stays a choice someone makes on the profile,
   never a task the system hands out. */

/* O4 / O6 — an opening running out of runway, then past it. Three steps:
   21 days is a digest line, 7 days is a members-channel post, and a start date
   that has already passed escalates — by then it is not a reminder, it is rent
   nobody is collecting. */
async function detectOpeningsAtRisk(db: DB): Promise<Notification[]> {
  const { data } = await db.from('recruit_listings')
    .select('id, room_id, kind, starts_on, status, rent_monthly')
    .eq('status', 'open').lte('starts_on', ptPlusDays(21))
  if (!data?.length) return []
  const { data: rooms } = await db.from('recruit_rooms').select('id, name')
  const roomName = new Map((rooms || []).map((r: { id: number; name: string }) => [r.id, r.name]))

  return data.map((l: Record<string, string | number>) => {
    const starts = String(l.starts_on)
    const left = daysUntil(starts)
    const room = roomName.get(l.room_id as number) || `room ${l.room_id}`
    const step = left < 0 ? 'overdue' : left <= 7 ? 'urgent' : 'soon'
    return {
      kind: left < 0 ? 'opening_overdue' : 'opening_at_risk',
      subject_type: 'listing' as const,
      subject_id: String(l.id),
      subject_label: String(room),
      audience: (step === 'overdue' ? 'oncall' : 'house') as 'oncall' | 'house',
      lane: (step === 'soon' ? 'daily' : 'now') as 'daily' | 'now',
      dedupe_key: `opening_risk:${l.id}:${step}`,
      payload: {
        title: String(room),
        copy: left < 0 ? 'opening_overdue' : 'opening_at_risk',
        vars: { subject: String(room), date: fmtDay(starts), days: plural(Math.abs(left), 'day') },
        section: 'Openings at risk',
        links: [{ label: ACTIONS.shortlist, url: viewLink('openings') },
                { label: ACTIONS.room, url: `${APP}?view=occupancy&room=${l.room_id}` }],
      },
    } as Notification
  })
}

/* C1 — a room emptying with nothing lined up. 45 days is deliberate: it is
   roughly one full funnel (review → screening → house decision → move), so a
   notification at 45 days is the last moment the house can still fill the room
   without rushing. A stay with a follow-on stay or any listing for the room is
   already handled and stays quiet. */
async function detectRoomsEmptying(db: DB): Promise<Notification[]> {
  const today = ptToday()
  const horizon = ptPlusDays(45)
  const { data: ending } = await db.from('recruit_stays')
    .select('id, room_id, occupant, kind, starts_on, ends_on')
    .not('ends_on', 'is', null).gte('ends_on', today).lte('ends_on', horizon)
  if (!ending?.length) return []

  const roomIds = [...new Set(ending.map((s: { room_id: number }) => s.room_id))]
  const [{ data: rooms }, { data: allStays }, { data: listings }] = await Promise.all([
    db.from('recruit_rooms').select('id, name').in('id', roomIds),
    db.from('recruit_stays').select('room_id, starts_on, ends_on').in('room_id', roomIds),
    db.from('recruit_listings').select('room_id, status, starts_on').in('room_id', roomIds)
      .in('status', ['draft', 'open', 'filled']),
  ])
  const roomName = new Map((rooms || []).map((r: { id: number; name: string }) => [r.id, r.name]))

  const out: Notification[] = []
  for (const s of ending) {
    const ends = String(s.ends_on)
    // Someone already following them into the room? Then it isn't emptying.
    const followOn = (allStays || []).some((o: Record<string, string | number>) =>
      o.room_id === s.room_id && String(o.starts_on) > ends && String(o.starts_on) <= ptPlusDays(60))
    if (followOn) continue
    // A listing covering the gap counts as handled, draft included — the
    // Openings rail is then the surface, and O2/O4 chase it from there.
    const listed = (listings || []).some((l: Record<string, string | number>) =>
      l.room_id === s.room_id && String(l.starts_on) >= ends)
    if (listed) continue

    const left = daysUntil(ends)
    const room = roomName.get(s.room_id) || `room ${s.room_id}`
    const step = left <= 21 ? 'urgent' : 'soon'
    out.push({
      kind: 'room_emptying',
      subject_type: 'stay',
      subject_id: String(s.id),
      subject_label: String(room),
      audience: step === 'urgent' ? 'oncall' : 'house',
      lane: step === 'urgent' ? 'now' : 'daily',
      dedupe_key: `room_emptying:${s.id}:${step}`,
      payload: {
        title: String(room),
        copy: 'room_emptying',
        vars: { subject: String(room), date: fmtDay(ends), occupant: String(s.occupant || 'the occupant') },
        section: 'Rooms emptying',
        links: [{ label: ACTIONS.calendar, url: `${APP}?view=occupancy&room=${s.room_id}` }],
      },
    })
  }
  return out
}


/* ---------------------------------------------------------------------------
   Phase 2: an active candidate's own journey.

   Everything above is about the house's backlog. These are about a person
   moving through the funnel — what they sent us, what happened to their call,
   and where the house's decision stands. They matter because a candidate who
   is mid-process is the most expensive thing to drop: they have already spent
   their own effort, and a week of silence loses people who were going to say
   yes.

   All of them read the tables that already exist. Nothing new is written
   anywhere except the ledger.
   ------------------------------------------------------------------------- */

// Anyone still live in the funnel. Used by every detector below, so that a
// rejected or archived applicant never generates candidate chatter.
const ACTIVE_STAGES = ['review', 'candidate']

async function activeApplicants(db: DB): Promise<Map<string, { first_name: string; last_name: string; stage: string }>> {
  const { data } = await db.from('recruit_applicants')
    .select('id, first_name, last_name, stage').in('stage', ACTIVE_STAGES)
  return new Map((data || []).map((a: Record<string, string>) => [a.id, a as never]))
}
const fullName = (a: { first_name: string; last_name?: string }) => `${a.first_name} ${a.last_name || ''}`.trim()

/* A3 — a reviewer asked for another read. The verdict itself is the ask, and it
   is addressed to the house rather than to whoever wrote it, so it posts once
   per verdict row. */
async function detectNeedsInput(db: DB): Promise<Notification[]> {
  const since = new Date(Date.now() - 14 * 86400000).toISOString()
  const { data } = await db.from('recruit_votes')
    .select('id, applicant_id, voter_id, voter_name, note, updated_at, created_at')
    .eq('verdict', 'needs_input').gte('created_at', since)
  if (!data?.length) return []
  const active = await activeApplicants(db)
  return (data as Array<Record<string, string>>)
    .filter((v) => active.has(v.applicant_id))
    .map((v) => ({
      kind: 'needs_input',
      subject_type: 'applicant' as const,
      subject_id: v.applicant_id,
      subject_label: active.get(v.applicant_id)!.first_name,
      lane: 'now' as const,
      dedupe_key: `needs_input:${v.id}`,
      owner: personName(v.voter_name) ? { name: personName(v.voter_name)!, userId: v.voter_id || null } : null,
      payload: {
        title: fullName(active.get(v.applicant_id)!),
        copy: 'needs_input',
        vars: { subject: fullName(active.get(v.applicant_id)!), asker: v.voter_name || 'A housemate' },
        body: shortPhrase(v.note, 140),
        section: 'Needs a second read',
        links: [{ label: ACTIONS.review, url: applicantLink(v.applicant_id) }],
      },
    }))
}

/* A4 / A5 — passed review, and whether a room actually fits. Two outcomes of
   the same moment: the auto-placement sweep either found them somewhere or it
   didn't, and "nowhere" is the more useful notification of the two. */
async function detectCandidateLanding(db: DB): Promise<Notification[]> {
  const { data: candidates } = await db.from('recruit_applicants')
    .select('id, first_name, last_name').eq('stage', 'candidate')
  if (!candidates?.length) return []

  const ids = candidates.map((a: { id: string }) => a.id)
  const [{ data: placements }, { data: listings }, { data: screenings }] = await Promise.all([
    db.from('recruit_listing_candidates').select('applicant_id, listing_id, created_at')
      .in('applicant_id', ids).eq('status', 'active'),
    db.from('recruit_listings').select('id, room_id, starts_on'),
    db.from('recruit_screenings').select('applicant_id').in('applicant_id', ids),
  ])
  const { data: rooms } = await db.from('recruit_rooms').select('id, name')
  const roomName = new Map((rooms || []).map((r: { id: number; name: string }) => [r.id, r.name]))
  const listingRoom = new Map((listings || []).map((l: Record<string, unknown>) =>
    [l.id as string, roomName.get(l.room_id as number) || `room ${l.room_id}`]))
  const booked = new Set((screenings || []).map((r: { applicant_id: string }) => r.applicant_id))

  const byApplicant = new Map<string, string[]>()
  for (const p of placements || []) {
    if (!byApplicant.has(p.applicant_id)) byApplicant.set(p.applicant_id, [])
    byApplicant.get(p.applicant_id)!.push(listingRoom.get(p.listing_id) || 'a listing')
  }

  const out: Notification[] = []
  for (const a of candidates) {
    const rooms = byApplicant.get(a.id) || []
    if (rooms.length) {
      out.push({
        kind: 'candidate_placed',
        subject_type: 'applicant',
        subject_id: a.id,
        subject_label: a.first_name,
        lane: 'now',
        // Keyed on the set of rooms, so a candidate moving between listings is
        // news again while a candidate sitting still is not.
        dedupe_key: `candidate_placed:${a.id}:${[...rooms].sort().join('+')}`,
        payload: {
          title: fullName(a),
          copy: 'candidate_placed',
          vars: { subject: fullName(a), rooms: rooms.length === 1 ? rooms[0] : `${rooms.length} rooms` },
          body: rooms.join(', '),
          section: 'Passed review',
          links: [{ label: ACTIONS.shortlist, url: viewLink('openings') }],
        },
      })
    } else if (!booked.has(a.id)) {
      out.push({
        kind: 'candidate_parked',
        subject_type: 'applicant',
        subject_id: a.id,
        subject_label: a.first_name,
        lane: 'weekly',
        dedupe_key: `candidate_parked:${a.id}:${ptToday().slice(0, 7)}`,
        payload: {
          title: fullName(a),
          copy: 'candidate_parked',
          vars: { subject: fullName(a) },
          section: 'Waiting for a room',
          links: [{ label: ACTIONS.profile, url: applicantLink(a.id) }],
        },
      })
    }
  }
  return out
}

/* The call: taken, imminent, or written up. Three moments the house currently
   only learns about by being in the right channel at the right minute. */
async function detectScreeningMoments(db: DB): Promise<Notification[]> {
  const out: Notification[] = []
  const active = await activeApplicants(db)

  /* A call got taken. Keyed on the screening rather than the claim post,
     because a call reaches the calendar three different ways — the Claim button
     in Discord, a time agreed in the email thread that scheduleFromEmail books,
     and someone arranging it by hand in the app — and only the first leaves a
     claim post. Reading recruit_screenings catches all three, which is what
     "when someone takes a call" actually means. */
  const { data: booked } = await db.from('recruit_screenings')
    .select('id, applicant_id, housemate_name, starts_at, status, kind, created_at')
    .gte('created_at', new Date(Date.now() - 21 * 86400000).toISOString())
  for (const sc of booked || []) {
    const who = active.get(sc.applicant_id)
    if (!who || !sc.starts_at) continue
    const when = new Date(sc.starts_at)
    /* A booking is only news while the call is still ahead.

       The first version allowed a day of grace, reasoning that a call booked
       this morning for this afternoon should still get its line. But that grace
       is about the BOOKING being recent, and the test that matters is whether
       the CALL has happened — so a call twenty hours past sat inside the window
       and got announced as "booked", which reads as though it had just been
       arranged. A call that already happened is covered by its own kinds:
       screening_notes when the recording lands, screening_followup when nobody
       follows up. */
    if (when.getTime() <= Date.now()) continue
    // And only a live booking. A completed or cancelled screening is not news
    // about something upcoming, whatever its start time says.
    if (sc.status !== 'scheduled') continue

    /* Never "today" in a stored sentence. The ledger keeps this line forever, so
       a relative word is true on the day it is written and a lie every day
       after — which is how "booked for today at 10:15 AM" ended up in the
       channel describing yesterday's call. */
    const dayPart = when.toLocaleDateString('en-US',
      { weekday: 'long', month: 'short', day: 'numeric', timeZone: TZ })
    const at = when.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: TZ }).replace(':00', '')
    /* Who is taking it — when we actually know. Calls swept off the calendar
       carry the organiser's display name, which for a shared calendar is
       "Agape Internal Calendar" or "the house": not a person, and reading
       "Agape Internal Calendar is taking Keerti's call" makes the whole line
       look machine-generated. When the name isn't a person, the call is the
       subject of the sentence instead of the screener. */
    const named = personName(sc.housemate_name)
    out.push({
      kind: 'screening_booked',
      subject_type: 'applicant',
      subject_id: sc.applicant_id,
      subject_label: who.first_name,
      lane: 'now',
      // Re-fires if the call moves, since a rescheduled call is news again.
      dedupe_key: `screening_booked:${sc.id}:${sc.starts_at}`,
      owner: named ? { name: named, userId: sc.housemate_user_id || null } : null,
      payload: {
        title: fullName(who),
        copy: named ? 'screening_booked.named' : 'screening_booked',
        vars: { subject: fullName(who), screener: named || '', when: `${dayPart} at ${at}` },
        body: 'calendar invite sent, on the house calendar',
        section: 'Screening',
        links: [{ label: ACTIONS.profile, url: applicantLink(sc.applicant_id) }],
      },
    })
  }

  /* Times offered, nobody booked. Read from recruit_availability rather than
     from claim posts: a claim post only exists when discord_auto_post is on
     (it is off), so keying on it meant this could never fire — while the
     failure it describes, a candidate who did their part and heard nothing,
     is the most damaging one in the funnel. */
  const { data: offers } = await db.from('recruit_availability')
    .select('applicant_id, windows, updated_at')
    .lte('updated_at', new Date(Date.now() - 72 * 3600000).toISOString())
  const bookedFor = new Set((booked || []).map((s2: { applicant_id: string }) => s2.applicant_id))
  for (const o of offers || []) {
    const who = active.get(o.applicant_id)
    if (!who) continue
    if (!Array.isArray(o.windows) || !o.windows.length) continue   // nothing was actually offered
    if (bookedFor.has(o.applicant_id)) continue                    // somebody took it
    const days = Math.floor((Date.now() - new Date(o.updated_at).getTime()) / 86400000)
    out.push({
      kind: 'screening_unclaimed',
      subject_type: 'applicant',
      subject_id: o.applicant_id,
      subject_label: who.first_name,
      audience: 'oncall',
      lane: 'now',
      // One nudge per 3-day block, so it escalates by repetition without
      // becoming daily noise.
      dedupe_key: `screening_unclaimed:${o.applicant_id}:${Math.floor(days / 3)}`,
      payload: {
        title: fullName(who),
        copy: 'screening_unclaimed',
        vars: { subject: fullName(who), days: plural(days, 'day') },
        section: 'Screening',
        links: [{ label: ACTIONS.takeCall, url: applicantLink(o.applicant_id) }],
      },
    })
  }

  // Today's calls, and calls whose notes have landed.
  const { data: screenings } = await db.from('recruit_screenings')
    .select('id, applicant_id, housemate_name, starts_at, status, kind, created_at, recording_posted_at, share_token')
    .gte('starts_at', new Date(Date.now() - 14 * 86400000).toISOString())
  for (const sc of screenings || []) {
    const who = active.get(sc.applicant_id)
    if (!who) continue
    const startsPT = ptToday(new Date(sc.starts_at))
    // Only worth its own line if the booking notification didn't already say
    // "today" — a call booked this morning for this afternoon says it once.
    const bookedToday = ptToday(new Date(sc.created_at)) === ptToday()
    if (sc.status === 'scheduled' && startsPT === ptToday() && !bookedToday) {
      const at = new Date(sc.starts_at).toLocaleTimeString('en-US',
        { hour: 'numeric', minute: '2-digit', timeZone: TZ }).replace(':00', '')
      out.push({
        kind: 'screening_today',
        subject_type: 'applicant',
        subject_id: sc.applicant_id,
        subject_label: who.first_name,
        lane: 'now',
        dedupe_key: `screening_today:${sc.id}:${startsPT}`,
        owner: personName(sc.housemate_name)
          ? { name: personName(sc.housemate_name)!, userId: sc.housemate_user_id || null } : null,
        payload: {
          title: fullName(who),
          // Safe here: this kind only exists on the day of the call, and its
          // dedupe key carries that date, so it is never re-read on another day.
          copy: personName(sc.housemate_name) ? 'screening_today.with' : 'screening_today',
          vars: { subject: fullName(who), at, screener: personName(sc.housemate_name) || '' },
          section: 'Screening',
          links: [{ label: ACTIONS.profile, url: applicantLink(sc.applicant_id) }],
        },
      })
    }
    if (sc.recording_posted_at) {
      out.push({
        kind: 'screening_notes',
        subject_type: 'applicant',
        subject_id: sc.applicant_id,
        subject_label: who.first_name,
        lane: 'now',
        dedupe_key: `screening_notes:${sc.id}`,
        owner: personName(sc.housemate_name)
          ? { name: personName(sc.housemate_name)!, userId: sc.housemate_user_id || null } : null,
        payload: {
          title: fullName(who),
          copy: personName(sc.housemate_name) ? 'screening_notes.by' : 'screening_notes',
          vars: { subject: fullName(who), screener: personName(sc.housemate_name) || '' },
          section: 'Screening',
          links: [{ label: ACTIONS.notes, url: applicantLink(sc.applicant_id) }],
        },
      })
    }
  }
  return out
}

/* H3 — the house decision, on a soft clock. Voting activity never fires this;
   only the approach of the date they would actually move does. A lively
   decision stays quiet and a stalled one gets louder, which is the correct way
   round. */
async function detectDecisionOpen(db: DB): Promise<Notification[]> {
  const { data: candidates } = await db.from('recruit_applicants')
    .select('id, first_name, last_name, move_in_from').eq('stage', 'candidate')
  if (!candidates?.length) return []
  const ids = candidates.map((a: { id: string }) => a.id)

  const [{ data: done }, { data: votes }, { data: placements }, { data: listings }] = await Promise.all([
    db.from('recruit_screenings').select('applicant_id, starts_at, status, housemate_name, housemate_user_id')
      .in('applicant_id', ids).eq('status', 'completed'),
    db.from('recruit_decision_votes').select('applicant_id, verdict').in('applicant_id', ids),
    db.from('recruit_listing_candidates').select('applicant_id, listing_id')
      .in('applicant_id', ids).eq('status', 'active'),
    db.from('recruit_listings').select('id, starts_on'),
  ])
  const screened = new Map((done || []).map((r: Record<string, string>) => [r.applicant_id, r.starts_at]))
  const listingStart = new Map((listings || []).map((l: Record<string, unknown>) => [l.id as string, l.starts_on as string]))
  const placedStart = new Map<string, string>()
  for (const p of placements || []) {
    const st = listingStart.get(p.listing_id)
    if (st && (!placedStart.has(p.applicant_id) || st < placedStart.get(p.applicant_id)!)) {
      placedStart.set(p.applicant_id, st)
    }
  }
  const tally = new Map<string, number>()
  for (const v of votes || []) tally.set(v.applicant_id, (tally.get(v.applicant_id) || 0) + 1)

  const out: Notification[] = []
  for (const a of candidates) {
    const screenedAt = screened.get(a.id)
    if (!screenedAt) continue          // nothing to decide yet
    // The date they would actually move: their confirmed window, else the
    // listing they are placed on, else a month after the call so a decision
    // without a room still has a clock.
    const date = a.move_in_from || placedStart.get(a.id) ||
      ptToday(new Date(new Date(screenedAt).getTime() + 30 * 86400000))
    const left = daysUntil(date)

    /* Only the move-in clock. "Interviewed and nobody voted" is the same
       condition screening_followup already reports, and firing both produced two
       lines a word apart about one person — the duplication this whole pass is
       trying to kill. That fact now lives in one place: the follow-up sentence
       below names the missing votes itself. */
    if (left > 14) continue
    const step = left < 0 ? 'passed' : left <= 3 ? 'urgent' : left <= 7 ? 'soon' : 'open'
    const n = tally.get(a.id) || 0
    out.push({
      kind: 'decision_open',
      subject_type: 'applicant',
      subject_id: a.id,
      subject_label: a.first_name,
      audience: step === 'urgent' || step === 'passed' ? 'oncall' : 'house',
      lane: step === 'open' ? 'daily' : 'now',
      dedupe_key: `decision_open:${a.id}:${step}`,
      payload: {
        title: fullName(a),
        copy: left < 0 ? 'decision_open.overdue' : 'decision_open',
        vars: { subject: fullName(a), date: fmtDay(date), days: plural(Math.abs(left), 'day') },
        body: n ? `${plural(n, 'housemate')} weighed in so far` : 'nobody has weighed in yet',
        section: 'Decisions',
        links: [{ label: ACTIONS.profile, url: applicantLink(a.id) }],
      },
    })
  }
  return out
}


/* We interviewed them and went quiet.

   This is the most expensive silence in the funnel. Someone gave up an evening
   to talk to strangers about living with them, and then heard nothing — and
   unlike an unreviewed application, they *know* they're waiting. Every day of
   it costs goodwill with someone the house already thought was worth meeting.

   Distinct from decision_open, which is driven by the date they'd move in: this
   one is driven purely by how long the house has been quiet, so it fires even
   for a candidate with no room and no move-in date. Both can be true at once
   and they say different things.

   Cadence: day 3, day 5, then every 5 days for as long as it stays true. The
   first two are close together because the fix is cheap early (a two-line email
   buys weeks of patience), and the tail keeps repeating because a candidate
   nobody has answered in three weeks is a decision the house is making by
   default. Escalates once it passes 10 days. */
const FOLLOWUP_FIRST = 3
const FOLLOWUP_SECOND = 5
const FOLLOWUP_EVERY = 5

/* Which nudge, if any, is due after `days` of silence. Returns the step as a
   number so it doubles as the dedupe key: each step fires exactly once. */
function followupStep(days: number): number | null {
  if (days < FOLLOWUP_FIRST) return null
  if (days < FOLLOWUP_SECOND) return FOLLOWUP_FIRST
  if (days < FOLLOWUP_SECOND + FOLLOWUP_EVERY) return FOLLOWUP_SECOND
  // Every 5 days after: 10, 15, 20 … whichever the current run has passed.
  return Math.floor(days / FOLLOWUP_EVERY) * FOLLOWUP_EVERY
}

async function detectScreeningFollowup(db: DB): Promise<Notification[]> {
  const { data: candidates } = await db.from('recruit_applicants')
    .select('id, first_name, last_name').eq('stage', 'candidate')
  if (!candidates?.length) return []
  const ids = candidates.map((a: { id: string }) => a.id)

  const [{ data: screenings }, { data: emails }, { data: votes }] = await Promise.all([
    db.from('recruit_screenings').select('applicant_id, starts_at, status, housemate_name, housemate_user_id')
      .in('applicant_id', ids).eq('status', 'completed'),
    // Anything the house has said to them since. One outbound email after the
    // call is the whole point of the nudge, so it stops as soon as one exists.
    db.from('recruit_emails').select('applicant_id, direction, sent_at')
      .in('applicant_id', ids).eq('direction', 'out'),
    db.from('recruit_decision_votes').select('applicant_id').in('applicant_id', ids),
  ])
  if (!screenings?.length) return []

  // Their most recent completed call.
  const lastCall = new Map<string, string>()
  // Whoever ran the most recent call is who the house would expect to write.
  const screener = new Map<string, { name: string; userId: string | null }>()
  for (const sc of screenings) {
    const prev = lastCall.get(sc.applicant_id)
    if (!prev || sc.starts_at > prev) {
      lastCall.set(sc.applicant_id, sc.starts_at)
      const name = personName(sc.housemate_name)
      if (name) screener.set(sc.applicant_id, { name, userId: sc.housemate_user_id || null })
      else screener.delete(sc.applicant_id)
    }
  }
  const lastOut = new Map<string, string>()
  for (const e of emails || []) {
    const prev = lastOut.get(e.applicant_id)
    if (!prev || e.sent_at > prev) lastOut.set(e.applicant_id, e.sent_at)
  }
  const voted = new Set((votes || []).map((v: { applicant_id: string }) => v.applicant_id))

  const out: Notification[] = []
  for (const a of candidates) {
    const call = lastCall.get(a.id)
    if (!call) continue
    // Silence is measured from the later of the call and our last word to them.
    const sinceIso = [call, lastOut.get(a.id) || ''].sort().reverse()[0]
    const days = Math.floor((Date.now() - new Date(sinceIso).getTime()) / 86400000)
    const step = followupStep(days)
    if (step === null) continue

    const heard = lastOut.get(a.id) && lastOut.get(a.id)! > call
    // The house reaches one decision; housemates weigh in on it. "Votes" made
    // it sound like a tally that needs a quorum, which is not how this works.
    const undecided = !voted.has(a.id)
    out.push({
      kind: 'screening_followup',
      subject_type: 'applicant',
      subject_id: a.id,
      subject_label: a.first_name,
      audience: days >= 10 ? 'oncall' : 'house',
      lane: step === FOLLOWUP_FIRST ? 'daily' : 'now',
      dedupe_key: `screening_followup:${a.id}:${step}`,
      owner: screener.get(a.id) || null,
      payload: {
        title: fullName(a),
        /* One sentence, both facts. The candidate is waiting AND the house
           hasn't decided — reporting those separately meant two notifications a
           word apart about the same person on the same day. */
        copy: undecided
          ? (screener.has(a.id) ? 'screening_followup.undecided_by' : 'screening_followup.undecided')
          : heard ? 'screening_followup.silent' : 'screening_followup.waiting',
        vars: {
          subject: fullName(a), days: plural(days, 'day'),
          screener: screener.get(a.id)?.name || '',
        },
        body: undecided ? undefined : 'the decision is in progress, nobody has told them',
        section: 'Owed an answer',
        links: [{ label: ACTIONS.write, url: applicantLink(a.id) }],
      },
    })
  }
  return out
}

/* C4 — a candidate became a housemate. The one purely good notification in the
   set, and the one the funnel PRD flagged as missing. */
async function detectPromotions(db: DB): Promise<Notification[]> {
  const { data: stays } = await db.from('recruit_stays')
    .select('id, applicant_id, occupant, room_id, starts_on, kind, created_at')
    .eq('kind', 'resident').not('applicant_id', 'is', null)
    .gte('created_at', new Date(Date.now() - 14 * 86400000).toISOString())
  if (!stays?.length) return []
  const { data: rooms } = await db.from('recruit_rooms').select('id, name')
  const roomName = new Map((rooms || []).map((r: { id: number; name: string }) => [r.id, r.name]))

  const { data: owed } = await db.from('recruit_onboarding')
    .select('stay_id, item, done_at').in('stay_id', stays.map((s: { id: string }) => s.id))
  const openItems = new Map<string, number>()
  for (const o of owed || []) {
    if (!o.done_at) openItems.set(o.stay_id, (openItems.get(o.stay_id) || 0) + 1)
  }

  return stays.map((s: Record<string, string | number>) => ({
    kind: 'candidate_promoted',
    subject_type: 'stay' as const,
    subject_id: String(s.id),
    subject_label: String(s.occupant || 'A new housemate'),
    lane: 'now' as const,
    dedupe_key: `candidate_promoted:${s.id}`,
    payload: {
      title: String(s.occupant || 'A new housemate'),
      copy: 'candidate_promoted',
      vars: {
        subject: String(s.occupant || 'A new housemate'),
        room: roomName.get(s.room_id as number) || 'the house',
        date: fmtDay(String(s.starts_on)),
      },
      body: openItems.get(String(s.id))
        ? `${plural(openItems.get(String(s.id))!, 'onboarding item')} still to tick`
        : undefined,
      section: 'New housemates',
      links: [{ label: ACTIONS.calendar, url: `${APP}?view=occupancy&room=${s.room_id}` }],
    },
  }))
}


/* ---------------------------------------------------------------------------
   Openings, in detail.

   Phase 1 covered the expensive end — a room with no runway left. These cover
   the quieter ways an opening fails: a draft nobody opened (so auto-placement,
   which only sees 'open', never ran), an open listing nobody qualifies for, and
   a listing marked filled with nothing on the calendar to match.
   ------------------------------------------------------------------------- */

/* O1 / O2 — a draft listing, then a draft nobody has touched. Drafts come from
   occupancy gaps and from marking a resident as leaving, and they are inert
   until a human opens them: the placement sweep only ever looks at 'open'. A
   draft sitting for a week is a room quietly not being filled. */
async function detectDraftListings(db: DB): Promise<Notification[]> {
  const { data } = await db.from('recruit_listings')
    .select('id, room_id, kind, starts_on, status, source, created_at')
    .eq('status', 'draft')
  if (!data?.length) return []
  const { data: rooms } = await db.from('recruit_rooms').select('id, name')
  const roomName = new Map((rooms || []).map((r: { id: number; name: string }) => [r.id, r.name]))

  return data.map((l: Record<string, string | number>) => {
    const age = Math.floor((Date.now() - new Date(String(l.created_at)).getTime()) / 86400000)
    const room = roomName.get(l.room_id as number) || `room ${l.room_id}`
    const stale = age >= 7
    return {
      kind: stale ? 'listing_draft_stale' : 'listing_draft',
      subject_type: 'listing' as const,
      subject_id: String(l.id),
      subject_label: String(room),
      lane: (stale ? 'weekly' : 'now') as 'weekly' | 'now',
      // A stale draft re-announces weekly; a new one announces once.
      dedupe_key: stale
        ? `listing_draft_stale:${l.id}:${ptToday().slice(0, 7)}`
        : `listing_draft:${l.id}`,
      payload: {
        title: String(room),
        copy: stale ? 'listing_draft_stale' : 'listing_draft',
        vars: { subject: String(room), days: plural(age, 'day'), date: fmtDay(String(l.starts_on)) },
        section: 'Draft openings',
        links: [{ label: ACTIONS.listing, url: viewLink('openings') }],
      },
    }
  })
}

/* O5 — the shortlist got its first candidate. This is the cue to send a
   screening request, and it is the one opening notification that is good news.
   Keyed on the listing, so it fires once when the shortlist stops being empty
   and not again as it fills. */
async function detectFirstCandidate(db: DB): Promise<Notification[]> {
  const { data: open } = await db.from('recruit_listings')
    .select('id, room_id, starts_on').eq('status', 'open')
  if (!open?.length) return []
  const { data: placements } = await db.from('recruit_listing_candidates')
    .select('listing_id, applicant_id, created_at').eq('status', 'active')
    .in('listing_id', open.map((l: { id: string }) => l.id))
  if (!placements?.length) return []
  const { data: rooms } = await db.from('recruit_rooms').select('id, name')
  const roomName = new Map((rooms || []).map((r: { id: number; name: string }) => [r.id, r.name]))

  const first = new Map<string, { count: number }>()
  for (const p of placements) {
    const e = first.get(p.listing_id) || { count: 0 }
    e.count++
    first.set(p.listing_id, e)
  }

  return open.filter((l: { id: string }) => first.has(l.id)).map((l: Record<string, unknown>) => {
    const room = roomName.get(l.room_id as number) || `room ${l.room_id}`
    const n = first.get(l.id as string)!.count
    return {
      kind: 'listing_has_candidates',
      subject_type: 'listing' as const,
      subject_id: String(l.id),
      subject_label: String(room),
      lane: 'now' as const,
      dedupe_key: `listing_has_candidates:${l.id}`,
      payload: {
        title: String(room),
        copy: 'listing_has_candidates',
      vars: { subject: String(room), count: plural(n, 'candidate') },
        section: 'Ready to screen',
        links: [{ label: ACTIONS.shortlist, url: viewLink('openings') }],
      },
    }
  })
}

/* O3 — an open listing nobody qualifies for, with the reason. "No candidates"
   on its own is not actionable; the useful notification says which of the three
   gates is closing everyone out, because each has a different fix (move the
   window, drop the rent, or widen the track). */
async function detectNoQualifiers(db: DB): Promise<Notification[]> {
  const week = new Date(Date.now() - 7 * 86400000).toISOString()
  const { data: open } = await db.from('recruit_listings')
    .select('id, room_id, kind, starts_on, ends_on, rent_monthly, created_at')
    .eq('status', 'open').lte('created_at', week)
  if (!open?.length) return []

  const [{ data: placements }, { data: candidates }, { data: rooms }] = await Promise.all([
    db.from('recruit_listing_candidates').select('listing_id').eq('status', 'active'),
    db.from('recruit_applicants')
      .select('id, residency, budget, move_in, move_in_from, move_in_to').eq('stage', 'candidate'),
    db.from('recruit_rooms').select('id, name'),
  ])
  const filled = new Set((placements || []).map((p: { listing_id: string }) => p.listing_id))
  const roomName = new Map((rooms || []).map((r: { id: number; name: string }) => [r.id, r.name]))

  const out: Notification[] = []
  for (const l of open) {
    if (filled.has(l.id)) continue
    const room = roomName.get(l.room_id) || `room ${l.room_id}`

    /* Why nobody fits. Deliberately coarse — the same three gates the
       placement sweep uses, counted across the candidate pool, and only the
       dominant one is reported. A precise per-candidate explanation belongs on
       the listing page, not in a notification. */
    let track = 0, budget = 0, dates = 0
    for (const c of candidates || []) {
      const wantsSublet = /short/i.test(c.residency || '')
      if (wantsSublet !== (l.kind === 'sublet')) { track++; continue }
      const cap = Number(String(c.budget || '').replace(/[^0-9]/g, '')) || null
      if (cap && l.rent_monthly && cap < l.rent_monthly) { budget++; continue }
      dates++   // right track, affordable — so it's the window that doesn't line up
    }
    const worst = track >= budget && track >= dates ? 'track'
      : budget >= dates ? 'budget' : 'dates'
    const because = !(candidates || []).length ? 'there are no candidates at all'
      : worst === 'track' ? `most candidates want ${l.kind === 'sublet' ? 'a full-time room' : 'a sublet'}`
      : worst === 'budget' ? `the rent is above what most candidates can pay`
      : `the dates don't line up for anyone`

    out.push({
      kind: 'listing_no_qualifiers',
      subject_type: 'listing',
      subject_id: String(l.id),
      subject_label: String(room),
      lane: 'weekly',
      dedupe_key: `listing_no_qualifiers:${l.id}:${ptToday().slice(0, 7)}`,
      payload: {
        title: String(room),
        copy: 'listing_no_qualifiers',
        vars: { subject: String(room), reason: because },
        section: 'Nobody qualifies',
        links: [{ label: ACTIONS.listing, url: viewLink('openings') }],
      },
    })
  }
  return out
}

/* O7 — marked filled, but the calendar disagrees. The two halves of the app
   drifting apart is exactly what the applicant_id link in migration 141 exists
   to stop, and this is the drift that costs money: a room believed let, with
   nobody actually booked into it. */
async function detectFilledWithoutStay(db: DB): Promise<Notification[]> {
  const { data: filled } = await db.from('recruit_listings')
    .select('id, room_id, starts_on, ends_on, status')
    .eq('status', 'filled')
  if (!filled?.length) return []
  const [{ data: stays }, { data: rooms }] = await Promise.all([
    db.from('recruit_stays').select('room_id, starts_on, ends_on'),
    db.from('recruit_rooms').select('id, name'),
  ])
  const roomName = new Map((rooms || []).map((r: { id: number; name: string }) => [r.id, r.name]))

  const out: Notification[] = []
  for (const l of filled) {
    // Any stay in that room that covers the listing's start is proof enough.
    // Overlap, not containment: any stay in that room touching the listing's
    // window is proof somebody is booked in.
    const lStart = String(l.starts_on), lEnd = String(l.ends_on || '9999-12-31')
    const covered = (stays || []).some((s: Record<string, string | number>) =>
      s.room_id === l.room_id &&
      String(s.starts_on) <= lEnd &&
      String(s.ends_on || '9999-12-31') >= lStart)
    if (covered) continue
    const room = roomName.get(l.room_id) || `room ${l.room_id}`
    out.push({
      kind: 'listing_filled_no_stay',
      subject_type: 'listing',
      subject_id: String(l.id),
      subject_label: String(room),
      lane: 'weekly',
      dedupe_key: `listing_filled_no_stay:${l.id}:${ptToday().slice(0, 7)}`,
      payload: {
        title: String(room),
        copy: 'listing_filled_no_stay',
        vars: { subject: String(room), date: fmtDay(String(l.starts_on)) },
        section: 'Reconcile',
        links: [{ label: ACTIONS.calendar, url: `${APP}?view=occupancy&room=${l.room_id}` }],
      },
    })
  }
  return out
}

/* ---------------------------------------------------------------------------
   Phase 3: the slow rot. Things that are nobody's emergency and everybody's
   problem a month later. All weekly.
   ------------------------------------------------------------------------- */

/* A10 — gone cold. We spoke, or wrote, and then both sides stopped. Scoped to
   people who have NOT had a screening, because screening_followup already owns
   the post-interview silence and says it better. */
async function detectGoneCold(db: DB): Promise<Notification[]> {
  const { data: live } = await db.from('recruit_applicants')
    .select('id, first_name, last_name').in('stage', ACTIVE_STAGES)
  if (!live?.length) return []
  const ids = live.map((a: { id: string }) => a.id)

  const [{ data: emails }, { data: screened }] = await Promise.all([
    db.from('recruit_emails').select('applicant_id, direction, sent_at').in('applicant_id', ids),
    db.from('recruit_screenings').select('applicant_id').in('applicant_id', ids),
  ])
  const hasCall = new Set((screened || []).map((r: { applicant_id: string }) => r.applicant_id))
  const last = new Map<string, { out?: string; in?: string }>()
  for (const e of emails || []) {
    const rec = last.get(e.applicant_id) || {}
    const key = e.direction === 'out' ? 'out' : 'in'
    if (!rec[key] || e.sent_at > rec[key]!) rec[key] = e.sent_at
    last.set(e.applicant_id, rec)
  }

  const out: Notification[] = []
  for (const a of live) {
    if (hasCall.has(a.id)) continue
    const rec = last.get(a.id)
    if (!rec?.out) continue                       // never written to — that's the Inbox's job, not this
    if (rec.in && rec.in > rec.out) continue      // they replied; the reply detectors own it
    const days = Math.floor((Date.now() - new Date(rec.out).getTime()) / 86400000)
    if (days < 10) continue
    out.push({
      kind: 'gone_cold',
      subject_type: 'applicant',
      subject_id: a.id,
      subject_label: a.first_name,
      lane: 'weekly',
      dedupe_key: `gone_cold:${a.id}:${Math.floor(days / 7)}`,
      payload: {
        title: fullName(a),
        copy: 'gone_cold',
        vars: { subject: fullName(a), days: plural(days, 'day') },
        section: 'Gone quiet',
        links: [{ label: ACTIONS.profile, url: applicantLink(a.id) }],
      },
    })
  }
  return out
}

/* C5 — onboarding still owed. The checklist is the house's shared memory of
   what a new resident hasn't been given yet (Google Group, Notion, Discord
   role, buddy, keys). Two weeks in, an unticked row usually means nobody picked
   it up rather than nobody needed it. */
async function detectOnboardingOwed(db: DB): Promise<Notification[]> {
  const { data: rows } = await db.from('recruit_onboarding')
    .select('stay_id, item, done_at, created_at').is('done_at', null)
  if (!rows?.length) return []
  const stayIds = [...new Set(rows.map((r: { stay_id: string }) => r.stay_id))]
  const { data: stays } = await db.from('recruit_stays')
    .select('id, occupant, created_at').in('id', stayIds)

  const out: Notification[] = []
  for (const st of stays || []) {
    const age = Math.floor((Date.now() - new Date(st.created_at).getTime()) / 86400000)
    if (age < 14) continue
    const items = rows.filter((r: { stay_id: string }) => r.stay_id === st.id)
      .map((r: { item: string }) => r.item)
    if (!items.length) continue
    out.push({
      kind: 'onboarding_owed',
      subject_type: 'stay',
      subject_id: String(st.id),
      subject_label: String(st.occupant || 'A new housemate'),
      lane: 'weekly',
      dedupe_key: `onboarding_owed:${st.id}:${Math.floor(age / 7)}`,
      payload: {
        title: String(st.occupant || 'A new housemate'),
        copy: 'onboarding_owed',
      vars: { subject: String(st.occupant || 'A new housemate'), days: plural(age, 'day'), count: plural(items.length, 'thing') },
        body: items.slice(0, 6).join(', '),
        section: 'Onboarding',
        links: [{ label: ACTIONS.calendar, url: viewLink('occupancy') }],
      },
    })
  }
  return out
}

/* C6 — the calendar contradicting itself: two stays in one room over the same
   dates. One summary rather than one per clash, because the fix is a single
   sitting with the calendar open. */
async function detectOccupancyConflicts(db: DB): Promise<Notification[]> {
  const [{ data: stays }, { data: rooms }] = await Promise.all([
    db.from('recruit_stays').select('id, room_id, occupant, starts_on, ends_on').order('starts_on'),
    db.from('recruit_rooms').select('id, name'),
  ])
  if (!stays?.length) return []
  const roomName = new Map((rooms || []).map((r: { id: number; name: string }) => [r.id, r.name]))
  const END = '9999-12-31'

  const clashes: string[] = []
  const byRoom = new Map<number, typeof stays>()
  for (const s of stays) {
    if (!byRoom.has(s.room_id)) byRoom.set(s.room_id, [])
    byRoom.get(s.room_id)!.push(s)
  }
  for (const [roomId, list] of byRoom) {
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        const a = list[i], b = list[j]
        const aEnd = String(a.ends_on || END), bEnd = String(b.ends_on || END)
        // Half-open comparison: a stay ending the day another starts is a
        // handover, not a clash.
        if (String(a.starts_on) < bEnd && String(b.starts_on) < aEnd) {
          clashes.push(`${roomName.get(roomId) || `room ${roomId}`}: ${a.occupant || '?'} and ${b.occupant || '?'}`)
        }
      }
    }
  }
  if (!clashes.length) return []
  return [{
    kind: 'occupancy_conflict',
    subject_type: 'house',
    subject_id: null,
    subject_label: 'The calendar',
    lane: 'weekly',
    dedupe_key: `occupancy_conflict:${ptToday().slice(0, 7)}:${clashes.length}`,
    payload: {
      title: `${plural(clashes.length, 'room')}`,
      copy: 'occupancy_conflict',
      vars: { subject: plural(clashes.length, 'room') },
      body: clashes.slice(0, 6).join(' · '),
      section: 'Reconcile',
      links: [{ label: ACTIONS.calendar, url: viewLink('occupancy') }],
    },
  }]
}

/* C7 — the trial votes.
   A trial candidate has two moments the whole house weighs in on: the check-in
   a month in, and the final decision before their sublet ends (migration 139).
   Each one is answered by a copy of the housemate feedback form, linked on the
   stay (migration 152), and the answers are only useful if they are in before
   the house talks — which is the Monday meeting. So the ballot closes at the
   last Monday meeting *before* the milestone, and every sentence names it.

   Two nudges, plus a backstop:
     open      four days before the meeting — the Thursday, so the ballot has
               the weekend to get filled in
     last call the morning of the meeting
     overdue   the milestone passed undecided — on-call, not the house

   Two is the whole ladder on purpose. A ballot that is open for four days and
   bumped once on the day is chased as hard as it can be without the channel
   learning to skip these. */
const VOTE_OPEN_LEAD = 4      // days before the closing meeting
const VOTE_STALE_DAYS = 14    // past this, a milestone is history, not news

/* When a ballot closes: the Monday house meeting before the milestone. The
   date on the stay is taken as it stands — a trial's dates are set by hand and
   moved by hand, and the meeting is found from whatever they say rather than
   rounded to a month boundary first. A milestone falling on a Monday closes at
   the meeting the week before: answers are wanted going *into* the day. */
export function ballotCloses(isoDate: string): string {
  const d = new Date(`${isoDate}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() - (((d.getUTCDay() + 6) % 7) || 7))
  return d.toISOString().slice(0, 10)
}

const MILESTONES = [
  ['checkin', 'month 1 check-in'],
  ['decision', 'final decision'],
] as const

async function detectTrialVotes(db: DB): Promise<Notification[]> {
  const { data: stays } = await db.from('recruit_stays')
    .select('id, kind, occupant, room_id, starts_on, ends_on, checkin_on, decision_on, checkin_form_url, decision_form_url')
  if (!stays?.length) return []

  const trials = stays.filter((s: { kind: string; checkin_on: string | null; decision_on: string | null }) =>
    s.kind === 'candidate' && (s.checkin_on || s.decision_on))
  if (!trials.length) return []

  /* Already decided in. A trial that turned into a residency doesn't owe the
     house a vote on whether it should — the promotion was the answer. */
  const settled = new Map<string, string>()
  for (const s of stays) {
    if (s.kind !== 'resident') continue
    const who = String(s.occupant || '').trim().toLowerCase()
    if (!who) continue
    const at = String(s.starts_on || '')
    if (!settled.has(who) || at > settled.get(who)!) settled.set(who, at)
  }

  const { data: rooms } = await db.from('recruit_rooms').select('id, name')
  const roomName = new Map((rooms || []).map((r: { id: number; name: string }) => [r.id, r.name]))

  const out: Notification[] = []
  for (const s of trials) {
    const who = String(s.occupant || '').trim()
    if (!who) continue
    const promotedAt = settled.get(who.toLowerCase())
    if (promotedAt && promotedAt >= String(s.starts_on || '')) continue

    for (const [which, milestone] of MILESTONES) {
      const on: string | null = which === 'checkin' ? s.checkin_on : s.decision_on
      if (!on) continue
      const form: string | null = which === 'checkin' ? s.checkin_form_url : s.decision_form_url
      const close = ballotCloses(on)
      const toMilestone = daysUntil(on)
      const toClose = daysUntil(close)

      // A date corrected after the fact isn't news.
      if (toMilestone < -VOTE_STALE_DAYS) continue

      let step: 'open' | 'last_call' | 'overdue' | null = null
      if (toMilestone < 0) step = 'overdue'
      else if (toClose <= 0) step = 'last_call'
      else if (toClose <= VOTE_OPEN_LEAD) step = 'open'
      if (!step) continue

      /* Without a form there is nothing to fill in, so the whole ladder
         collapses to the one line that says so — chasing people three times
         toward a link that doesn't exist is noise. It collapses rather than
         going silent: a milestone days away with no ballot is worse news than
         one with an unfilled ballot, not better. Overdue is exempt because it
         escalates the missed decision itself, which no form would have fixed. */
      if (!form && step !== 'overdue') step = 'open'
      const copy = step === 'open' && !form ? 'trial_vote_open.noform' : `trial_vote_${step}`

      out.push({
        kind: `trial_vote_${step}`,
        subject_type: 'stay',
        subject_id: String(s.id),
        subject_label: who,
        audience: step === 'overdue' ? 'oncall' : 'house',
        lane: step === 'open' ? 'daily' : 'now',
        /* Keyed on the closing meeting, not just the step: a trial that gets
           extended moves its decision date, and a key without the meeting in it
           would leave the house holding the deadline from before the extension.
           A milestone that moves *within* the same meeting's month is the same
           deadline, so that correctly stays quiet. */
        dedupe_key: `trial_vote:${s.id}:${which}:${close}:${step}`,
        payload: {
          title: who,
          copy,
          vars: {
            subject: who,
            milestone,
            date: fmtDay(on),
            close: fmtDay(close),
            days: plural(Math.abs(toMilestone), 'day'),
            room: String(roomName.get(s.room_id) || 'their room'),
          },
          section: 'Trial votes',
          links: form
            ? [{ label: ACTIONS.ballot, url: form }, { label: ACTIONS.calendar, url: viewLink('occupancy') }]
            : [{ label: ACTIONS.calendar, url: viewLink('occupancy') }],
        },
        // No due_at: dispatch only picks up rows that are already due, and a
        // rung is due the moment it is detected — the milestone is the thing
        // being announced, not the time to announce it.
      })
    }
  }
  return out
}

/* Detect everything. Each kind is independent: one failing query must not cost
   the others their tick, so each is caught on its own. */
function detectors(db: DB): Array<[string, () => Promise<Notification[]>]> {
  return [
    ['application_new', () => detectNewApplications(db)],
    ['review_stalled', () => detectReviewStalled(db)],
    ['review_backlog', () => detectReviewBacklog(db)],
    ['opening_at_risk', () => detectOpeningsAtRisk(db)],
    ['room_emptying', () => detectRoomsEmptying(db)],
    // Phase 2 — the active candidate's own journey.
    ['needs_input', () => detectNeedsInput(db)],
    ['candidate_landing', () => detectCandidateLanding(db)],
    ['screening_moments', () => detectScreeningMoments(db)],
    ['decision_open', () => detectDecisionOpen(db)],
    ['screening_followup', () => detectScreeningFollowup(db)],
    ['candidate_promoted', () => detectPromotions(db)],
    // Openings, in detail.
    ['listing_draft', () => detectDraftListings(db)],
    ['listing_has_candidates', () => detectFirstCandidate(db)],
    ['listing_no_qualifiers', () => detectNoQualifiers(db)],
    ['listing_filled_no_stay', () => detectFilledWithoutStay(db)],
    // Phase 3 — the slow rot.
    ['gone_cold', () => detectGoneCold(db)],
    ['onboarding_owed', () => detectOnboardingOwed(db)],
    ['occupancy_conflict', () => detectOccupancyConflicts(db)],
    // The people already living here.
    ['trial_vote', () => detectTrialVotes(db)],
  ]
}

export async function detect(db: DB): Promise<number> {
  let found = 0
  for (const [name, fn] of detectors(db)) {
    try {
      found += await record(db, await fn())
    } catch (err) {
      console.warn(`[notify] detect ${name} failed: ${(err as Error).message}`)
    }
  }
  return found
}

// ---- deliver ---------------------------------------------------------------

/* How each kind introduces itself to a human. The kind slug is a database
   value and must never reach a Discord message — "review_stalled" is not a
   sentence. Every notification reads as: <icon> <label> · <who or what> — <why
   it matters>. */
/* Labels, icons, and every sentence live in _shared/recruit-copy.ts, so copy can
   be read and edited as one document. Detectors below decide WHAT is true and
   name a copy key; they no longer contain prose. Overrides in recruit_copy win
   over the module's defaults, which is what makes wording changes a SQL edit
   rather than a deploy. */
const warned = new Set<string>()
function checkKind(kind: string): void {
  if (KINDS[kind] || warned.has(kind)) return
  warned.add(kind)
  console.warn(`[notify] kind '${kind}' is missing from KINDS — it will render as a bullet`)
}


/* One notification, one line. Deliberately three parts and no more: what kind
   of thing this is, who it concerns, and the single reason it was worth saying.
   No lane, no audience, no kind slug — those are how the system thinks, not
   what a housemate needs at 9am. */
interface LineRow {
  kind: string
  subject_label: string
  payload?: {
    sentence?: string
    title?: string
    body?: string
    links?: Array<{ label: string; url: string }>
  }
}

/* One notification, one line, two parts: what kind of thing this is, and who or
   what it is about — where the subject itself is the link into the app. That's
   the whole message.

   No trailing clause after an em dash. The detail (how many days, which date,
   what they wrote) lives on the payload and shows up in the Activity view,
   which has room for a second line; in a channel it read as the system
   explaining itself, and the notification is not the place to argue its case.
   Anyone who wants the particulars taps the name. */
function oneLine(n: LineRow): string {
  const who = n.payload?.title || n.subject_label
  const url = n.payload?.links?.[0]?.url
  const subject = url ? `[${who}](${url})` : who
  const sentence = n.payload?.sentence
  // Older rows (and any detector that forgets a sentence) still read sensibly.
  if (!sentence) return `${icon(n.kind)} **${label(n.kind)}** · ${subject}`
  return `${icon(n.kind)} ${sentence.replace('{}', subject)}`
}

/* The log's Discord half: every row, unbatched, muted or not. Runs before the
   members-channel passes so #recruiting-automation is never behind the
   channel the house reads. */
async function drainLog(db: DB): Promise<number> {
  const { data } = await db.from('recruit_notifications')
    .select('id, kind, subject_label, payload, audience, lane, muted')
    .is('log_at', null).neq('audience', 'none')
    .order('created_at').limit(12)
  if (!data?.length) return 0
  let sent = 0
  for (const n of data) {
    try {
      await sendEmbed(AUTOMATION_CHANNEL_ID, oneLine(n))
      await db.from('recruit_notifications').update({ log_at: new Date().toISOString() }).eq('id', n.id)
      sent++
    } catch (err) {
      console.warn(`[notify] log post failed for ${n.id}: ${(err as Error).message}`)
    }
  }
  return sent
}

/* The Now lane. Two audiences, two destinations, two stamps:

     house   → the members channel, stamped members_at
     oncall  → #recruiting-automation, stamped escalated_at

   They are drained separately rather than by inspecting each row's audience
   mid-loop, because a mixed batch would have to pick one channel and one stamp
   for rows that want different ones — the bug the first live tick exposed, where
   Chloe's and Soham's escalations were recorded as having gone to the house.

   ≥4 of one kind in a single pass collapse to a line-list — the existing
   new-application rule, generalised. */
async function drainLane(db: DB, settings: NotifySettings, audience: 'house' | 'oncall'): Promise<number> {
  const stampCol = audience === 'oncall' ? 'escalated_at' : 'members_at'
  const { data } = await db.from('recruit_notifications')
    .select('id, kind, subject_label, payload')
    .is(stampCol, null).eq('muted', false)
    .eq('lane', 'now').eq('audience', audience)   // never 'none'
    .lte('due_at', new Date().toISOString()).is('acked_at', null)
    .order('created_at').limit(8)
  if (!data?.length) return 0

  const byKind = new Map<string, typeof data>()
  for (const n of data) {
    if (!byKind.has(n.kind)) byKind.set(n.kind, [])
    byKind.get(n.kind)!.push(n)
  }

  const channel = audience === 'oncall' ? AUTOMATION_CHANNEL_ID : houseChannel(settings)
  let sent = 0
  for (const [kind, rows] of byKind) {
    try {
      if (rows.length >= 4) {
        // A batch names the kind once in its heading, so the rows inside drop
        // the repeated label and lead with who.
        const body = `${icon(kind)} **${label(kind)} — ${rows.length}**\n` +
          rows.map((r: Record<string, any>) => oneLine(r)).join('\n')
        await sendEmbed(channel, body)
      } else {
        for (const r of rows) {
          if (audience === 'oncall') {
            // The log already put this in the channel; the escalation raises
            // the volume and carries the link, it doesn't repeat the entry.
            await sendEmbed(channel, oneLine(r))
          } else {
            await sendEmbed(channel, oneLine(r))
          }
        }
      }
      await db.from('recruit_notifications')
        .update({ [stampCol]: new Date().toISOString() })
        .in('id', rows.map((r: { id: string }) => r.id))
      sent += rows.length
    } catch (err) {
      console.warn(`[notify] ${audience} now-lane ${kind} failed: ${(err as Error).message}`)
    }
  }
  return sent
}

/* The digest: one embed, counted sections, five rows each at most. Zero state
   posts nothing — a quiet channel has to be trustworthy as a quiet channel,
   and the log is where "nothing happened today" is legible. */
async function drainDigest(db: DB, settings: NotifySettings, lane: 'daily' | 'weekly'): Promise<number> {
  const { data } = await db.from('recruit_notifications')
    .select('id, kind, subject_label, payload')
    .is('members_at', null).eq('muted', false).eq('lane', lane)
    .eq('audience', 'house')
    .is('acked_at', null).lte('due_at', new Date().toISOString())
    .order('created_at').limit(200)
  if (!data?.length) return 0

  const SECTION_ORDER = ['Needs a review', 'Needs a second read', 'Owed an answer', 'Decisions', 'Ready to screen', 'Draft openings', 'Nobody qualifies', 'Gone quiet', 'Onboarding', 'Screening', 'Replies', 'Passed review', 'Waiting for a room', 'Openings at risk', 'Rooms emptying', 'New housemates', 'New applications', 'Backlog']
  const sections = new Map<string, typeof data>()
  for (const n of data) {
    const s = n.payload?.section || 'Other'
    if (!sections.has(s)) sections.set(s, [])
    sections.get(s)!.push(n)
  }
  const ordered = [...sections.entries()].sort((a, b) => {
    const ai = SECTION_ORDER.indexOf(a[0]), bi = SECTION_ORDER.indexOf(b[0])
    return (ai < 0 ? 99 : ai) - (bi < 0 ? 99 : bi)
  })

  const digestId = crypto.randomUUID()
  const blocks = ordered.map(([section, rows]) => {
    // Inside a named section the kind is already established, so each row is
    // just the name, linked. The section heading carries everything else.
    const shown = rows.slice(0, 5).map((r: Record<string, any>) => oneLine(r)).join('\n')
    const more = rows.length > 5 ? `\n_+${rows.length - 5} more_` : ''
    return `**${section} (${rows.length})**\n${shown}${more}`
  })
  const heading = lane === 'daily' ? '🌞 **Recruiting today**' : '📅 **Recruiting this week**'
  await sendEmbed(houseChannel(settings), `${heading}\n\n${blocks.join('\n\n')}`)
  await db.from('recruit_notifications')
    .update({ members_at: new Date().toISOString(), digest_id: digestId })
    .in('id', data.map((r: { id: string }) => r.id))
  return data.length
}

/* Has a digest for this lane already gone out in the current period? Read off
   the ledger itself rather than a separate marker — digest_id is stamped on
   every row a digest carried, so "did today's digest run" is a query, and a
   redeploy or a double tick can't produce two. */
async function digestSentThisPeriod(db: DB, lane: 'daily' | 'weekly'): Promise<boolean> {
  const since = lane === 'daily'
    ? new Date(`${ptToday()}T00:00:00-07:00`).toISOString()
    : new Date(Date.now() - 6 * 86400000).toISOString()
  const { data } = await db.from('recruit_notifications')
    .select('id').eq('lane', lane).not('digest_id', 'is', null)
    .gte('members_at', since).limit(1)
  return Boolean(data?.length)
}

/* What the detectors WOULD say right now, without writing or sending anything.

   Checking a copy edit by deleting rows and forcing a tick re-posts them to the
   channel — a re-send, not a preview, and it put four duplicate lines in front
   of the house before I stopped doing it. This is the honest way to see the
   effect of a template change: it runs the same detectors and the same renderer
   against the same overrides, and stops before the ledger.

   Rows whose dedupe_key already exists are marked `existing: true` — those would
   be no-ops on a real tick, so a preview showing twenty lines does not mean
   twenty messages are about to go out. */
export async function previewTick(db: DB): Promise<Array<Record<string, unknown>>> {
  const overrides = await loadCopyOverrides(db)
  const found: Notification[] = []
  for (const [name, fn] of detectors(db)) {
    try {
      found.push(...await fn())
    } catch (err) {
      console.warn(`[notify] preview ${name} failed: ${(err as Error).message}`)
    }
  }
  const { data: seen } = await db.from('recruit_notifications')
    .select('dedupe_key').in('dedupe_key', found.map((n) => n.dedupe_key))
  const known = new Set((seen || []).map((r: { dedupe_key: string }) => r.dedupe_key))

  return found.map((n) => ({
    kind: n.kind,
    existing: known.has(n.dedupe_key),
    lane: n.lane || 'daily',
    audience: n.audience || 'house',
    copy: n.payload.copy || null,
    /* The preview renders the real name where a stored row keeps `{}` — a dry
       run is read by a person, and "{} is up for their final decision" tells
       them nothing about who. Deliberate divergence from record(): don't
       "fix" this into matching, and don't trust it to prove a line is linked.
       It won't show the difference. */
    line: `${icon(n.kind)} ${n.payload.copy
      ? renderCopy(n.payload.copy, n.payload.vars || {}, overrides)
      : (n.payload.sentence || '')}`.replace('{subject}', String(n.payload.vars?.subject ?? n.payload.title)),
    dedupe_key: n.dedupe_key,
  }))
}

export interface TickResult {
  detected: number
  logged: number
  now: number
  digest: number
}

/* One tick: detect, then log, then broadcast. Called from recruit-discord's
   existing 15-minute /remind cron — no new schedule, same as the trial
   milestone reminders in v3.39. */
export async function notifyTick(db: DB): Promise<TickResult> {
  const settings = await loadSettings(db)
  const out: TickResult = { detected: 0, logged: 0, now: 0, digest: 0 }
  if (!settings.enabled) return out
  setAllowedChannel(settings)

  out.detected = await detect(db)
  // The log first, always: #recruiting-automation must never lag the channel
  // the house reads.
  try { out.logged = await drainLog(db) } catch (err) {
    console.warn(`[notify] log drain failed: ${(err as Error).message}`)
  }
  try { out.now = await drainLane(db, settings, 'house') + await drainLane(db, settings, 'oncall') } catch (err) {
    console.warn(`[notify] now drain failed: ${(err as Error).message}`)
  }

  // Digests ride the same tick: the clock is read, not scheduled. The window
  // is the digest hour itself — a 15-minute tick always lands inside it.
  const { hour, weekday } = ptParts()
  try {
    if (hour === settings.digestHour && !(await digestSentThisPeriod(db, 'daily'))) {
      out.digest += await drainDigest(db, settings, 'daily')
    }
    if (weekday === 'Mon' && hour === settings.digestHour && !(await digestSentThisPeriod(db, 'weekly'))) {
      out.digest += await drainDigest(db, settings, 'weekly')
    }
  } catch (err) {
    console.warn(`[notify] digest failed: ${(err as Error).message}`)
  }
  return out
}
