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

const VERSION = '1.30.0'
console.log(`[recruit-discord] v${VERSION} — screening claims + sign-in + link nudges + trial votes + notification ledger`)

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { scheduleScreening, sendIntroEmail, sharedAccessToken, sweepCalendars, HOUSE_CALENDAR_ID, SHARED_EMAIL } from '../_shared/recruit-schedule.ts'
import { editSchedulerSignedUp, editSchedulerFailed, dmUser, slotLabel, slotWhen } from '../_shared/discord.ts'
import { notifyTick, previewTick } from '../_shared/recruit-notify.ts'
import { ensureBallots } from '../_shared/recruit-ballots.ts'

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


/* The interview guide, as the screener should receive it.

   Lives in recruit_settings so it can be rewritten without a deploy — it is the
   kind of text that gets edited after every second call for a while.

   Written to fit ONE Discord message. A guide that arrives in two parts gets
   read as one and a half: the second message looks like a footnote, and the
   close — what you actually promise the applicant — was in it. Length is the
   discipline that keeps it a reference rather than a script.

   {profile} and {notes} are substituted per call, so the screener can open the
   application they are about to discuss without going to find it. The splitter
   below stays as a safety net: if somebody pastes an essay into the setting it
   arrives whole rather than truncated mid-question. */
/* The cron gate, shared by every header-authenticated route: a shared secret
   when one is configured, otherwise the one-time nonce the pg_cron tick mints
   and this burns on use. */
async function cronAuthorized(req: Request, client: ReturnType<typeof db>): Promise<boolean> {
  const secret = Deno.env.get('CRON_SECRET')
  if (secret && req.headers.get('x-cron-secret') === secret) return true
  const nonce = req.headers.get('x-cron-nonce')
  if (!nonce || !/^[0-9a-f-]{36}$/i.test(nonce)) return false
  const { data: burned } = await client.from('recruit_cron_nonce')
    .delete().eq('nonce', nonce)
    .gte('created_at', new Date(Date.now() - 10 * 60000).toISOString())
    .select().maybeSingle()
  return Boolean(burned)
}

