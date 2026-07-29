// _shared/discord.ts
// Discord REST helpers for the recruiting automations: claim posts, notes,
// pings, DMs. Used by recruit-gmail, recruit-availability, recruit-discord.
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
// #recruiting-society — the members channel (pings, notes, recordings)
export const NOTES_CHANNEL_ID = Deno.env.get('SCREENING_NOTES_CHANNEL_ID') || '1503490895469609211'

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

export interface ClaimPostInput {
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
export function buildMessage(input: ClaimPostInput, slots: Slot[]): Record<string, unknown> {
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
      `**${input.firstName}** replied about scheduling, but no concrete times could be read.\n\n` +
      considerationsBlock +
      `See ${poss} [application](${appLink(input.applicantId)}) — read the thread and coordinate by email.`
  } else {
    description =
      `Can someone take this Intro Call with **${input.firstName}**?\n\n` +
      considerationsBlock +
      `See ${poss} [application](${appLink(input.applicantId)}).\n\n` +
      `_Tap a time below to claim the call — you'll both receive an invite and be added to the email thread._`
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
export async function upsertClaimMessage(db: any, input: ClaimPostInput): Promise<any | null> {
  const { data: existing } = await db.from('recruit_claim_posts')
    .select('*').eq('applicant_id', input.applicantId).maybeSingle()
  if (existing?.status === 'claimed') {
    console.log(`[discord] claim post for ${input.applicantId} already claimed — skipping repost`)
    return null
  }

  const slots = input.needsHuman ? [] : deriveSlots(input.windows)
  const payload = buildMessage(input, slots)
  const status = (input.needsHuman || !slots.length) ? 'manual' : 'open'
  const live = existing && existing.status !== 'expired' ? existing : null

  const message = await postOrPatch(CLAIMS_CHANNEL_ID, live?.discord_message_id || null, payload)
  // Mirror copy is best-effort: missing channel perms must not kill the post.
  let mirror: any = null
  try {
    mirror = await postOrPatch(NOTES_CHANNEL_ID, live?.mirror_message_id || null, payload)
  } catch (err) {
    console.warn(`[discord] mirror post failed for ${input.applicantId}: ${(err as Error).message}`)
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
  if (error) throw new Error(`claim post upsert failed: ${error.message}`)
  console.log(`[discord] claim post ${existing ? 'updated' : 'created'} for ${input.applicantId} (${slots.length} slots, ${status}, mirror=${Boolean(mirror)})`)
  return row
}

// A claim post row's message targets: primary + mirror when present.
// deno-lint-ignore no-explicit-any
function postTargets(post: any): Array<{ channelId: string; messageId: string }> {
  const targets = [{ channelId: post.discord_channel_id, messageId: post.discord_message_id }]
  if (post.mirror_message_id && post.mirror_channel_id) {
    targets.push({ channelId: post.mirror_channel_id, messageId: post.mirror_message_id })
  }
  return targets
}

// deno-lint-ignore no-explicit-any
async function editClaimPostEverywhere(post: any, payload: Record<string, unknown>): Promise<void> {
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
export async function editClaimMessageClaimed(
  post: any, claimerDiscordId: string,
  applicantName: string, applicantId: string, when: string,
): Promise<void> {
  await editClaimPostEverywhere(post, {
    embeds: [{
      description: `✅ <@${claimerDiscordId}> will be interviewing **${applicantName}** on ${when} — [see the candidate background here](${appLink(applicantId)}).`,
      color: 0x2ecc71,
    }],
    components: [],
  })
}

// Mark a claimed post (both copies) that hit an error downstream.
// deno-lint-ignore no-explicit-any
export async function editClaimMessageFailed(
  post: any, claimerDiscordId: string,
  applicantId: string, when: string,
): Promise<void> {
  await editClaimPostEverywhere(post, {
    embeds: [{
      description: `⚠️ <@${claimerDiscordId}> claimed this interview (${when}) but the calendar invite failed — [book manually in the app](${appLink(applicantId)}).`,
      color: 0xe74c3c,
    }],
    components: [],
  })
}

/* DMs are audited as well: a claimer's confirmation is an automation the
   house should be able to see happened, without exposing the DM thread. */
export async function dmUser(discordUserId: string, content: string): Promise<void> {
  const channel = await discordFetch('/users/@me/channels', {
    method: 'POST', body: JSON.stringify({ recipient_id: discordUserId }),
  })
  await discordFetch(`/channels/${channel.id}/messages`, {
    method: 'POST', body: JSON.stringify({ content }),
  })
  await auditMirror('Direct message', content.split('\n')[0], { dmTo: discordUserId })
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
  const fallback = channelId === NOTES_CHANNEL_ID ? AUTOMATION_CHANNEL_ID : NOTES_CHANNEL_ID
  try {
    await discordFetch(`/channels/${channelId}/messages`, { method: 'POST', body: JSON.stringify(payload) })
    await auditMirror(label, summarize(payload), { channelId })
    return
  } catch (err) {
    console.warn(`[discord] ${label}: post to ${channelId} failed: ${(err as Error).message}`)
  }
  try {
    await discordFetch(`/channels/${fallback}/messages`, {
      method: 'POST',
      body: JSON.stringify({
        ...payload,
        content: `⚠️ Posted here because <#${channelId}> rejected it — check the bot's permissions there.${typeof payload.content === 'string' ? `\n${payload.content}` : ''}`,
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

// Post the recording + summary back to the claims channel after a call ends.
export async function postRecordingNote(
  firstName: string, applicantId: string, residentName: string,
  summary: string | null, shareToken: string | null,
): Promise<void> {
  const lines = [
    summary || '_No transcript captured (captions may have been off)._',
    '',
    shareToken ? `🎥 [Watch the recording](${watchLink(shareToken)})` : '🎥 Recording unavailable.',
    `📋 [Full profile](${appLink(applicantId)})`,
  ]
  await postResilient(NOTES_CHANNEL_ID, {
    embeds: [{
      title: `${firstName} × ${residentName} — Intro Call notes`,
      description: lines.join('\n').slice(0, 4000),
      color: 0x9b59b6,
    }],
  }, `intro-call notes (${firstName})`)
}

// Notes for a non-applicant meeting hosted by the shared account.
export async function postMeetingNote(
  title: string, summary: string | null, shareToken: string | null,
): Promise<void> {
  const lines = [
    summary || '_No transcript captured (captions may have been off)._',
    '',
    shareToken ? `🎥 [Watch the recording](${watchLink(shareToken)})` : '🎥 Recording unavailable.',
  ]
  await postResilient(NOTES_CHANNEL_ID, {
    embeds: [{ title: `${title} — meeting notes`, description: lines.join('\n').slice(0, 4000), color: 0x9b59b6 }],
  }, `meeting notes (${title})`)
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
  await auditMirror('Sign-in helper posted', 'Persistent phone sign-in message', { channelId })
  return await discordFetch(`/channels/${channelId}/messages`, {
    method: 'POST',
    body: JSON.stringify({
      embeds: [{
        description: '📱 **Applicant inbox — sign in from your phone**\n' +
          'Tap below for a one-time sign-in link. No password, no Discord OAuth dance — ' +
          'works in any browser. Links expire after 10 minutes.',
        color: 0x5865f2,
      }],
      components: [{
        type: 1,
        components: [{ type: 2, style: 1, label: 'Get sign-in link', custom_id: 'signin' }],
      }],
    }),
  })
}

// One channel nudge for a post nobody claimed within 96h.
// Plain embed post to any channel (new-application pings etc.).
export async function postChannelEmbed(channelId: string, description: string, color = 0x378add, label = 'Automated post'): Promise<any> {
  const msg = await discordFetch(`/channels/${channelId}/messages`, {
    method: 'POST',
    body: JSON.stringify({ embeds: [{ description, color }] }),
  })
  await auditMirror(label, description.split('\n')[0], { channelId })
  return msg
}

export async function notifyStuck(channelId: string, messageId: string, firstName: string): Promise<void> {
  const guildId = Deno.env.get('AGAPE_GUILD_ID') || '952961396121931838'
  await postResilient(channelId, {
    content: `⏰ **${firstName}**'s Agape Intro Call has been unclaimed for 4 days — anyone free? https://discord.com/channels/${guildId}/${channelId}/${messageId}`,
  }, `stuck nudge (${firstName})`)
}
