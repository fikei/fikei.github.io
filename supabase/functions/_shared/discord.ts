// _shared/discord.ts
// Discord REST helpers for the recruiting automations: screener schedulers,
// notes, pings, DMs. Used by recruit-gmail, recruit-availability, recruit-discord.
//
// Vocabulary (2026-07): the post that offers an applicant's open times is a
// SCREENER SCHEDULER; a housemate SIGNS UP for a slot and becomes the
// SCREENER. "Claim" survives only in storage (recruit_claim_posts, claimed_*)
// and in Discord custom_ids — live posted buttons carry `claim|…`, so the
// wire format is frozen for compatibility.
//
// Channel roles:
//   #recruiting-automation — every automated message the app sends lands
//     here as well as at its intended target, so the house has one audit
//     trail and subgroups can be granted access to just this channel.
//     (Formerly #recruiting-automation — same channel id, renamed 2026-07.)
//   #recruiting-society — the members channel: new-application pings,
//     Intro Call notes/recordings, live-call announcements.

// deno-lint-ignore-file no-explicit-any

import { TZ } from './recruit-schedule.ts'

const DISCORD_API = 'https://discord.com/api/v10'
// #recruiting-automation in the Agape guild (952961396121931838) — claim
// posts live here AND it is the audit mirror for every other automation.
export const AUTOMATION_CHANNEL_ID = Deno.env.get('RECRUITING_AUTOMATION_CHANNEL_ID')
  || Deno.env.get('SCREENING_CLAIMS_CHANNEL_ID') || '1529576830514762029'
// Kept for callers that still speak in claim terms — same channel.
export const CLAIMS_CHANNEL_ID = AUTOMATION_CHANNEL_ID
/* #recruiting-society — the members channel (pings, notes, recordings).

   HELD. Every recruiting automation is pointed at #recruiting-automation while
   the notification system earns its keep, and this is the one place that can be
   true for all of them: notes, recordings, live-call announcements, the claim
   mirror, and postResilient's fallback all resolve their destination through
   this constant. Redirecting it here means no caller can post to the house
   channel by forgetting to check a flag — which is exactly how a new-application
   ping kept landing there while the ledger's own switch said not to.

   Set RECRUITING_SOCIETY_POSTS=true to hand the channel back its traffic. */
export const SOCIETY_CHANNEL_ID = Deno.env.get('SCREENING_NOTES_CHANNEL_ID') || '1503490895469609211'
const SOCIETY_POSTS_ON = Deno.env.get('RECRUITING_SOCIETY_POSTS') === 'true'
export const NOTES_CHANNEL_ID = SOCIETY_POSTS_ON ? SOCIETY_CHANNEL_ID : AUTOMATION_CHANNEL_ID

// Compact one-liner for the audit trail: the embed's title/description or
// the plain content, whichever the payload carries.
function summarize(payload: Record<string, unknown>): string {
  const embeds = payload.embeds as Array<Record<string, string>> | undefined
  if (embeds?.length) {
    const e = embeds[0]
    return [e.title, (e.description || '').split('\n')[0]].filter(Boolean).join(' — ')
  }
  return String(payload.content || '(no text)').split('\n')[0]
}

function botHeaders(): Record<string, string> {
  const token = Deno.env.get('DISCORD_BOT_TOKEN')
  if (!token) throw new Error('DISCORD_BOT_TOKEN not set')
  return { Authorization: `Bot ${token}`, 'Content-Type': 'application/json' }
}

async function discordFetch(path: string, options: RequestInit): Promise<any> {
  const resp = await fetch(`${DISCORD_API}${path}`, { ...options, headers: botHeaders() })
  const text = await resp.text()
  if (!resp.ok) {
    const err = new Error(`Discord ${resp.status} ${options.method || 'GET'} ${path}: ${text.slice(0, 200)}`) as any
    err.status = resp.status
    throw err
  }
  return text ? JSON.parse(text) : null
}

// ---- timezone-correct slot derivation -------------------------------------

// Offset (ms) between UTC and `tz` at instant d — the formatToParts trick,
// since Deno's runtime TZ is UTC and windows are Pacific wall times.
function tzOffsetMs(d: Date, tz: string): number {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', {
      timeZone: tz, hour12: false,
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
    }).formatToParts(d).map((p) => [p.type, p.value]),
  )
  const asUTC = Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour % 24, +parts.minute, +parts.second)
  return asUTC - d.getTime()
}

// Pacific wall time ("2026-07-25", "09:00") → UTC instant.
export function ptToUTC(date: string, hhmm: string): Date {
  const guess = new Date(`${date}T${hhmm}:00Z`)
  return new Date(guess.getTime() - tzOffsetMs(guess, TZ))
}