async function interviewGuide(
  client: ReturnType<typeof db>,
  applicantId: string,
): Promise<string[]> {
  const { data } = await client.from('recruit_settings').select('key, value')
    .in('key', ['interview_guide', 'interview_guide_url'])
  const map = new Map((data || []).map((r) => [r.key, r.value]))
  const url = String(map.get('interview_guide_url') || '').trim()
  const guide = String(map.get('interview_guide') || '').trim()
    .replaceAll('{profile}', `https://ctrl.rodeo/applications/?a=${encodeURIComponent(applicantId)}`)
    .replaceAll('{notes}', url || 'https://ctrl.rodeo/applications/')
  if (!guide) return []

  /* Discord's real cap, not a rounded-down guess. The house's guide is 1,998
     characters — it fits, and an arbitrary 1,900 would have split it in two for
     no reason. The cost of using the true limit is that an edit adding more than
     two characters splits it, which /guide-preview will show before it matters. */
  const LIMIT = 2000
  if (guide.length <= LIMIT) return [guide]

  console.warn(`[recruit-discord] interview guide is ${guide.length} chars — splitting; it is meant to fit one message`)
  const out: string[] = []
  let buf = ''
  for (const para of guide.split(/\n\s*\n/)) {
    if (buf && `${buf}\n\n${para}`.length > LIMIT) { out.push(buf); buf = '' }
    buf = buf ? `${buf}\n\n${para}` : para
    while (buf.length > LIMIT) { out.push(buf.slice(0, LIMIT)); buf = buf.slice(LIMIT) }
  }
  if (buf) out.push(buf)
  return out
}

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
    await editSchedulerSignedUp(claimPost, opts.discordUserId, applicantName, applicantId, slotWhen(startsAt))

    const platform = claimPost.platform as { kind?: string; handle?: string } | null
    const platformLine = platform?.kind
      ? `\nHeads up: they asked for ${platform.kind}${platform.handle ? ` (@${platform.handle})` : ''} — default is the Meet link, but feel free to DM them about it.`
      : ''
    await dmUser(opts.discordUserId,
      `✅ You're screening **${applicantName}** — Agape intro call — ${slotWhen(startsAt)}.\n` +
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
      await editSchedulerFailed(claimPost, opts.discordUserId, applicantId, slotWhen(startsAt))
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
/* Every auth attempt lands in recruit_auth_events and, for anything a human
   should see, pings #recruiting-automation. Login failures used to be
   invisible — the only signal was somebody saying "it doesn't work". */
async function logAuth(
  client: ReturnType<typeof db>,
  event: string,
  opts: { discordUserId?: string | null; discordUsername?: string | null; userId?: string | null;
          detail?: string | null; channel?: string | null; inAppBrowser?: boolean | null } = {},
  notify = false,
): Promise<void> {
  try {
    await client.from('recruit_auth_events').insert({
      event,
      discord_user_id: opts.discordUserId ?? null,
      discord_username: opts.discordUsername ?? null,
      user_id: opts.userId ?? null,
      detail: opts.detail ?? null,
      channel: opts.channel ?? null,
      in_app_browser: opts.inAppBrowser ?? null,
    })
  } catch (err) {
    console.warn(`[auth-log] ${event}: ${(err as Error).message}`)
  }
  if (!notify) return
  try {
    const { postChannelEmbed, AUTOMATION_CHANNEL_ID } = await import('../_shared/discord.ts')
    const who = opts.discordUsername || opts.discordUserId || 'someone'
    const FACE: Record<string, { title: string; color: number }> = {
      link_sent:       { title: `Sign-in link sent to ${who}`, color: 0x5865f2 },
      link_redeemed:   { title: `${who} signed in`, color: 0x1D9E75 },
      link_expired:    { title: `${who} tapped an expired link`, color: 0xBA7517 },
      gate_pass:       { title: `${who} opened the inbox`, color: 0x1D9E75 },
      gate_no_channel: { title: `${who} was refused — not in Recruiting Society`, color: 0xBA7517 },
      gate_not_linked: { title: `${who} has no Discord linked`, color: 0xBA7517 },
      gate_error:      { title: `Sign-in failed for ${who}`, color: 0xE24B4A },
      client_stall:    { title: `${who} got stuck signing in`, color: 0xE24B4A },
    }
    const face = FACE[event] || { title: `${who}: ${event}`, color: 0x888780 }
    const bits = [opts.detail, opts.channel ? `via ${opts.channel}` : null,
                  opts.inAppBrowser ? 'in an in-app browser' : null].filter(Boolean)
    await postChannelEmbed(AUTOMATION_CHANNEL_ID, {
      description: `**${face.title}**${bits.length ? `\n${bits.join(' · ')}` : ''}`,
      color: face.color,
    })
  } catch (err) {
    console.warn(`[auth-log] notify ${event}: ${(err as Error).message}`)
  }
}

// Jump link to the pinned sign-in message, so "get another link" is a tap
// rather than an instruction to go and find something.
const SIGNIN_MESSAGE_URL = Deno.env.get('SIGNIN_MESSAGE_URL')
  || 'https://discord.com/channels/952961396121931838/1529576830514762029/1532462592872808539'

const shadowEmail = (discordUserId: string) => `discord-${discordUserId}@signin.ctrl.rodeo`

async function sha256Hex(s: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s))
  return Array.from(new Uint8Array(digest)).map(b => b.toString(16).padStart(2, '0')).join('')
}

/* Mint a one-time link for a Discord id. Shared by the button, the /signin
   command and the proactive DM, so there is one definition of a sign-in. */
async function mintSigninUrl(
  discordUserId: string,
  discordUsername: string | null,
  // 10 minutes suits a link you just asked for; a DM sits unread far longer.
  // Four of the first five DM'd links expired before anyone opened them.
  ttlMinutes = 10,
): Promise<string | null> {
  const raw = crypto.randomUUID().replaceAll('-', '') + crypto.randomUUID().replaceAll('-', '')
  const { error } = await db().from('recruit_signin_tokens').insert({
    token_hash: await sha256Hex(raw), discord_user_id: discordUserId, discord_username: discordUsername,
    expires_at: new Date(Date.now() + ttlMinutes * 60_000).toISOString(),
  })
  if (error) return null
  return `${APP_URL}?signin=${raw}`
}

/* "How we run an intro call" — answered on request.

   Ephemeral so it never clutters a channel if the button is ever posted in one,
   and so a screener can tap it twice without leaving two copies behind. It
   returns the guide as its own message rather than a link, because the moment
   this gets tapped is five minutes before a call and opening a browser tab is
   already too much. */
