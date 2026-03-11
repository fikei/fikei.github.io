// Supabase Edge Function: youtube-import
// Handles YouTube OAuth connection and imports liked videos + playlists
// as secondary signals (source_weight = 0.6) for the taste engine.
// Higher intent than watch history (0.35) but lower than user-saved pins (1.0).
//
// POST /functions/v1/youtube-import
// Body:
//   { action: 'connect', code: string, redirect_uri: string }
//   { action: 'import', import_type: 'liked' | 'playlists' | 'all' }
//   { action: 'disconnect' }
//   { action: 'status' }

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient, SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2'

const VERSION = '2.0.0'
console.log(`[youtube-import] v${VERSION} - liked videos & playlists → secondary signals`)

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const YOUTUBE_API_BASE = 'https://www.googleapis.com/youtube/v3'
const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token'
const MAX_LIKED_VIDEOS = 500
const MAX_PLAYLISTS = 50
const PAGE_SIZE = 50
const SOURCE_WEIGHT = 0.6             // higher than takeout (0.35) but lower than pins (1.0)
const HAIKU_BATCH_SIZE = 10           // subjects per Haiku call
const MAX_HAIKU_CALLS = 100           // per import operation
const MIN_VIDEO_COUNT = 2             // channel must appear 2+ times

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface YouTubePlaylistItem {
  snippet: {
    title: string
    description: string
    channelTitle: string
    publishedAt: string
    resourceId: { videoId: string }
    thumbnails?: { high?: { url: string }; medium?: { url: string }; default?: { url: string } }
    position: number
    videoOwnerChannelTitle?: string
    videoOwnerChannelId?: string
  }
  contentDetails?: {
    videoId: string
    videoPublishedAt?: string
  }
}

interface YouTubePlaylist {
  id: string
  snippet: {
    title: string
    description: string
    publishedAt: string
    channelTitle: string
    thumbnails?: { high?: { url: string } }
  }
  contentDetails?: {
    itemCount: number
  }
}

interface ConnectedAccount {
  id: string
  user_id: string
  platform: string
  access_token: string
  refresh_token: string | null
  token_expires_at: string | null
  scopes: string[]
  platform_user_id: string | null
  platform_username: string | null
  status: string
  last_import_at: string | null
  last_import_count: number
}

interface Bucket {
  name: string
  count: number
  context: string[]       // representative video titles (up to 5)
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

/** Extract user_id from the Authorization header JWT */
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

/** Get a service-role Supabase client for DB operations */
function getServiceClient(): SupabaseClient {
  return createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  )
}

