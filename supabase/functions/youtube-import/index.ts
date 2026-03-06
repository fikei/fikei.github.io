// Supabase Edge Function: youtube-import
// Handles YouTube OAuth connection and imports liked videos + playlists
// as second-class pins (import_source = 'youtube') for taste map visualization.
//
// POST /functions/v1/youtube-import
// Body:
//   { action: 'connect', code: string, redirect_uri: string }
//   { action: 'import', import_type: 'liked' | 'playlists' | 'all' }
//   { action: 'disconnect' }
//   { action: 'status' }

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const VERSION = '1.0.0'
console.log(`[youtube-import] v${VERSION} - liked videos and playlists`)

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const YOUTUBE_API_BASE = 'https://www.googleapis.com/youtube/v3'
const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token'
const MAX_LIKED_VIDEOS = 500
const MAX_PLAYLISTS = 50
const PAGE_SIZE = 50

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
function getServiceClient() {
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
async function refreshToken(account: ConnectedAccount, db: ReturnType<typeof createClient>): Promise<string> {
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
async function getValidToken(account: ConnectedAccount, db: ReturnType<typeof createClient>): Promise<string> {
  if (account.token_expires_at) {
    const expiresAt = new Date(account.token_expires_at)
    const fiveMinFromNow = new Date(Date.now() + 5 * 60 * 1000)
    if (expiresAt < fiveMinFromNow) {
      return await refreshToken(account, db)
    }
  }
  return account.access_token
}

/** Normalize a YouTube URL to a canonical form */
function normalizeYouTubeUrl(videoId: string): string {
  return `https://www.youtube.com/watch?v=${videoId}`
}

/** Get the best available thumbnail URL */
function getBestThumbnail(thumbnails?: { high?: { url: string }; medium?: { url: string }; default?: { url: string } }): string | null {
  if (!thumbnails) return null
  return thumbnails.high?.url ?? thumbnails.medium?.url ?? thumbnails.default?.url ?? null
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

  // Collect all video items to import
  const items: Array<{
    videoId: string
    title: string
    channelTitle: string
    description: string
    thumbnail: string | null
    publishedAt: string
    playlistId: string | null
    playlistName: string | null
  }> = []

  // --- Liked videos ---
  if (importType === 'liked' || importType === 'all') {
    console.log('[youtube-import] Fetching liked videos...')

    // Get the likes playlist ID
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

        for (const item of pageItems) {
          const videoId = item.snippet?.resourceId?.videoId ?? item.contentDetails?.videoId
          if (!videoId) continue
          items.push({
            videoId,
            title: item.snippet.title,
            channelTitle: item.snippet.channelTitle,
            description: (item.snippet.description ?? '').slice(0, 500),
            thumbnail: getBestThumbnail(item.snippet.thumbnails),
            publishedAt: item.contentDetails?.videoPublishedAt ?? item.snippet.publishedAt,
            playlistId: null,
            playlistName: null,
          })
        }

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

        for (const item of pageItems) {
          const videoId = item.snippet?.resourceId?.videoId ?? item.contentDetails?.videoId
          if (!videoId) continue
          items.push({
            videoId,
            title: item.snippet.title,
            channelTitle: item.snippet.channelTitle,
            description: (item.snippet.description ?? '').slice(0, 500),
            thumbnail: getBestThumbnail(item.snippet.thumbnails),
            publishedAt: item.contentDetails?.videoPublishedAt ?? item.snippet.publishedAt,
            playlistId: playlist.id,
            playlistName: playlist.snippet.title,
          })
        }

        playlistItemCount += pageItems.length
        pageToken = data.nextPageToken
      } while (pageToken && playlistItemCount < maxPerPlaylist)
    }

    console.log(`[youtube-import] Total items from playlists: ${items.length}`)
  }

  if (items.length === 0) {
    return json({ imported: 0, skipped: 0, total: 0, message: 'No videos found to import' })
  }

  // Deduplicate within batch (same videoId can appear in liked + playlist)
  const seen = new Map<string, typeof items[0]>()
  for (const item of items) {
    if (!seen.has(item.videoId)) {
      seen.set(item.videoId, item)
    }
  }
  const uniqueItems = Array.from(seen.values())

  // Check existing URLs to avoid duplicates
  const urls = uniqueItems.map(i => normalizeYouTubeUrl(i.videoId))
  const { data: existing } = await db
    .from('links')
    .select('url')
    .eq('user_id', userId)
    .in('url', urls)

  const existingUrls = new Set((existing ?? []).map((r: { url: string }) => r.url))

  // Build pin rows for new items
  const newPins = uniqueItems
    .filter(item => !existingUrls.has(normalizeYouTubeUrl(item.videoId)))
    .map(item => ({
      user_id: userId,
      url: normalizeYouTubeUrl(item.videoId),
      title: item.title,
      description: `${item.channelTitle} — ${item.description.slice(0, 200)}`,
      image: item.thumbnail ?? `https://img.youtube.com/vi/${item.videoId}/hqdefault.jpg`,
      domain: 'youtube.com',
      category: inferCategory(item.playlistName),
      content_type: 'video',
      import_source: 'youtube',
      tags: item.playlistName ? [item.playlistName] : [],
      video: {
        title: item.title,
        creator: item.channelTitle,
        year: new Date(item.publishedAt).getFullYear(),
        type: 'video',
        platform: 'youtube',
        platformId: item.videoId,
      },
    }))

  // Bulk insert in batches of 100
  let imported = 0
  const batchSize = 100
  for (let i = 0; i < newPins.length; i += batchSize) {
    const batch = newPins.slice(i, i + batchSize)
    const { error: insertErr, count } = await db
      .from('links')
      .insert(batch)

    if (insertErr) {
      console.error(`[youtube-import] Batch insert error at offset ${i}:`, insertErr)
    } else {
      imported += count ?? batch.length
    }
  }

  // Update account stats
  await db.from('connected_accounts').update({
    last_import_at: new Date().toISOString(),
    last_import_count: imported,
  }).eq('user_id', userId).eq('platform', 'youtube')

  const skipped = existingUrls.size
  console.log(`[youtube-import] Done: ${imported} imported, ${skipped} skipped (already saved)`)

  return json({
    imported,
    skipped,
    total: uniqueItems.length,
    message: `Imported ${imported} videos${skipped > 0 ? ` (${skipped} already in your library)` : ''}`,
  })
}

/** Infer category from playlist name */
function inferCategory(playlistName: string | null): string {
  if (!playlistName) return 'watch'
  const lower = playlistName.toLowerCase()
  if (/music|songs?|playlist|mix|beats|tracks/i.test(lower)) return 'listen'
  if (/cook|recipe|food|eat/i.test(lower)) return 'eat'
  if (/learn|tutorial|course|how.?to|lecture/i.test(lower)) return 'read'
  if (/style|fashion|outfit|wear/i.test(lower)) return 'wear'
  if (/travel|places|visit/i.test(lower)) return 'go'
  return 'watch'
}

async function handleDisconnect(userId: string) {
  const db = getServiceClient()
  const { error } = await db
    .from('connected_accounts')
    .update({ status: 'revoked' })
    .eq('user_id', userId)
    .eq('platform', 'youtube')

  if (error) {
    console.error('[youtube-import] Disconnect error:', error)
    return err('Failed to disconnect')
  }

  return json({ success: true, message: 'YouTube disconnected. Imported videos remain in your library.' })
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