export function slotLabel(d: Date): string {
  const day = d.toLocaleString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: TZ })
  const time = d.toLocaleString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true, timeZone: TZ })
    .toLowerCase().replace(' am', 'a').replace(' pm', 'p')
  return `${day} · ${time}`
}

// Prose variant for sentences: "Thu, Jul 23 at 9:30a"
export function slotWhen(d: Date): string {
  return slotLabel(d).replace(' · ', ' at ')
}

export interface Slot { start: string; label: string }

// Windows → up to 8 concrete 30-min slots. Round-robin across windows so one
// long window doesn't crowd out the others; drop starts already in the past.
export function deriveSlots(windows: Array<{ date: string; start: string; end: string }>): Slot[] {
  const now = Date.now()
  const perWindow: Date[][] = windows.map((w) => {
    const starts: Date[] = []
    const end = ptToUTC(w.date, w.end)
    for (let t = ptToUTC(w.date, w.start); t.getTime() + 30 * 60000 <= end.getTime(); t = new Date(t.getTime() + 30 * 60000)) {
      if (t.getTime() > now) starts.push(t)
    }
    return starts
  })
  const slots: Slot[] = []
  for (let i = 0; slots.length < 8; i++) {
    let any = false
    for (const starts of perWindow) {
      if (i < starts.length && slots.length < 8) {
        slots.push({ start: starts[i].toISOString(), label: slotLabel(starts[i]) })
        any = true
      }
    }
    if (!any) break
  }
  slots.sort((a, b) => a.start.localeCompare(b.start))
  return slots
}

// ---- claim message --------------------------------------------------------

export interface ScreenerSchedulerInput {
  applicantId: string
  firstName: string
  whyLine: string | null
  pronouns?: string | null
  windows: Array<{ date: string; start: string; end: string }>
  platform: { kind: string; handle?: string } | null
  timezoneNote: string | null
  needsHuman: boolean
}

function appLink(applicantId: string): string {
  return `https://ctrl.rodeo/applications/?a=${encodeURIComponent(applicantId)}`
}

// Capability link to our archived copy — Recall's presigned URLs died within
// hours, so recording posts point here instead. The token is the credential.
function watchLink(shareToken: string): string {
  return `https://ctrl.rodeo/applications/watch/?t=${encodeURIComponent(shareToken)}`
}

// "her/his/their application" from the applicant's own pronouns field;
// neutral "their" whenever unstated or ambiguous.
function possessive(pronouns: string | null | undefined): string {
  const p = (pronouns || '').toLowerCase()
  if (/she/.test(p) && !/he\/|\bhe\b/.test(p.replace(/she/g, ''))) return 'her'
  if (/\bhe\b|he\/him/.test(p) && !/she/.test(p)) return 'his'
  return 'their'
}

// Exported so the app can render a faithful preview before a human
// triggers the post (auto-posting is off for now — manual first).
export function buildMessage(input: ScreenerSchedulerInput, slots: Slot[]): Record<string, unknown> {
  const manual = input.needsHuman || !slots.length
  const poss = possessive(input.pronouns)

  const considerations: string[] = []
  if (input.timezoneNote) considerations.push(`⚠️ ${input.timezoneNote}`)
  if (input.platform?.kind) {
    const handle = input.platform.handle ? ` (@${input.platform.handle})` : ''
    considerations.push(`⚠️ Asked for ${input.platform.kind}${handle} — default is Meet; the resident can DM them about it.`)
  }
  // Considerations section only exists when there is something to flag.
  const considerationsBlock = considerations.length
    ? `**Considerations:**\n${considerations.join('\n')}\n\n`
    : ''

  let description: string
  if (manual) {
    description =
      `**${input.firstName}** wrote back about scheduling, but didn't name specific times.\n\n` +
      considerationsBlock +
      `See ${poss} [application](${appLink(input.applicantId)}) — read the thread and coordinate by email.`
  } else {
    description =
      `Can someone take this Intro Call with **${input.firstName}**?\n\n` +
      considerationsBlock +
      `See ${poss} [application](${appLink(input.applicantId)}).\n\n` +
      `_Tap a time to sign up — you'll both receive an invite and be added to the email thread._`
  }

  const components: Array<Record<string, unknown>> = []
  if (!manual) {
    let row: Array<Record<string, unknown>> = []
    for (const slot of slots) {
      row.push({ type: 2, style: 1, label: slot.label, custom_id: `claim|${input.applicantId}|${Date.parse(slot.start)}` })
      if (row.length === 5) { components.push({ type: 1, components: row }); row = [] }
    }
    row.push({ type: 2, style: 5, label: 'Other time…', url: appLink(input.applicantId) })
    components.push({ type: 1, components: row })
  }

  return {
    embeds: [{
      description,
      color: manual ? 0xe67e22 : 0x3498db,
    }],
    components,
  }
}

