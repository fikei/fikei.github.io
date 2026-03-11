// Supabase Edge Function: import-source
// Ingests secondary taste signals from file exports (Spotify, YouTube Takeout).
// Client-side parses files → batches events → POSTs to this function.
// Signals are grouped by artist/channel, classified via Haiku, and stored in
// secondary_signals table. These feed the taste engine but are never shown as pins.
//
// POST /functions/v1/import-source
// Authorization: Bearer <user_access_token>
// Actions:
//   { action: 'create-job', source: 'spotify'|'youtube_takeout' }
//   { action: 'ingest-batch', jobId: string, source: string, batch: Event[] }
//   { action: 'complete-job', jobId: string }
//   { action: 'job-status', jobId: string }
//   { action: 'delete-source', source: string }

const VERSION = '1.0.0'
console.log(`[import-source] v${VERSION} - secondary signal ingestion`)

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient, SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MAX_HAIKU_CALLS_PER_JOB = 100
const HAIKU_BATCH_SIZE = 10          // subjects per Haiku call
const MIN_PLAY_MS = 30_000           // Spotify: ignore plays under 30 seconds
const MIN_PLAY_COUNT = 3             // artist/channel must appear 3+ times
const SIGNAL_WEIGHTS: Record<string, number> = {
  spotify: 0.3,
  youtube_takeout: 0.35,
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface SpotifyEvent {
  ts: string
  artistName: string
  trackName: string
  albumName?: string
  msPlayed: number
}

interface YouTubeTakeoutEvent {
  titleUrl?: string
  title?: string
  subtitles?: Array<{ name: string; url?: string }>
  time?: string
  snippet?: { title: string; channelTitle: string; publishedAt?: string }
}

interface Bucket {
  name: string
  count: number
  context: string[]       // representative track/video titles (up to 5)
  mostRecent: string      // ISO timestamp of most recent event
}

interface Classification {
  name: string
  taste_tags: string[]
  practical_tags: string[]
  entities: Array<{ type: string; name: string; confidence: number }>
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

function err(message: string, status = 400) {
  return json({ error: message }, status)
}

async function getUserId(req: Request): Promise<string | null> {
  const authHeader = req.headers.get('authorization')
  if (!authHeader) return null

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_ANON_KEY')!,
    { global: { headers: { Authorization: authHeader } } }
  )

  const { data: { user } } = await supabase.auth.getUser()
  return user?.id ?? null
}

function getServiceClient(): SupabaseClient {
  return createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  )
}

// ---------------------------------------------------------------------------
// Spotify: group raw events by artist
// ---------------------------------------------------------------------------

function groupSpotifyByArtist(events: SpotifyEvent[]): Bucket[] {
  const map = new Map<string, Bucket>()

  for (const e of events) {
    if (!e.artistName || e.msPlayed < MIN_PLAY_MS) continue

    const key = e.artistName.toLowerCase().trim()
    const existing = map.get(key)
    if (existing) {
      existing.count++
      if (existing.context.length < 5 && !existing.context.includes(e.trackName)) {
        existing.context.push(e.trackName)
      }
      if (e.ts > existing.mostRecent) existing.mostRecent = e.ts
    } else {
      map.set(key, {
        name: e.artistName,
        count: 1,
        context: e.trackName ? [e.trackName] : [],
        mostRecent: e.ts || new Date().toISOString(),
      })
    }
  }

  return [...map.values()]
    .filter(b => b.count >= MIN_PLAY_COUNT)
    .sort((a, b) => b.count - a.count)
}

// ---------------------------------------------------------------------------
// YouTube Takeout: group raw events by channel
// ---------------------------------------------------------------------------

function groupYouTubeByChannel(events: YouTubeTakeoutEvent[]): Bucket[] {
  const map = new Map<string, Bucket>()

  for (const e of events) {
    // watch-history.json: subtitles[0].name = channel
    // liked-videos: snippet.channelTitle
    const channelName = e.subtitles?.[0]?.name || e.snippet?.channelTitle
    if (!channelName) continue

    // Strip "Watched " prefix from Takeout titles
    let title = e.title || e.snippet?.title || ''
    if (title.startsWith('Watched ')) title = title.slice(8)

    const ts = e.time || e.snippet?.publishedAt || new Date().toISOString()
    const key = channelName.toLowerCase().trim()

    const existing = map.get(key)
    if (existing) {
      existing.count++
      if (existing.context.length < 5 && title && !existing.context.includes(title)) {
        existing.context.push(title)
      }
      if (ts > existing.mostRecent) existing.mostRecent = ts
    } else {
      map.set(key, {
        name: channelName,
        count: 1,
        context: title ? [title] : [],
        mostRecent: ts,
      })
    }
  }

  return [...map.values()]
    .filter(b => b.count >= 2)
    .sort((a, b) => b.count - a.count)
}

