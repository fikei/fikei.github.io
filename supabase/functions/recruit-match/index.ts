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

const VERSION = '1.4.0'
console.log(`[recruit-match] v${VERSION} — AI listing match for Agape applicants`)

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}
const jsonHeaders = { ...corsHeaders, 'Content-Type': 'application/json' }

const MODEL = 'claude-haiku-4-5-20251001'
const OPINION_MODEL = 'claude-sonnet-5'
const FRESH_MS = 7 * 24 * 3600 * 1000

function db() {
  return createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
}

async function callClaudeRaw(model: string, system: string, prompt: string, maxTokens = 500): Promise<string> {
  const key = Deno.env.get('ANTHROPIC_API_KEY') || Deno.env.get('LADDER_ANTHROPIC_API_KEY')
  if (!key) throw new Error('No Anthropic API key configured')
  const resp = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
    body: JSON.stringify({ model, max_tokens: maxTokens, system, messages: [{ role: 'user', content: prompt }] }),
  })
  if (!resp.ok) throw new Error(`Anthropic ${resp.status}: ${(await resp.text()).slice(0, 200)}`)
  const data = await resp.json()
  // models may emit thinking blocks before text — take all text blocks
  const text = (data.content || []).filter((b: Record<string, unknown>) => b.type === 'text')
    .map((b: Record<string, unknown>) => b.text).join('').trim()
  if (!text) throw new Error('Empty completion')
  return text
}

async function callClaude(prompt: string): Promise<Record<string, unknown>> {
  const text = await callClaudeRaw(MODEL,
    'You match housing applicants to room listings for a communal house. Respond with a single JSON object only — no prose, no markdown fences.',
    prompt)
  return JSON.parse(text.replace(/^```json?\s*|\s*```$/g, ''))
}

// Independent, deeper read on an applicant — posted into the house notes so
// every recruiting member sees the same second opinion.
// deno-lint-ignore no-explicit-any
async function secondOpinion(client: any, applicant: any, notes: any[], userId: string): Promise<string> {
  const trim = (s: string, n = 1200) => (s || '').replace(/\s+/g, ' ').slice(0, n)
  const noteLines = notes.map((n) => `- ${n.author_name || 'Housemate'}: ${trim(n.body, 200)}`).join('\n') || '(none yet)'
  const prompt = `You are giving a communal house (Agape, SF — do-ocracy, creative, emotionally mature, community-first) a second opinion on an applicant. Housemates already formed first impressions; be an independent voice — concise, concrete, and willing to disagree.

APPLICANT
Name: ${applicant.first_name} ${applicant.last_name}
Residency sought: ${applicant.residency}
Move-in: ${applicant.move_in} · Budget: ${applicant.budget}
About: ${trim(applicant.about)}
Why Agape: ${trim(applicant.why_agape)}
Gifts: ${trim(applicant.gifts)}
Heard from: ${applicant.heard_from}

EXISTING HOUSE NOTES
${noteLines}

Write a second opinion in under 120 words, three tight parts:
Strengths: …
Watch for: …
Read: … (your one-sentence overall call, including anything the notes above may have missed)
Plain text, no markdown headers beyond those three labels.`
  const text = await callClaudeRaw(OPINION_MODEL,
    'You are a thoughtful, direct housing-committee advisor. Plain text only.', prompt, 400)
  const { error } = await client.from('recruit_comments').insert({
    applicant_id: applicant.id, user_id: userId, author_name: 'AI · second opinion', body: text.slice(0, 3900),
  })
  if (error) throw new Error(`Note write failed: ${error.message}`)
  return text
}

