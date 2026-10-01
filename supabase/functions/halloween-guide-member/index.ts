// Supabase Edge Function: halloween-guide-member
// Answers one question for the Agape Halloween guide (/halloween/guide/):
// is the signed-in user in the Agape Discord server?
//
// POST /functions/v1/halloween-guide-member   (Authorization: Bearer <user JWT>)
// Response: { linked, isMember, discordUsername }
//
// Deliberately stateless and quiet: unlike discord-membership it writes nothing
// (so it can't freshen user_discord_membership.verified_at and hide a stale
// recruiting verdict) and posts nothing to #recruiting-automation, because the
// guide is opened by hundreds of guests. The client caches the answer.

const VERSION = '1.0.0'
console.log(`[halloween-guide-member] v${VERSION} - Agape guild membership check for the Halloween guide`)

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}
const jsonHeaders = { ...corsHeaders, 'Content-Type': 'application/json' }
const DISCORD_API = 'https://discord.com/api/v10'
const AGAPE_GUILD_ID = Deno.env.get('AGAPE_GUILD_ID') || '952961396121931838'

function discordIdOf(user: Record<string, unknown>): { id: string; username: string | null } | null {
  const identities = (user.identities || []) as Array<Record<string, unknown>>
  const ident = identities.find(i => i.provider === 'discord')
  if (ident) {
    const data = (ident.identity_data || {}) as Record<string, unknown>
    const id = String(data.provider_id || data.sub || ident.id || '')
    const username = (data.custom_claims as Record<string, unknown> | undefined)?.global_name || data.full_name || data.name || null
    return id ? { id, username: username ? String(username) : null } : null
  }
  // Bot magic-link accounts carry their Discord id in app_metadata.
  const meta = (user.app_metadata || {}) as Record<string, unknown>
  if (meta.discord_user_id) return { id: String(meta.discord_user_id), username: meta.discord_username ? String(meta.discord_username) : null }
  return null
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  try {
    const token = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '')
    const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
    const { data: userData, error } = await db.auth.getUser(token)
    if (error || !userData?.user) return new Response(JSON.stringify({ error: 'Not authenticated' }), { status: 401, headers: jsonHeaders })

    const who = discordIdOf(userData.user as unknown as Record<string, unknown>)
    if (!who) return new Response(JSON.stringify({ linked: false, isMember: false, discordUsername: null }), { headers: jsonHeaders })

    const botToken = Deno.env.get('DISCORD_BOT_TOKEN')
    if (!botToken) throw new Error('DISCORD_BOT_TOKEN not set')
    const ctl = new AbortController()
    const timer = setTimeout(() => ctl.abort(), 8000)
    let resp: Response
    try {
      resp = await fetch(`${DISCORD_API}/guilds/${AGAPE_GUILD_ID}/members/${who.id}`, {
        headers: { Authorization: `Bot ${botToken}` }, signal: ctl.signal,
      })
    } finally { clearTimeout(timer) }
    if (resp.status === 404) return new Response(JSON.stringify({ linked: true, isMember: false, discordUsername: who.username }), { headers: jsonHeaders })
    if (!resp.ok) throw new Error(`Discord API ${resp.status}`)
    const member = await resp.json().catch(() => ({})) as Record<string, unknown>
    const user = (member.user || {}) as Record<string, unknown>
    const name = (member.nick || user.global_name || user.username || who.username || null) as string | null
    return new Response(JSON.stringify({ linked: true, isMember: true, discordUsername: name }), { headers: jsonHeaders })
  } catch (err) {
    console.error('halloween-guide-member error:', (err as Error).message)
    return new Response(JSON.stringify({ error: (err as Error).message }), { status: 500, headers: jsonHeaders })
  }
})