// ---------------------------------------------------------------------------
// Haiku classification: batch subjects for taste/practical tag extraction
// ---------------------------------------------------------------------------

async function classifyBatch(
  subjects: Array<{ name: string; context: string[] }>,
  mediaType: 'music' | 'video'
): Promise<Classification[]> {
  const apiKey = Deno.env.get('ANTHROPIC_API_KEY')
  if (!apiKey) {
    console.warn('[import-source] No ANTHROPIC_API_KEY — skipping classification')
    return subjects.map(s => ({
      name: s.name, taste_tags: [], practical_tags: [],
      entities: [{ type: mediaType === 'music' ? 'person' : 'brand', name: s.name, confidence: 0.85 }],
    }))
  }

  const subjectType = mediaType === 'music' ? 'artists' : 'YouTube channels'
  const contextLabel = mediaType === 'music' ? 'tracks' : 'videos'

  const prompt = `Classify these ${subjectType} for a personal taste profile.
For each, produce taste_tags (aesthetic/cultural/emotional vibe) and practical_tags (genre/format/topic).

${subjects.map((s, i) => `${i + 1}. ${s.name}${s.context.length ? ` — ${contextLabel}: ${s.context.slice(0, 3).join(', ')}` : ''}`).join('\n')}

Return a JSON array with one entry per subject (same order):
[{"name":"exact name","taste_tags":["3-6 tags"],"practical_tags":["3-5 tags"],"entities":[{"type":"person","name":"Name","confidence":0.9}]}]

Rules:
- taste_tags: vibe/aesthetic/mood, lowercase, underscores for spaces (e.g. lo_fi, melancholic, experimental, cinematic)
- practical_tags: factual genre/format/topic, lowercase (e.g. techno, ambient, cooking, documentary, indie_rock)
- entities: the ${mediaType === 'music' ? 'artist' : 'channel'} as person or brand, confidence >= 0.8
- 3-6 taste_tags and 3-5 practical_tags per subject
JSON array only, no other text.`

  try {
    const resp = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-3-5-haiku-20241022',
        max_tokens: 2048,
        messages: [{ role: 'user', content: prompt }],
      }),
    })

    if (!resp.ok) {
      console.error('[import-source] Haiku API error:', resp.status)
      return fallbackClassifications(subjects, mediaType)
    }

    const data = await resp.json()
    const text = data.content?.[0]?.text || ''
    const match = text.match(/\[[\s\S]*\]/)
    if (!match) return fallbackClassifications(subjects, mediaType)

    const parsed: Classification[] = JSON.parse(match[0])
    // Ensure we got the right count
    if (parsed.length !== subjects.length) return fallbackClassifications(subjects, mediaType)
    return parsed
  } catch (e) {
    console.error('[import-source] Haiku classification error:', e)
    return fallbackClassifications(subjects, mediaType)
  }
}

function fallbackClassifications(
  subjects: Array<{ name: string; context: string[] }>,
  mediaType: 'music' | 'video'
): Classification[] {
  return subjects.map(s => ({
    name: s.name,
    taste_tags: [],
    practical_tags: [],
    entities: [{ type: mediaType === 'music' ? 'person' : 'brand', name: s.name, confidence: 0.85 }],
  }))
}

// ---------------------------------------------------------------------------
// Insert classified signals into secondary_signals table
// ---------------------------------------------------------------------------