// deno-lint-ignore no-explicit-any
function buildPrompt(a: any, listings: any[], rooms: any[], openToCouples: boolean) {
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
- ${openToCouples ? 'The house is currently open to couples, but still flag them so the room choice accounts for it.' : 'HOUSE PREFERENCE: the house is NOT open to couples right now — flag any couple prominently and lean toward listing_id null for them.'}
- Budget under $1500/mo is impractical for this house — flag it.
- If nothing fits well, return listing_id null (they stay in General interest for future availability).

Return exactly: {"listing_id": "<id or null>", "confidence": <0..1>, "rationale": "<one or two sentences, plain language>", "flags": [{"type": "couple|timing|budget|duration|fit", "message": "<short practical heads-up>"}]}
flags must be [] when there is no practical concern.`
}

// deno-lint-ignore no-explicit-any
async function suggestFor(client: any, applicant: any, listings: any[], rooms: any[], openToCouples: boolean) {
  const raw = await callClaude(buildPrompt(applicant, listings, rooms, openToCouples))
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

// House reference copy (Notion "Recruiting Copy" → "Responding to Agape
// website's inquiries" — the template for people who applied TO US).
const REFERENCE_COPY = `Subject line: Hi from Agape! (co-op in the Mission)

Hi [name],

I'm [sender]. I saw your application to Agape and wanted to share details on a room that may be available for [date].

Here are the details:
1 bedroom is available in a 13 bedroom co-op in the Mission.
[one concrete line about the room — floor, light, street-facing, etc.]
$1490 covers rent, utilities, cleaners for common spaces
+$210 for shared organic groceries
Room available starting [date] [for 1-3 months / as a 3-month resident trial].

Come live with a bunch of artists, musicians, academics, and entrepreneurs. We have a weekly vegan gf family dinner meal and often do shared activities together.

agapesf.org
instagram.com/agapeandfriends

Let me know if you have any questions and if this sounds interesting to you!

[sender]`

// Draft a tailored outreach email for an applicant + their listing.
// deno-lint-ignore no-explicit-any
async function draftEmail(applicant: any, listing: any, room: any, flags: any[], senderName: string): Promise<{ subject: string; body: string }> {
  const trim = (t: string, n = 600) => (t || '').replace(/\s+/g, ' ').slice(0, n)
  const listingLine = listing
    ? `${room?.name || 'A room'} — ${listing.kind === 'resident' ? '3-month resident trial (full residency track, house vote at the end)' : 'short-term sublet'}, available from ${listing.starts_on}${listing.ends_on ? ` through ${listing.ends_on}` : ''}${listing.notes ? `. Notes: ${listing.notes}` : ''}`
    : 'No specific room right now — we want to keep them warm for future availability (general interest).'
  const conflictLines = (flags || []).map((f) => `- ${f.type}: ${f.message}`).join('\n') || '(none)'

  const prompt = `Draft a reply from ${senderName} at Agape (13-bedroom intentional community / co-op in a Victorian near Dolores Park, SF) to someone who ALREADY APPLIED to live at Agape. We reviewed their application and want to move forward.

REFERENCE COPY — match this voice and structure closely (warm, casual, concrete; this is the house's standard reply):
${REFERENCE_COPY}

APPLICANT (they applied to us — we have their full application)
Name: ${applicant.first_name}
Pronouns: ${applicant.pronouns || 'unknown'}
Track they applied for: ${applicant.residency}
Their move-in words: ${applicant.move_in}
Their budget words: ${applicant.budget}
Why they want Agape (their words): ${trim(applicant.why_agape)}

WHAT WE'RE OFFERING THEM
${listingLine}

PRACTICAL WRINKLES TO ADDRESS HONESTLY (one short, matter-of-fact line each):
${conflictLines}

Hard rules:
- This is a RESPONSE to their application, never cold outreach. Open by acknowledging their application to Agape ("thanks for applying", "we read your application", etc.). Do NOT introduce or pitch Agape as if they don't know it — they applied; skip the agapesf.org/instagram links and the "come live with artists..." pitch line entirely.
- Never say "apply on our website" — they already did. The CTA is the next step: answer questions, and invite them to come by (house dinner or a visit) / hop on a quick chat if the room sounds right.
- Reference one specific thing they wrote so it reads personally — ideally connect it to house life.
- Details block: tailor to the listing kind. Sublet → the window and dates matter most. Resident trial → explain plainly: the room starts as a 3-month trial, then the house votes on full residency. General interest → no room right now, we liked their application, we'll reach out when one opens (no details block).
- Keep the $1435-1490 + $210 groceries structure only when offering a room; set availability from the listing.
- Address wrinkles in one honest line ("heads up — the room opens Sep 1, a bit after your August timing; let us know if that still works").
- Under 160 words. Sign off with ${senderName}.
Return exactly: {"subject": "...", "body": "..."} — body with real newlines, no markdown.`

  const text = await callClaudeRaw(OPINION_MODEL, 'You write warm, concise community-house outreach emails. Respond with a single JSON object only.', prompt, 700)
  const parsed = JSON.parse(text.replace(/^```json?\s*|\s*```$/g, ''))
  return { subject: String(parsed.subject || 'Hi from Agape!').slice(0, 150), body: String(parsed.body || '').slice(0, 3000) }
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
    const [{ data: listings }, { data: rooms }, { data: settingsRows }] = await Promise.all([
      client.from('recruit_listings').select('*').eq('status', 'open'),
      client.from('recruit_rooms').select('*'),
      client.from('recruit_settings').select('*'),
    ])
    const openToCouples = (settingsRows || []).find((r) => r.key === 'open_to_couples')?.value !== false

    if (body.action === 'draft_email' && body.applicantId) {
      const { data: applicant } = await client.from('recruit_applicants').select('*').eq('id', String(body.applicantId)).maybeSingle()
      if (!applicant) return new Response(JSON.stringify({ error: 'Unknown applicant' }), { status: 404, headers: jsonHeaders })
      const { data: decision } = await client.from('recruit_decisions').select('listing_id').eq('applicant_id', applicant.id).maybeSingle()
      const { data: sug } = await client.from('recruit_match_suggestions').select('flags').eq('applicant_id', applicant.id).maybeSingle()
      const listing = decision?.listing_id ? (listings || []).find((l) => l.id === decision.listing_id) ||
        (await client.from('recruit_listings').select('*').eq('id', decision.listing_id).maybeSingle()).data : null
      const room = listing ? (rooms || []).find((r) => r.id === listing.room_id) : null
      const { data: prof } = await client.from('user_discord_membership').select('discord_username').eq('user_id', userData.user.id).maybeSingle()
      const draft = await draftEmail(applicant, listing, room, sug?.flags || [], prof?.discord_username || 'a housemate')
      return new Response(JSON.stringify(draft), { headers: jsonHeaders })
    }

    if (body.action === 'second_opinion' && body.applicantId) {
      const { data: applicant } = await client.from('recruit_applicants').select('*').eq('id', String(body.applicantId)).maybeSingle()
      if (!applicant) return new Response(JSON.stringify({ error: 'Unknown applicant' }), { status: 404, headers: jsonHeaders })
      const { data: notes } = await client.from('recruit_comments')
        .select('author_name, body').eq('applicant_id', applicant.id).neq('author_name', 'AI · second opinion').order('created_at')
      const text = await secondOpinion(client, applicant, notes || [], userData.user.id)
      return new Response(JSON.stringify({ opinion: text }), { headers: jsonHeaders })
    }

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
        const s = await suggestFor(client, applicant, listings || [], rooms || [], openToCouples)
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