/** Fetch from YouTube API with access token */
async function ytFetch(path: string, accessToken: string): Promise<Response> {
  const resp = await fetch(`${YOUTUBE_API_BASE}${path}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  })
  if (!resp.ok) {
    const body = await resp.text()
    throw new Error(`YouTube API ${resp.status}: ${body}`)
  }
  return resp
}

/** Refresh an expired Google OAuth token */
async function refreshToken(account: ConnectedAccount, db: SupabaseClient): Promise<string> {
  if (!account.refresh_token) {
    throw new Error('No refresh token available — user must reconnect')
  }

  const resp = await fetch(GOOGLE_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: Deno.env.get('YOUTUBE_CLIENT_ID')!,
      client_secret: Deno.env.get('YOUTUBE_CLIENT_SECRET')!,
      refresh_token: account.refresh_token,
      grant_type: 'refresh_token',
    }),
  })

  if (!resp.ok) {
    const body = await resp.text()
    console.error(`[youtube-import] Token refresh failed: ${resp.status} ${body}`)
    await db.from('connected_accounts').update({ status: 'expired' }).eq('id', account.id)
    throw new Error('Token refresh failed — user must reconnect')
  }

  const tokens = await resp.json()
  const expiresAt = new Date(Date.now() + tokens.expires_in * 1000).toISOString()

  await db.from('connected_accounts').update({
    access_token: tokens.access_token,
    token_expires_at: expiresAt,
    status: 'active',
  }).eq('id', account.id)

  return tokens.access_token
}

/** Get a valid access token, refreshing if needed */
async function getValidToken(account: ConnectedAccount, db: SupabaseClient): Promise<string> {
  if (account.token_expires_at) {
    const expiresAt = new Date(account.token_expires_at)
    const fiveMinFromNow = new Date(Date.now() + 5 * 60 * 1000)
    if (expiresAt < fiveMinFromNow) {
      return await refreshToken(account, db)
    }
  }
  return account.access_token
}

// ---------------------------------------------------------------------------
// Group fetched videos by channel → Buckets
// ---------------------------------------------------------------------------

function groupByChannel(items: YouTubePlaylistItem[]): Bucket[] {
  const map = new Map<string, Bucket>()

  for (const item of items) {
    const channelName = item.snippet.videoOwnerChannelTitle || item.snippet.channelTitle
    if (!channelName) continue

    const title = item.snippet.title || ''
    const ts = item.contentDetails?.videoPublishedAt || item.snippet.publishedAt || new Date().toISOString()
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
    .filter(b => b.count >= MIN_VIDEO_COUNT)
    .sort((a, b) => b.count - a.count)
}

// ---------------------------------------------------------------------------
// Haiku classification (same pattern as import-source)
// ---------------------------------------------------------------------------

async function classifyBatch(
  subjects: Array<{ name: string; context: string[] }>
): Promise<Classification[]> {
  const apiKey = Deno.env.get('ANTHROPIC_API_KEY')
  if (!apiKey) {
    console.warn('[youtube-import] No ANTHROPIC_API_KEY — skipping classification')
    return fallbackClassifications(subjects)
  }

  const prompt = `Classify these YouTube channels for a personal taste profile.
For each, produce taste_tags (aesthetic/cultural/emotional vibe) and practical_tags (genre/format/topic).

${subjects.map((s, i) => `${i + 1}. ${s.name}${s.context.length ? ` — videos: ${s.context.slice(0, 3).join(', ')}` : ''}`).join('\n')}

Return a JSON array with one entry per channel (same order):
[{"name":"exact name","taste_tags":["3-6 tags"],"practical_tags":["3-5 tags"],"entities":[{"type":"brand","name":"Name","confidence":0.9}]}]

Rules:
- taste_tags: vibe/aesthetic/mood, lowercase, underscores for spaces (e.g. lo_fi, melancholic, experimental, cinematic)
- practical_tags: factual genre/format/topic, lowercase (e.g. techno, ambient, cooking, documentary, indie_rock)
- entities: the channel as brand or person, confidence >= 0.8
- 3-6 taste_tags and 3-5 practical_tags per channel
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
      console.error('[youtube-import] Haiku API error:', resp.status)
      return fallbackClassifications(subjects)
    }

    const data = await resp.json()
    const text = data.content?.[0]?.text || ''
    const match = text.match(/\[[\s\S]*\]/)
    if (!match) return fallbackClassifications(subjects)

    const parsed: Classification[] = JSON.parse(match[0])
    if (parsed.length !== subjects.length) return fallbackClassifications(subjects)
    return parsed
  } catch (e) {
    console.error('[youtube-import] Haiku classification error:', e)
    return fallbackClassifications(subjects)
  }
}

function fallbackClassifications(
  subjects: Array<{ name: string; context: string[] }>
): Classification[] {
  return subjects.map(s => ({
    name: s.name,
    taste_tags: [],
    practical_tags: [],
    entities: [{ type: 'brand', name: s.name, confidence: 0.85 }],
  }))
}

// ---------------------------------------------------------------------------
// Insert classified signals into secondary_signals
// ---------------------------------------------------------------------------

