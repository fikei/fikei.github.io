// _shared/discord.ts
// Discord REST helpers for the screening-claim flow: post/edit the claimable
// message in #recruiting-interviews, DM the claimer, nudge stuck posts.
// Used by recruit-gmail, recruit-availability, and recruit-discord.

// deno-lint-ignore-file no-explicit-any

import { TZ } from './recruit-schedule.ts'

const DISCORD_API = 'https://discord.com/api/v10'
// #recruiting-interviews in the Agape guild (952961396121931838)
export const CLAIMS_CHANNEL_ID = Deno.env.get('SCREENING_CLAIMS_CHANNEL_ID') || '1529576830514762029'

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
  windows: Array<{ date: string; start: string; end: string }>
  platform: { kind: string; handle?: string } | null
  timezoneNote: string | null
  needsHuman: boolean
}

function appLink(applicantId: string): string {
  return `https://ctrl.rodeo/applications/?id=${encodeURIComponent(applicantId)}`
}

function buildMessage(input: ClaimPostInput, slots: Slot[]): Record<string, unknown> {
  const why = (input.whyLine || '').trim().replace(/\s+/g, ' ').slice(0, 140)
  const manual = input.needsHuman || !slots.length

  let description = why ? `_${why}_\n\n` : ''
  if (manual) {
    description += `Couldn't extract concrete times from their reply — read their thread and coordinate by email.\n\n[Open in the app](${appLink(input.applicantId)})`
  } else {
    description += `Offered times for a screening call — tap one to claim it.`
  }
  const warnings: string[] = []
  if (input.timezoneNote) warnings.push(`⚠️ ${input.timezoneNote}`)
  if (input.platform?.kind) {
    const handle = input.platform.handle ? ` (@${input.platform.handle})` : ''
    warnings.push(`⚠️ Asked for ${input.platform.kind}${handle} — default is Meet; claimer can DM them about it.`)
  }
  if (warnings.length) description += `\n\n${warnings.join('\n')}`
  if (!manual) description += `\n\n_Tap a time to claim the call — you'll both get a calendar invite._`

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
      title: `${input.firstName} — screening call`,
      description,
      color: manual ? 0xe67e22 : 0x3498db,
    }],
    components,
  }
}

// Post (or edit, per the one-open-post-per-applicant rule) the claim message.
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

  let message: any = null
  if (existing && existing.status !== 'expired') {
    try {
      message = await discordFetch(`/channels/${existing.discord_channel_id}/messages/${existing.discord_message_id}`, {
        method: 'PATCH', body: JSON.stringify(payload),
      })
    } catch (err) {
      if ((err as any).status !== 404) throw err
      // message was deleted in Discord — fall through to a fresh post
    }
  }
  if (!message) {
    message = await discordFetch(`/channels/${CLAIMS_CHANNEL_ID}/messages`, {
      method: 'POST', body: JSON.stringify(payload),
    })
  }

  const { data: row, error } = await db.from('recruit_claim_posts').upsert({
    applicant_id: input.applicantId,
    discord_message_id: message.id,
    discord_channel_id: message.channel_id || CLAIMS_CHANNEL_ID,
    slots, platform: input.platform, timezone_note: input.timezoneNote,
    needs_human: input.needsHuman, status,
    posted_at: existing?.posted_at || new Date().toISOString(),
    reminded_at: null,
    updated_at: new Date().toISOString(),
  }).select().single()
  if (error) throw new Error(`claim post upsert failed: ${error.message}`)
  console.log(`[discord] claim post ${existing ? 'updated' : 'created'} for ${input.applicantId} (${slots.length} slots, ${status})`)
  return row
}

// Close a claimed post: strip buttons, green interview announcement.
export async function editClaimMessageClaimed(
  channelId: string, messageId: string, claimerDiscordId: string,
  applicantName: string, applicantId: string, when: string,
): Promise<void> {
  await discordFetch(`/channels/${channelId}/messages/${messageId}`, {
    method: 'PATCH',
    body: JSON.stringify({
      embeds: [{
        description: `✅ <@${claimerDiscordId}> will be interviewing **${applicantName}** on ${when} — [see the candidate background here](${appLink(applicantId)}).`,
        color: 0x2ecc71,
      }],
      components: [],
    }),
  })
}

// Mark a claimed post that hit an error downstream (calendar etc.).
export async function editClaimMessageFailed(
  channelId: string, messageId: string, claimerDiscordId: string,
  applicantId: string, when: string,
): Promise<void> {
  await discordFetch(`/channels/${channelId}/messages/${messageId}`, {
    method: 'PATCH',
    body: JSON.stringify({
      embeds: [{
        description: `⚠️ <@${claimerDiscordId}> claimed this interview (${when}) but the calendar invite failed — [book manually in the app](${appLink(applicantId)}).`,
        color: 0xe74c3c,
      }],
      components: [],
    }),
  })
}

export async function dmUser(discordUserId: string, content: string): Promise<void> {
  const channel = await discordFetch('/users/@me/channels', {
    method: 'POST', body: JSON.stringify({ recipient_id: discordUserId }),
  })
  await discordFetch(`/channels/${channel.id}/messages`, {
    method: 'POST', body: JSON.stringify({ content }),
  })
}

// One channel nudge for a post nobody claimed within 96h.
export async function notifyStuck(channelId: string, messageId: string, firstName: string): Promise<void> {
  const guildId = Deno.env.get('AGAPE_GUILD_ID') || '952961396121931838'
  await discordFetch(`/channels/${channelId}/messages`, {
    method: 'POST',
    body: JSON.stringify({
      content: `⏰ **${firstName}**'s screening call has been unclaimed for 4 days — anyone free? https://discord.com/channels/${guildId}/${channelId}/${messageId}`,
    }),
  })
}
