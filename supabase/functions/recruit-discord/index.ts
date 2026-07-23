// Supabase Edge Function: recruit-discord
// Discord interactions endpoint for the screening-claim flow (verify_jwt=false
// in config.toml — Discord authenticates with an Ed25519 signature, not a JWT).
//
// PING (type 1)              → PONG
// Button click (type 3)      → custom_id "claim|<applicantId>|<startEpochMs>"
//   1. resolve the tapper via user_discord_membership (must be recruiting member)
//   2. atomic first-write-wins claim on recruit_claim_posts (status open → claimed)
//   3. ACK within Discord's 3s deadline (DEFERRED_UPDATE_MESSAGE)
//   4. background: GCal event + Meet via scheduleScreening, edit the post,
//      DM the claimer, email the applicant a short confirmation.
//
// The app public key is fetched from GET /applications/@me with the bot token
// (env DISCORD_PUBLIC_KEY overrides), so no extra secret is needed.

const VERSION = '1.8.1'
console.log(`[recruit-discord] v${VERSION} — screening-claim interactions + DM reminders`)

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { scheduleScreening, sendIntroEmail, sharedAccessToken } from '../_shared/recruit-schedule.ts'
import { editClaimMessageClaimed, editClaimMessageFailed, dmUser, slotLabel, slotWhen } from '../_shared/discord.ts'

declare const EdgeRuntime: { waitUntil(p: Promise<unknown>): void } | undefined

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } })

function db() {
  return createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
}

// ---- signature verification ----

let cachedPublicKey: string | null = null

async function publicKeyHex(): Promise<string> {
  if (cachedPublicKey) return cachedPublicKey
  const env = Deno.env.get('DISCORD_PUBLIC_KEY')
  if (env) return (cachedPublicKey = env)
  const resp = await fetch('https://discord.com/api/v10/applications/@me', {
    headers: { Authorization: `Bot ${Deno.env.get('DISCORD_BOT_TOKEN')}` },
  })
  const app = await resp.json()
  if (!resp.ok || !app.verify_key) throw new Error(`Could not fetch app verify_key: ${JSON.stringify(app).slice(0, 150)}`)
  return (cachedPublicKey = app.verify_key)
}

function hexToBytes(hex: string): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(hex.length / 2)
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16)
  return out
}

async function verifySignature(req: Request, body: string): Promise<boolean> {
  const signature = req.headers.get('X-Signature-Ed25519')
  const timestamp = req.headers.get('X-Signature-Timestamp')
  if (!signature || !timestamp) return false
  const keyBytes = hexToBytes(await publicKeyHex())
  const message = new TextEncoder().encode(timestamp + body)
  const sigBytes = hexToBytes(signature)
  try {
    const key = await crypto.subtle.importKey('raw', keyBytes, 'Ed25519', false, ['verify'])
    return await crypto.subtle.verify('Ed25519', key, sigBytes, message)
  } catch {
    // runtime without WebCrypto Ed25519 — tweetnacl fallback (CJS: exports on default)
    // deno-lint-ignore no-explicit-any
    const mod: any = await import('https://esm.sh/tweetnacl@1.0.3')
    const nacl = mod.default ?? mod
    return nacl.sign.detached.verify(message, sigBytes, keyBytes)
  }
}

// ---- interaction responses ----

const PONG = { type: 1 }
const DEFERRED_UPDATE = { type: 6 }
const ephemeral = (content: string) => ({ type: 4, data: { content, flags: 64 } })

// ---- claim background work (runs after the 3s ACK) ----

