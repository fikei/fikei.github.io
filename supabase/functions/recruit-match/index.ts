// Supabase Edge Function: recruit-match
// Matches an Agape applicant in Outreach to the open room listings with
// Claude Haiku: which listing fits (or General interest), a one-line
// rationale, and practicality flags (couple / timing / budget / duration)
// that the UI shows as soft alerts. Suggestions land in
// recruit_match_suggestions (service-role write, member read).
//
// POST /functions/v1/recruit-match   (Authorization: Bearer <user JWT>)
// Body: { applicantId: string }      one applicant (recompute even if fresh)
//       { backfill: true }           every outreach applicant without a
//                                    fresh (<7d) suggestion
// Response: { suggestions: [{ applicantId, listingId, confidence, rationale, flags }] }

const VERSION = '1.0.0'
console.log(`[recruit-match] v${VERSION} — AI listing match for Agape applicants`)

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}
const jsonHeaders = { ...corsHeaders, 'Content-Type': 'application/json' }

const MODEL = 'claude-haiku-4-5-20251001'
const FRESH_MS = 7 * 24 * 3600 * 1000

function db() {
  return createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
}

async function callClaude(prompt: string): Promise<Record<string, unknown>> {
  const key = Deno.env.get('ANTHROPIC_API_KEY') || Deno.env.get('LADDER_ANTHROPIC_API_KEY')
  if (!key) throw new Error('No Anthropic API key configured')
  const resp = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 500,
      system: 'You match housing applicants to room listings for a communal house. Respond with a single JSON object only — no prose, no markdown fences.',
      messages: [{ role: 'user', content: prompt }],
    }),
  })
  if (!resp.ok) throw new Error(`Anthropic ${resp.status}: ${(await resp.text()).slice(0, 200)}`)
  const data = await resp.json()
  const text = (data.content?.[0]?.text || '').trim().replace(/^```json?\s*|\s*```$/g, '')
  return JSON.parse(text)
}

// deno-lint-ignore no-explicit-any
function buildPrompt(a: any, listings: any[], rooms: any[]) {
  const roomById = Object.fromEntries(rooms.map((r) => [r.id, r]))
  const listingLines = listings.map((l) => {
    const room = roomById[l.room_id]
    const window = l.ends_on ? `${l.starts_on} to ${l.ends_on}` : `from ${l.starts_on}, open-ended`
    const kind = l.kind === 'resident' ? '3-month resident trial (full-time candidates)' : 'short-term sublet (3 months or less)'
    return `- id "${l.id}": ${room?.name || 'Room'} (${room?.floor || ''}) — ${kind}, ${window}${l.notes ? `. Notes: ${l.notes}` : ''}`
  }).join('\n')
  const trim = (s: string, n = 700) => (s || '').replace(/\s+/g, ' ').slice(0, n)

  return `Today is ${new Date().toISOString().slice(0, 10)}.

APPLICANT
Name: ${a.first_name} ${a.last_name}
Residency sought: ${a.residency}
Move-in (their words): ${a.move_in}
Budget (their words): ${a.budget}
About: ${trim(a.about)}
Why this house: ${trim(a.why_agape)}

OPEN LISTINGS
${listingLines || '(none)'}

Match this applicant to the single best listing, or to none.
Rules of thumb:
- "Short (1 month or less)" or an explicitly bounded stay → sublet listings only; full-time applicants → resident-trial listings (a sublet is acceptable as a bridge only if their timing matches).
- Timing must genuinely overlap the listing window.
- Rooms are single-occupancy unless notes say otherwise; couples ("we", partner mentioned) usually need a large room — flag them.
- Budget under $1500/mo is impractical for this house — flag it.
- If nothing fits well, return listing_id null (they stay in General interest for future availability).

Return exactly: {"listing_id": "<id or null>", "confidence": <0..1>, "rationale": "<one or two sentences, plain language>", "flags": [{"type": "couple|timing|budget|duration|fit", "message": "<short practical heads-up>"}]}
flags must be [] when there is no practical concern.`
}

// deno-lint-ignore no-explicit-any
async function suggestFor(client: any, applicant: any, listings: any[], rooms: any[]) {
  const raw = await callClaude(buildPrompt(applicant, listings, rooms))
  const listingId = typeof raw.listing_id === 'string' && raw.listing_id !== 'null' &&
    listings.some((l) => l.id === raw.listing_id) ? raw.listing_id : null
  const row = {
    applicant_id: applicant.id,
    listing_id: listingId,
    confidence: Math.max(0, Math.min(1, Number(raw.confidence) || 0)),
    rationale: String(raw.rationale || '').slice(0, 500),
    flags: Array.isArray(raw.flags) ? raw.flags.slice(0, 5).map((f: Record<string, unknown>) => ({
      type: String(f.type || 'fit').slice(0, 20),
      message: String(f.message || '').slice(0, 200),
    })) : [],
    model: MODEL,
    created_at: new Date().toISOString(),
  }
  const { error } = await client.from('recruit_match_suggestions').upsert(row, { onConflict: 'applicant_id' })
  if (error) throw new Error(`Suggestion write failed: ${error.message}`)
  console.log(`Matched ${applicant.id} → ${listingId || 'general interest'} (${row.confidence})`)
  return row
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
    const [{ data: listings }, { data: rooms }] = await Promise.all([
      client.from('recruit_listings').select('*').eq('status', 'open'),
      client.from('recruit_rooms').select('*'),
    ])

    let targets: string[] = []
    if (body.applicantId) {
      targets = [String(body.applicantId)]
    } else if (body.backfill) {
      const { data: outreach } = await client.from('recruit_decisions')
        .select('applicant_id').eq('decision', 'outreach')
      const { data: fresh } = await client.from('recruit_match_suggestions')
        .select('applicant_id, created_at')
      const freshSet = new Set((fresh || [])
        .filter((s) => Date.now() - new Date(s.created_at).getTime() < FRESH_MS)
        .map((s) => s.applicant_id))
      targets = (outreach || []).map((d) => d.applicant_id).filter((id) => !freshSet.has(id))
    } else {
      return new Response(JSON.stringify({ error: 'Pass applicantId or backfill:true' }), { status: 400, headers: jsonHeaders })
    }

    const suggestions = []
    for (const id of targets.slice(0, 30)) {
      const { data: applicant } = await client.from('recruit_applicants').select('*').eq('id', id).maybeSingle()
      if (!applicant) continue
      try {
        const s = await suggestFor(client, applicant, listings || [], rooms || [])
        suggestions.push({ applicantId: id, listingId: s.listing_id, confidence: s.confidence, rationale: s.rationale, flags: s.flags })
      } catch (err) {
        console.error(`Match failed for ${id}:`, (err as Error).message)
      }
    }

    return new Response(JSON.stringify({ suggestions }), { headers: jsonHeaders })
  } catch (err) {
    console.error('recruit-match error:', (err as Error).message)
    return new Response(JSON.stringify({ error: (err as Error).message }), { status: 500, headers: jsonHeaders })
  }
})