// PATCH an existing message, falling back to a fresh POST when it was deleted
// (404) or never existed. Returns the live message.
async function postOrPatch(channelId: string, messageId: string | null, payload: Record<string, unknown>): Promise<any> {
  if (messageId) {
    try {
      return await discordFetch(`/channels/${channelId}/messages/${messageId}`, {
        method: 'PATCH', body: JSON.stringify(payload),
      })
    } catch (err) {
      if ((err as any).status !== 404) throw err
    }
  }
  return await discordFetch(`/channels/${channelId}/messages`, {
    method: 'POST', body: JSON.stringify(payload),
  })
}

// Post (or edit, per the one-open-post-per-applicant rule) the claim message —
// in BOTH #recruiting-automation and #recruiting-society. Either copy is
// claimable; both carry the same custom_ids so the claim handler is agnostic.
// Returns the recruit_claim_posts row, or null when posting was skipped.
export async function upsertScreenerScheduler(db: any, input: ScreenerSchedulerInput): Promise<any | null> {
  const { data: existing } = await db.from('recruit_claim_posts')
    .select('*').eq('applicant_id', input.applicantId).maybeSingle()
  if (existing?.status === 'claimed') {
    console.log(`[discord] screener scheduler for ${input.applicantId} already signed up — skipping repost`)
    return null
  }

  const slots = input.needsHuman ? [] : deriveSlots(input.windows)
  const payload = buildMessage(input, slots)
  const status = (input.needsHuman || !slots.length) ? 'manual' : 'open'
  const live = existing && existing.status !== 'expired' ? existing : null

  const message = await postOrPatch(CLAIMS_CHANNEL_ID, live?.discord_message_id || null, payload)
  // Mirror copy is best-effort: missing channel perms must not kill the post.
  // Scheduling asks reach the members channel via society_scheduling_posts
  // (test applicants never do); otherwise fall back to the held NOTES route.
  // Skipped when it would just duplicate the post into the same channel.
  let mirror: any = null
  const mirrorChannel = (await schedulingSocietyChannel(db, input.applicantId))
    || (NOTES_CHANNEL_ID !== CLAIMS_CHANNEL_ID ? NOTES_CHANNEL_ID : null)
  if (mirrorChannel && mirrorChannel !== CLAIMS_CHANNEL_ID) {
    try {
      mirror = await postOrPatch(mirrorChannel, live?.mirror_message_id || null, payload)
    } catch (err) {
      console.warn(`[discord] mirror post failed for ${input.applicantId}: ${(err as Error).message}`)
    }
  }

  const { data: row, error } = await db.from('recruit_claim_posts').upsert({
    applicant_id: input.applicantId,
    discord_message_id: message.id,
    discord_channel_id: message.channel_id || AUTOMATION_CHANNEL_ID,
    mirror_message_id: mirror?.id || null,
    mirror_channel_id: mirror ? (mirror.channel_id || NOTES_CHANNEL_ID) : null,
    slots, platform: input.platform, timezone_note: input.timezoneNote,
    needs_human: input.needsHuman, status,
    posted_at: existing?.posted_at || new Date().toISOString(),
    reminded_at: null,
    updated_at: new Date().toISOString(),
  }).select().single()
  if (error) throw new Error(`screener scheduler upsert failed: ${error.message}`)
  console.log(`[discord] screener scheduler ${existing ? 'updated' : 'created'} for ${input.applicantId} (${slots.length} slots, ${status}, mirror=${Boolean(mirror)})`)
  return row
}

// A scheduler row's message targets: primary + mirror when present.
// deno-lint-ignore no-explicit-any
function postTargets(post: any): Array<{ channelId: string; messageId: string }> {
  const targets = [{ channelId: post.discord_channel_id, messageId: post.discord_message_id }]
  if (post.mirror_message_id && post.mirror_channel_id) {
    targets.push({ channelId: post.mirror_channel_id, messageId: post.mirror_message_id })
  }
  return targets
}

// deno-lint-ignore no-explicit-any
async function editSchedulerEverywhere(post: any, payload: Record<string, unknown>): Promise<void> {
  for (const t of postTargets(post)) {
    try {
      await discordFetch(`/channels/${t.channelId}/messages/${t.messageId}`, {
        method: 'PATCH', body: JSON.stringify(payload),
      })
    } catch (err) {
      console.warn(`[discord] edit failed in ${t.channelId}: ${(err as Error).message}`)
    }
  }
}

// Close a claimed post (both copies): strip buttons, green announcement.
// deno-lint-ignore no-explicit-any
export async function editSchedulerSignedUp(
  post: any, screenerDiscordId: string,
  applicantName: string, applicantId: string, when: string,
): Promise<void> {
  await editSchedulerEverywhere(post, {
    embeds: [{
      description: `✅ <@${screenerDiscordId}> is screening **${applicantName}** on ${when} — [see the candidate background here](${appLink(applicantId)}).`,
      color: 0x2ecc71,
    }],
    components: [],
  })
}

