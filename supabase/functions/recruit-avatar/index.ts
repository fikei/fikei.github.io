// Supabase Edge Function: recruit-avatar
// Resolves a profile photo per applicant, once, server-side: extracts social
// handles from the application, probes unavatar (paced — its free tier
// rate-limits around 50/min), and stores the first working image URL on
// recruit_applicants.avatar_url (NULL = unchecked, '' = none found).
//
// POST /functions/v1/recruit-avatar   (Authorization: Bearer <user JWT>)
// Body: { applicantId: string }   resolve one (recheck even if set)
//       { backfill: true }        resolve up to 25 unchecked applicants
// Response: { resolved: n, remaining: n }

const VERSION = '1.1.0'
console.log(`[recruit-avatar] v${VERSION} — server-side avatar resolution`)

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}
const jsonHeaders = { ...corsHeaders, 'Content-Type': 'application/json' }
const BATCH = 15
const PACE_MS = 2500

function db() {
  return createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
}

// Candidate unavatar sources in priority order, mined from the applicant's
// links (a compact port of the frontend links helper).
// deno-lint-ignore no-explicit-any
function avatarCandidates(a: any): string[] {
  const social = a.social || ''
  const all = [social, a.about, a.why_agape, a.gifts].join('  ')
  const out: Array<[number, string]> = []
  const push = (prio: number, provider: string, handle: string) => {
    if (!handle || /^(https?|www|and|but|not|the)$/i.test(handle)) return
    // direct endpoints where they exist — unavatar only for the rest
    if (provider === 'github') out.push([prio, `https://github.com/${encodeURIComponent(handle)}.png?size=200`])
    else if (provider === 'gravatar') out.push([prio, `GRAVATAR:${handle}`])
    else out.push([prio, `https://unavatar.io/${provider}/${encodeURIComponent(handle)}?fallback=false`])
  }
  for (const m of all.matchAll(/github\.com\/([A-Za-z0-9-]{2,40})/g)) push(0, 'github', m[1])
  for (const m of all.matchAll(/(?:twitter|x)\.com\/([A-Za-z0-9_]{2,20})/g)) push(1, 'twitter', m[1])
  for (const m of all.matchAll(/instagram\.com\/([A-Za-z0-9._]{2,32})/g)) push(2, 'instagram', m[1].replace(/\/$/, ''))
  for (const m of all.matchAll(/tiktok\.com\/@?([A-Za-z0-9._]{2,32})/g)) push(3, 'tiktok', m[1])
  for (const m of all.matchAll(/facebook\.com\/([A-Za-z0-9.]{3,50})/g)) push(4, 'facebook', m[1])
  // bare @handles in the socials field — platform hints or instagram default
  for (const m of social.matchAll(/(?:(insta(?:gram)?|ig|tiktok|fb|facebook|twitter|x)\b[:\s]*)?@([A-Za-z0-9._]{2,30})\b/gi)) {
    const hint = (m[1] || 'instagram').toLowerCase()
    const provider = /tiktok/.test(hint) ? 'tiktok' : /fb|facebook/.test(hint) ? 'facebook' : /twitter|^x$/.test(hint) ? 'twitter' : 'instagram'
    push(2, provider, m[2])
  }
  // "IG: name" / "name on ig" without @
  for (const m of social.matchAll(/(?:insta(?:gram)?|ig)\b[:\s]+([A-Za-z0-9._]{3,30})\b/gi)) push(2, 'instagram', m[1])
  if (a.email?.includes('@')) push(9, 'gravatar', a.email.trim().toLowerCase())
  return [...new Set(out.sort((x, y) => x[0] - y[0]).map(x => x[1]))].slice(0, 4)
}

async function md5Hex(input: string): Promise<string> {
  // gravatar addresses are md5-hashed; Deno's webcrypto lacks MD5, so use a
  // tiny JS implementation via the js-md5 ESM build
  const { default: md5 } = await import('https://esm.sh/js-md5@0.8.3')
  return md5(input)
}

async function resolveOne(client: ReturnType<typeof db>, applicant: Record<string, unknown>): Promise<string> {
  for (let url of avatarCandidates(applicant)) {
    if (url.startsWith('GRAVATAR:')) {
      url = `https://gravatar.com/avatar/${await md5Hex(url.slice(9))}?s=200&d=404`
    }
    try {
      const resp = await fetch(url, { redirect: 'follow' })
      // read a little to confirm it's an image, then discard
      const type = resp.headers.get('content-type') || ''
      await resp.body?.cancel()
      if (resp.ok && type.startsWith('image/')) {
        await client.from('recruit_applicants').update({ avatar_url: url }).eq('id', applicant.id)
        console.log(`avatar ${applicant.id} → ${url}`)
        return url
      }
    } catch { /* try next */ }
    await new Promise((r) => setTimeout(r, PACE_MS))
  }
  await client.from('recruit_applicants').update({ avatar_url: '' }).eq('id', applicant.id)
  return ''
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const token = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '')
    const client = db()
    const { data: userData, error: userErr } = await client.auth.getUser(token)
    if (userErr || !userData?.user) {
      return new Response(JSON.stringify({ error: 'Not authenticated' }), { status: 401, headers: jsonHeaders })
    }
    const { data: membership } = await client.from('user_discord_membership')
      .select('is_recruiting_member').eq('user_id', userData.user.id).maybeSingle()
    if (!membership?.is_recruiting_member) {
      return new Response(JSON.stringify({ error: 'Not a recruiting member' }), { status: 403, headers: jsonHeaders })
    }

    const body = await req.json().catch(() => ({}))
    let resolved = 0
    let remaining = 0

    if (body.applicantId) {
      const { data: a } = await client.from('recruit_applicants').select('*').eq('id', String(body.applicantId)).maybeSingle()
      if (a) { await resolveOne(client, a); resolved = 1 }
    } else if (body.backfill) {
      const { data: pending } = await client.from('recruit_applicants')
        .select('*').is('avatar_url', null).order('submitted_at', { ascending: false }).limit(BATCH + 1)
      const batch = (pending || []).slice(0, BATCH)
      remaining = Math.max(0, (pending || []).length - BATCH)
      for (const a of batch) { await resolveOne(client, a); resolved++ }
      if (remaining === 0) {
        const { count } = await client.from('recruit_applicants')
          .select('id', { count: 'exact', head: true }).is('avatar_url', null)
        remaining = count || 0
      }
    } else {
      return new Response(JSON.stringify({ error: 'Pass applicantId or backfill:true' }), { status: 400, headers: jsonHeaders })
    }

    return new Response(JSON.stringify({ resolved, remaining }), { headers: jsonHeaders })
  } catch (err) {
    console.error('recruit-avatar error:', (err as Error).message)
    return new Response(JSON.stringify({ error: (err as Error).message }), { status: 500, headers: jsonHeaders })
  }
})
