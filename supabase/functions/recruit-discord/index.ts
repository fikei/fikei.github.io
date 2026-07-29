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

const VERSION = '1.11.0'
console.log(`[recruit-discord] v${VERSION} — screening claims + magic-link sign-in + unmatched-call link nudges`)

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { scheduleScreening, sendIntroEmail, sharedAccessToken } from '../_shared/recruit-schedule.ts'
import { editClaimMessageClaimed, editClaimMessageFailed, dmUser, slotLabel, slotWhen } from '../_shared/discord.ts'

declare const EdgeRuntime: { waitUntil(p: Promise<unknown>): void } | undefined

// CORS needed only by the browser-facing routes (/redeem, /signin-post);
// harmless on Discord-signed interaction responses.
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}
const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })

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
    // Shadow magic-link accounts have a synthetic email — invites would bounce.
    if (authErr || !housemateEmail.includes('@') || housemateEmail.endsWith('@signin.ctrl.rodeo')) {
      throw new Error('Could not resolve your real email — set your name/email in the app profile first')
    }

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

// ---- bot-issued magic-link sign-in ----
// The "Get sign-in link" button (posted via /signin-post) lives in a
// recruiting channel, so tapping it proves channel access; the link itself
// only mints a session — the app's discord-membership gate still runs the
// real channel-permission check afterwards.

const SIGNIN_TTL_MS = 10 * 60_000
const APP_URL = 'https://ctrl.rodeo/applications/'
// Shadow email for members who've never OAuth'd on desktop; deterministic so
// repeat sign-ins land on the same account.
const shadowEmail = (discordUserId: string) => `discord-${discordUserId}@signin.ctrl.rodeo`

async function sha256Hex(s: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s))
  return Array.from(new Uint8Array(digest)).map(b => b.toString(16).padStart(2, '0')).join('')
}

async function handleSigninButton(interaction: Record<string, any>): Promise<Response> {
  const discordUserId = interaction.member?.user?.id || interaction.user?.id
  const discordUsername = interaction.member?.user?.username || interaction.user?.username || null
  if (!discordUserId || !interaction.guild_id) return json(ephemeral('Could not identify you.'))

  const raw = crypto.randomUUID().replaceAll('-', '') + crypto.randomUUID().replaceAll('-', '')
  const client = db()
  const { error } = await client.from('recruit_signin_tokens').insert({
    token_hash: await sha256Hex(raw), discord_user_id: discordUserId, discord_username: discordUsername,
  })
  if (error) return json(ephemeral('Could not mint a link — try again in a minute.'))

  return json(ephemeral(
    `🔑 Your one-time sign-in link (10 min, single use):\n${APP_URL}?signin=${raw}\n` +
    `Opens the applicant inbox already signed in — any browser works.`,
  ))
}

// POST /redeem  { token } → { token_hash, email } for supabase-js verifyOtp.
// Unauthenticated by design: the token is the credential (single-use, 10-min).
async function handleRedeem(req: Request): Promise<Response> {
  const { token } = await req.json().catch(() => ({} as Record<string, unknown>))
  if (typeof token !== 'string' || token.length < 32) return json({ error: 'bad token' }, 400)
  const client = db()
  const { data: row } = await client.from('recruit_signin_tokens')
    .update({ used_at: new Date().toISOString() })
    .eq('token_hash', await sha256Hex(token)).is('used_at', null)
    .gte('created_at', new Date(Date.now() - SIGNIN_TTL_MS).toISOString())
    .select().maybeSingle()
  if (!row) return json({ error: 'Link expired or already used — get a fresh one from the Discord button.' }, 401)

  // Prefer the member's existing account (from a past desktop OAuth sign-in).
  const { data: membership } = await client.from('user_discord_membership')
    .select('user_id').eq('discord_user_id', row.discord_user_id).maybeSingle()

  let email: string | null = null
  if (membership?.user_id) {
    const { data: au } = await client.auth.admin.getUserById(membership.user_id)
    email = au?.user?.email || null
  }
  if (!email) {
    email = shadowEmail(row.discord_user_id)
    const { error: createErr } = await client.auth.admin.createUser({
      email, email_confirm: true,
      app_metadata: { discord_user_id: row.discord_user_id, discord_username: row.discord_username },
      user_metadata: { username: row.discord_username },
    })
    // "already registered" is fine — repeat shadow sign-in.
    if (createErr && !/already/i.test(createErr.message)) return json({ error: createErr.message }, 500)
  }

  const { data: link, error: linkErr } = await client.auth.admin.generateLink({ type: 'magiclink', email })
  if (linkErr || !link?.properties?.hashed_token) return json({ error: linkErr?.message || 'link generation failed' }, 500)
  return json({ token_hash: link.properties.hashed_token, email })
}