// Mark a signed-up scheduler (both copies) that hit an error downstream.
// deno-lint-ignore no-explicit-any
export async function editSchedulerFailed(
  post: any, screenerDiscordId: string,
  applicantId: string, when: string,
): Promise<void> {
  await editSchedulerEverywhere(post, {
    embeds: [{
      description: `⚠️ <@${screenerDiscordId}> signed up for this screener (${when}) but the calendar invite failed — [book manually in the app](${appLink(applicantId)}).`,
      color: 0xe74c3c,
    }],
    components: [],
  })
}

/* DMs are audited as well: a screener's confirmation is an automation the
   house should be able to see happened, without exposing the DM thread. */
/* A DM, optionally with buttons under it.

   Buttons are how a message can offer something without spending the reader's
   attention on it — the call reminder can mention the interview guide in one
   tap's worth of space rather than pasting two thousand characters nobody asked
   for at that moment. */
export async function dmUser(
  discordUserId: string,
  content: string,
  buttons: Array<{ label: string; customId: string }> = [],
  /* Render the text as an embed rather than plain content.

     Discord only resolves [label](url) inside an embed — in plain content it
     shows the raw URL, which is why a message meant to say "View application"
     would otherwise print sixty characters of query string. Plain stays the
     default because most DMs here are one line and an embed would make them
     look like announcements. */
  asEmbed = false,
): Promise<void> {
  const channel = await discordFetch('/users/@me/channels', {
    method: 'POST', body: JSON.stringify({ recipient_id: discordUserId }),
  })
  const components = buttons.length
    ? [{
        type: 1,
        components: buttons.slice(0, 5).map((b) => ({
          type: 2, style: 2, label: b.label, custom_id: b.customId,
        })),
      }]
    : []
  await discordFetch(`/channels/${channel.id}/messages`, {
    method: 'POST',
    body: JSON.stringify({
      ...(asEmbed
        ? { embeds: [{ description: content.slice(0, 3900), color: 0x378add }] }
        : { content }),
      ...(components.length ? { components } : {}),
    }),
  })
  await auditMirror('Message sent', content.split('\n')[0], { dmTo: discordUserId })
}

/* Audit mirror: a one-line record of every automated message, posted to
   #recruiting-automation alongside the real thing. Best-effort by design —
   an audit failure must never break (or double-report) the automation it
   describes, and messages that already went to the automation channel are
   skipped so the trail stays readable. */
export async function auditMirror(
  label: string, summary: string, target: { channelId?: string; dmTo?: string } = {},
): Promise<void> {
  try {
    if (target.channelId && target.channelId === AUTOMATION_CHANNEL_ID) return
    const where = target.dmTo ? `DM → <@${target.dmTo}>`
      : target.channelId ? `→ <#${target.channelId}>`
      : '→ (no channel)'
    await discordFetch(`/channels/${AUTOMATION_CHANNEL_ID}/messages`, {
      method: 'POST',
      body: JSON.stringify({
        embeds: [{
          description: `🤖 **${label}** ${where}\n${summary.slice(0, 900)}`,
          color: 0x6a6c6a,
        }],
      }),
    })
  } catch (err) {
    console.warn(`[discord] audit mirror for "${label}" failed: ${(err as Error).message}`)
  }
}

// Ops contact for last-resort alerts when Discord posting fails everywhere.
const ALERT_DISCORD_USER_ID = Deno.env.get('ALERT_DISCORD_USER_ID') || '853782600082522152' // Ian

// Post with a fallback ladder so a broken channel can never fail silently
// (the #recruiting-society permissions outage went unnoticed for hours
// because alerts posted into the channel that was broken): primary channel →
// the other recruiting channel with a ⚠️ prefix → DM the ops contact.
// Throws if every rung fails, so callers don't stamp state as posted.
/* Read recent messages from a channel. Needs the bot to hold "Read Message
   History" there — it already posts to both recruiting channels, so this is
   normally granted. Paginates backwards via `before`. */
export async function fetchChannelMessages(
  channelId: string,
  opts: { limit?: number; sinceIso?: string } = {},
): Promise<any[]> {
  const want = Math.min(opts.limit ?? 200, 1000)
  const since = opts.sinceIso ? new Date(opts.sinceIso).getTime() : 0
  const out: any[] = []
  let before = ''
  while (out.length < want) {
    const page: any[] = await discordFetch(
      `/channels/${channelId}/messages?limit=100${before ? `&before=${before}` : ''}`,
    )
    if (!page.length) break
    for (const m of page) {
      if (since && new Date(m.timestamp).getTime() < since) return out
      out.push(m)
    }
    before = page[page.length - 1].id
    if (page.length < 100) break
  }
  return out
}