async function insertSignals(
  db: SupabaseClient,
  userId: string,
  jobId: string,
  classified: Array<Bucket & { classification: Classification }>
): Promise<number> {
  const rows = classified.map(b => ({
    user_id: userId,
    source: 'youtube_api',
    import_job_id: jobId,
    external_id: b.name.toLowerCase().trim().slice(0, 255),
    category: 'watch',
    content_type: 'video',
    taste_tags: b.classification.taste_tags || [],
    practical_tags: b.classification.practical_tags || [],
    entities: b.classification.entities || [],
    source_weight: SOURCE_WEIGHT,
    created_at: b.mostRecent,
  }))

  let inserted = 0
  for (let i = 0; i < rows.length; i += 100) {
    const chunk = rows.slice(i, i + 100)
    const { error, count } = await db
      .from('secondary_signals')
      .upsert(chunk, { onConflict: 'user_id,source,external_id', count: 'exact' })

    if (error) {
      console.error('[youtube-import] Insert error:', error.message)
    } else {
      inserted += count ?? chunk.length
    }
  }

  return inserted
}

// ---------------------------------------------------------------------------
// Action handlers
// ---------------------------------------------------------------------------

async function handleConnect(body: { code: string; redirect_uri: string }, userId: string) {
  const clientId = Deno.env.get('YOUTUBE_CLIENT_ID')
  const clientSecret = Deno.env.get('YOUTUBE_CLIENT_SECRET')

  if (!clientId || !clientSecret) {
    return err('YouTube OAuth not configured', 500)
  }

  // Exchange authorization code for tokens
  const tokenResp = await fetch(GOOGLE_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code: body.code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: body.redirect_uri,
      grant_type: 'authorization_code',
    }),
  })

  if (!tokenResp.ok) {
    const errBody = await tokenResp.text()
    console.error(`[youtube-import] Token exchange failed: ${tokenResp.status} ${errBody}`)
    return err('OAuth token exchange failed')
  }

  const tokens = await tokenResp.json()
  const accessToken = tokens.access_token
  const refreshTk = tokens.refresh_token ?? null
  const expiresAt = tokens.expires_in
    ? new Date(Date.now() + tokens.expires_in * 1000).toISOString()
    : null

  // Fetch channel info
  const channelResp = await ytFetch('/channels?part=snippet&mine=true', accessToken)
  const channelData = await channelResp.json()
  const channel = channelData.items?.[0]
  const channelTitle = channel?.snippet?.title ?? 'Unknown'
  const channelId = channel?.id ?? null

  // Upsert connected_accounts
  const db = getServiceClient()
  const { error: upsertError } = await db.from('connected_accounts').upsert({
    user_id: userId,
    platform: 'youtube',
    access_token: accessToken,
    refresh_token: refreshTk,
    token_expires_at: expiresAt,
    scopes: ['youtube.readonly'],
    platform_user_id: channelId,
    platform_username: channelTitle,
    status: 'active',
    connected_at: new Date().toISOString(),
  }, { onConflict: 'user_id,platform' })

  if (upsertError) {
    console.error('[youtube-import] Upsert error:', upsertError)
    return err('Failed to save connection')
  }

  console.log(`[youtube-import] Connected: ${channelTitle} (${channelId})`)
  return json({ success: true, channel_title: channelTitle, channel_id: channelId })
}

