// Shared: the recruiting notification ledger — detect, log, broadcast.
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
  audience?: 'house' | 'oncall' | 'person'
  recipient_id?: string | null
  lane?: 'now' | 'daily' | 'weekly'
  dedupe_key: string
  payload: {
    title: string
    body: string
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

/* Move-in answers are prose in the applicant's voice — "asap (august/sept)",
   "I start my job August 24th", "Flexible". Prefixing any of those with "wants"
   produces something ungrammatical about half the time, so quote them instead:
   it always reads correctly and it is honestly their words, not our summary. */
function moveInQuote(text: string | null | undefined): string {
  const phrase = shortPhrase(text)
  return phrase ? `“${phrase.charAt(0).toLowerCase()}${phrase.slice(1)}”` : ''
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`

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
  const payload = rows.map((n) => ({
    kind: n.kind,
    subject_type: n.subject_type,
    subject_id: n.subject_id,
    subject_label: n.subject_label,
    audience: n.audience || 'house',
    recipient_id: n.recipient_id || null,
    lane: n.lane || 'daily',
    dedupe_key: n.dedupe_key,
    payload: n.payload,
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
      body: [
        /short/i.test(a.residency || '') ? 'sublet' : 'full-time',
        moveInQuote(a.move_in),
      ].filter(Boolean).join(' · '),
      section: 'New applications',
      links: [{ label: `Review ${a.first_name}`, url: applicantLink(a.id) }],
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
        body: `waiting ${plural(days, 'day')}`,
        section: 'Needs a review',
        links: [{ label: `Review ${a.first_name}`, url: applicantLink(a.id) }],
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
      title: `${plural(n, 'application')} nobody has reviewed`,
      body: `all older than ${REVIEW_RECENT_DAYS} days`,
      section: 'Backlog',
      links: [{ label: 'Open the inbox', url: viewLink('inbox') }],
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
        title: `${room} · ${l.kind === 'sublet' ? 'sublet' : 'resident'}`,
        body: left < 0
          ? `should have started ${fmtDay(starts)}, ${plural(Math.abs(left), 'day')} ago`
          : `starts ${fmtDay(starts)} · ${plural(left, 'day')} out`,
        section: 'Openings at risk',
        links: [{ label: 'Open the shortlist', url: viewLink('openings') },
                { label: 'See the room', url: `${APP}?view=occupancy&room=${l.room_id}` }],
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
        title: room,
        body: `${s.occupant || 'the occupant'} leaves ${fmtDay(ends)} · no listing`,
        section: 'Rooms emptying',
        links: [{ label: 'Open the calendar', url: `${APP}?view=occupancy&room=${s.room_id}` }],
      },
    })
  }
  return out
}

/* Detect everything. Each kind is independent: one failing query must not cost
   the others their tick, so each is caught on its own. */
export async function detect(db: DB): Promise<number> {
  const kinds: Array<[string, () => Promise<Notification[]>]> = [
    ['application_new', () => detectNewApplications(db)],
    ['review_stalled', () => detectReviewStalled(db)],
    ['review_backlog', () => detectReviewBacklog(db)],
    ['opening_at_risk', () => detectOpeningsAtRisk(db)],
    ['room_emptying', () => detectRoomsEmptying(db)],
  ]
  let found = 0
  for (const [name, fn] of kinds) {
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
const KINDS: Record<string, { icon: string; label: string }> = {
  application_new:   { icon: '📥', label: 'New application' },
  review_stalled:    { icon: '⏳', label: 'Waiting on a review' },
  review_backlog:    { icon: '🗄️', label: 'Inbox backlog' },
  opening_at_risk:   { icon: '🏠', label: 'Opening at risk' },
  opening_overdue:   { icon: '🔴', label: 'Opening overdue' },
  room_emptying:     { icon: '📦', label: 'Room emptying' },
}
const icon = (kind: string) => KINDS[kind]?.icon || '•'
// Unknown kinds degrade to a de-slugged label rather than leaking the slug.
const label = (kind: string) =>
  KINDS[kind]?.label || (kind.charAt(0).toUpperCase() + kind.slice(1).replace(/_/g, ' '))

/* One notification, one line. Deliberately three parts and no more: what kind
   of thing this is, who it concerns, and the single reason it was worth saying.
   No lane, no audience, no kind slug — those are how the system thinks, not
   what a housemate needs at 9am. */
interface LineRow {
  kind: string
  subject_label: string
  payload?: { title?: string; body?: string; links?: Array<{ label: string; url: string }> }
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
  return `${icon(n.kind)} **${label(n.kind)}** · ${url ? `[${who}](${url})` : who}`
}

/* The log's Discord half: every row, unbatched, muted or not. Runs before the
   members-channel passes so #recruiting-automation is never behind the
   channel the house reads. */
async function drainLog(db: DB): Promise<number> {
  const { data } = await db.from('recruit_notifications')
    .select('id, kind, subject_label, payload, audience, lane, muted')
    .is('log_at', null).order('created_at').limit(12)
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
    .eq('lane', 'now').eq('audience', audience)
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
          rows.map((r: Record<string, any>) => {
            const who = r.payload?.title || r.subject_label
            const url = r.payload?.links?.[0]?.url
            return `• ${url ? `[${who}](${url})` : who}`
          }).join('\n')
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

  const SECTION_ORDER = ['Needs a review', 'Openings at risk', 'Rooms emptying', 'New applications', 'Backlog']
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
    const shown = rows.slice(0, 5).map((r: Record<string, any>) => {
      const link = r.payload?.links?.[0]?.url
      const title = r.payload?.title || r.subject_label
      return `• ${link ? `[${title}](${link})` : title}`
    }).join('\n')
    const more = rows.length > 5 ? `\n• _+${rows.length - 5} more_` : ''
    return `**${section} (${rows.length})**\n${shown}${more}`
  })
  const heading = lane === 'daily' ? '☀️ **Recruiting today**' : '🗓️ **Recruiting this week**'
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