export async function postResilient(channelId: string, payload: Record<string, unknown>, label: string): Promise<void> {
  // While society posts are held both constants are the same channel, and
  // retrying there would fail twice and bury the real error. Skip straight to
  // the alert DM in that case.
  const fallback = channelId === NOTES_CHANNEL_ID ? AUTOMATION_CHANNEL_ID : NOTES_CHANNEL_ID
  const canFallBack = fallback !== channelId
  try {
    await discordFetch(`/channels/${channelId}/messages`, { method: 'POST', body: JSON.stringify(payload) })
    await auditMirror(label, summarize(payload), { channelId })
    return
  } catch (err) {
    console.warn(`[discord] ${label}: post to ${channelId} failed: ${(err as Error).message}`)
  }
  try {
    if (!canFallBack) throw new Error('no distinct fallback channel')
    await discordFetch(`/channels/${fallback}/messages`, {
      method: 'POST',
      body: JSON.stringify({
        ...payload,
        content: `⚠️ Posting this in <#${channelId}> didn't work, so it's here instead — check the bot's permissions there.${typeof payload.content === 'string' ? `\n${payload.content}` : ''}`,
      }),
    })
    return
  } catch (err) {
    console.warn(`[discord] ${label}: fallback post to ${fallback} failed: ${(err as Error).message}`)
  }
  try {
    await dmUser(ALERT_DISCORD_USER_ID, `🚨 Discord posting is failing in both recruiting channels (${label}). Check the bot's permissions.`)
  } catch (err) {
    console.error(`[discord] ${label}: even the alert DM failed: ${(err as Error).message}`)
  }
  throw new Error(`all posting fallbacks failed for ${label}`)
}

// Cap an already-assembled description without cutting into its trailing
// link lines: trim ahead of the last 🎥 line instead of the tail.
function fitDescription(desc: string, cap = 4000): string {
  if (desc.length <= cap) return desc
  const at = desc.lastIndexOf('\n🎥 ')
  if (at < 0) return desc.slice(0, cap)
  const tail = desc.slice(at)
  return desc.slice(0, Math.max(0, cap - tail.length - 1)).trimEnd() + '…' + tail
}

// Fit an embed description under Discord's cap by trimming the SUMMARY,
// never the trailing link lines. A blunt .slice(0, 4000) on the whole
// description used to amputate the watch URL when a summary ran long,
// which is how "expired" recording links were actually born.
function summaryWithLinks(summary: string | null, links: string[], cap = 4000): string {
  const linksBlock = links.length ? '\n\n' + links.join('\n') : ''
  const body = summary || '_No transcript captured (captions may have been off)._'
  const room = cap - linksBlock.length
  const trimmed = body.length > room ? body.slice(0, Math.max(0, room - 1)).trimEnd() + '…' : body
  return trimmed + linksBlock
}

// Post the recording + summary back to the claims channel after a call ends.
export async function postRecordingNote(
  firstName: string, applicantId: string, residentName: string,
  summary: string | null, shareToken: string | null,
): Promise<void> {
  const links = [
    shareToken ? `🎥 [Watch the recording](${watchLink(shareToken)})` : '🎥 Recording unavailable.',
    `📋 [Full profile](${appLink(applicantId)})`,
  ]
  await postResilient(NOTES_CHANNEL_ID, {
    embeds: [{
      title: `${firstName} × ${residentName} — Intro Call notes`,
      description: summaryWithLinks(summary, links),
      color: 0x9b59b6,
    }],
  }, `intro-call notes (${firstName})`)
}

// Notes for a non-applicant meeting hosted by the shared account.
export async function postMeetingNote(
  title: string, summary: string | null, shareToken: string | null,
): Promise<void> {
  const links = [
    shareToken ? `🎥 [Watch the recording](${watchLink(shareToken)})` : '🎥 Recording unavailable.',
  ]
  await postResilient(NOTES_CHANNEL_ID, {
    embeds: [{ title: `${title} — meeting notes`, description: summaryWithLinks(summary, links), color: 0x9b59b6 }],
  }, `meeting notes (${title})`)
}