async function finishClaim(client: ReturnType<typeof db>, opts: {
  claimPost: Record<string, any>
  applicantId: string
  startsAt: Date
  label: string
  userId: string
  discordUserId: string
  discordUsername: string
}): Promise<void> {
  const { claimPost, applicantId, startsAt, label } = opts
  try {
    const { data: rp } = await client.from('recruit_profiles').select('display_name, group_email').eq('user_id', opts.userId).maybeSingle()
    const housemateName = rp?.display_name || opts.discordUsername || 'an Agape housemate'
    const { data: authUser, error: authErr } = await client.auth.admin.getUserById(opts.userId)
    // Google Group address preferred — it's the email residents actually read.
    const housemateEmail = (rp?.group_email || authUser?.user?.email || '').toLowerCase().trim()
    if (authErr || !housemateEmail.includes('@')) throw new Error('Could not resolve your account email')

    const { screening, meetLink, applicant } = await scheduleScreening(client, {
      applicantId, startsAt, housemateUserId: opts.userId, housemateName, housemateEmail,
    })

    const applicantName = `${applicant.first_name} ${applicant.last_name || ''}`.trim()
    await editClaimMessageClaimed(claimPost, opts.discordUserId, applicantName, applicantId, slotWhen(startsAt))

    const platform = claimPost.platform as { kind?: string; handle?: string } | null
    const platformLine = platform?.kind
      ? `\nHeads up: they asked for ${platform.kind}${platform.handle ? ` (@${platform.handle})` : ''} — default is the Meet link, but feel free to DM them about it.`
      : ''
    await dmUser(opts.discordUserId,
      `✅ You claimed **${applicantName}**'s Agape Intro Call — ${slotWhen(startsAt)}.\n` +
      `Calendar invites are out to you both. Meet: ${meetLink || '(see calendar invite)'}${platformLine}`)

    try {
      await sendIntroEmail(client, applicant, housemateName, housemateEmail, startsAt, meetLink)
    } catch (err) {
      console.warn(`[recruit-discord] intro email failed for ${applicantId}: ${(err as Error).message}`)
    }
    console.log(`[recruit-discord] claim complete: ${applicantId} × ${housemateName} @ ${startsAt.toISOString()} (screening ${screening.id})`)
  } catch (err) {
    // Never reopen the post (avoids double-booking) — flag it and tell the claimer.
    console.error(`[recruit-discord] claim finish failed for ${applicantId}: ${(err as Error).message}`)
    try {
      await editClaimMessageFailed(claimPost, opts.discordUserId, applicantId, slotWhen(startsAt))
    } catch { /* best effort */ }
    try {
      await dmUser(opts.discordUserId,
        `⚠️ You claimed the call with this applicant (${label}), but scheduling hit an error: ${(err as Error).message.slice(0, 200)}\n` +
        `Please book it manually in the app: https://ctrl.rodeo/applications/?a=${encodeURIComponent(applicantId)}`)
    } catch { /* best effort */ }
  }
}

