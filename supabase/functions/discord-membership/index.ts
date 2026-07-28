// Supabase Edge Function: discord-membership
// Verifies whether the calling user's linked Discord account is a member of
// the Agape server, using the existing scraper bot's token (the bot lives in
// the guild, so a plain Get Guild Member lookup works — no OAuth guilds scope,
// no provider_token freshness problems).
//
// POST /functions/v1/discord-membership   (Authorization: Bearer <user JWT>)
// Body: { action?: 'status' | 'verify' }
//   status (default): return the cached membership row; auto-verifies when
//                     there is no cached row yet or the cache is older than
//                     REVERIFY_DAYS.
//   verify:           force a fresh check against the Discord API.
//
// Response: { linked, isMember, isRecruitingMember, discordUsername, verifiedAt }
//   linked=false means the user has no Discord identity on their account.
//
// v1.1.0: also verifies channel-level access to the Recruiting Society
// channel (RECRUITING_CHANNEL_ID env, else first channel whose name matches
// /recruit/i) by computing the member's effective permissions from guild
// roles + channel permission overwrites. Cached as is_recruiting_member and
// used by the recruit_* RLS policies (migration 108).

const VERSION = '1.3.0'
console.log(`[discord-membership] v${VERSION} — Agape guild + recruiting-channel verification (OAuth or bot magic-link)`)

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}
const jsonHeaders = { ...corsHeaders, 'Content-Type': 'application/json' }

const DISCORD_API = 'https://discord.com/api/v10'
// Agape server (same guild the scrape-discord-events bot reads #events from)
const AGAPE_GUILD_ID = Deno.env.get('AGAPE_GUILD_ID') || '952961396121931838'
const REVERIFY_DAYS = 7

function getSupabase() {
  const url = Deno.env.get('SUPABASE_URL')!
  const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  return createClient(url, key)
}

interface DiscordIdentity {
  discordUserId: string
  username: string | null
}

function findDiscordIdentity(user: Record<string, unknown>): DiscordIdentity | null {
  const identities = (user.identities || []) as Array<Record<string, unknown>>
  const identity = identities.find(i => i.provider === 'discord')
  if (!identity) {
    // Bot magic-link accounts (recruit-discord /redeem) carry their Discord id
    // in app_metadata instead of a provider identity.
    const meta = (user.app_metadata || {}) as Record<string, unknown>
    if (meta.discord_user_id) {
      return { discordUserId: String(meta.discord_user_id), username: meta.discord_username ? String(meta.discord_username) : null }
    }
    return null
  }
  const data = (identity.identity_data || {}) as Record<string, unknown>
  const discordUserId = String(identity.id || data.provider_id || data.sub || '')
  if (!discordUserId) return null
  const username = (data.custom_claims as Record<string, unknown>)?.global_name ||
    data.full_name || data.name || data.preferred_username || null
  return { discordUserId, username: username ? String(username) : null }
}

function botHeaders() {
  const botToken = Deno.env.get('DISCORD_BOT_TOKEN')
  if (!botToken) throw new Error('DISCORD_BOT_TOKEN not configured')
  return { 'Authorization': `Bot ${botToken}` }
}

async function discordGet(path: string): Promise<Response> {
  const resp = await fetch(`${DISCORD_API}${path}`, { headers: botHeaders() })
  if (resp.status !== 200 && resp.status !== 404) {
    throw new Error(`Discord API ${resp.status} ${path}: ${(await resp.text()).slice(0, 200)}`)
  }
  return resp
}

// Guild member (with roles), or null when not in the guild.
async function fetchGuildMember(discordUserId: string): Promise<{ roles: string[] } | null> {
  const resp = await discordGet(`/guilds/${AGAPE_GUILD_ID}/members/${discordUserId}`)
  if (resp.status === 404) return null
  return await resp.json()
}

const VIEW_CHANNEL = 1n << 10n
const ADMINISTRATOR = 1n << 3n

// Effective-permission check for the Recruiting Society channel: base perms
// from @everyone + the member's roles, then channel overwrites in Discord's
// documented order (@everyone → roles → member).
async function checkRecruitingChannel(discordUserId: string, memberRoles: string[]): Promise<boolean> {
  const [channelsResp, rolesResp] = await Promise.all([
    discordGet(`/guilds/${AGAPE_GUILD_ID}/channels`),
    discordGet(`/guilds/${AGAPE_GUILD_ID}/roles`),
  ])
  if (channelsResp.status === 404 || rolesResp.status === 404) return false
  const channels = await channelsResp.json() as Array<Record<string, unknown>>
  const roles = await rolesResp.json() as Array<{ id: string; permissions: string }>

  // The guild has several recruiting-* channels (per-cohort); the gate is the
  // "Recruiting Society" one, so prefer a society match over the first hit.
  const wantedId = Deno.env.get('RECRUITING_CHANNEL_ID')
  const named = (rx: RegExp) => channels.find(c => rx.test(String(c.name || '')) && c.type !== 4 /* not a category */)
  const channel = wantedId
    ? channels.find(c => String(c.id) === wantedId)
    : (named(/recruit.*society|society.*recruit/i) || named(/recruit/i))
  if (!channel) {
    console.warn('Recruiting channel not found (set RECRUITING_CHANNEL_ID)')
    return false
  }

  const roleById = new Map(roles.map(r => [r.id, BigInt(r.permissions)]))
  let base = roleById.get(AGAPE_GUILD_ID) ?? 0n // @everyone
  for (const rid of memberRoles) base |= roleById.get(rid) ?? 0n
  if (base & ADMINISTRATOR) return true

  type Overwrite = { id: string; type: number; allow: string; deny: string }
  const overwrites = (channel.permission_overwrites || []) as Overwrite[]
  let perms = base
  const everyoneOw = overwrites.find(o => o.id === AGAPE_GUILD_ID)
  if (everyoneOw) { perms &= ~BigInt(everyoneOw.deny); perms |= BigInt(everyoneOw.allow) }
  let roleAllow = 0n, roleDeny = 0n
  for (const ow of overwrites) {
    if (ow.type === 0 && ow.id !== AGAPE_GUILD_ID && memberRoles.includes(ow.id)) {
      roleAllow |= BigInt(ow.allow); roleDeny |= BigInt(ow.deny)
    }
  }
  perms &= ~roleDeny; perms |= roleAllow
  const memberOw = overwrites.find(o => o.type === 1 && o.id === discordUserId)
  if (memberOw) { perms &= ~BigInt(memberOw.deny); perms |= BigInt(memberOw.allow) }

  return (perms & VIEW_CHANNEL) === VIEW_CHANNEL
}