async function handleImport(body: { import_type?: string }, userId: string) {
  const importType = body.import_type ?? 'all'
  const db = getServiceClient()

  // Get connected account
  const { data: account, error: acctErr } = await db
    .from('connected_accounts')
    .select('*')
    .eq('user_id', userId)
    .eq('platform', 'youtube')
    .eq('status', 'active')
    .single()

  if (acctErr || !account) {
    return err('YouTube not connected. Please connect first.')
  }

  const accessToken = await getValidToken(account as ConnectedAccount, db)

  // Create import job
  const { data: jobData, error: jobErr } = await db
    .from('import_jobs')
    .insert({ user_id: userId, source: 'youtube_api', status: 'processing' })
    .select('id')
    .single()

  if (jobErr) {
    console.error('[youtube-import] Failed to create import job:', jobErr)
    return err('Failed to create import job', 500)
  }
  const jobId = jobData.id

  // Delete previous youtube_api signals (fresh import replaces old)
  await db
    .from('secondary_signals')
    .delete()
    .eq('user_id', userId)
    .eq('source', 'youtube_api')

  // Collect all video items
  const allItems: YouTubePlaylistItem[] = []

  // --- Liked videos ---
  if (importType === 'liked' || importType === 'all') {
    console.log('[youtube-import] Fetching liked videos...')

    const channelResp = await ytFetch('/channels?part=contentDetails&mine=true', accessToken)
    const channelData = await channelResp.json()
    const likesPlaylistId = channelData.items?.[0]?.contentDetails?.relatedPlaylists?.likes

    if (likesPlaylistId) {
      let pageToken: string | undefined
      let totalFetched = 0

      do {
        const pageParam = pageToken ? `&pageToken=${pageToken}` : ''
        const resp = await ytFetch(
          `/playlistItems?part=snippet,contentDetails&playlistId=${likesPlaylistId}&maxResults=${PAGE_SIZE}${pageParam}`,
          accessToken
        )
        const data = await resp.json()
        const pageItems: YouTubePlaylistItem[] = data.items ?? []
        allItems.push(...pageItems)

        totalFetched += pageItems.length
        pageToken = data.nextPageToken
      } while (pageToken && totalFetched < MAX_LIKED_VIDEOS)

      console.log(`[youtube-import] Fetched ${totalFetched} liked videos`)
    }
  }

  // --- User playlists ---
  if (importType === 'playlists' || importType === 'all') {
    console.log('[youtube-import] Fetching playlists...')

    let playlistPageToken: string | undefined
    const playlists: YouTubePlaylist[] = []

    do {
      const pageParam = playlistPageToken ? `&pageToken=${playlistPageToken}` : ''
      const resp = await ytFetch(
        `/playlists?part=snippet,contentDetails&mine=true&maxResults=${PAGE_SIZE}${pageParam}`,
        accessToken
      )
      const data = await resp.json()
      playlists.push(...(data.items ?? []))
      playlistPageToken = data.nextPageToken
    } while (playlistPageToken && playlists.length < MAX_PLAYLISTS)

    console.log(`[youtube-import] Found ${playlists.length} playlists`)

    for (const playlist of playlists) {
      let pageToken: string | undefined
      let playlistItemCount = 0
      const maxPerPlaylist = 200

      do {
        const pageParam = pageToken ? `&pageToken=${pageToken}` : ''
        const resp = await ytFetch(
          `/playlistItems?part=snippet,contentDetails&playlistId=${playlist.id}&maxResults=${PAGE_SIZE}${pageParam}`,
          accessToken
        )
        const data = await resp.json()
        const pageItems: YouTubePlaylistItem[] = data.items ?? []
        allItems.push(...pageItems)

        playlistItemCount += pageItems.length
        pageToken = data.nextPageToken
      } while (pageToken && playlistItemCount < maxPerPlaylist)
    }

    console.log(`[youtube-import] Total items from playlists: ${allItems.length}`)
  }

  if (allItems.length === 0) {
    await db.from('import_jobs').update({
      status: 'complete', completed_at: new Date().toISOString(),
      total_events: 0, signals_created: 0,
    }).eq('id', jobId)
    return json({ signals: 0, channels: 0, total_videos: 0, message: 'No videos found to import' })
  }

  // Group by channel
  const buckets = groupByChannel(allItems)
  console.log(`[youtube-import] ${allItems.length} videos → ${buckets.length} channels (min ${MIN_VIDEO_COUNT} videos)`)

  // Classify via Haiku (batched, budget-capped)
  const maxSubjects = MAX_HAIKU_CALLS * HAIKU_BATCH_SIZE
  const toClassify = buckets.slice(0, maxSubjects)
  const unclassified = buckets.slice(maxSubjects)

  let haikuCallsMade = 0
  const classified: Array<Bucket & { classification: Classification }> = []

  for (let i = 0; i < toClassify.length; i += HAIKU_BATCH_SIZE) {
    const subjectBatch = toClassify.slice(i, i + HAIKU_BATCH_SIZE)
    const classifications = await classifyBatch(
      subjectBatch.map(b => ({ name: b.name, context: b.context }))
    )
    haikuCallsMade++

    for (let j = 0; j < subjectBatch.length; j++) {
      classified.push({
        ...subjectBatch[j],
        classification: classifications[j] || {
          name: subjectBatch[j].name, taste_tags: [], practical_tags: [], entities: [],
        },
      })
    }
  }

  // Unclassified: entity only, no tags
  for (const b of unclassified) {
    classified.push({
      ...b,
      classification: {
        name: b.name,
        taste_tags: [],
        practical_tags: [],
        entities: [{ type: 'brand', name: b.name, confidence: 0.85 }],
      },
    })
  }

  // Insert signals
  const signalsCreated = await insertSignals(db, userId, jobId, classified)

  // Update import job
  await db.from('import_jobs').update({
    status: 'complete',
    completed_at: new Date().toISOString(),
    total_events: allItems.length,
    processed_events: allItems.length,
    signals_created: signalsCreated,
    haiku_calls_made: haikuCallsMade,
  }).eq('id', jobId)

  // Update account stats
  await db.from('connected_accounts').update({
    last_import_at: new Date().toISOString(),
    last_import_count: signalsCreated,
  }).eq('user_id', userId).eq('platform', 'youtube')

  // Fire-and-forget: trigger taste engine full pipeline
  const fnUrl = `${Deno.env.get('SUPABASE_URL')}/functions/v1/taste-engine`
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  fetch(fnUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${serviceKey}` },
    body: JSON.stringify({ action: 'full-pipeline', userId }),
  }).catch(e => console.error('[youtube-import] taste-engine trigger error:', e))

  console.log(`[youtube-import] Done: ${signalsCreated} signals from ${allItems.length} videos (${haikuCallsMade} Haiku calls)`)

  return json({
    signals: signalsCreated,
    channels: buckets.length,
    total_videos: allItems.length,
    haiku_calls: haikuCallsMade,
    message: `Imported ${signalsCreated} channel signals from ${allItems.length} videos`,
  })
}

async function handleDisconnect(userId: string) {
  const db = getServiceClient()

  // Revoke account
  const { error } = await db
    .from('connected_accounts')
    .update({ status: 'revoked' })
    .eq('user_id', userId)
    .eq('platform', 'youtube')

  if (error) {
    console.error('[youtube-import] Disconnect error:', error)
    return err('Failed to disconnect')
  }

  // Delete youtube_api signals
  await db
    .from('secondary_signals')
    .delete()
    .eq('user_id', userId)
    .eq('source', 'youtube_api')

  // Trigger taste engine recompute
  const fnUrl = `${Deno.env.get('SUPABASE_URL')}/functions/v1/taste-engine`
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  fetch(fnUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${serviceKey}` },
    body: JSON.stringify({ action: 'full-pipeline', userId }),
  }).catch(e => console.error('[youtube-import] taste-engine trigger error:', e))

  return json({ success: true, message: 'YouTube disconnected. Signals removed from taste profile.' })
}