async function handleClaim(interaction: Record<string, any>): Promise<Response> {
  const customId = String(interaction.data?.custom_id || '')
  const [action, applicantId, startMsRaw] = customId.split('|')
  if (action !== 'claim' || !applicantId) return json(ephemeral('Unsupported button.'))
  const startsAt = new Date(Number(startMsRaw))
  if (isNaN(startsAt.getTime())) return json(ephemeral('Bad slot — try another.'))

  const discordUserId = interaction.member?.user?.id || interaction.user?.id
  const discordUsername = interaction.member?.user?.username || interaction.user?.username || ''
  if (!discordUserId) return json(ephemeral('Could not identify you.'))

  const client = db()
  const { data: membership } = await client.from('user_discord_membership')
    .select('user_id, is_recruiting_member, discord_username')
    .eq('discord_user_id', discordUserId).maybeSingle()
  if (!membership?.user_id || !membership.is_recruiting_member) {
    return json(ephemeral('Sign in at https://ctrl.rodeo/applications with Discord first, then tap again.'))
  }

  if (startsAt < new Date()) return json(ephemeral('That time has already passed — pick another or use "Other time…".'))

  const label = slotLabel(startsAt)
  // First-write-wins: only an 'open' row can transition to 'claimed'.
  const { data: claimed } = await client.from('recruit_claim_posts')
    .update({
      status: 'claimed',
      claimed_by_user_id: membership.user_id,
      claimed_slot: { start: startsAt.toISOString(), label },
      claimed_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('applicant_id', applicantId).eq('status', 'open')
    .select().maybeSingle()
  if (!claimed) return json(ephemeral('Already claimed — thanks for the quick trigger finger though!'))

  const work = finishClaim(client, {
    claimPost: claimed, applicantId, startsAt, label,
    userId: membership.user_id, discordUserId,
    discordUsername: membership.discord_username || discordUsername,
  })
  if (typeof EdgeRuntime !== 'undefined' && EdgeRuntime?.waitUntil) EdgeRuntime.waitUntil(work)
  else work.catch(() => { /* logged inside */ })

  return json(DEFERRED_UPDATE)
}

// DM each claimer ~an hour before their interview. Invoked by pg_cron every
// 15 min via POST /recruit-discord/remind with X-Cron-Secret (migration 122).
async function remindUpcoming(client: ReturnType<typeof db>): Promise<number> {
  const now = Date.now()
  const { data: upcoming } = await client.from('recruit_screenings')
    .select('id, applicant_id, housemate_user_id, housemate_email, starts_at, meet_link, gcal_event_id')
    .eq('status', 'scheduled').is('reminder_sent_at', null)
    .gte('starts_at', new Date(now).toISOString())
    .lte('starts_at', new Date(now + 65 * 60000).toISOString())
  if (!upcoming?.length) return 0
  // One calendar token per tick; if Gmail is disconnected we fail open and
  // remind anyway — a stray reminder beats a silent no-show.
  let gcalToken: string | null = null
  try { gcalToken = await sharedAccessToken(client) } catch { /* fail open */ }
  let sent = 0
  for (const s of (upcoming || [])) {
    try {
      // Liveness check: the calendar is the source of truth. Cancelled event,
      // or the resident declined / was removed → mark cancelled, stay quiet.
      if (gcalToken && s.gcal_event_id) {
        try {
          const resp = await fetch(`https://www.googleapis.com/calendar/v3/calendars/primary/events/${encodeURIComponent(s.gcal_event_id)}`, {
            headers: { Authorization: `Bearer ${gcalToken}` },
          })
          let dead = resp.status === 404 || resp.status === 410
          if (resp.ok) {
            const ev = await resp.json()
            const myEmail = (s.housemate_email || '').toLowerCase()
            // deno-lint-ignore no-explicit-any
            const me = (ev.attendees || []).find((a: any) => (a.email || '').toLowerCase() === myEmail)
            // Missing-attendee only signals a release when we actually know the
            // resident's email — calendar-pickup rows have none (housemate_email
            // null) and must not be treated as declined (the Katie 10am bug).
            dead = ev.status === 'cancelled'
              || me?.responseStatus === 'declined'
              || (Boolean(myEmail) && !me && (ev.attendees || []).length > 0)
          }
          if (dead) {
            await client.from('recruit_screenings')
              .update({ status: 'cancelled', reminder_sent_at: new Date().toISOString() }).eq('id', s.id)
            console.log(`[recruit-discord] screening ${s.id} cancelled/declined on calendar — no reminder`)
            continue
          }
        } catch (err) {
          console.warn(`[recruit-discord] gcal liveness check failed for ${s.id}: ${(err as Error).message}`)
        }
      }
      const [{ data: applicant }, { data: dm }] = await Promise.all([
        client.from('recruit_applicants').select('first_name, last_name').eq('id', s.applicant_id).maybeSingle(),
        client.from('user_discord_membership').select('discord_user_id').eq('user_id', s.housemate_user_id).maybeSingle(),
      ])
      if (dm?.discord_user_id && applicant) {
        const name = `${applicant.first_name} ${applicant.last_name || ''}`.trim()
        await dmUser(dm.discord_user_id,
          `⏰ Coming up: you're interviewing **${name}** at ${slotWhen(new Date(s.starts_at))} PT.\n` +
          `Meet: ${s.meet_link || '(see calendar invite)'}\n` +
          `Background: https://ctrl.rodeo/applications/?a=${encodeURIComponent(s.applicant_id)}`)
        sent++
      }
      // Stamp even without a Discord id so we don't retry forever.
      await client.from('recruit_screenings').update({ reminder_sent_at: new Date().toISOString() }).eq('id', s.id)
    } catch (err) {
      console.warn(`[recruit-discord] reminder failed for screening ${s.id}: ${(err as Error).message}`)
    }
  }
  return sent
}

// Harvest finished Recall recordings: after a call ends, pull the transcript,
// summarize with Haiku, post notes + recording link to #recruiting-interviews,
// and store the summary on the screening row (the app reads it from there).
// Runs on the same 15-min cron tick as reminders; inert without RECALL_API_KEY.
// Every scheduled screening with a Meet link gets a recording bot — including
// calls created by hand on the shared calendar (picked up by scan) and calls
// booked before RECALL_API_KEY existed. Runs on the 15-min tick.
async function scheduleMissingBots(client: ReturnType<typeof db>): Promise<number> {
  const { recallEnabled, createRecordingBot } = await import('../_shared/recall.ts')
  if (!recallEnabled()) return 0
  const { data: rows } = await client.from('recruit_screenings')
    .select('id, meet_link, starts_at')
    .eq('status', 'scheduled').is('recall_bot_id', null)
    .not('meet_link', 'is', null)
    .gt('starts_at', new Date().toISOString()).limit(10)
  let created = 0
  for (const s of (rows || [])) {
    try {
      const botId = await createRecordingBot(s.meet_link, s.starts_at)
      await client.from('recruit_screenings')
        .update({ recall_bot_id: botId, recall_status: 'scheduled' }).eq('id', s.id)
      created++
      console.log(`[recall] backfilled bot ${botId} for screening ${s.id} (${s.starts_at})`)
    } catch (err) {
      console.warn(`[recall] backfill failed for screening ${s.id}: ${(err as Error).message}`)
    }
  }
  return created
}

// Invite the bot's Google account to an existing event (idempotent) so a
// signed-in bot joins without knocking — covers manually created events.
// deno-lint-ignore-next-line no-explicit-any
async function inviteBotToEvent(token: string, ev: any): Promise<void> {
  const botEmail = (Deno.env.get('RECALL_BOT_EMAIL') || '').toLowerCase()
  if (!botEmail.includes('@')) return
  // deno-lint-ignore no-explicit-any
  const attendees = (ev.attendees || []) as any[]
  if (attendees.some((a) => (a.email || '').toLowerCase() === botEmail)) return
  await fetch(`https://www.googleapis.com/calendar/v3/calendars/primary/events/${encodeURIComponent(ev.id)}?sendUpdates=none`, {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ attendees: [...attendees, { email: botEmail }] }),
  })
}

