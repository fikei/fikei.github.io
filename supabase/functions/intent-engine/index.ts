// Supabase Edge Function: intent-engine
// Temporal intent clustering — Sessions (L2), Journeys (L3)
// Future: Hypotheses (L4), Predictions (L5) via LLM
//
// POST /functions/v1/intent-engine
// Body: { action, userId }
// Actions:
//   'detect-sessions'  — L2: cluster pins by time proximity (algorithmic)
//   'link-journeys'    — L3: link sessions by topic overlap into arcs (algorithmic)
//   'hypothesize'      — L4: LLM goal statement per journey (Phase 2, stubbed)
//   'predict'          — L5: LLM actionable suggestions (Phase 3, stubbed)
//   'full-pipeline'    — Run all levels in sequence
//   'get-profile'      — Return current intent state (read-only)
//   'health'           — Version check

const VERSION = '0.1.0'
console.log(`[intent-engine] v${VERSION} — session + journey detection`)

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient, SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}
const jsonHeaders = { ...corsHeaders, 'Content-Type': 'application/json' }

// --- Supabase client (service role for DB writes) ---

function getSupabase(): SupabaseClient {
  const url = Deno.env.get('SUPABASE_URL')!
  const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  return createClient(url, key)
}

// --- Types ---

interface PinRow {
  id: string
  user_id: string
  title: string | null
  category: string
  taste_tags: string[] | null
  practical_tags: string[] | null
  content_type: string | null
  created_at: string
}

interface IntentRow {
  link_id: string
  intent: string
  action_state: string
  horizon: string
}

interface Session {
  id?: string
  user_id?: string
  started_at: string
  ended_at: string
  pin_ids: string[]
  category_mix: Record<string, number>
  topic_tags: string[]
  intent_mix: Record<string, number>
  session_length_minutes: number
}

interface Journey {
  id?: string
  user_id?: string
  session_ids: string[]
  pin_ids: string[]
  topic_tags: string[]
  state: string
  hypothesis: string | null
  confidence: number
  first_pin_at: string
  last_pin_at: string
}

// --- Constants ---

const SESSION_GAP_MS = 60 * 60 * 1000  // 60 minutes between saves = new session
const SESSION_MIN_PINS = 2              // minimum pins to form a session
const MIN_OVERLAP_TAGS = 2              // minimum tag overlap to link sessions
const DORMANT_DAYS = 14                 // journey dormant after 14 days
const ABANDONED_DAYS = 30               // journey abandoned after 30 days
const JOURNEY_OVERLAP_THRESHOLD = 0.5   // 50% pin overlap to preserve journey ID
const MAX_TOPIC_TAGS = 15               // cap topic tags per session

// --- Helpers ---

function daysSince(dateStr: string): number {
  return Math.max(0, (Date.now() - new Date(dateStr).getTime()) / (1000 * 60 * 60 * 24))
}

function frequency(arr: string[]): Map<string, number> {
  const counts = new Map<string, number>()
  for (const item of arr) {
    counts.set(item, (counts.get(item) || 0) + 1)
  }
  return counts
}

function topN(freqMap: Map<string, number>, n: number): string[] {
  return [...freqMap.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, n)
    .map(([key]) => key)
}

function mode(arr: string[]): string {
  const freq = frequency(arr)
  let best = arr[0] || 'appreciate'
  let bestCount = 0
  for (const [key, count] of freq) {
    if (count > bestCount) { best = key; bestCount = count }
  }
  return best
}

function setIntersection(a: Set<string>, b: Set<string>): Set<string> {
  const result = new Set<string>()
  for (const item of a) {
    if (b.has(item)) result.add(item)
  }
  return result
}

function setUnion(a: Set<string>, b: Set<string>): Set<string> {
  const result = new Set(a)
  for (const item of b) result.add(item)
  return result
}

// --- Data Fetching ---

async function fetchPins(supabase: SupabaseClient, userId: string): Promise<PinRow[]> {
  const { data, error } = await supabase
    .from('links')
    .select('id, user_id, title, category, taste_tags, practical_tags, content_type, created_at')
    .eq('user_id', userId)
    .order('created_at', { ascending: true })

  if (error) {
    console.error('[intent-engine] Error fetching pins:', error)
    return []
  }
  return data || []
}