async function handleGuideButton(interaction: Record<string, any>): Promise<Response> {
  const applicantId = String(interaction.data?.custom_id || '').split('|')[1] || 'preview'
  try {
    const parts = await interviewGuide(db(), applicantId)
    if (!parts.length) return json(ephemeral('No interview guide is set.'))
    // One interaction response; anything that spilled to a second message is
    // joined, since Discord allows more in a response than in a DM.
    return json({ type: 4, data: { content: parts.join('\n\n').slice(0, 3900), flags: 64 } })
  } catch (err) {
    console.warn(`[recruit-discord] guide button failed: ${(err as Error).message}`)
    return json(ephemeral('Could not load the guide — try the app.'))
  }
}

async function handleSigninButton(interaction: Record<string, any>): Promise<Response> {
  const discordUserId = interaction.member?.user?.id || interaction.user?.id
  const discordUsername = interaction.member?.user?.username || interaction.user?.username || null
  if (!discordUserId) return json(ephemeral('Could not identify you.'))

  const url = await mintSigninUrl(discordUserId, discordUsername)
  if (!url) return json(ephemeral('Could not mint a link — try again in a minute.'))
  // Discord discards an interaction that takes more than 3 seconds, and
  // logAuth posts to a channel — never make the reply wait on it.
  const logging = logAuth(db(), 'link_sent',
    { discordUserId, discordUsername, channel: interaction.type === 2 ? 'slash' : 'button' }, true)
  if (typeof EdgeRuntime !== 'undefined' && EdgeRuntime?.waitUntil) EdgeRuntime.waitUntil(logging)
  else logging.catch(() => {})

  return json(ephemeral(`🔑 ${url}\nOpens the inbox signed in. Works once, for 10 minutes.`))
}

/* Registers /signin on the guild so nobody has to hunt for the button.
   Idempotent — Discord replaces the command set on every PUT. */