// One-shot repair for notes posted before capability links existed: their
// 🎥 line still points at a Recall presigned URL that expired within hours.
// Rewrites that line in place (editing beats reposting — the notes keep their
// position in channel history). resolve() maps an applicant id to its share
// token; posts we can't resolve are left untouched.
export async function relinkRecordingPosts(
  // Meeting-style notes carry no profile link, so the title is the only
  // handle we have on them — the resolver gets both.
  resolve: (applicantId: string | null, title: string) => Promise<string | null>,
  limit = 100,
): Promise<{ scanned: number; updated: number; skipped: string[] }> {
  const messages = await discordFetch(`/channels/${NOTES_CHANNEL_ID}/messages?limit=${limit}`, { method: 'GET' })
  const skipped: string[] = []
  let updated = 0
  for (const msg of (messages || [])) {
    const embed = (msg.embeds || [])[0]
    const desc: string = embed?.description || ''
    // Two repairable shapes: a stale pre-capability Recall link, and a watch
    // link whose token isn't 64 hex — the old whole-description slice used to
    // amputate URLs mid-token, so those posts 404 exactly like expired ones.
    const stale = /🎥 \[Recording\]\(/.test(desc)
    const truncated = !stale &&
      /🎥 \[Watch the recording\]\(https:\/\/ctrl\.rodeo\/applications\/watch\/\?t=(?![0-9a-f]{64}\))/.test(desc)
    if (!stale && !truncated) continue
    const idMatch = desc.match(/\/applications\/\?a=([0-9a-zA-Z-]+)/)?.[1]
    const applicantId = idMatch ? decodeURIComponent(idMatch) : null
    const token = await resolve(applicantId, String(embed?.title || ''))
    if (!token) { skipped.push(`${msg.id}: ${embed?.title || 'untitled'} — no archived recording`); continue }
    const watchLine = `🎥 [Watch the recording](${watchLink(token)})`
    const fixed = stale
      ? desc.replace(/🎥 \[Recording\]\([^)]*\)(\s*_\([^)]*\)_)?/, watchLine)
      // The slice destroyed everything from the 🎥 line to the end (including
      // any profile line after it), so rebuild that whole tail.
      : desc.replace(/🎥 \[Watch the recording\]\([\s\S]*$/,
          watchLine + (applicantId ? `\n📋 [Full profile](${appLink(applicantId)})` : ''))
    if (fixed === desc) { skipped.push(`${msg.id}: line not matched`); continue }
    await discordFetch(`/channels/${NOTES_CHANNEL_ID}/messages/${msg.id}`, {
      method: 'PATCH',
      // Guarded trim (summary, never links) — a plain slice here would
      // recreate the very truncation this repair exists to undo.
      body: JSON.stringify({ embeds: [{ ...embed, description: fitDescription(fixed) }] }),
    })
    updated++
  }
  return { scanned: (messages || []).length, updated, skipped }
}

// "Happening now" — announce a starting call so housemates can drop in.
export async function postLiveCall(title: string, when: string, meetLink: string | null): Promise<void> {
  await postResilient(NOTES_CHANNEL_ID, {
    embeds: [{
      description: `🎥 **Join — ${title}** · ${when}${meetLink ? `\n[▶ Tap to join the call](${meetLink})` : ''}`,
      color: 0xe74c3c,
    }],
  }, `live-call post (${title})`)
}

// Persistent "Get sign-in link" helper message for phone sign-in — tapping
// the button gets an ephemeral one-time link (handled in recruit-discord).
export async function postSigninMessage(channelId: string): Promise<any> {
  await auditMirror('Phone sign-in message posted', 'Housemates can get a sign-in link from it any time', { channelId })
  return await discordFetch(`/channels/${channelId}/messages`, {
    method: 'POST',
    body: JSON.stringify({
      embeds: [{
        description: '**Applicant inbox**\n' +
          'Tap below, or type `/signin` anywhere in the server.',
        footer: { text: 'Links work once, for 10 minutes. Fine inside Instagram and Discord browsers.' },
        color: 0x5865f2,
      }],
      components: [{
        type: 1,
        components: [{ type: 2, style: 1, label: 'Get sign-in link', custom_id: 'signin' }],
      }],
    }),
  })
}

/* Effective VIEW_CHANNEL for the Recruiting Society channel, computed the way
   Discord does it: @everyone base, then the member's roles, then channel
   overwrites (@everyone → roles → member). Mirrors discord-membership, which
   is deliberately standalone; this copy serves the cron sweeps. */
const VIEW_CHANNEL = 1n << 10n
const ADMINISTRATOR = 1n << 3n

/* Fetch the channel + role table ONCE. Doing this per member turned a roster
   sweep into two Discord calls per person, which is fine for one lookup and
   ruinous for a whole guild. */
export async function recruitingGate(): Promise<{ channel: any; roleById: Map<string, bigint>; guildId: string } | null> {
  const guildId = Deno.env.get('AGAPE_GUILD_ID') || '952961396121931838'
  const [channels, roles] = await Promise.all([
    discordFetch(`/guilds/${guildId}/channels`, { method: 'GET' }),
    discordFetch(`/guilds/${guildId}/roles`, { method: 'GET' }),
  ])
  const wantedId = Deno.env.get('RECRUITING_CHANNEL_ID')
  const named = (rx: RegExp) => channels.find((c: any) => rx.test(String(c.name || '')) && c.type !== 4)
  const channel = wantedId
    ? channels.find((c: any) => String(c.id) === wantedId)
    : (named(/recruit.*society|society.*recruit/i) || named(/recruit/i))
  if (!channel) return null
  return { channel, roleById: new Map(roles.map((r: any) => [r.id, BigInt(r.permissions)])), guildId }
}