async function fetchIntents(supabase: SupabaseClient, userId: string): Promise<Map<string, IntentRow>> {
  const { data, error } = await supabase
    .from('pin_intent')
    .select('link_id, intent, action_state, horizon')
    .eq('user_id', userId)

  if (error) {
    console.error('[intent-engine] Error fetching intents:', error)
    return new Map()
  }

  const map = new Map<string, IntentRow>()
  for (const row of (data || [])) {
    map.set(row.link_id, row)
  }
  return map
}

// =====================================================================
// LEVEL 2: SESSION DETECTION (algorithmic, no LLM)
// Groups pins into temporal clusters. A session = activity burst.
// =====================================================================

function detectSessions(pins: PinRow[], intents: Map<string, IntentRow>): Session[] {
  if (pins.length === 0) return []

  // Pins should already be sorted by created_at ascending from the query
  const sorted = [...pins].sort((a, b) =>
    new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
  )

  const rawSessions: { pins: PinRow[], startedAt: number, lastPinAt: number }[] = []
  let current: { pins: PinRow[], startedAt: number, lastPinAt: number } | null = null

  for (const pin of sorted) {
    const pinTime = new Date(pin.created_at).getTime()

    if (!current || (pinTime - current.lastPinAt) > SESSION_GAP_MS) {
      // Start new session
      if (current) rawSessions.push(current)
      current = { pins: [pin], startedAt: pinTime, lastPinAt: pinTime }
    } else {
      // Extend current session
      current.pins.push(pin)
      current.lastPinAt = pinTime
    }
  }
  if (current) rawSessions.push(current)

  // Finalize: only keep sessions with >= MIN_PINS
  const sessions: Session[] = []
  for (const raw of rawSessions) {
    if (raw.pins.length < SESSION_MIN_PINS) continue
    sessions.push(finalizeSession(raw.pins, raw.startedAt, raw.lastPinAt, intents))
  }

  return sessions
}

function finalizeSession(
  pins: PinRow[],
  startedAt: number,
  lastPinAt: number,
  intents: Map<string, IntentRow>
): Session {
  // Collect all tags from pins
  const allTags: string[] = []
  const categoryCount: Record<string, number> = {}
  const intentCount: Record<string, number> = { acquire: 0, reference: 0, appreciate: 0 }

  for (const pin of pins) {
    // Category mix
    categoryCount[pin.category] = (categoryCount[pin.category] || 0) + 1

    // Topic tags: union of taste_tags + practical_tags
    const tasteTags = pin.taste_tags || []
    const practicalTags = pin.practical_tags || []
    allTags.push(...tasteTags, ...practicalTags)

    // Intent mix from pin_intent table
    const intent = intents.get(pin.id)
    const intentType = intent?.intent || 'appreciate'
    if (intentType in intentCount) {
      intentCount[intentType]++
    } else {
      intentCount.appreciate++
    }
  }

  // Dedupe and cap topic tags
  const topicTags = topN(frequency(allTags), MAX_TOPIC_TAGS)

  // Session length in minutes
  const lengthMs = lastPinAt - startedAt
  const lengthMinutes = Math.round(lengthMs / 60000 * 10) / 10

  return {
    started_at: new Date(startedAt).toISOString(),
    ended_at: new Date(lastPinAt).toISOString(),
    pin_ids: pins.map(p => p.id),
    category_mix: categoryCount,
    topic_tags: topicTags,
    intent_mix: intentCount,
    session_length_minutes: lengthMinutes,
  }
}

async function saveSessions(
  supabase: SupabaseClient,
  userId: string,
  sessions: Session[]
): Promise<string[]> {
  // Full rebuild: delete all existing sessions for this user
  const { error: deleteErr } = await supabase
    .from('intent_sessions')
    .delete()
    .eq('user_id', userId)

  if (deleteErr) {
    console.error('[intent-engine] Error deleting old sessions:', deleteErr)
  }

  if (sessions.length === 0) return []

  // Batch insert in chunks of 50
  const savedIds: string[] = []
  for (let i = 0; i < sessions.length; i += 50) {
    const chunk = sessions.slice(i, i + 50).map(s => ({
      user_id: userId,
      started_at: s.started_at,
      ended_at: s.ended_at,
      pin_ids: s.pin_ids,
      category_mix: s.category_mix,
      topic_tags: s.topic_tags,
      intent_mix: s.intent_mix,
      session_length_minutes: s.session_length_minutes,
    }))

    const { data, error } = await supabase
      .from('intent_sessions')
      .insert(chunk)
      .select('id')

    if (error) {
      console.error(`[intent-engine] Error inserting sessions chunk ${i}:`, error)
    } else if (data) {
      savedIds.push(...data.map((d: { id: string }) => d.id))
    }
  }

  console.log(`[intent-engine] Saved ${savedIds.length} sessions for user ${userId.slice(0, 8)}`)
  return savedIds
}