async function handleStatus(userId: string) {
  const db = getServiceClient()
  const { data, error } = await db
    .from('connected_accounts')
    .select('platform_username, status, last_import_at, last_import_count, connected_at')
    .eq('user_id', userId)
    .eq('platform', 'youtube')
    .single()

  if (error || !data) {
    return json({ connected: false })
  }

  return json({
    connected: data.status === 'active',
    channel: data.platform_username,
    status: data.status,
    last_import_at: data.last_import_at,
    last_import_count: data.last_import_count,
    connected_at: data.connected_at,
  })
}

// ---------------------------------------------------------------------------
// Main handler
// ---------------------------------------------------------------------------

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const userId = await getUserId(req)
    if (!userId) {
      return err('Not authenticated', 401)
    }

    const body = await req.json()
    const action = body.action

    switch (action) {
      case 'connect':
        if (!body.code || !body.redirect_uri) {
          return err('Missing code or redirect_uri')
        }
        return await handleConnect(body, userId)

      case 'import':
        return await handleImport(body, userId)

      case 'disconnect':
        return await handleDisconnect(userId)

      case 'status':
        return await handleStatus(userId)

      default:
        return err(`Unknown action: ${action}`)
    }
  } catch (e) {
    console.error('[youtube-import] Unhandled error:', e)
    return err(e instanceof Error ? e.message : 'Internal error', 500)
  }
})