/* Pure permission maths against an already-fetched gate. */
export function canSeeWithGate(
  gate: { channel: any; roleById: Map<string, bigint>; guildId: string },
  discordUserId: string,
  memberRoles: string[],
): boolean {
  const { channel, roleById, guildId } = gate
  let base = (roleById.get(guildId) as bigint) ?? 0n
  for (const rid of memberRoles) base |= (roleById.get(rid) as bigint) ?? 0n
  if (base & ADMINISTRATOR) return true
  const overwrites = (channel.permission_overwrites || []) as Array<any>
  let perms = base
  const everyone = overwrites.find((o) => o.id === guildId)
  if (everyone) { perms &= ~BigInt(everyone.deny); perms |= BigInt(everyone.allow) }
  let allow = 0n, deny = 0n
  for (const ow of overwrites) {
    if (ow.type === 0 && ow.id !== guildId && memberRoles.includes(ow.id)) {
      allow |= BigInt(ow.allow); deny |= BigInt(ow.deny)
    }
  }
  perms &= ~deny; perms |= allow
  const mine = overwrites.find((o) => o.type === 1 && o.id === discordUserId)
  if (mine) { perms &= ~BigInt(mine.deny); perms |= BigInt(mine.allow) }
  return (perms & VIEW_CHANNEL) === VIEW_CHANNEL
}

export async function canSeeRecruiting(discordUserId: string, memberRoles: string[]): Promise<boolean> {
  const gate = await recruitingGate()
  if (!gate) return false
  return canSeeWithGate(gate, discordUserId, memberRoles)
}

export async function _unusedCanSeeRecruiting(discordUserId: string, memberRoles: string[]): Promise<boolean> {
  const guildId = Deno.env.get('AGAPE_GUILD_ID') || '952961396121931838'
  const [channels, roles] = await Promise.all([
    discordFetch(`/guilds/${guildId}/channels`, { method: 'GET' }),
    discordFetch(`/guilds/${guildId}/roles`, { method: 'GET' }),
  ])
  const wantedId = Deno.env.get('RECRUITING_CHANNEL_ID')
  const named = (rx: RegExp) => channels.find((c: any) => rx.test(String(c.name || '')) && c.type !== 4)
  const channel = wantedId
    ? channels.find((c: any) => String(c.id) === wantedId)
    : (named(/recruit.*society|society.*recruit/i) || named(/recruit/i))
  if (!channel) return false

  const roleById = new Map(roles.map((r: any) => [r.id, BigInt(r.permissions)]))
  let base = (roleById.get(guildId) as bigint) ?? 0n
  for (const rid of memberRoles) base |= (roleById.get(rid) as bigint) ?? 0n
  if (base & ADMINISTRATOR) return true

  const overwrites = (channel.permission_overwrites || []) as Array<any>
  let perms = base
  const everyone = overwrites.find((o) => o.id === guildId)
  if (everyone) { perms &= ~BigInt(everyone.deny); perms |= BigInt(everyone.allow) }
  let allow = 0n, deny = 0n
  for (const ow of overwrites) {
    if (ow.type === 0 && ow.id !== guildId && memberRoles.includes(ow.id)) {
      allow |= BigInt(ow.allow); deny |= BigInt(ow.deny)
    }
  }
  perms &= ~deny; perms |= allow
  const mine = overwrites.find((o) => o.type === 1 && o.id === discordUserId)
  if (mine) { perms &= ~BigInt(mine.deny); perms |= BigInt(mine.allow) }
  return (perms & VIEW_CHANNEL) === VIEW_CHANNEL
}

// ---- house-tour polls -----------------------------------------------------

// Two rows of five buttons is the ceiling worth reading.
export const TOUR_MAX_SLOTS = 10

export interface TourSlot { start: string; label: string; emoji?: string }

// Test records never reach the members channel — the house shouldn't get
// pinged about a pipeline test.
export function isTestApplicant(applicantId: string): boolean {
  return /^(e2e-|test-)/i.test(applicantId)
}

/* Where scheduling asks (screener schedulers, tour polls) reach the house.
   recruit_settings.society_scheduling_posts (default ON) routes them to
   #recruiting-society — deliberately narrower than the held
   RECRUITING_SOCIETY_POSTS env switch, which still gates notes, recordings,
   and everything else. Null = keep the ask out of the members channel. */
// deno-lint-ignore no-explicit-any
export async function schedulingSocietyChannel(db: any, applicantId: string): Promise<string | null> {
  if (isTestApplicant(applicantId)) return null
  try {
    const { data } = await db.from('recruit_settings')
      .select('value').eq('key', 'society_scheduling_posts').maybeSingle()
    if (data?.value === false) return null
  } catch { /* default on */ }
  return SOCIETY_CHANNEL_ID
}