// POST /signin-post  (user JWT, recruiting member) → post the button message.
async function handleSigninPost(req: Request): Promise<Response> {
  const client = db()
  const token = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '')
  const { data: userData, error: userErr } = await client.auth.getUser(token)
  if (userErr || !userData?.user) return json({ error: 'Not authenticated' }, 401)
  const { data: membership } = await client.from('user_discord_membership')
    .select('is_recruiting_member').eq('user_id', userData.user.id).maybeSingle()
  if (!membership?.is_recruiting_member) return json({ error: 'Not a recruiting member' }, 403)

  const { postSigninMessage, NOTES_CHANNEL_ID } = await import('../_shared/discord.ts')
  const body = await req.json().catch(() => ({} as Record<string, unknown>))
  const channelId = typeof body.channelId === 'string' && body.channelId
    ? body.channelId
    : (Deno.env.get('RECRUITING_CHANNEL_ID') || NOTES_CHANNEL_ID)
  const message = await postSigninMessage(channelId)
  return json({ posted: true, channelId, messageId: message?.id || null })
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

// DM housemates on swept calls with an unrecognized external guest: the call
// got a recording bot but no applicant attachment, so someone should either
// link it or know it's house-internal. One DM per event (unmatched_notified_at).
async function notifyUnmatchedCalls(client: ReturnType<typeof db>): Promise<number> {
  const { dmUser } = await import('../_shared/discord.ts')
  const { SHARED_EMAIL } = await import('../_shared/recruit-schedule.ts')
  const { data: rows } = await client.from('recruit_recorded_events')
    .select('gcal_event_id, title, starts_at, meet_link')
    .is('applicant_id', null).is('unmatched_notified_at', null)
    .gt('starts_at', new Date().toISOString()).limit(10)
  if (!rows?.length) return 0

  let token: string
  try { token = await sharedAccessToken(client) } catch { return 0 }
  const botEmail = (Deno.env.get('RECALL_BOT_EMAIL') || '').toLowerCase()
  // Known internal addresses: profile group emails + login emails of members.
  const { data: profs } = await client.from('recruit_profiles').select('user_id, group_email')
  const { data: members } = await client.from('user_discord_membership').select('user_id, discord_user_id')
  const discordByUser = new Map((members || []).map(m => [m.user_id, m.discord_user_id]))
  const internal = new Map<string, string | null>() // email -> discord id (null = internal, not DM-able)
  internal.set(SHARED_EMAIL.toLowerCase(), null)
  if (botEmail) internal.set(botEmail, null)
  for (const p of (profs || [])) {
    if (p.group_email) internal.set(String(p.group_email).toLowerCase(), discordByUser.get(p.user_id) || null)
  }
  for (const m of (members || [])) {
    try {
      const { data: au } = await client.auth.admin.getUserById(m.user_id)
      const em = (au?.user?.email || '').toLowerCase()
      if (em.includes('@') && !em.endsWith('@signin.ctrl.rodeo')) internal.set(em, m.discord_user_id)
    } catch { /* best effort */ }
  }

  let notified = 0
  for (const r of (rows || [])) {
    try {
      const resp = await fetch(`https://www.googleapis.com/calendar/v3/calendars/primary/events/${encodeURIComponent(r.gcal_event_id)}`, {
        headers: { Authorization: `Bearer ${token}` },
      })
      if (!resp.ok) continue
      const ev = await resp.json()
      // deno-lint-ignore no-explicit-any
      const emails = ((ev.attendees || []) as any[]).map(a => String(a.email || '').toLowerCase()).filter(Boolean)
      const hasGuest = emails.some(e => !internal.has(e))
      if (!hasGuest) {
        // House-internal meeting — nothing to link, never notify.
        await client.from('recruit_recorded_events')
          .update({ unmatched_notified_at: new Date().toISOString() }).eq('gcal_event_id', r.gcal_event_id)
        continue
      }
      const housemateDiscordIds = [...new Set(emails.map(e => internal.get(e)).filter(Boolean))] as string[]
      for (const did of housemateDiscordIds.slice(0, 3)) {
        await dmUser(did,
          `🔗 Your call **${r.title || 'Agape call'}** (${slotWhen(new Date(r.starts_at))}) has a guest I can't match to an applicant.\n` +
          `It'll be recorded either way — if it's an applicant call, link it so notes land on their profile:\n` +
          `https://ctrl.rodeo/applications/?link=${encodeURIComponent(r.gcal_event_id)}`)
      }
      await client.from('recruit_recorded_events')
        .update({ unmatched_notified_at: new Date().toISOString() }).eq('gcal_event_id', r.gcal_event_id)
      if (housemateDiscordIds.length) notified++
    } catch (err) {
      console.warn(`[unmatched] notify failed for ${r.gcal_event_id}: ${(err as Error).message}`)
    }
  }
  return notified
}

