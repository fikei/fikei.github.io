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
// Response: { linked, isMember, discordUsername, verifiedAt }
//   linked=false means the user has no Discord identity on their account.

const VERSION = '1.0.0'
console.log(`[discord-membership] v${VERSION} — Agape guild membership verification`)

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
  if (!identity) return null
  const data = (identity.identity_data || {}) as Record<string, unknown>
  const discordUserId = String(identity.id || data.provider_id || data.sub || '')
  if (!discordUserId) return null
  const username = (data.custom_claims as Record<string, unknown>)?.global_name ||
    data.full_name || data.name || data.preferred_username || null
  return { discordUserId, username: username ? String(username) : null }
}

async function checkGuildMembership(discordUserId: string): Promise<boolean> {
  const botToken = Deno.env.get('DISCORD_BOT_TOKEN')
  if (!botToken) throw new Error('DISCORD_BOT_TOKEN not configured')
  const resp = await fetch(`${DISCORD_API}/guilds/${AGAPE_GUILD_ID}/members/${discordUserId}`, {
    headers: { 'Authorization': `Bot ${botToken}` },
  })
  if (resp.status === 200) return true
  if (resp.status === 404) return false // unknown member — not in the guild
  throw new Error(`Discord API ${resp.status}: ${(await resp.text()).slice(0, 200)}`)
}

async function verifyAndCache(userId: string, identity: DiscordIdentity) {
  const isMember = await checkGuildMembership(identity.discordUserId)
  const row = {
    user_id: userId,
    discord_user_id: identity.discordUserId,
    discord_username: identity.username,
    is_agape_member: isMember,
    verified_at: new Date().toISOString(),
  }
  const { error } = await getSupabase()
    .from('user_discord_membership')
    .upsert(row, { onConflict: 'user_id' })
  if (error) throw new Error(`Cache write failed: ${error.message}`)
  console.log(`Verified ${identity.discordUserId} (${identity.username || 'unknown'}): member=${isMember}`)
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
      return new Response(JSON.stringify({ linked: false, isMember: false, discordUsername: null, verifiedAt: null }), { headers: jsonHeaders })
    }

    let row: { discord_username: string | null; is_agape_member: boolean; verified_at: string } | null = null
    if (action !== 'verify') {
      const { data } = await db
        .from('user_discord_membership')
        .select('discord_user_id, discord_username, is_agape_member, verified_at')
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
      discordUsername: row.discord_username,
      verifiedAt: row.verified_at,
    }), { headers: jsonHeaders })
  } catch (err) {
    console.error('discord-membership error:', (err as Error).message)
    return new Response(JSON.stringify({ error: (err as Error).message }), { status: 500, headers: jsonHeaders })
  }
})
