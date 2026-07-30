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

const VERSION = '1.6.1'
console.log(`[discord-membership] v${VERSION} — Agape guild + recruiting-channel gate + #recruiting-automation admin (OAuth or bot magic-link)`)

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
  // A hung Discord call used to hang the whole request, and the browser had no
  // timeout either — the caller sat on a spinner indefinitely. Bound it here.
  const ctl = new AbortController()
  const timer = setTimeout(() => ctl.abort(), 10_000)
  let resp: Response
  try {
    resp = await fetch(`${DISCORD_API}${path}`, { headers: botHeaders(), signal: ctl.signal })
  } catch (err) {
    throw new Error(`Discord API unreachable ${path}: ${(err as Error).name}`)
  } finally {
    clearTimeout(timer)
  }
  // One retry for the rate limit Discord tells us how to wait out.
  if (resp.status === 429) {
    const retryMs = Math.min(Number(resp.headers.get('retry-after') || 1) * 1000, 5_000)
    await new Promise((r) => setTimeout(r, retryMs))
    return await discordGet(path)
  }
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

// Same default as _shared/discord.ts; this function is standalone (no _shared
// import), so the constant is duplicated rather than drifting behind an import.
const AUTOMATION_CHANNEL_FALLBACK = '1529576830514762029'

const VIEW_CHANNEL = 1n << 10n
const ADMINISTRATOR = 1n << 3n