async function insertSignals(
  db: SupabaseClient,
  userId: string,
  jobId: string,
  source: string,
  classified: Array<Bucket & { classification: Classification }>
): Promise<number> {
  const sourceWeight = SIGNAL_WEIGHTS[source] ?? 0.3
  const category = source === 'spotify' ? 'listen' : 'watch'
  const contentType = source === 'spotify' ? 'music' : 'video'

  const rows = classified.map(b => ({
    user_id: userId,
    source,
    import_job_id: jobId,
    external_id: b.name.toLowerCase().trim().slice(0, 255),
    category,
    content_type: contentType,
    taste_tags: b.classification.taste_tags || [],
    practical_tags: b.classification.practical_tags || [],
    entities: b.classification.entities || [],
    source_weight: sourceWeight,
    created_at: b.mostRecent,
  }))

  let inserted = 0
  // Upsert in chunks of 100
  for (let i = 0; i < rows.length; i += 100) {
    const chunk = rows.slice(i, i + 100)
    const { error, count } = await db
      .from('secondary_signals')
      .upsert(chunk, { onConflict: 'user_id,source,external_id', count: 'exact' })

    if (error) {
      console.error('[import-source] Insert error:', error.message)
    } else {
      inserted += count ?? chunk.length
    }
  }

  return inserted
}

// ---------------------------------------------------------------------------
// Action handlers
// ---------------------------------------------------------------------------

async function handleCreateJob(
  body: { source: string },
  userId: string
): Promise<Response> {
  const { source } = body
  if (!source || !SIGNAL_WEIGHTS[source]) {
    return err(`Invalid source: ${source}. Supported: ${Object.keys(SIGNAL_WEIGHTS).join(', ')}`)
  }

  const db = getServiceClient()

  // Delete previous signals from same source (fresh import replaces old)
  await db
    .from('secondary_signals')
    .delete()
    .eq('user_id', userId)
    .eq('source', source)

  const { data, error } = await db
    .from('import_jobs')
    .insert({ user_id: userId, source, status: 'pending' })
    .select('id')
    .single()

  if (error) return err(`Failed to create job: ${error.message}`, 500)

  console.log(`[import-source] Created job ${data.id} for ${source}`)
  return json({ jobId: data.id })
}

async function handleIngestBatch(
  body: { jobId: string; source: string; batch: unknown[] },
  userId: string
): Promise<Response> {
  const { jobId, source, batch } = body
  if (!jobId || !source || !Array.isArray(batch) || batch.length === 0) {
    return err('Missing jobId, source, or empty batch')
  }

  const db = getServiceClient()

  // Verify job ownership and get current state
  const { data: job, error: jobErr } = await db
    .from('import_jobs')
    .select('*')
    .eq('id', jobId)
    .eq('user_id', userId)
    .single()

  if (jobErr || !job) return err('Job not found', 404)
  if (job.status === 'complete' || job.status === 'error') {
    return err(`Job already ${job.status}`)
  }

  // Update job to processing
  if (job.status === 'pending') {
    await db.from('import_jobs').update({ status: 'processing' }).eq('id', jobId)
  }

  // Group events by artist/channel
  let buckets: Bucket[]
  const mediaType = source === 'spotify' ? 'music' : 'video'

  if (source === 'spotify') {
    buckets = groupSpotifyByArtist(batch as SpotifyEvent[])
  } else if (source === 'youtube_takeout') {
    buckets = groupYouTubeByChannel(batch as YouTubeTakeoutEvent[])
  } else {
    return err(`Unknown source: ${source}`)
  }

  // Classify via Haiku (batched, budget-capped)
  const haikuBudget = MAX_HAIKU_CALLS_PER_JOB - (job.haiku_calls_made || 0)
  const maxSubjects = haikuBudget * HAIKU_BATCH_SIZE
  const toClassify = buckets.slice(0, maxSubjects)
  const unclassified = buckets.slice(maxSubjects)

  let haikuCallsMade = 0
  const classified: Array<Bucket & { classification: Classification }> = []

  // Process in Haiku batches
  for (let i = 0; i < toClassify.length; i += HAIKU_BATCH_SIZE) {
    const subjectBatch = toClassify.slice(i, i + HAIKU_BATCH_SIZE)
    const classifications = await classifyBatch(
      subjectBatch.map(b => ({ name: b.name, context: b.context })),
      mediaType as 'music' | 'video'
    )
    haikuCallsMade++

    for (let j = 0; j < subjectBatch.length; j++) {
      classified.push({
        ...subjectBatch[j],
        classification: classifications[j] || { name: subjectBatch[j].name, taste_tags: [], practical_tags: [], entities: [] },
      })
    }
  }

  // Unclassified subjects: entity only, no tags
  for (const b of unclassified) {
    classified.push({
      ...b,
      classification: {
        name: b.name,
        taste_tags: [],
        practical_tags: [],
        entities: [{ type: mediaType === 'music' ? 'person' : 'brand', name: b.name, confidence: 0.85 }],
      },
    })
  }

  // Insert signals
  const signalsCreated = await insertSignals(db, userId, jobId, source, classified)

  // Update job progress
  await db.from('import_jobs').update({
    processed_events: (job.processed_events || 0) + batch.length,
    signals_created: (job.signals_created || 0) + signalsCreated,
    haiku_calls_made: (job.haiku_calls_made || 0) + haikuCallsMade,
  }).eq('id', jobId)

  console.log(`[import-source] Batch: ${batch.length} events → ${buckets.length} buckets → ${signalsCreated} signals (${haikuCallsMade} Haiku calls)`)

  return json({
    processedEvents: batch.length,
    bucketsFound: buckets.length,
    signalsCreated,
    haikuCallsMade,
  })
}