// Default: record EVERY Meet hosted by the shared account. Sweep the shared
// calendar for upcoming Meet-bearing events it organizes; applicant calls are
// covered via recruit_screenings, anything else lands in recruit_recorded_events.
async function scheduleCalendarBots(client: ReturnType<typeof db>): Promise<number> {
  const { recallEnabled, createRecordingBot } = await import('../_shared/recall.ts')
  if (!recallEnabled()) return 0
  let token: string
  try { token = await sharedAccessToken(client) } catch { return 0 }
  const now = new Date()
  const timeMax = new Date(now.getTime() + 7 * 24 * 3600 * 1000)
  const resp = await fetch(
    `https://www.googleapis.com/calendar/v3/calendars/primary/events?singleEvents=true&orderBy=startTime&maxResults=50&timeMin=${encodeURIComponent(now.toISOString())}&timeMax=${encodeURIComponent(timeMax.toISOString())}`,
    { headers: { Authorization: `Bearer ${token}` } },
  )
  if (!resp.ok) { console.warn(`[recall] calendar sweep failed: ${resp.status}`); return 0 }
  const events = (await resp.json()).items || []
  // deno-lint-ignore no-explicit-any
  const meetOf = (ev: any) => ev.hangoutLink || ev.conferenceData?.entryPoints?.find((e: any) => e.entryPointType === 'video')?.uri || null
  // deno-lint-ignore no-explicit-any
  const candidates = events.filter((ev: any) => ev.status !== 'cancelled' && ev.organizer?.self && meetOf(ev) && ev.start?.dateTime)
  if (!candidates.length) return 0

  // deno-lint-ignore no-explicit-any
  const ids = candidates.map((ev: any) => ev.id)
  const [{ data: screenings }, { data: tracked }] = await Promise.all([
    client.from('recruit_screenings').select('gcal_event_id').in('gcal_event_id', ids),
    client.from('recruit_recorded_events').select('gcal_event_id').in('gcal_event_id', ids),
  ])
  // deno-lint-ignore no-explicit-any
  const known = new Set([...(screenings || []), ...(tracked || [])].map((r: any) => r.gcal_event_id))

  let created = 0
  for (const ev of candidates) {
    // Idempotently keep the bot account invited on every upcoming Meet,
    // including events whose bot already exists.
    try { await inviteBotToEvent(token, ev) } catch (err) {
      console.warn(`[recall] bot invite failed for ${ev.id}: ${(err as Error).message}`)
    }
    if (known.has(ev.id)) continue
    try {
      const meet = meetOf(ev)
      const botId = await createRecordingBot(meet, ev.start.dateTime)
      await client.from('recruit_recorded_events').upsert({
        gcal_event_id: ev.id, title: (ev.summary || 'Agape call').slice(0, 200),
        starts_at: ev.start.dateTime, ends_at: ev.end?.dateTime || null,
        meet_link: meet, recall_bot_id: botId, recall_status: 'scheduled',
      })
      created++
      console.log(`[recall] calendar bot ${botId} for "${ev.summary}" (${ev.start.dateTime})`)
    } catch (err) {
      console.warn(`[recall] calendar bot failed for ${ev.id}: ${(err as Error).message}`)
    }
  }
  return created
}