async function registerCommands(): Promise<Record<string, unknown>> {
  const botToken = Deno.env.get('DISCORD_BOT_TOKEN')
  if (!botToken) throw new Error('DISCORD_BOT_TOKEN not set')
  const app = await (await fetch('https://discord.com/api/v10/applications/@me', {
    headers: { Authorization: `Bot ${botToken}` },
  })).json()
  if (!app?.id) throw new Error('could not resolve application id')
  const guildId = Deno.env.get('AGAPE_GUILD_ID') || '952961396121931838'
  const resp = await fetch(`https://discord.com/api/v10/applications/${app.id}/guilds/${guildId}/commands`, {
    method: 'PUT',
    headers: { Authorization: `Bot ${botToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify([
      { name: 'signin', description: 'Get a one-time link into the Agape applicant inbox', type: 1 },
    ]),
  })
  const out = await resp.json()
  if (!resp.ok) throw new Error(`Discord ${resp.status}: ${JSON.stringify(out).slice(0, 200)}`)
  // Registering succeeds even when the bot was invited without the
  // applications.commands scope — in that case Discord accepts the command
  // but never shows it to anyone. Hand back the URL that grants the scope.
  const authorizeUrl = `https://discord.com/oauth2/authorize?client_id=${app.id}` +
    `&scope=applications.commands%20bot&guild_id=${guildId}&disable_guild_select=true`
  return {
    registered: Array.isArray(out) ? out.map((c: Record<string, unknown>) => c.name) : out,
    guildId, appId: app.id, appName: app.name, authorizeUrl,
    // Without this set, Discord has nowhere to deliver a button press or a
    // slash command, and both fail silently — which looks identical to a
    // missing scope from the outside.
    interactionsEndpointUrl: app.interactions_endpoint_url || null,
    expectedEndpointUrl: `${Deno.env.get('SUPABASE_URL')}/functions/v1/recruit-discord`,
  }
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
    .gt('expires_at', new Date().toISOString())
    .select().maybeSingle()
  if (!row) {
    await logAuth(client, 'link_expired', { detail: 'tapped a dead link', channel: 'link' }, true)
    return json({
      error: 'This link already expired or was used. Grab a fresh one — it takes a second.',
      rerequestUrl: SIGNIN_MESSAGE_URL,
    }, 401)
  }
  await logAuth(client, 'link_redeemed',
    { discordUserId: row.discord_user_id, discordUsername: row.discord_username, channel: 'link' }, true)

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
    // Only intro calls get reminders — a swept house dinner is not a call
    // anyone needs paging about (migration 137).
    .eq('kind', 'intro_call')
    .eq('status', 'scheduled').is('reminder_sent_at', null)
    .gte('starts_at', new Date(now).toISOString())
    /* The next quarter hour. The tick runs every fifteen minutes, so a
       sixteen-minute window catches every call exactly once, and the reminder
       lands somewhere in the fifteen minutes before it — close enough to be the
       thing you read on your way into the Meet. */
    .lte('starts_at', new Date(now + 16 * 60000).toISOString())
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
        /* Offered, not pushed. Two thousand characters of guide arriving the
           moment somebody claims a call is read once, days before it matters,
           and never again. Five minutes out is when a screener actually wants
           it — and a button costs one line of the reminder, so the people who
           have run twenty of these are not made to scroll past it. */
        await dmUser(dm.discord_user_id,
          `⏰ Coming up: you're interviewing **${name}** at ${slotWhen(new Date(s.starts_at))} PT.\n` +
          `${s.meet_link ? `[Join the Meet](${s.meet_link})` : 'See the calendar invite for the link'} · ` +
          `[View application](https://ctrl.rodeo/applications/?a=${encodeURIComponent(s.applicant_id)})`,
          [{ label: 'How we run an intro call', customId: `guide|${s.applicant_id}` }],
          true)
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
// summarize with Haiku, post notes + recording link to #recruiting-automation,
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
    // Never send a recording bot into a house event (migration 137).
    .eq('kind', 'intro_call')
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
  // Every calendar we book on, not just primary. Screenings now land on the
  // house calendar, and a bot sweep that only watched primary would silently
  // stop recording the moment bookings moved.
  const events: any[] = []
  for (const calendarId of sweepCalendars()) {
    const resp = await fetch(
      `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events?singleEvents=true&orderBy=startTime&maxResults=50&timeMin=${encodeURIComponent(now.toISOString())}&timeMax=${encodeURIComponent(timeMax.toISOString())}`,
      { headers: { Authorization: `Bearer ${token}` } },
    )
    if (!resp.ok) { console.warn(`[recall] calendar sweep failed for ${calendarId}: ${resp.status}`); continue }
    events.push(...((await resp.json()).items || []))
  }
  // deno-lint-ignore no-explicit-any
  const meetOf = (ev: any) => ev.hangoutLink || ev.conferenceData?.entryPoints?.find((e: any) => e.entryPointType === 'video')?.uri || null
  // organizer.self is only true on the account's own calendar — on a shared
  // group calendar the organizer is the calendar itself, so ours would all
  // be filtered out. Accept either.
  // deno-lint-ignore no-explicit-any
  const isOurs = (ev: any) => ev.organizer?.self ||
    String(ev.organizer?.email || '').toLowerCase() === HOUSE_CALENDAR_ID.toLowerCase() ||
    String(ev.creator?.email || '').toLowerCase() === SHARED_EMAIL.toLowerCase()
  // deno-lint-ignore no-explicit-any
  const candidates = events.filter((ev: any) => ev.status !== 'cancelled' && isOurs(ev) && meetOf(ev) && ev.start?.dateTime)
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

// House-local hour, 0–23. The tick runs every 15 minutes; work that should
// happen once a day picks its hour with this rather than earning a cron of its
// own. PT, not UTC — "8am" is a time the house recognises.
function ptHour(now = new Date()): number {
  return Number(new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Los_Angeles', hour12: false, hour: '2-digit',
  }).format(now)) % 24
}

// Trial-candidate milestones used to post their own one-shot embeds from here.
// They are now four escalating rungs in the notification ledger
// (detectTrialVotes in _shared/recruit-notify.ts), so they get copy overrides,
// dedupe, lanes, and a log entry like every other notification — and the house
// hears about a milestone once, not from two systems.

// Capability token for a recording's public watch link — 10 random bytes
// (20 hex, ~80 bits) so the link stays short enough to paste anywhere without
// getting clipped, and still unguessable. Legacy 64-hex tokens keep working:
// recruit-watch accepts them whole or by their first 20 chars. Revoke by
// nulling share_token.
function newShareToken(): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(10)))
    .map(b => b.toString(16).padStart(2, '0')).join('')
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
      .select(`${idCol}, recall_bot_id, share_token`)
      .eq('recall_status', 'done').is('recording_path', null)
      .not('recall_bot_id', 'is', null).limit(limit)
    // deno-lint-ignore no-explicit-any
    for (const r of ((rows || []) as any[])) {
      try {
        const bot = await getBotResult(r.recall_bot_id)
        if (bot.videoUrl) {
          const path = await archiveVideoToStorage(client, bot.videoUrl, `${pathPrefix}/${r[idCol]}.mp4`)
          await client.from(table).update({
            recording_path: path,
            ...(r.share_token ? {} : { share_token: newShareToken() }),
          }).eq(idCol, r[idCol])
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

/* Proactive sign-in: anyone who can see the Recruiting Society channel but has
   never completed a sign-in gets one DM with a link. This is the automation
   that matters — access granted in Discord becomes access to the app without
   anyone being told to go find a button. One DM per person, ever.

   Listing the roster needs the Server Members privileged intent; without it
   this no-ops quietly rather than pretending to have swept. */
async function inviteUnsignedMembers(client: ReturnType<typeof db>): Promise<number> {
  // OFF by default. Unsolicited DMs to the whole house is not a thing to
  // enable by accident — flip recruit_settings.signin_sweep_enabled to true
  // deliberately, and only when the house expects it.
  const { data: flag } = await client.from('recruit_settings')
    .select('value').eq('key', 'signin_sweep_enabled').maybeSingle()
  if (flag?.value !== true) return 0
  const { dmUser } = await import('../_shared/discord.ts')
  const botToken = Deno.env.get('DISCORD_BOT_TOKEN')
  if (!botToken) return 0
  const guildId = Deno.env.get('AGAPE_GUILD_ID') || '952961396121931838'

  const resp = await fetch(`https://discord.com/api/v10/guilds/${guildId}/members?limit=1000`, {
    headers: { Authorization: `Bot ${botToken}` },
  })
  if (!resp.ok) {
    console.log(`[signin-sweep] roster unavailable (${resp.status}) — needs the Server Members intent`)
    return 0
  }
  const members = await resp.json()
  if (!Array.isArray(members)) return 0

  const [{ data: known }, { data: invited }] = await Promise.all([
    client.from('user_discord_membership').select('discord_user_id'),
    client.from('recruit_signin_invites').select('discord_user_id'),
  ])
  const hasAccount = new Set((known || []).map((r: Record<string, unknown>) => String(r.discord_user_id)))
  const alreadyAsked = new Set((invited || []).map((r: Record<string, unknown>) => String(r.discord_user_id)))

  // One channel/role fetch for the whole sweep, not one per member.
  const { recruitingGate, canSeeWithGate } = await import('../_shared/discord.ts')
  const gate = await recruitingGate()
  if (!gate) { console.warn('[signin-sweep] recruiting channel not found'); return 0 }
  let sent = 0
  for (const m of members) {
    const did = String(m.user?.id || '')
    if (!did || m.user?.bot || hasAccount.has(did) || alreadyAsked.has(did)) continue
    let allowed = false
    try { allowed = canSeeWithGate(gate, did, m.roles || []) } catch { continue }
    if (!allowed) continue
    const url = await mintSigninUrl(did, m.user?.global_name || m.user?.username || null)
    if (!url) continue
    try {
      await dmUser(did,
        `👋 You have access to the Agape applicant inbox.\n` +
        `Here is a one-tap link (10 min, single use): ${url}\n` +
        `After that, type \`/signin\` in the server any time you need a fresh one.`)
      await client.from('recruit_signin_invites').insert({ discord_user_id: did })
      sent++
    } catch (err) {
      console.warn(`[signin-sweep] DM failed for ${did}: ${(err as Error).message}`)
    }
  }
  if (sent) console.log(`[signin-sweep] ${sent} sign-in link DM(s) sent`)
  return sent
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
    .eq('kind', 'intro_call')
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
      // Archive before posting — the Discord link resolves to our copy.
      let recordingPath: string | null = null
      if (bot.videoUrl) {
        try {
          const { archiveVideoToStorage } = await import('../_shared/recall.ts')
          recordingPath = await archiveVideoToStorage(client, bot.videoUrl, `events/${m.gcal_event_id}.mp4`)
        } catch (err) { console.warn(`[archive] event ${m.gcal_event_id}: ${(err as Error).message}`) }
      }
      const shareToken = recordingPath ? newShareToken() : null
      await client.from('recruit_recorded_events').update({
        recall_status: 'done', recording_summary: summary, recording_posted_at: new Date().toISOString(),
        recording_path: recordingPath,
        ...(shareToken ? { share_token: shareToken } : {}),
      }).eq('gcal_event_id', m.gcal_event_id)
      await postMeetingNote(m.title || 'Agape call', summary, shareToken)
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
      // Archive BEFORE posting — the Discord link points at our copy, so it
      // has to exist first. Recall purges media in ~7 days; if the upload
      // fails, recording_path stays null and the backfill sweep retries.
      let recordingPath: string | null = null
      if (bot.videoUrl) {
        try {
          const { archiveVideoToStorage } = await import('../_shared/recall.ts')
          recordingPath = await archiveVideoToStorage(client, bot.videoUrl, `screenings/${s.id}.mp4`)
        } catch (err) { console.warn(`[archive] screening ${s.id}: ${(err as Error).message}`) }
      }
      const shareToken = recordingPath ? newShareToken() : null
      await client.from('recruit_screenings').update({
        recall_status: 'done',
        recording_summary: summary,
        recording_posted_at: new Date().toISOString(),
        recording_path: recordingPath,
        ...(shareToken ? { share_token: shareToken } : {}),
      }).eq('id', s.id)
      await postRecordingNote(applicant?.first_name || 'Applicant', s.applicant_id, s.housemate_name || 'resident', summary, shareToken)
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
      if (!(await cronAuthorized(req, client))) return json({ error: 'unauthorized' }, 401)
      /* /remind?dry=1 — show what the detectors would say, write nothing, send
         nothing. The safe way to check a copy edit: forcing a real tick to see
         new wording re-posts every row it recreates. */
      if (new URL(req.url).searchParams.get('dry') === '1') {
        const preview = await previewTick(client)
        return json({ dryRun: true, wouldSend: preview.filter((p) => !p.existing).length, preview })
      }

      const bots = await scheduleMissingBots(client) + await scheduleCalendarBots(client)
      const invitedIn = await inviteUnsignedMembers(client).catch((e) => {
        console.warn(`[signin-sweep] ${(e as Error).message}`); return 0
      })
      if (invitedIn) console.log(`[signin-sweep] invited ${invitedIn}`)
      const unmatched = await notifyUnmatchedCalls(client)
      if (unmatched) console.log(`[unmatched] ${unmatched} link-nudge DM(s) sent`)
      const live = await announceLiveCalls(client)
      await completePastCalls(client)
      const sent = await remindUpcoming(client)
      const recorded = await processRecordings(client) + await processMeetingRecordings(client)
      const archived = await archiveMissingRecordings(client)
      if (archived) console.log(`[archive] ${archived} recording(s) copied to storage`)
      /* Trial ballots, once a day at PT 8am — the copy of the feedback form
         each milestone is voted with. Ahead of the ledger on purpose: a ballot
         made this morning is linked by the time the day's nudges go out, so
         the house never gets told to fill in a form that doesn't exist yet.
         Idempotent, so the four ticks inside the 8am hour cost one pass. */
      // ?ballots=1 forces the pass off-schedule — for the morning someone
      // reconnects the shared account and doesn't want to wait until 8am to
      // find out whether it worked. Same cron auth as the rest of /remind.
      let ballots = 0
      if (ptHour() === 8 || new URL(req.url).searchParams.get('ballots') === '1') {
        try { ballots = await ensureBallots(client) } catch (err) {
          console.warn(`[ballots] pass failed: ${(err as Error).message}`)
        }
        if (ballots) console.log(`[ballots] ${ballots} created`)
      }
      // The notification ledger: detect what's true now, write it to the log,
      // then broadcast whatever the house is owed. Isolated from everything
      // above — a failing detector must not cost the screening reminders their
      // tick.
      let notify = { detected: 0, logged: 0, now: 0, digest: 0, replies: 0 }
      try { notify = await notifyTick(client) } catch (err) {
        console.warn(`[notify] tick failed: ${(err as Error).message}`)
      }
      console.log(`[recruit-discord] tick: ${bots} bot(s), ${live} live post(s), ${sent} reminder(s), ${recorded} recording(s), ${ballots} ballot(s), notify ${notify.detected} new / ${notify.logged} logged / ${notify.now} posted / ${notify.digest} digested / ${notify.replies} reply note(s)`)
      return json({ bots, live, reminded: sent, recorded, ballots, notify })
    }

    /* POST /guide-preview?to=<discord user id>[&a=<applicant id>]
       DM the interview guide to one person, exactly as a screener receives it.

       Copy that is only ever seen at the moment somebody claims a real call is
       copy nobody proofreads — you would have to book a screening to find out
       that a line reads badly. This sends it on demand, to one recipient, with
       the same substitution and the same message splitting as the real path, so
       what you read is what a screener gets.

       Same nonce gate as /remind: it can DM, so it is not open. */
    if (new URL(req.url).pathname.endsWith('/guide-preview')) {
      const client = db()
      if (!(await cronAuthorized(req, client))) return json({ error: 'unauthorized' }, 401)
      const params = new URL(req.url).searchParams
      const to = params.get('to') || ''
      if (!/^\d{5,25}$/.test(to)) return json({ error: 'pass ?to=<discord user id>' }, 400)

      // A real applicant if one is named, so the {profile} link is clickable;
      // otherwise a placeholder that still shows where the link would go.
      const applicantId = params.get('a') || 'preview'

      /* ?as=reminder sends the call reminder itself, button and all, rather
         than the guide text. The guide is now offered rather than pushed, so
         the thing that needs proving is the button — whether it renders in a DM
         and whether tapping it returns the guide. Previewing only the text
         would test the half that was never in doubt. */
      if (params.get('as') === 'reminder') {
        const { data: who } = await client.from('recruit_applicants')
          .select('first_name, last_name').eq('id', applicantId).maybeSingle()
        const name = who ? `${who.first_name} ${who.last_name || ''}`.trim() : 'an applicant'
        await dmUser(to,
          `⏰ Coming up: you're interviewing **${name}** at 3:00 PM PT.\n` +
          `[Join the Meet](https://meet.google.com/) · ` +
          `[View application](https://ctrl.rodeo/applications/?a=${encodeURIComponent(applicantId)})`,
          [{ label: 'How we run an intro call', customId: `guide|${applicantId}` }],
          true)
        return json({ sent: 1, shape: 'reminder' })
      }

      const parts = await interviewGuide(client, applicantId)
      if (!parts.length) return json({ sent: 0, note: 'interview_guide is empty' })
      for (const part of parts) await dmUser(to, part)
      return json({ sent: parts.length, chars: parts.map((p) => p.length) })
    }

    const pathname = new URL(req.url).pathname
    if (pathname.endsWith('/redeem')) return await handleRedeem(req)
    if (pathname.endsWith('/signin-post')) return await handleSigninPost(req)
    // Send ONE named person a sign-in link. Deliberately one-at-a-time: the
    // bulk sweep DM'd the house unasked once, and never should again.
    // Unauthenticated beacon: the app reports a gate that stranded someone.
    // Anonymous by nature — if sign-in failed we may not know who they are.
    if (pathname.endsWith('/auth-event')) {
      const b = await req.json().catch(() => ({}))
      const allowed = ['client_stall', 'gate_error']
      const ev = String(b.event || '')
      if (!allowed.includes(ev)) return json({ error: 'unsupported event' }, 400)
      await logAuth(db(), ev, {
        detail: String(b.detail || '').slice(0, 300),
        channel: String(b.channel || 'app').slice(0, 20),
        inAppBrowser: b.inAppBrowser === true,
      }, true)
      return json({ logged: true })
    }

    if (pathname.endsWith('/signin-dm')) {
      const client = db()
      const tok = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '')
      const { data: u } = await client.auth.getUser(tok)
      if (!u?.user) return json({ error: 'Not authenticated' }, 401)
      const { data: adm } = await client.from('recruit_admins').select('user_id').eq('user_id', u.user.id).maybeSingle()
      if (!adm) return json({ error: 'Admins only' }, 403)
      const b = await req.json().catch(() => ({}))
      const did = String(b.discordUserId || '')
      if (!/^\d{5,25}$/.test(did)) return json({ error: 'discordUserId required' }, 400)
      const { dmUser } = await import('../_shared/discord.ts')
      // mode 'pointer' tells someone where to self-serve, without minting a
      // token that will have expired by the time they read the message.
      if (b.mode === 'pointer') {
        await dmUser(did,
          `Need another sign-in link? Tap here any time: ${SIGNIN_MESSAGE_URL}\n` +
          `That message has a **Get sign-in link** button — each link works once, for 10 minutes. ` +
          `Typing \`/signin\` in the server does the same thing.`)
        return json({ sent: true, mode: 'pointer', discordUserId: did })
      }
      const url = await mintSigninUrl(did, b.username ? String(b.username) : null, 24 * 60)
      if (!url) return json({ error: 'could not mint link' }, 500)
      await logAuth(client, 'link_sent', { discordUserId: did, discordUsername: b.username ? String(b.username) : null, channel: 'dm', detail: 'valid for 24 hours' }, true)
      await dmUser(did,
        `🔑 Sign-in link for the Agape applicant inbox:\n${url}\n` +
        `Works once, and lasts 24 hours. Opens signed in — no password, and it works ` +
        `inside Instagram or Discord's own browser, where the normal sign-in fails.\n` +
        `Expired? Get another here: ${SIGNIN_MESSAGE_URL}`)
      return json({ sent: true, discordUserId: did })
    }

    if (pathname.endsWith('/message-delete')) {
      const client = db()
      const tok = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '')
      const { data: u } = await client.auth.getUser(tok)
      if (!u?.user) return json({ error: 'Not authenticated' }, 401)
      const { data: adm } = await client.from('recruit_admins').select('user_id').eq('user_id', u.user.id).maybeSingle()
      if (!adm) return json({ error: 'Admins only' }, 403)
      const b = await req.json().catch(() => ({}))
      const ch = String(b.channelId || ''), msg = String(b.messageId || '')
      if (!/^\d{5,25}$/.test(ch) || !/^\d{5,25}$/.test(msg)) return json({ error: 'channelId and messageId required' }, 400)
      const resp = await fetch(`https://discord.com/api/v10/channels/${ch}/messages/${msg}`, {
        method: 'DELETE', headers: { Authorization: `Bot ${Deno.env.get('DISCORD_BOT_TOKEN')}` },
      })
      if (!resp.ok && resp.status !== 404) return json({ error: `Discord ${resp.status}` }, 502)
      return json({ deleted: true, messageId: msg })
    }

    if (pathname.endsWith('/register-commands')) {
      const client = db()
      const tok = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '')
      const { data: u } = await client.auth.getUser(tok)
      if (!u?.user) return json({ error: 'Not authenticated' }, 401)
      const { data: adm } = await client.from('recruit_admins').select('user_id').eq('user_id', u.user.id).maybeSingle()
      if (!adm) return json({ error: 'Admins only' }, 403)
      return json(await registerCommands())
    }

    const body = await req.text()
    if (!(await verifySignature(req, body))) {
      return json({ error: 'invalid request signature' }, 401)
    }
    const interaction = JSON.parse(body)
    if (interaction.type === 1) return json(PONG)
    // Anything thrown past here would reach the user as Discord's opaque
    // "the application did not respond". Answer with words instead.
    try {
      // Slash command — /signin works anywhere in the guild, including a DM
      // with the bot, so there is no message to find.
      if (interaction.type === 2) {
        if (String(interaction.data?.name || '') === 'signin') return await handleSigninButton(interaction)
        return json(ephemeral('Unknown command.'))
      }
      if (interaction.type === 3) {
        if (String(interaction.data?.custom_id || '') === 'signin') return await handleSigninButton(interaction)
        if (String(interaction.data?.custom_id || '').startsWith('guide|')) return await handleGuideButton(interaction)
        return await handleClaim(interaction)
      }
      return json(ephemeral('Unsupported interaction.'))
    } catch (err) {
      console.error('[recruit-discord] interaction failed:', (err as Error).message)
      return json(ephemeral(`Something broke on our side: ${(err as Error).message.slice(0, 140)}`))
    }
  } catch (err) {
    console.error('[recruit-discord] error:', (err as Error).message)
    return json({ error: (err as Error).message }, 500)
  }
})