// Effective-permission check for one channel: base perms from @everyone + the
// member's roles, then channel overwrites in Discord's documented order
// (@everyone → roles → member).
//
// `pick` chooses which channel to test, so the same math serves two gates: the
// Recruiting Society channel (can you use the app at all) and
// #recruiting-automation (can you change how recruiting behaves).
async function canViewChannel(
  discordUserId: string,
  memberRoles: string[],
  pick: (channels: Array<Record<string, unknown>>) => Record<string, unknown> | undefined,
  label: string,
): Promise<boolean> {
  const [channelsResp, rolesResp] = await Promise.all([
    discordGet(`/guilds/${AGAPE_GUILD_ID}/channels`),
    discordGet(`/guilds/${AGAPE_GUILD_ID}/roles`),
  ])
  if (channelsResp.status === 404 || rolesResp.status === 404) return false
  const channels = await channelsResp.json() as Array<Record<string, unknown>>
  const roles = await rolesResp.json() as Array<{ id: string; permissions: string }>

  const channel = pick(channels)
  if (!channel) {
    console.warn(`${label} channel not found`)
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

const namedChannel = (channels: Array<Record<string, unknown>>, rx: RegExp) =>
  channels.find(c => rx.test(String(c.name || '')) && c.type !== 4 /* not a category */)

// The guild has several recruiting-* channels (per-cohort); the gate is the
// "Recruiting Society" one, so prefer a society match over the first hit.
function checkRecruitingChannel(discordUserId: string, memberRoles: string[]) {
  const wantedId = Deno.env.get('RECRUITING_CHANNEL_ID')
  return canViewChannel(discordUserId, memberRoles, channels => wantedId
    ? channels.find(c => String(c.id) === wantedId)
    : (namedChannel(channels, /recruit.*society|society.*recruit/i) || namedChannel(channels, /recruit/i)),
    'Recruiting Society')
}

// Admin = can see #recruiting-automation. Same channel the app already posts
// its audit trail to, so the people who watch the automation are the people
// who get to change it.
function checkAutomationChannel(discordUserId: string, memberRoles: string[]) {
  const wantedId = Deno.env.get('RECRUITING_AUTOMATION_CHANNEL_ID')
    || Deno.env.get('SCREENING_CLAIMS_CHANNEL_ID')
    || AUTOMATION_CHANNEL_FALLBACK
  return canViewChannel(discordUserId, memberRoles, channels => wantedId
    ? channels.find(c => String(c.id) === wantedId)
    : namedChannel(channels, /recruit.*automation|automation.*recruit/i),
    '#recruiting-automation')
}

async function verifyAndCache(userId: string, identity: DiscordIdentity) {
  const member = await fetchGuildMember(identity.discordUserId)
  const isMember = member !== null
  let isRecruiting = false
  let isAdmin = false
  if (member) {
    try {
      isRecruiting = await checkRecruitingChannel(identity.discordUserId, member.roles || [])
    } catch (err) {
      // Channel check failing must not break the guild gate the events page uses.
      console.error('Recruiting channel check failed:', (err as Error).message)
    }
    if (isRecruiting) {
      try {
        isAdmin = await checkAutomationChannel(identity.discordUserId, member.roles || [])
      } catch (err) {
        // Losing this check costs write access to settings, never read access.
        console.error('Automation channel check failed:', (err as Error).message)
      }
    }
  }
  const row = {
    user_id: userId,
    discord_user_id: identity.discordUserId,
    discord_username: identity.username,
    is_agape_member: isMember,
    is_recruiting_member: isRecruiting,
    // Cached so a NULL can mean "never checked" — see migration 145. The
    // authority RLS reads is still recruit_admins, written just below.
    is_recruiting_admin: isAdmin,
    verified_at: new Date().toISOString(),
  }
  const { error } = await getSupabase()
    .from('user_discord_membership')
    .upsert(row, { onConflict: 'user_id' })
  if (error) throw new Error(`Cache write failed: ${error.message}`)

  // recruit_admins is the only thing RLS trusts for settings writes, and the
  // client cannot write it — so it is reconciled here on every verify, in both
  // directions. Losing access to #recruiting-automation loses admin.
  try {
    const db = getSupabase()
    if (isAdmin) {
      await db.from('recruit_admins').upsert(
        { user_id: userId, discord_user_id: identity.discordUserId },
        { onConflict: 'user_id' },
      )
    } else {
      await db.from('recruit_admins').delete().eq('user_id', userId)
    }
  } catch (err) {
    console.error('recruit_admins reconcile failed:', (err as Error).message)
  }

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

  console.log(`Verified ${identity.discordUserId} (${identity.username || 'unknown'}): member=${isMember} recruiting=${isRecruiting} admin=${isAdmin}`)
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
    // Read the body exactly once — a later req.clone() is too late, the stream
    // is already consumed ("Body is unusable").
    const payload = req.method === 'POST' ? (await req.json().catch(() => ({}))) : {}
    const action = payload?.action || 'status'

    // Admin probe: "why can't <person> get in?" answered from what the bot
    // actually sees, instead of guessing. Read-only; caches nothing.
    if (action === 'probe') {
      const { data: adm } = await db.from('recruit_admins').select('user_id').eq('user_id', user.id).maybeSingle()
      if (!adm) return new Response(JSON.stringify({ error: 'Admins only' }), { status: 403, headers: jsonHeaders })
      const target = String(payload?.discordUserId || '')
      if (!/^[0-9]{5,25}$/.test(target)) {
        return new Response(JSON.stringify({ error: 'discordUserId required' }), { status: 400, headers: jsonHeaders })
      }
      const out: Record<string, unknown> = { discordUserId: target, guildId: AGAPE_GUILD_ID }
      try {
        const member = await fetchGuildMember(target)
        out.inGuild = member !== null
        if (member) {
          out.roles = member.roles || []
          try { out.canSeeRecruiting = await checkRecruitingChannel(target, member.roles || []) }
          catch (err) { out.recruitingCheckError = (err as Error).message }
          try { out.canSeeAutomation = await checkAutomationChannel(target, member.roles || []) }
          catch (err) { out.automationCheckError = (err as Error).message }
        }
      } catch (err) {
        out.error = (err as Error).message
      }
      return new Response(JSON.stringify(out), { headers: jsonHeaders })
    }

    // Admin audit: everyone who can see the Recruiting Society channel, and
    // whether they have actually managed to sign in. Answers "who is stuck?"
    // without waiting for each of them to report it.
    if (action === 'audit') {
      const { data: adm } = await db.from('recruit_admins').select('user_id').eq('user_id', user.id).maybeSingle()
      if (!adm) return new Response(JSON.stringify({ error: 'Admins only' }), { status: 403, headers: jsonHeaders })
      let members: Array<Record<string, any>>
      try {
        // Needs the Server Members privileged intent enabled for the bot.
        const resp = await discordGet(`/guilds/${AGAPE_GUILD_ID}/members?limit=1000`)
        members = await resp.json()
        if (!Array.isArray(members)) throw new Error('unexpected member list')
      } catch (err) {
        // Listing the roster needs the Server Members privileged intent. Without
        // it we can still audit in the other direction: everyone who has an
        // account, and what the bot says their access is right now. That misses
        // people who have never signed in — which is exactly what the intent
        // would reveal — so say so rather than implying the list is complete.
        const { data: known } = await db.from('user_discord_membership')
          .select('discord_user_id, discord_username, verified_at, is_recruiting_member')
        const out: Array<Record<string, unknown>> = []
        for (const r of (known || [])) {
          const did = String(r.discord_user_id)
          let inGuild = false, canSee = false, checkError: string | null = null
          try {
            const m = await fetchGuildMember(did)
            inGuild = m !== null
            if (m) canSee = await checkRecruitingChannel(did, m.roles || [])
          } catch (e) { checkError = (e as Error).message }
          out.push({
            discordUserId: did, name: r.discord_username || did,
            signedIn: true, inGuild, canSeeRecruiting: canSee,
            cachedVerdict: Boolean(r.is_recruiting_member), lastVerified: r.verified_at,
            staleVerdict: Boolean(r.is_recruiting_member) !== canSee,
            checkError,
          })
        }
        return new Response(JSON.stringify({
          partial: true,
          scope: 'accounts-only',
          note: 'Roster listing needs the Server Members privileged intent; enable it in the Discord developer portal to also see channel members who have never signed in.',
          reason: (err as Error).message,
          accounts: out.length,
          rows: out,
        }), { headers: jsonHeaders })
      }
      const [{ data: cached }, { data: admins }] = await Promise.all([
        db.from('user_discord_membership').select('discord_user_id, discord_username, verified_at, is_recruiting_member'),
        db.from('recruit_admins').select('user_id'),
      ])
      const byDiscord = new Map((cached || []).map((r: Record<string, unknown>) => [String(r.discord_user_id), r]))
      const rows: Array<Record<string, unknown>> = []
      for (const m of members) {
        const did = String(m.user?.id || '')
        if (!did || m.user?.bot) continue
        let canSee = false
        try { canSee = await checkRecruitingChannel(did, m.roles || []) } catch { canSee = false }
        if (!canSee) continue
        const row = byDiscord.get(did)
        rows.push({
          discordUserId: did,
          name: m.user?.global_name || m.nick || m.user?.username || did,
          signedIn: Boolean(row),
          lastVerified: row?.verified_at || null,
          grantedInApp: row ? Boolean(row.is_recruiting_member) : false,
        })
      }
      rows.sort((a, b) => Number(a.signedIn) - Number(b.signedIn))
      return new Response(JSON.stringify({
        channelMembers: rows.length,
        signedIn: rows.filter(r => r.signedIn).length,
        neverSignedIn: rows.filter(r => !r.signedIn).map(r => r.name),
        adminCount: (admins || []).length,
        rows,
      }), { headers: jsonHeaders })
    }

    const identity = findDiscordIdentity(user as unknown as Record<string, unknown>)
    if (!identity) {
      // Discord unlinked: drop any stale membership so RLS stops granting access
      await db.from('user_discord_membership').delete().eq('user_id', user.id)
      await db.from('recruit_admins').delete().eq('user_id', user.id)
      return new Response(JSON.stringify({ linked: false, isMember: false, isRecruitingMember: false, isRecruitingAdmin: false, discordUsername: null, verifiedAt: null }), { headers: jsonHeaders })
    }

    let row: {
      discord_username: string | null
      is_agape_member: boolean
      is_recruiting_member?: boolean
      is_recruiting_admin?: boolean
      verified_at: string
    } | null = null
    if (action !== 'verify') {
      const { data } = await db
        .from('user_discord_membership')
        .select('discord_user_id, discord_username, is_agape_member, is_recruiting_member, is_recruiting_admin, verified_at')
        .eq('user_id', user.id)
        .maybeSingle()
      const fresh = data &&
        data.discord_user_id === identity.discordUserId &&
        (Date.now() - new Date(data.verified_at).getTime()) < REVERIFY_DAYS * 86400_000 &&
        // A null admin verdict means this row predates the admin check, so it
        // isn't fresh enough to answer the question. One re-verify fixes it.
        (data.is_recruiting_admin !== null || !data.is_recruiting_member)
      if (fresh) {
        // Read the verdict from the table RLS actually consults, so the UI and
        // the database can never disagree about who can write.
        const { data: adm } = await db.from('recruit_admins')
          .select('user_id').eq('user_id', user.id).maybeSingle()
        row = { ...data, is_recruiting_admin: !!adm }
      }
    }
    if (!row) row = await verifyAndCache(user.id, identity)

    return new Response(JSON.stringify({
      linked: true,
      isMember: row.is_agape_member,
      isRecruitingMember: !!row.is_recruiting_member,
      isRecruitingAdmin: !!row.is_recruiting_admin,
      discordUsername: row.discord_username,
      verifiedAt: row.verified_at,
    }), { headers: jsonHeaders })
  } catch (err) {
    console.error('discord-membership error:', (err as Error).message)
    return new Response(JSON.stringify({ error: (err as Error).message }), { status: 500, headers: jsonHeaders })
  }
})