// Calls whose end time passed flip scheduled -> completed so the app stops
// showing them as upcoming (the Watch chip takes over once notes land).
async function completePastCalls(client: ReturnType<typeof db>): Promise<number> {
  const { data: rows } = await client.from('recruit_screenings')
    .update({ status: 'completed' })
    .eq('status', 'scheduled')
    .lt('ends_at', new Date(Date.now() - 30 * 60000).toISOString())
    .select('id')
  if (rows?.length) console.log(`[recruit-discord] ${rows.length} call(s) marked completed`)
  return rows?.length || 0
}

// Announce calls starting within the next tick window so housemates can
// join live. One post per call (live_posted_at stamp).
async function announceLiveCalls(client: ReturnType<typeof db>): Promise<number> {
  const { postLiveCall } = await import('../_shared/discord.ts')
  const now = Date.now()
  const from = new Date(now - 5 * 60000).toISOString()
  const to = new Date(now + 16 * 60000).toISOString()
  let posted = 0
  const { data: screenings } = await client.from('recruit_screenings')
    .select('id, applicant_id, housemate_name, starts_at, meet_link')
    .eq('status', 'scheduled').is('live_posted_at', null)
    .gte('starts_at', from).lte('starts_at', to)
  for (const s of (screenings || [])) {
    try {
      const { data: a } = await client.from('recruit_applicants').select('first_name, last_name').eq('id', s.applicant_id).maybeSingle()
      const name = `${a?.first_name || 'Applicant'} ${a?.last_name || ''}`.trim()
      await postLiveCall(`Agape Intro Call — ${name} × ${s.housemate_name || 'the house'}`, slotWhen(new Date(s.starts_at)), s.meet_link)
      await client.from('recruit_screenings').update({ live_posted_at: new Date().toISOString() }).eq('id', s.id)
      posted++
    } catch (err) {
      console.warn(`[live] announce failed for screening ${s.id}: ${(err as Error).message}`)
    }
  }
  const { data: meetings } = await client.from('recruit_recorded_events')
    .select('gcal_event_id, title, starts_at, meet_link')
    .is('live_posted_at', null)
    .gte('starts_at', from).lte('starts_at', to)
  for (const m of (meetings || [])) {
    try {
      await postLiveCall(m.title || 'Agape call', slotWhen(new Date(m.starts_at)), m.meet_link)
      await client.from('recruit_recorded_events').update({ live_posted_at: new Date().toISOString() }).eq('gcal_event_id', m.gcal_event_id)
      posted++
    } catch (err) {
      console.warn(`[live] announce failed for event ${m.gcal_event_id}: ${(err as Error).message}`)
    }
  }
  return posted
}

// Harvest finished non-applicant meeting recordings.
async function processMeetingRecordings(client: ReturnType<typeof db>): Promise<number> {
  const { recallEnabled, getBotResult, fetchTranscriptText, summarizeMeeting } = await import('../_shared/recall.ts')
  if (!recallEnabled()) return 0
  const { postMeetingNote } = await import('../_shared/discord.ts')
  const { data: rows } = await client.from('recruit_recorded_events')
    .select('gcal_event_id, title, recall_bot_id, ends_at')
    .not('recall_bot_id', 'is', null).is('recording_posted_at', null)
    .lt('ends_at', new Date(Date.now() - 5 * 60000).toISOString()).limit(5)
  let posted = 0
  for (const m of (rows || [])) {
    try {
      const bot = await getBotResult(m.recall_bot_id)
      if (!bot.done && !bot.failed) continue
      if (bot.failed) {
        await client.from('recruit_recorded_events')
          .update({ recall_status: 'failed', recording_posted_at: new Date().toISOString() }).eq('gcal_event_id', m.gcal_event_id)
        try { await postMeetingNote(m.title || 'Agape call', `⚠️ Recording failed (${bot.statusCode}) — no notes for this one.`, null) } catch { /* best effort */ }
        continue
      }
      let summary: string | null = null
      if (bot.transcriptUrl) {
        summary = await summarizeMeeting(await fetchTranscriptText(bot.transcriptUrl), m.title || 'Agape call')
      }
      await postMeetingNote(m.title || 'Agape call', summary, bot.videoUrl)
      await client.from('recruit_recorded_events').update({
        recall_status: 'done', recording_summary: summary, recording_posted_at: new Date().toISOString(),
      }).eq('gcal_event_id', m.gcal_event_id)
      posted++
    } catch (err) {
      console.warn(`[recall] meeting processing failed for ${m.gcal_event_id}: ${(err as Error).message}`)
    }
  }
  return posted
}