/* The poll message: one button per slot, count in the label. A tap toggles
   your vote (handled in recruit-discord, custom_id "tourvote|…") and the
   handler re-renders this same payload with fresh counts — no reactions, no
   seeding, nothing to hunt in an emoji picker. Exported so the interaction
   handler and the poster render identically. */
export function buildTourPollPayload(input: {
  firstName: string; applicantId: string; slots: TourSlot[]
  offHours: boolean; threshold: number
  counts?: Map<string, number>
}): Record<string, unknown> {
  const description =
    `🏠 **House tour poll — ${input.firstName}** sent ${input.slots.length === 1 ? 'a time' : 'times'} for a visit.\n\n` +
    (input.offHours ? `⚠️ None of their windows fit Tue–Thu 5–7pm — these are their raw times; confirming may need a human call.\n\n` : '') +
    `Tap every slot you can make (tap again to back out) — the visit confirms automatically once **more than ${input.threshold}** housemates are in on one.\n\n` +
    `See their [application](${appLink(input.applicantId)}).`
  const components: Array<Record<string, unknown>> = []
  let row: Array<Record<string, unknown>> = []
  for (const s of input.slots.slice(0, TOUR_MAX_SLOTS)) {
    const n = input.counts?.get(s.start) || 0
    row.push({
      type: 2, style: n > 0 ? 1 : 2,
      label: `${s.label}${n ? ` · ${n} in` : ''}`,
      custom_id: `tourvote|${input.applicantId}|${Date.parse(s.start)}`,
    })
    if (row.length === 5) { components.push({ type: 1, components: row }); row = [] }
  }
  if (row.length) components.push({ type: 1, components: row })
  return { embeds: [{ description, color: 0x1abc9c }], components }
}

// Quiet single-message edit (no audit line) — the vote handler re-renders
// the poll after every tap, and one audit row per tap would drown the trail.
export async function editChannelMessage(
  channelId: string, messageId: string, payload: Record<string, unknown>,
): Promise<void> {
  await discordFetch(`/channels/${channelId}/messages/${messageId}`, {
    method: 'PATCH', body: JSON.stringify(payload),
  })
}

// Post (or refresh) the tour poll. Returns the message.
export async function postTourPoll(input: {
  firstName: string; applicantId: string; slots: TourSlot[]
  offHours: boolean; threshold: number
  counts?: Map<string, number>
  channelId?: string
  existing?: { channelId: string; messageId: string } | null
}): Promise<any> {
  const payload = buildTourPollPayload(input)
  const message = await postOrPatch(
    input.existing?.channelId || input.channelId || NOTES_CHANNEL_ID,
    input.existing?.messageId || null, payload,
  )
  const channelId = message.channel_id || input.existing?.channelId || input.channelId || NOTES_CHANNEL_ID
  await auditMirror('House tour poll', `${input.firstName} — ${input.slots.length} slot(s)`, { channelId })
  return message
}

// Close a confirmed poll in place: buttons gone, the message becomes the
// announcement.
export async function editTourConfirmed(
  channelId: string, messageId: string,
  firstName: string, applicantId: string, when: string, count: number,
): Promise<void> {
  try {
    await discordFetch(`/channels/${channelId}/messages/${messageId}`, {
      method: 'PATCH',
      body: JSON.stringify({
        embeds: [{
          description: `✅ **${firstName}'s house tour is on — ${when}** (${count} housemates in). They've been emailed the address and details. [Application](${appLink(applicantId)})`,
          color: 0x2ecc71,
        }],
        components: [],
      }),
    })
  } catch (err) {
    console.warn(`[discord] tour confirm edit failed: ${(err as Error).message}`)
  }
}

// One channel nudge for a post nobody claimed within 96h.
// Plain embed post to any channel (new-application pings etc.).
export async function postChannelEmbed(
  channelId: string, description: string, color = 0x378add, label = 'Automated post',
  links: Array<{ label: string; url: string }> = [],
): Promise<any> {
  const components = links.length
    ? [{ type: 1, components: links.slice(0, 5).map((l) => ({ type: 2, style: 5, label: l.label, url: l.url })) }]
    : []
  const msg = await discordFetch(`/channels/${channelId}/messages`, {
    method: 'POST',
    body: JSON.stringify({ embeds: [{ description, color }], components }),
  })
  await auditMirror(label, description.split('\n')[0], { channelId })
  return msg
}

export async function notifyStuck(channelId: string, messageId: string, firstName: string): Promise<void> {
  const guildId = Deno.env.get('AGAPE_GUILD_ID') || '952961396121931838'
  await postResilient(channelId, {
    content: `⏰ **${firstName}**'s Agape intro call still needs a screener after 4 days — anyone free? https://discord.com/channels/${guildId}/${channelId}/${messageId}`,
  }, `stuck nudge (${firstName})`)
}