// Backfill archive: recordings processed before the archive existed (or whose
// upload failed) get copied to storage while Recall still has the media.
// media_expired marks the permanently lost so we stop retrying.
async function archiveMissingRecordings(client: ReturnType<typeof db>): Promise<number> {
  const { recallEnabled, getBotResult, archiveVideoToStorage } = await import('../_shared/recall.ts')
  if (!recallEnabled()) return 0
  let archived = 0
  const sweep = async (table: string, idCol: string, pathPrefix: string, limit: number) => {
    const { data: rows } = await client.from(table)
      .select(`${idCol}, recall_bot_id`)
      .eq('recall_status', 'done').is('recording_path', null)
      .not('recall_bot_id', 'is', null).limit(limit)
    // deno-lint-ignore no-explicit-any
    for (const r of ((rows || []) as any[])) {
      try {
        const bot = await getBotResult(r.recall_bot_id)
        if (bot.videoUrl) {
          const path = await archiveVideoToStorage(bot.videoUrl, `${pathPrefix}/${r[idCol]}.mp4`)
          await client.from(table).update({ recording_path: path }).eq(idCol, r[idCol])
          archived++
          console.log(`[archive] backfilled ${table} ${r[idCol]}`)
        } else if (bot.statusCode === 'media_expired' || bot.done) {
          await client.from(table).update({ recall_status: 'media_expired' }).eq(idCol, r[idCol])
          console.warn(`[archive] ${table} ${r[idCol]} media gone (${bot.statusCode})`)
        }
      } catch (err) {
        console.warn(`[archive] backfill ${table} ${r[idCol]}: ${(err as Error).message}`)
      }
    }
  }
  await sweep('recruit_screenings', 'id', 'screenings', 2)
  await sweep('recruit_recorded_events', 'gcal_event_id', 'events', 1)
  return archived
}

// Calls whose end time passed flip scheduled -> completed so the app stops
// showing them as upcoming (the Watch chip takes over once notes land).
async function completePastCalls(client: ReturnType<typeof db>): Promise<number> {
  const { data: rows } = await client.from('recruit_screenings')
    .update({ status: 'completed' })
    .eq('status', 'scheduled')
    .lt('ends_at', new Date(Date.now() - 5 * 60000).toISOString())
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
      let recordingPath: string | null = null
      if (bot.videoUrl) {
        try {
          const { archiveVideoToStorage } = await import('../_shared/recall.ts')
          recordingPath = await archiveVideoToStorage(bot.videoUrl, `events/${m.gcal_event_id}.mp4`)
        } catch (err) { console.warn(`[archive] event ${m.gcal_event_id}: ${(err as Error).message}`) }
      }
      await client.from('recruit_recorded_events').update({
        recall_status: 'done', recording_summary: summary, recording_posted_at: new Date().toISOString(),
        recording_path: recordingPath,
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
      // Permanent copy — Recall purges media in ~7 days. Failure is fine:
      // recording_path stays null and the backfill sweep retries next tick.
      let recordingPath: string | null = null
      if (bot.videoUrl) {
        try {
          const { archiveVideoToStorage } = await import('../_shared/recall.ts')
          recordingPath = await archiveVideoToStorage(bot.videoUrl, `screenings/${s.id}.mp4`)
        } catch (err) { console.warn(`[archive] screening ${s.id}: ${(err as Error).message}`) }
      }
      await client.from('recruit_screenings').update({
        recall_status: 'done',
        recording_summary: summary,
        recording_posted_at: new Date().toISOString(),
        recording_path: recordingPath,
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
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
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
      const unmatched = await notifyUnmatchedCalls(client)
      if (unmatched) console.log(`[unmatched] ${unmatched} link-nudge DM(s) sent`)
      const live = await announceLiveCalls(client)
      await completePastCalls(client)
      const sent = await remindUpcoming(client)
      const recorded = await processRecordings(client) + await processMeetingRecordings(client)
      const archived = await archiveMissingRecordings(client)
      if (archived) console.log(`[archive] ${archived} recording(s) copied to storage`)
      console.log(`[recruit-discord] tick: ${bots} bot(s), ${live} live post(s), ${sent} reminder(s), ${recorded} recording(s)`)
      return json({ bots, live, reminded: sent, recorded })
    }

    const pathname = new URL(req.url).pathname
    if (pathname.endsWith('/redeem')) return await handleRedeem(req)
    if (pathname.endsWith('/signin-post')) return await handleSigninPost(req)

    const body = await req.text()
    if (!(await verifySignature(req, body))) {
      return json({ error: 'invalid request signature' }, 401)
    }
    const interaction = JSON.parse(body)
    if (interaction.type === 1) return json(PONG)
    if (interaction.type === 3) {
      if (String(interaction.data?.custom_id || '') === 'signin') return await handleSigninButton(interaction)
      return await handleClaim(interaction)
    }
    return json(ephemeral('Unsupported interaction.'))
  } catch (err) {
    console.error('[recruit-discord] error:', (err as Error).message)
    return json({ error: (err as Error).message }, 500)
  }
})