async function processRecordings(client: ReturnType<typeof db>): Promise<number> {
  const { recallEnabled, getBotResult, fetchTranscriptText, summarizeIntroCall } = await import('../_shared/recall.ts')
  if (!recallEnabled()) return 0
  const { postRecordingNote, postMeetingNote } = await import('../_shared/discord.ts')
  const { data: rows } = await client.from('recruit_screenings')
    .select('id, applicant_id, housemate_name, recall_bot_id, ends_at')
    .not('recall_bot_id', 'is', null).is('recording_posted_at', null)
    .lt('ends_at', new Date(Date.now() - 5 * 60000).toISOString())
    .limit(5)
  let posted = 0
  for (const s of (rows || [])) {
    try {
      const bot = await getBotResult(s.recall_bot_id)
      if (!bot.done && !bot.failed) continue // still recording or processing
      if (bot.failed) {
        await client.from('recruit_screenings')
          .update({ recall_status: 'failed', recording_posted_at: new Date().toISOString() }).eq('id', s.id)
        console.warn(`[recall] bot ${s.recall_bot_id} failed (${bot.statusCode}) for screening ${s.id}`)
        try {
          const { data: a } = await client.from('recruit_applicants').select('first_name').eq('id', s.applicant_id).maybeSingle()
          await postMeetingNote(`${a?.first_name || 'Applicant'}'s Intro Call`, `⚠️ Recording failed (${bot.statusCode}) — the claimer's own notes are all we have.`, null)
        } catch { /* best effort */ }
        continue
      }
      const { data: applicant } = await client.from('recruit_applicants')
        .select('first_name, last_name').eq('id', s.applicant_id).maybeSingle()
      const applicantName = `${applicant?.first_name || 'Applicant'} ${applicant?.last_name || ''}`.trim()
      let summary: string | null = null
      if (bot.transcriptUrl) {
        const transcript = await fetchTranscriptText(bot.transcriptUrl)
        summary = await summarizeIntroCall(transcript, applicantName, s.housemate_name || 'a resident')
      }
      await postRecordingNote(applicant?.first_name || 'Applicant', s.applicant_id, s.housemate_name || 'resident', summary, bot.videoUrl)
      await client.from('recruit_screenings').update({
        recall_status: 'done',
        recording_summary: summary,
        recording_posted_at: new Date().toISOString(),
      }).eq('id', s.id)
      posted++
      console.log(`[recall] notes posted for screening ${s.id}`)
    } catch (err) {
      console.warn(`[recall] processing failed for screening ${s.id}: ${(err as Error).message}`)
    }
  }
  return posted
}

serve(async (req) => {
  try {
    // Cron path: interview reminders (header auth, not Discord-signed).
    // Auth: X-Cron-Secret when CRON_SECRET is configured, else the one-time
    // nonce minted by the pg_cron tick (migration 123) — delete-on-use.
    if (new URL(req.url).pathname.endsWith('/remind')) {
      const client = db()
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
      const bots = await scheduleMissingBots(client) + await scheduleCalendarBots(client)
      const live = await announceLiveCalls(client)
      await completePastCalls(client)
      const sent = await remindUpcoming(client)
      const recorded = await processRecordings(client) + await processMeetingRecordings(client)
      console.log(`[recruit-discord] tick: ${bots} bot(s), ${live} live post(s), ${sent} reminder(s), ${recorded} recording(s)`)
      return json({ bots, live, reminded: sent, recorded })
    }

    const body = await req.text()
    if (!(await verifySignature(req, body))) {
      return json({ error: 'invalid request signature' }, 401)
    }
    const interaction = JSON.parse(body)
    if (interaction.type === 1) return json(PONG)
    if (interaction.type === 3) return await handleClaim(interaction)
    return json(ephemeral('Unsupported interaction.'))
  } catch (err) {
    console.error('[recruit-discord] error:', (err as Error).message)
    return json({ error: (err as Error).message }, 500)
  }
})
