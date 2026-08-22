// Supabase Edge Function: recruit-score-apps
// Haiku first pass over submitted program (DJ residency) applications so a
// 1,000-application inbox is sortable. Five dimensions (credentials, sound,
// fit, logistics, excitement) 1–5 each + a two-sentence note, stamped onto
// recruit_applicants. Scores are DISPLAY-ONLY by product decision: they sort
// the inbox, they never gate, auto-advance, or auto-reject.
//
// POST /functions/v1/recruit-score-apps   (Authorization: Bearer <user JWT>,
//                                          recruiting members only)
// Body: { batch: true }            score up to BATCH unscored submitted apps
//       { applicantId: string }    (re)score one, even if already scored
// Response: { scored: n, remaining: n }

const VERSION = '1.0.0'
console.log(`[recruit-score-apps] v${VERSION} — Haiku first-pass scoring for program applications`)

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}
const jsonHeaders = { ...corsHeaders, 'Content-Type': 'application/json' }
const BATCH = 10

function db() {
  return createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
}

const DIMENSIONS = ['credentials', 'sound', 'fit', 'logistics', 'excitement'] as const

// deno-lint-ignore no-explicit-any
async function scoreOne(client: ReturnType<typeof db>, a: any): Promise<boolean> {
  const key = Deno.env.get('RECRUIT_ANTHROPIC_API_KEY') || Deno.env.get('ANTHROPIC_API_KEY') || Deno.env.get('LADDER_ANTHROPIC_API_KEY')
  if (!key) throw new Error('no Anthropic API key configured')

  const application = [
    `Artist name: ${a.artist_name || '(none given)'}`,
    `Legal name: ${[a.first_name, a.last_name].filter(Boolean).join(' ')}`,
    `Based in: ${a.based_in || '(not given)'}`,
    `Mix links: ${a.mix_links || '(none)'}`,
    `Performance history: ${a.performance_history || '(none given)'}`,
    `About their sound: ${a.sound_essay || '(empty)'}`,
    `About them: ${a.about || '(empty)'}`,
    `What they'd bring to the house: ${a.gifts || '(empty)'}`,
    `Community answer: ${a.community || '(empty)'}`,
    `Gear needs: ${a.gear_notes || '(none)'}`,
    `Anything else: ${a.anything_else || '(none)'}`,
  ].join('\n')

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
    body: JSON.stringify({
      model: 'claude-haiku-4-5-20251001', max_tokens: 400,
      system: 'You score DJ residency applications for Agape, a 16-person co-op in San Francisco with a basement listening room (Neptune sound system, Pioneer decks). Residents live in the house for the residency window and record a one-hour filmed set. You are a triage aid for human reviewers, not a decision-maker. You cannot listen to audio — judge mix links only by what the text conveys (platforms, specificity, self-description). Reply with ONLY a JSON object: {"credentials":1-5,"sound":1-5,"fit":1-5,"logistics":1-5,"excitement":1-5,"note":"one or two plain sentences for the reviewer"}. credentials = evidence of real DJ practice and performance; sound = how developed and specific their musical identity reads; fit = would they thrive in (and give to) a dense communal house; logistics = can they realistically relocate for the window, reasonable gear needs; excitement = would housemates be excited to live with this person. Be honest and use the full 1-5 range.',
      messages: [{ role: 'user', content: application }],
    }),
  })
  if (!res.ok) throw new Error(`anthropic ${res.status}: ${(await res.text()).slice(0, 200)}`)
  const data = await res.json()
  const text: string = data?.content?.[0]?.text || ''
  const m = text.match(/\{[\s\S]*\}/)
  if (!m) throw new Error('no JSON in model reply')
  const parsed = JSON.parse(m[0])

  const clamp = (v: unknown) => Math.min(5, Math.max(1, Math.round(Number(v) || 1)))
  const scores = Object.fromEntries(DIMENSIONS.map((d) => [d, clamp(parsed[d])]))
  const total = DIMENSIONS.reduce((s, d) => s + (scores[d] as number), 0)

  const { error } = await client.from('recruit_applicants').update({
    score_credentials: scores.credentials,
    score_sound: scores.sound,
    score_fit: scores.fit,
    score_logistics: scores.logistics,
    score_excitement: scores.excitement,
    score_total: total,
    score_notes: String(parsed.note || '').slice(0, 500),
    scored_at: new Date().toISOString(),
  }).eq('id', a.id)
  if (error) throw new Error(error.message)
  console.log(`scored ${a.id} → ${total}/25`)
  return true
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
    let scored = 0
    let remaining = 0

    if (body.applicantId) {
      const { data: a } = await client.from('recruit_applicants')
        .select('*').eq('id', String(body.applicantId)).not('listing_id', 'is', null).maybeSingle()
      if (!a) return new Response(JSON.stringify({ error: 'No such program applicant' }), { status: 404, headers: jsonHeaders })
      await scoreOne(client, a)
      scored = 1
    } else if (body.batch) {
      const { data: pending } = await client.from('recruit_applicants')
        .select('*')
        .not('listing_id', 'is', null)
        .eq('is_submitted', true)
        .is('scored_at', null)
        .order('submitted_at', { ascending: true })
        .limit(BATCH)
      for (const a of pending || []) {
        try { await scoreOne(client, a); scored++ } catch (e) {
          // One bad application must not wedge the sweep — stamp it checked
          // with the failure in the note so it surfaces instead of looping.
          console.warn('score failed', a.id, (e as Error).message)
          await client.from('recruit_applicants').update({
            scored_at: new Date().toISOString(),
            score_notes: `scoring failed: ${(e as Error).message.slice(0, 200)}`,
          }).eq('id', a.id)
        }
      }
      const { count } = await client.from('recruit_applicants')
        .select('id', { count: 'exact', head: true })
        .not('listing_id', 'is', null).eq('is_submitted', true).is('scored_at', null)
      remaining = count || 0
    } else {
      return new Response(JSON.stringify({ error: 'Pass applicantId or batch:true' }), { status: 400, headers: jsonHeaders })
    }

    return new Response(JSON.stringify({ scored, remaining, version: VERSION }), { headers: jsonHeaders })
  } catch (err) {
    console.error('recruit-score-apps error:', (err as Error).message)
    return new Response(JSON.stringify({ error: (err as Error).message }), { status: 500, headers: jsonHeaders })
  }
})