// =====================================================================
// LEVEL 3: JOURNEY LINKING (algorithmic, no LLM)
// Connects sessions by topic overlap into multi-session arcs.
// =====================================================================

interface SessionWithId extends Session {
  id: string
}

function linkJourneys(sessions: SessionWithId[], intents: Map<string, IntentRow>): Journey[] {
  if (sessions.length < 2) return []

  // Build topic sets per session
  const topicSets = sessions.map(s => new Set(s.topic_tags))

  // Build adjacency graph: sessions connected if they share >= MIN_OVERLAP_TAGS
  const adjacency: Set<number>[] = sessions.map(() => new Set())
  for (let i = 0; i < sessions.length; i++) {
    for (let j = i + 1; j < sessions.length; j++) {
      const overlap = setIntersection(topicSets[i], topicSets[j])
      if (overlap.size >= MIN_OVERLAP_TAGS) {
        adjacency[i].add(j)
        adjacency[j].add(i)
      }
    }
  }

  // Find connected components via BFS
  const visited = new Set<number>()
  const components: number[][] = []

  for (let i = 0; i < sessions.length; i++) {
    if (visited.has(i)) continue
    const component: number[] = []
    const queue = [i]
    visited.add(i)
    while (queue.length > 0) {
      const node = queue.shift()!
      component.push(node)
      for (const neighbor of adjacency[node]) {
        if (!visited.has(neighbor)) {
          visited.add(neighbor)
          queue.push(neighbor)
        }
      }
    }
    components.push(component)
  }

  // Convert components to journeys (skip single-session components)
  const journeys: Journey[] = []
  for (const component of components) {
    if (component.length < 2) continue

    const componentSessions = component.map(i => sessions[i])

    // Collect all pin IDs and session IDs
    const allPinIds = new Set<string>()
    const sessionIds: string[] = []
    for (const s of componentSessions) {
      sessionIds.push(s.id)
      for (const pid of s.pin_ids) allPinIds.add(pid)
    }

    // Topic tags = intersection of all session tags (common thread)
    let commonTags = new Set(componentSessions[0].topic_tags)
    for (let i = 1; i < componentSessions.length; i++) {
      commonTags = setIntersection(commonTags, new Set(componentSessions[i].topic_tags))
    }

    // If intersection is too small, use union of top tags instead
    if (commonTags.size < 2) {
      const allTags: string[] = []
      for (const s of componentSessions) allTags.push(...s.topic_tags)
      commonTags = new Set(topN(frequency(allTags), 10))
    }

    // Time bounds
    const timestamps = componentSessions.map(s => new Date(s.started_at).getTime())
    const endTimestamps = componentSessions.map(s => new Date(s.ended_at).getTime())
    const firstPinAt = new Date(Math.min(...timestamps)).toISOString()
    const lastPinAt = new Date(Math.max(...endTimestamps)).toISOString()

    // Aggregate intent mix across sessions
    const aggregateIntentMix: Record<string, number> = { acquire: 0, reference: 0, appreciate: 0 }
    for (const s of componentSessions) {
      for (const [intent, count] of Object.entries(s.intent_mix)) {
        aggregateIntentMix[intent] = (aggregateIntentMix[intent] || 0) + (count as number)
      }
    }

    // Infer state
    const state = inferJourneyState(
      [...allPinIds],
      lastPinAt,
      aggregateIntentMix,
      intents
    )

    journeys.push({
      session_ids: sessionIds,
      pin_ids: [...allPinIds],
      topic_tags: [...commonTags],
      state,
      hypothesis: null,
      confidence: 0.3,
      first_pin_at: firstPinAt,
      last_pin_at: lastPinAt,
    })
  }

  return journeys
}