async function handleCompleteJob(
  body: { jobId: string },
  userId: string
): Promise<Response> {
  const { jobId } = body
  if (!jobId) return err('Missing jobId')

  const db = getServiceClient()

  const { data: job, error: jobErr } = await db
    .from('import_jobs')
    .select('*')
    .eq('id', jobId)
    .eq('user_id', userId)
    .single()

  if (jobErr || !job) return err('Job not found', 404)

  // Mark complete
  await db.from('import_jobs').update({
    status: 'complete',
    completed_at: new Date().toISOString(),
  }).eq('id', jobId)

  // Fire-and-forget: trigger taste engine full pipeline
  const fnUrl = `${Deno.env.get('SUPABASE_URL')}/functions/v1/taste-engine`
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  fetch(fnUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${serviceKey}` },
    body: JSON.stringify({ action: 'full-pipeline', userId }),
  }).catch(e => console.error('[import-source] taste-engine trigger error:', e))

  console.log(`[import-source] Job ${jobId} complete: ${job.signals_created} signals, ${job.haiku_calls_made} Haiku calls`)

  return json({
    status: 'complete',
    totalEvents: job.processed_events,
    signalsCreated: job.signals_created,
    haikuCallsMade: job.haiku_calls_made,
  })
}

async function handleJobStatus(
  body: { jobId: string },
  userId: string
): Promise<Response> {
  const { jobId } = body
  if (!jobId) return err('Missing jobId')

  const db = getServiceClient()
  const { data, error } = await db
    .from('import_jobs')
    .select('*')
    .eq('id', jobId)
    .eq('user_id', userId)
    .single()

  if (error || !data) return err('Job not found', 404)

  return json(data)
}

async function handleDeleteSource(
  body: { source: string },
  userId: string
): Promise<Response> {
  const { source } = body
  if (!source) return err('Missing source')

  const db = getServiceClient()

  const { count } = await db
    .from('secondary_signals')
    .delete()
    .eq('user_id', userId)
    .eq('source', source)

  console.log(`[import-source] Deleted ${count} signals for ${source}`)

  // Trigger taste engine recompute
  const fnUrl = `${Deno.env.get('SUPABASE_URL')}/functions/v1/taste-engine`
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  fetch(fnUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${serviceKey}` },
    body: JSON.stringify({ action: 'full-pipeline', userId }),
  }).catch(e => console.error('[import-source] taste-engine trigger error:', e))

  return json({ deleted: count })
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const userId = await getUserId(req)
    if (!userId) return err('Not authenticated', 401)

    const body = await req.json()
    const { action } = body

    switch (action) {
      case 'create-job':    return await handleCreateJob(body, userId)
      case 'ingest-batch':  return await handleIngestBatch(body, userId)
      case 'complete-job':  return await handleCompleteJob(body, userId)
      case 'job-status':    return await handleJobStatus(body, userId)
      case 'delete-source': return await handleDeleteSource(body, userId)
      default:              return err(`Unknown action: ${action}`)
    }
  } catch (e) {
    console.error('[import-source] Error:', e)
    return err(`Internal error: ${e.message}`, 500)
  }
})