async function verifyAndCache(userId: string, identity: DiscordIdentity) {
  const member = await fetchGuildMember(identity.discordUserId)
  const isMember = member !== null
  let isRecruiting = false
  if (member) {
    try {
      isRecruiting = await checkRecruitingChannel(identity.discordUserId, member.roles || [])
    } catch (err) {
      // Channel check failing must not break the guild gate the events page uses.
      console.error('Recruiting channel check failed:', (err as Error).message)
    }
  }
  const row = {
    user_id: userId,
    discord_user_id: identity.discordUserId,
    discord_username: identity.username,
    is_agape_member: isMember,
    is_recruiting_member: isRecruiting,
    verified_at: new Date().toISOString(),
  }
  const { error } = await getSupabase()
    .from('user_discord_membership')
    .upsert(row, { onConflict: 'user_id' })
  if (error) throw new Error(`Cache write failed: ${error.message}`)

  // First-sign-in nicety: when the login email is on the AgapeSF group
  // roster, seed recruit_profiles with their real name + group email so
  // Intro Call invites and intro emails use real identities from day one.
  if (isRecruiting) {
    try {
      const db = getSupabase()
      const { data: au } = await db.auth.admin.getUserById(userId)
      const email = (au?.user?.email || '').toLowerCase()
      const { data: roster } = email
        ? await db.from('recruit_group_roster').select('full_name, email').eq('email', email).maybeSingle()
        : { data: null }
      if (roster) {
        const { data: prof } = await db.from('recruit_profiles')
          .select('user_id, display_name, group_email').eq('user_id', userId).maybeSingle()
        if (!prof) {
          await db.from('recruit_profiles').insert({ user_id: userId, display_name: roster.full_name, group_email: roster.email })
        } else if (!prof.display_name || !prof.group_email) {
          await db.from('recruit_profiles').update({
            display_name: prof.display_name || roster.full_name,
            group_email: prof.group_email || roster.email,
          }).eq('user_id', userId)
        }
      }
    } catch (err) {
      console.warn('roster autofill failed:', (err as Error).message)
    }
  }

  console.log(`Verified ${identity.discordUserId} (${identity.username || 'unknown'}): member=${isMember} recruiting=${isRecruiting}`)
  return row
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const token = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '')
    const db = getSupabase()
    const { data: userData, error: userErr } = await db.auth.getUser(token)
    if (userErr || !userData?.user) {
      return new Response(JSON.stringify({ error: 'Not authenticated' }), { status: 401, headers: jsonHeaders })
    }
    const user = userData.user
    const action = req.method === 'POST'
      ? ((await req.json().catch(() => ({})))?.action || 'status')
      : 'status'

    const identity = findDiscordIdentity(user as unknown as Record<string, unknown>)
    if (!identity) {
      // Discord unlinked: drop any stale membership so RLS stops granting access
      await db.from('user_discord_membership').delete().eq('user_id', user.id)
      return new Response(JSON.stringify({ linked: false, isMember: false, isRecruitingMember: false, discordUsername: null, verifiedAt: null }), { headers: jsonHeaders })
    }

    let row: { discord_username: string | null; is_agape_member: boolean; is_recruiting_member?: boolean; verified_at: string } | null = null
    if (action !== 'verify') {
      const { data } = await db
        .from('user_discord_membership')
        .select('discord_user_id, discord_username, is_agape_member, is_recruiting_member, verified_at')
        .eq('user_id', user.id)
        .maybeSingle()
      const fresh = data &&
        data.discord_user_id === identity.discordUserId &&
        (Date.now() - new Date(data.verified_at).getTime()) < REVERIFY_DAYS * 86400_000
      if (fresh) row = data
    }
    if (!row) row = await verifyAndCache(user.id, identity)

    return new Response(JSON.stringify({
      linked: true,
      isMember: row.is_agape_member,
      isRecruitingMember: !!row.is_recruiting_member,
      discordUsername: row.discord_username,
      verifiedAt: row.verified_at,
    }), { headers: jsonHeaders })
  } catch (err) {
    console.error('discord-membership error:', (err as Error).message)
    return new Response(JSON.stringify({ error: (err as Error).message }), { status: 500, headers: jsonHeaders })
  }
})
