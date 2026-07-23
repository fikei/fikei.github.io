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

const VERSION = '1.1.1'
console.log(`[recruit-discord] v${VERSION} — screening-claim interactions + DM reminders`)

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { scheduleScreening, sendApplicantConfirmation } from '../_shared/recruit-schedule.ts'
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
    const { data: rp } = await client.from('recruit_profiles').select('display_name').eq('user_id', opts.userId).maybeSingle()
    const housemateName = rp?.display_name || opts.discordUsername || 'an Agape housemate'
    const { data: authUser, error: authErr } = await client.auth.admin.getUserById(opts.userId)
    const housemateEmail = (authUser?.user?.email || '').toLowerCase()
    if (authErr || !housemateEmail.includes('@')) throw new Error('Could not resolve your account email')

    const { screening, meetLink, applicant } = await scheduleScreening(client, {
      applicantId, startsAt, housemateUserId: opts.userId, housemateName, housemateEmail,
    })

    const applicantName = `${applicant.first_name} ${applicant.last_name || ''}`.trim()
    await editClaimMessageClaimed(
      claimPost.discord_channel_id, claimPost.discord_message_id, opts.discordUserId,
      applicantName, applicantId, slotWhen(startsAt),
    )

    const platform = claimPost.platform as { kind?: string; handle?: string } | null
    const platformLine = platform?.kind
      ? `\nHeads up: they asked for ${platform.kind}${platform.handle ? ` (@${platform.handle})` : ''} — default is the Meet link, but feel free to DM them about it.`
      : ''
    await dmUser(opts.discordUserId,
      `✅ You claimed **${applicantName}**'s screening call — ${slotWhen(startsAt)}.\n` +
      `Calendar invites are out to you both. Meet: ${meetLink || '(see calendar invite)'}${platformLine}`)

    try {
      await sendApplicantConfirmation(client, applicant, housemateName, startsAt, meetLink)
    } catch (err) {
      console.warn(`[recruit-discord] confirmation email failed for ${applicantId}: ${(err as Error).message}`)
    }
    console.log(`[recruit-discord] claim complete: ${applicantId} × ${housemateName} @ ${startsAt.toISOString()} (screening ${screening.id})`)
  } catch (err) {
    // Never reopen the post (avoids double-booking) — flag it and tell the claimer.
    console.error(`[recruit-discord] claim finish failed for ${applicantId}: ${(err as Error).message}`)
    try {
      await editClaimMessageFailed(claimPost.discord_channel_id, claimPost.discord_message_id, opts.discordUserId, applicantId, slotWhen(startsAt))
    } catch { /* best effort */ }
    try {
      await dmUser(opts.discordUserId,
        `⚠️ You claimed the call with this applicant (${label}), but scheduling hit an error: ${(err as Error).message.slice(0, 200)}\n` +
        `Please book it manually in the app: https://ctrl.rodeo/applications/?id=${encodeURIComponent(applicantId)}`)
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
    .select('id, applicant_id, housemate_user_id, starts_at, meet_link')
    .eq('status', 'scheduled').is('reminder_sent_at', null)
    .gte('starts_at', new Date(now).toISOString())
    .lte('starts_at', new Date(now + 65 * 60000).toISOString())
  let sent = 0
  for (const s of (upcoming || [])) {
    try {
      const [{ data: applicant }, { data: dm }] = await Promise.all([
        client.from('recruit_applicants').select('first_name, last_name').eq('id', s.applicant_id).maybeSingle(),
        client.from('user_discord_membership').select('discord_user_id').eq('user_id', s.housemate_user_id).maybeSingle(),
      ])
      if (dm?.discord_user_id && applicant) {
        const name = `${applicant.first_name} ${applicant.last_name || ''}`.trim()
        await dmUser(dm.discord_user_id,
          `⏰ Coming up: you're interviewing **${name}** at ${slotWhen(new Date(s.starts_at))} PT.\n` +
          `Meet: ${s.meet_link || '(see calendar invite)'}\n` +
          `Background: https://ctrl.rodeo/applications/?id=${encodeURIComponent(s.applicant_id)}`)
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
      const sent = await remindUpcoming(client)
      console.log(`[recruit-discord] reminder sweep: ${sent} DM(s) sent`)
      return json({ reminded: sent })
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