function inferJourneyState(
  pinIds: string[],
  lastPinAt: string,
  intentMix: Record<string, number>,
  intents: Map<string, IntentRow>
): string {
  const daysSinceLast = daysSince(lastPinAt)
  const totalIntents = Object.values(intentMix).reduce((a, b) => a + b, 0)
  const acquireRatio = totalIntents > 0 ? (intentMix.acquire || 0) / totalIntents : 0

  // Check if most acquire pins are done
  if (acquireRatio > 0.3) {
    let doneCount = 0
    let acquireCount = 0
    for (const pid of pinIds) {
      const intent = intents.get(pid)
      if (intent?.intent === 'acquire') {
        acquireCount++
        if (intent.action_state === 'done') doneCount++
      }
    }
    if (acquireCount > 0 && doneCount / acquireCount > 0.75) return 'done'
  }

  if (daysSinceLast > ABANDONED_DAYS) return 'abandoned'
  if (daysSinceLast > DORMANT_DAYS) return 'dormant'

  // Intent-based state
  if (acquireRatio > 0.5) return 'acquiring'
  if (pinIds.length >= 10) return 'deciding'
  if (pinIds.length >= 5) return 'researching'
  return 'exploring'
}

async function saveJourneys(
  supabase: SupabaseClient,
  userId: string,
  journeys: Journey[]
): Promise<void> {
  // Load existing journeys for ID stability check
  const { data: existing } = await supabase
    .from('intent_journeys')
    .select('id, pin_ids, hypothesis')
    .eq('user_id', userId)

  const existingJourneys = existing || []

  // For each new journey, check if it overlaps enough with an existing one
  // to preserve the ID (and keep the hypothesis text)
  for (const journey of journeys) {
    const newPinSet = new Set(journey.pin_ids)

    for (const old of existingJourneys) {
      const oldPinSet = new Set(old.pin_ids as string[])
      const overlap = setIntersection(newPinSet, oldPinSet)
      const overlapRatio = oldPinSet.size > 0
        ? overlap.size / oldPinSet.size
        : 0

      if (overlapRatio >= JOURNEY_OVERLAP_THRESHOLD) {
        journey.id = old.id
        // Preserve existing hypothesis if we don't have a new one
        if (!journey.hypothesis && old.hypothesis) {
          journey.hypothesis = old.hypothesis
        }
        break
      }
    }
  }

  // Delete all existing journeys
  const { error: deleteErr } = await supabase
    .from('intent_journeys')
    .delete()
    .eq('user_id', userId)

  if (deleteErr) {
    console.error('[intent-engine] Error deleting old journeys:', deleteErr)
  }

  if (journeys.length === 0) return

  // Insert new journeys (use preserved IDs where available)
  for (let i = 0; i < journeys.length; i += 50) {
    const chunk = journeys.slice(i, i + 50).map(j => {
      const row: Record<string, unknown> = {
        user_id: userId,
        session_ids: j.session_ids,
        pin_ids: j.pin_ids,
        topic_tags: j.topic_tags,
        state: j.state,
        hypothesis: j.hypothesis,
        confidence: j.confidence,
        first_pin_at: j.first_pin_at,
        last_pin_at: j.last_pin_at,
      }
      // Preserve ID if we matched an existing journey
      if (j.id) row.id = j.id
      return row
    })

    const { error } = await supabase
      .from('intent_journeys')
      .insert(chunk)

    if (error) {
      console.error(`[intent-engine] Error inserting journeys chunk ${i}:`, error)
    }
  }

  console.log(`[intent-engine] Saved ${journeys.length} journeys for user ${userId.slice(0, 8)}`)
}

// =====================================================================
// GET PROFILE (read-only, returns current intent state)
// =====================================================================

async function getProfile(supabase: SupabaseClient, userId: string) {
  const [sessions, journeys, predictions] = await Promise.all([
    supabase
      .from('intent_sessions')
      .select('*')
      .eq('user_id', userId)
      .order('started_at', { ascending: false })
      .limit(20),
    supabase
      .from('intent_journeys')
      .select('*')
      .eq('user_id', userId)
      .order('last_pin_at', { ascending: false }),
    supabase
      .from('intent_predictions')
      .select('*')
      .eq('user_id', userId)
      .maybeSingle(),
  ])

  return {
    sessions: sessions.data || [],
    journeys: journeys.data || [],
    predictions: predictions.data?.predictions || [],
  }
}

// =====================================================================
// MAIN HANDLER
// =====================================================================

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const body = await req.json()
    const { action, userId } = body

    if (!action) {
      return new Response(
        JSON.stringify({ error: 'Missing required field: action' }),
        { status: 400, headers: jsonHeaders }
      )
    }

    // Health check (no auth needed)
    if (action === 'health') {
      return new Response(
        JSON.stringify({ status: 'ok', version: VERSION }),
        { headers: jsonHeaders }
      )
    }

    if (!userId) {
      return new Response(
        JSON.stringify({ error: 'Missing required field: userId' }),
        { status: 400, headers: jsonHeaders }
      )
    }

    const supabase = getSupabase()
    const startTime = Date.now()
    const pipelineLog: string[] = []

    // --- get-profile: read-only ---
    if (action === 'get-profile') {
      const profile = await getProfile(supabase, userId)
      return new Response(
        JSON.stringify({
          profile,
          meta: { elapsed: Date.now() - startTime, version: VERSION },
        }),
        { headers: jsonHeaders }
      )
    }

    // --- Fetch data for compute actions ---
    const pins = await fetchPins(supabase, userId)
    const intents = await fetchIntents(supabase, userId)
    pipelineLog.push(`Fetched ${pins.length} pins, ${intents.size} intents`)

    let savedSessionIds: string[] = []

    // --- L2: detect-sessions ---
    if (action === 'detect-sessions' || action === 'full-pipeline') {
      const sessions = detectSessions(pins, intents)
      savedSessionIds = await saveSessions(supabase, userId, sessions)
      pipelineLog.push(`Detected ${sessions.length} sessions (${savedSessionIds.length} saved)`)

      if (action === 'detect-sessions') {
        return new Response(
          JSON.stringify({
            sessions,
            meta: { pinCount: pins.length, elapsed: Date.now() - startTime, version: VERSION },
          }),
          { headers: jsonHeaders }
        )
      }
    }

    // --- L3: link-journeys ---
    if (action === 'link-journeys' || action === 'full-pipeline') {
      // Load sessions from DB (either just saved or existing)
      const { data: dbSessions } = await supabase
        .from('intent_sessions')
        .select('*')
        .eq('user_id', userId)
        .order('started_at', { ascending: true })

      const sessionsWithId = (dbSessions || []) as SessionWithId[]
      const journeys = linkJourneys(sessionsWithId, intents)
      await saveJourneys(supabase, userId, journeys)
      pipelineLog.push(`Linked ${journeys.length} journeys from ${sessionsWithId.length} sessions`)

      if (action === 'link-journeys') {
        return new Response(
          JSON.stringify({
            journeys,
            meta: { sessionCount: sessionsWithId.length, elapsed: Date.now() - startTime, version: VERSION },
          }),
          { headers: jsonHeaders }
        )
      }
    }

    // --- L4: hypothesize (Phase 2 — stubbed) ---
    if (action === 'hypothesize' || action === 'full-pipeline') {
      pipelineLog.push('Hypothesize: stubbed (Phase 2)')

      if (action === 'hypothesize') {
        return new Response(
          JSON.stringify({
            message: 'Hypothesize action is not yet implemented (Phase 2)',
            meta: { elapsed: Date.now() - startTime, version: VERSION },
          }),
          { headers: jsonHeaders }
        )
      }
    }

    // --- L5: predict (Phase 3 — stubbed) ---
    if (action === 'predict' || action === 'full-pipeline') {
      pipelineLog.push('Predict: stubbed (Phase 3)')

      if (action === 'predict') {
        return new Response(
          JSON.stringify({
            message: 'Predict action is not yet implemented (Phase 3)',
            meta: { elapsed: Date.now() - startTime, version: VERSION },
          }),
          { headers: jsonHeaders }
        )
      }
    }

    // --- full-pipeline terminal ---
    if (action === 'full-pipeline') {
      const profile = await getProfile(supabase, userId)
      return new Response(
        JSON.stringify({
          profile,
          meta: {
            pinCount: pins.length,
            elapsed: Date.now() - startTime,
            version: VERSION,
          },
          debug: pipelineLog,
        }),
        { headers: jsonHeaders }
      )
    }

    // Unknown action
    return new Response(
      JSON.stringify({ error: `Unknown action: ${action}` }),
      { status: 400, headers: jsonHeaders }
    )

  } catch (err) {
    console.error('[intent-engine] Error:', err)
    return new Response(
      JSON.stringify({ error: 'Internal error', detail: String(err) }),
      { status: 500, headers: jsonHeaders }
    )
  }
})
