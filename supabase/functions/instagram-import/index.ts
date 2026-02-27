// Supabase Edge Function: instagram-import
// Processes Instagram Reel URLs into structured board pins.
//
// Pipeline:
//   1. ScrapeCreators API → caption, video URL, thumbnail, audio track, location
//   2. Transcription → Instagram auto-transcript, Supadata, or Deepgram Nova-2
//   3. Claude Haiku → entity extraction from caption + transcript
//   4. DuckDuckGo → resolve entities to stable primary-source URLs
//   5. Return source pin + N derived pins
//
// POST /functions/v1/instagram-import
// Body:
//   Single mode: { url: "https://instagram.com/reel/ABC/" }
//   Batch mode:  { urls: ["https://...", "https://..."] }
//   Pre-parsed:  { posts: [{ shortcode, caption, video_url, ... }] }
//
// Returns: { source_pin, derived_pins[], transcript?, entities[], cost_estimate }

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ReelData {
  url: string
  shortcode: string
  caption: string
  author_username: string
  thumbnail_url: string | null
  video_url: string | null
  duration: number | null
  audio_track: string | null
  tagged_location: string | null
  tagged_accounts: string[]
  auto_transcript: string | null
  view_count: number | null
  like_count: number | null
}

interface Entity {
  type: string
  name: string
  location_hint: string | null
  category: string
  confidence: number
  source: string
  search_query: string
  resolved_url: string | null
  resolved_via: string | null
  match_quality: number
  status: 'auto' | 'review' | 'discarded'
}

interface SearchResult {
  url: string
  title: string
}

interface ExtractionResult {
  entities: Entity[]
  post_category: string
  post_summary: string
}

interface Pin {
  id: string
  url: string
  title: string
  description: string
  image: string | null
  domain: string
  category: string
  content_type: string
  type_confidence: number
  source: string
  source_id?: string
  source_url?: string
  instagram?: Record<string, unknown>
  extraction?: Record<string, unknown>
  addedAt: number
}


// ---------------------------------------------------------------------------
// 1. Content Extraction (ScrapeCreators)
// ---------------------------------------------------------------------------

function parseShortcode(url: string): string | null {
  const match = url.match(/instagram\.com\/(?:reel|p|tv)\/([A-Za-z0-9_-]+)/)
  return match ? match[1] : null
}

async function extractReel(url: string): Promise<ReelData> {
  const apiKey = Deno.env.get('SCRAPECREATORS_API_KEY')
  if (!apiKey) {
    throw new Error('SCRAPECREATORS_API_KEY not configured')
  }

  const encodedUrl = encodeURIComponent(url)
  const apiUrl = `https://api.scrapecreators.com/v2/instagram/post?url=${encodedUrl}`

  const resp = await fetch(apiUrl, {
    headers: {
      'x-api-key': apiKey,
      'Accept': 'application/json',
    },
  })

  if (!resp.ok) {
    const text = await resp.text()
    throw new Error(`ScrapeCreators API error ${resp.status}: ${text}`)
  }

  const raw = await resp.json()
  const post = raw.shortcode ? raw : (raw.data || raw)

  // Extract audio track from music metadata
  let audioTrack: string | null = null
  const music = post.music_info || post.clips_metadata?.music_info
  if (music) {
    const asset = music.music_asset_info || music
    const trackName = asset.title || asset.track_name
    const artist = asset.display_artist || asset.artist_name
    if (trackName) {
      audioTrack = artist ? `${artist} - ${trackName}` : trackName
    }
  }

  // Extract tagged location
  let taggedLocation: string | null = null
  if (post.location && typeof post.location === 'object') {
    taggedLocation = post.location.name || null
  } else if (typeof post.location === 'string') {
    taggedLocation = post.location
  }

  return {
    url,
    shortcode: post.shortcode || parseShortcode(url) || 'unknown',
    caption: post.caption || post.description || '',
    author_username: post.author_username || post.owner_username || '',
    thumbnail_url: post.thumbnail_url || post.display_url || null,
    video_url: post.video_url || null,
    duration: post.duration || post.video_duration || null,
    audio_track: audioTrack,
    tagged_location: taggedLocation,
    tagged_accounts: post.tagged_users || [],
    auto_transcript: post.transcript || post.accessibility_caption || null,
    view_count: post.video_view_count || post.view_count || null,
    like_count: post.like_count || null,
  }
}

// ---------------------------------------------------------------------------
// 2. Audio Transcription (Supadata → Deepgram fallback)
// ---------------------------------------------------------------------------

async function transcribeViaSupadata(url: string): Promise<string | null> {
  const apiKey = Deno.env.get('SUPADATA_API_KEY')
  if (!apiKey) return null

  try {
    const resp = await fetch('https://api.supadata.ai/v1/transcript', {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ url }),
    })

    if (!resp.ok) return null

    const data = await resp.json()
    return data.content || data.transcript || data.text || null
  } catch {
    return null
  }
}

async function transcribeViaDeepgram(videoUrl: string): Promise<string | null> {
  const apiKey = Deno.env.get('DEEPGRAM_API_KEY')
  if (!apiKey || !videoUrl) return null

  try {
    // Download video to buffer
    const videoResp = await fetch(videoUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)',
      },
    })
    if (!videoResp.ok) return null

    const videoBuffer = await videoResp.arrayBuffer()
    console.log(`[instagram-import] Downloaded ${(videoBuffer.byteLength / 1024 / 1024).toFixed(1)} MB for transcription`)

    // Send to Deepgram
    const dgResp = await fetch(
      'https://api.deepgram.com/v1/listen?model=nova-2&smart_format=true&detect_language=true',
      {
        method: 'POST',
        headers: {
          'Authorization': `Token ${apiKey}`,
          'Content-Type': 'video/mp4',
        },
        body: videoBuffer,
      }
    )

    if (!dgResp.ok) return null

    const result = await dgResp.json()
    return result.results?.channels?.[0]?.alternatives?.[0]?.transcript || null
  } catch {
    return null
  }
}

async function transcribeAudio(reel: ReelData): Promise<string | null> {
  // 1. Instagram's own auto-transcript (free)
  if (reel.auto_transcript) {
    console.log('[instagram-import] Using Instagram auto-transcript')
    return reel.auto_transcript
  }

  // 2. Supadata (URL -> transcript in one call)
  const supadataResult = await transcribeViaSupadata(reel.url)
  if (supadataResult) {
    console.log('[instagram-import] Got Supadata transcript')
    return supadataResult
  }

  // 3. Deepgram (download video + transcribe)
  if (reel.video_url) {
    const deepgramResult = await transcribeViaDeepgram(reel.video_url)
    if (deepgramResult) {
      console.log('[instagram-import] Got Deepgram transcript')
      return deepgramResult
    }
  }

  console.log('[instagram-import] No transcription available')
  return null
}

// ---------------------------------------------------------------------------
// 3. Entity Extraction (Claude Haiku)
// ---------------------------------------------------------------------------

const EXTRACTION_PROMPT = `Analyze this Instagram Reel post. Your job is to find EVERY real-world entity the creator mentions or recommends — places, restaurants, products, brands, songs, events, people, recipes, tools, etc.

## Step 1: Count expected items
Before extracting, read the caption and transcript carefully. Does the creator say "my top 8 restaurants", "5 things you need", "these 3 spots", etc.? If so, note that number — you MUST find that many entities. If no explicit count is given, estimate how many distinct things are being recommended based on the content.

## Step 2: Extract all entities
For each entity extract:
- type: place | product | brand | song | food | event | person | generic
- name: the CORRECT canonical spelling of the entity name. The transcript is speech-to-text and may contain misspellings or phonetic errors (e.g. "Bouchon Bistrow" → "Bouchon Bistro", "Nobu Malibu" may be transcribed as "Nobu Maleebu"). Use context clues from the caption, location tags, and surrounding words to determine the correct real-world name. Always output the corrected canonical name.
- location_hint: any geographic context (e.g., "Valencia St, San Francisco")
- category: which board category fits best (eat, go, wear, watch, listen, use, follow, read)
- confidence: 0.0-1.0 (use 0.5+ for anything plausible, not just certain items)
- source: which input it came from ("caption" | "transcript" | "audio_track" | "tagged_location" | "tagged_account" | "screen_text")
- search_query: a search query to find this SPECIFIC entity — use the CORRECTED canonical name, not the misspelled transcript version. For places include city/neighborhood. For products include brand name. For songs include artist.

## Step 3: Cross-check
Compare your extracted list against the caption AND transcript independently:
- Did you find everything mentioned in the caption?
- Did you find everything mentioned in the transcript?
- If the creator mentioned a count (Step 1), does your list match that count? If not, look again — you may have missed an item or merged two distinct entities into one.

## Step 4: Screen text
If a thumbnail image is provided, extract any text visible on screen — overlaid text, signs, labels, product names. Use source "screen_text". These may reveal items not mentioned in the audio.

## Key rules
- Be aggressive: if someone says "this place" while tagged at a location, that's a place entity. Vague references backed by context still count.
- Specificity: extract the specific piece of content, not the creator's channel/homepage — unless the entity IS the creator.
- Do NOT discard entities just because the transcript spelling looks odd — correct the spelling and include them with confidence >= 0.5.

Return ONLY valid JSON, no markdown fences:
{
  "expected_count": 8,
  "entities": [...],
  "post_category": "eat|go|wear|watch|listen|use|follow|read",
  "post_summary": "one sentence summary"
}`

async function extractEntities(reel: ReelData, transcript: string | null): Promise<ExtractionResult> {
  const apiKey = Deno.env.get('ANTHROPIC_API_KEY')
  if (!apiKey) {
    throw new Error('ANTHROPIC_API_KEY not configured')
  }

  // Build context
  const parts: string[] = []
  parts.push(`Author: @${reel.author_username}`)
  if (reel.caption) parts.push(`Caption: ${reel.caption}`)
  if (transcript) parts.push(`Transcript (spoken audio): ${transcript}`)
  if (reel.audio_track) parts.push(`Audio track playing: ${reel.audio_track}`)
  if (reel.tagged_location) parts.push(`Tagged location: ${reel.tagged_location}`)
  if (reel.tagged_accounts.length > 0) {
    parts.push(`Tagged accounts: ${reel.tagged_accounts.map(a => '@' + a).join(', ')}`)
  }

  const userMessage = parts.join('\n\n')
  console.log(`[instagram-import] Entity extraction input: ${userMessage.length} chars, thumbnail: ${reel.thumbnail_url ? 'yes' : 'no'}`)

  // Build multimodal content array — include thumbnail for on-screen text extraction
  const messageContent: Array<{type: string; [key: string]: unknown}> = []
  if (reel.thumbnail_url) {
    messageContent.push({
      type: 'image',
      source: { type: 'url', url: reel.thumbnail_url },
    })
  }
  messageContent.push({
    type: 'text',
    text: `${EXTRACTION_PROMPT}\n\n---\n\n${userMessage}`,
  })

  const resp = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 2048,
      messages: [
        { role: 'user', content: messageContent }
      ],
    }),
  })

  if (!resp.ok) {
    const text = await resp.text()
    throw new Error(`Claude API error ${resp.status}: ${text}`)
  }

  const result = await resp.json()
  let text = result.content[0].text.trim()

  // Strip markdown fences if present
  if (text.startsWith('```')) {
    text = text.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '')
  }

  return JSON.parse(text) as ExtractionResult
}

// ---------------------------------------------------------------------------
// 4. Entity Resolution (DuckDuckGo search)
// ---------------------------------------------------------------------------

function unwrapDdgUrl(rawUrl: string): string | null {
  try {
    const parsed = new URL(rawUrl)
    const uddg = parsed.searchParams.get('uddg')
    if (uddg) return uddg
  } catch { /* not a redirect URL */ }
  return rawUrl
}

async function searchDuckDuckGo(query: string, maxResults = 5): Promise<SearchResult[]> {
  const encoded = encodeURIComponent(query)
  const url = `https://html.duckduckgo.com/html/?q=${encoded}`

  try {
    const resp = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
      },
    })

    const html = await resp.text()
    const results: SearchResult[] = []
    const pattern = /class="result__a"[^>]*href="([^"]+)"[^>]*>([^<]*)</g
    let match
    while ((match = pattern.exec(html)) !== null && results.length < maxResults) {
      const resolvedUrl = unwrapDdgUrl(match[1])
      if (resolvedUrl) {
        results.push({
          url: resolvedUrl,
          title: match[2].trim().replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>'),
        })
      }
    }
    return results
  } catch {
    return []
  }
}

function buildSearchQuery(entity: Entity): string {
  // Always prefer Claude's specific search_query first
  if (entity.search_query) return entity.search_query
  // Fallbacks — only used if Claude returned no search_query
  switch (entity.type) {
    case 'place': return `${entity.name} ${entity.location_hint || ''} Google Maps`.trim()
    case 'food': return `${entity.name} ${entity.location_hint || ''} Google Maps`.trim()
    case 'song': return `${entity.name} Spotify`
    case 'brand': return `${entity.name} official site`
    case 'product': return `${entity.name} product page`
    case 'person': return `${entity.name} ${entity.location_hint || ''}`.trim()
    default: return entity.name
  }
}

const URL_SELECTION_PROMPT = `You are selecting the best primary-source URL for each entity from web search results.

Pick the URL that is the OFFICIAL or CANONICAL source for this entity. Prefer:
- place/food/eat: Google Maps link > official restaurant/venue website > Yelp
- song/listen: Spotify > Apple Music > YouTube Music > SoundCloud
- brand: official brand website (not aggregators or review sites)
- product: brand's own product page (not homepage) > specific retailer listing (not retailer homepage)
- person/follow: if the entity is a specific piece of content by a person, prefer the direct URL for that content; if the entity is the person themselves, prefer Instagram profile > personal website > LinkedIn

Specificity: when the entity refers to a specific piece of content, prefer the direct URL for that content over the creator's profile or channel page. Examples: specific YouTube video over channel, specific article over blog homepage, specific podcast episode over show page, specific product listing over brand homepage, specific recipe page over food blog. If the entity IS the creator/channel/brand itself (not a specific piece of their content), then the profile or homepage is correct.

If none of the URLs match the entity well, set selected_url to null.

Return ONLY a valid JSON array, no markdown fences:
[{"entity_index": 0, "selected_url": "https://...", "match_quality": 0.95}]`

async function selectBestUrls(
  entities: { index: number; name: string; type: string; category: string; location_hint: string | null; results: SearchResult[] }[]
): Promise<Map<number, { url: string | null; quality: number }>> {
  const apiKey = Deno.env.get('ANTHROPIC_API_KEY')
  if (!apiKey) return new Map()

  const input = entities.map(e => ({
    entity_index: e.index,
    entity_name: e.name,
    entity_type: e.type,
    entity_category: e.category,
    location_hint: e.location_hint,
    search_results: e.results.map(r => ({ url: r.url, title: r.title })),
  }))

  try {
    const resp = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 1024,
        messages: [
          { role: 'user', content: `${URL_SELECTION_PROMPT}\n\nEntities:\n${JSON.stringify(input, null, 2)}` }
        ],
      }),
    })

    if (!resp.ok) throw new Error(`Claude API ${resp.status}`)

    const result = await resp.json()
    let text = result.content[0].text.trim()
    if (text.startsWith('```')) {
      text = text.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '')
    }

    const selections: { entity_index: number; selected_url: string | null; match_quality: number }[] = JSON.parse(text)
    const map = new Map<number, { url: string | null; quality: number }>()
    for (const s of selections) {
      map.set(s.entity_index, { url: s.selected_url, quality: s.match_quality || 0 })
    }
    console.log(`[instagram-import] Claude selected URLs for ${map.size} entities`)
    return map
  } catch (err) {
    console.error('[instagram-import] URL selection failed, falling back to first results:', err)
    return new Map()
  }
}

async function resolveAllEntities(entities: Entity[], reel: ReelData): Promise<Entity[]> {
  // Phase 1: Classify entities
  const toResolve: Entity[] = []
  for (const entity of entities) {
    if (entity.confidence < 0.35) {
      entity.resolved_url = null
      entity.resolved_via = null
      entity.match_quality = 0
      entity.status = 'discarded'
    } else {
      entity.status = entity.confidence >= 0.7 ? 'auto' : 'review'
      toResolve.push(entity)
    }
  }

  // Phase 2: Search DDG for each entity (serial, rate-limited)
  const searchResults = new Map<number, SearchResult[]>()
  for (let i = 0; i < toResolve.length; i++) {
    const query = buildSearchQuery(toResolve[i])
    const results = await searchDuckDuckGo(query)
    searchResults.set(i, results)
    console.log(`[instagram-import] DDG: ${toResolve[i].name} -> ${results.length} results`)
    if (i < toResolve.length - 1) await new Promise(r => setTimeout(r, 500))
  }

  // Phase 3: Batch Claude call to pick best URL per entity
  const forSelection = toResolve
    .map((entity, i) => ({ index: i, name: entity.name, type: entity.type, category: entity.category, location_hint: entity.location_hint, results: searchResults.get(i) || [] }))
    .filter(e => e.results.length > 0)

  const selections = forSelection.length > 0 ? await selectBestUrls(forSelection) : new Map()

  // Phase 4: Apply selections, fall back to first DDG result
  for (let i = 0; i < toResolve.length; i++) {
    const entity = toResolve[i]
    const results = searchResults.get(i) || []
    const selection = selections.get(i)

    if (selection?.url) {
      entity.resolved_url = selection.url
      entity.resolved_via = 'duckduckgo+claude'
      entity.match_quality = selection.quality
    } else if (results.length > 0) {
      entity.resolved_url = results[0].url
      entity.resolved_via = 'duckduckgo-first'
      entity.match_quality = 0
    } else {
      entity.resolved_url = null
      entity.resolved_via = null
      entity.match_quality = 0
    }

    console.log(`[instagram-import] Resolved: ${entity.name} -> ${entity.resolved_url || 'NOT FOUND'} (${entity.resolved_via})`)
  }

  // Phase 5: Enhanced music resolution (Spotify + AudD multi-track)
  const musicEntities = toResolve.filter(e => isMusicEntity(e))
  if (musicEntities.length > 0) {
    console.log(`[instagram-import] Phase 5: Enhanced music resolution for ${musicEntities.length} entities`)

    // Tier 2 prep: fingerprint ALL tracks in one call (before entity loop)
    let fingerprints: FingerprintResult[] = []
    const streamingRegex = /spotify\.com|music\.apple\.com|soundcloud\.com|beatport\.com|bandcamp\.com|tidal\.com|deezer\.com|audiomack\.com|youtube\.com\/watch|music\.youtube\.com/
    const anyNeedFingerprint = musicEntities.some(e => {
      const isStreaming = e.resolved_url && streamingRegex.test(e.resolved_url)
      return !(isStreaming && e.match_quality >= 0.7)
    })
    if (anyNeedFingerprint && reel.video_url) {
      fingerprints = await fingerprintAllTracks(reel.video_url)
    }

    for (const entity of musicEntities) {
      // Check if Tier 0 already resolved to a streaming service with high quality
      const isStreamingUrl = entity.resolved_url && streamingRegex.test(entity.resolved_url)
      if (isStreamingUrl && entity.match_quality >= 0.7) {
        console.log(`[instagram-import] Tier 0 sufficient for: ${entity.name} (${entity.match_quality})`)
        continue
      }

      // Parse artist/track from entity name or audio_track metadata
      const { artist, track } = parseArtistTrack(entity.name, reel.audio_track)

      // Tier 1: Spotify search
      if (artist || track) {
        const spotifyResult = await searchSpotify(artist, track)
        if (spotifyResult && spotifyResult.quality >= 0.6) {
          entity.resolved_url = spotifyResult.url
          entity.resolved_via = 'spotify'
          entity.match_quality = spotifyResult.quality
          continue
        }
      }

      // Tier 2: match against fingerprints
      if (fingerprints.length > 0) {
        const match = matchFingerprintToEntity(entity, fingerprints)
        if (match) {
          entity.resolved_url = match.spotifyUrl || entity.resolved_url
          entity.resolved_via = 'audd-fingerprint'
          entity.match_quality = 0.85
          if (match.track) {
            entity.name = match.artist
              ? `${match.artist} - ${match.track}`
              : match.track
          }
          console.log(`[instagram-import] AudD matched: ${entity.name}`)
          // If no URL yet, try Spotify search with the now-identified track
          if (!entity.resolved_url && match.artist && match.track) {
            const fallback = await searchSpotify(match.artist, match.track)
            if (fallback) {
              entity.resolved_url = fallback.url
              entity.resolved_via = 'audd-fingerprint+spotify'
            }
          }
        }
      }
    }

    // Create entities for unmatched fingerprints (tracks not in caption/transcript)
    for (const fp of fingerprints) {
      if (fp._matched) continue
      console.log(`[instagram-import] AudD new track: ${fp.artist} - ${fp.track} (offset: ${fp.offset}s)`)
      entities.push({
        type: 'song',
        name: `${fp.artist} - ${fp.track}`,
        category: 'listen',
        confidence: 0.8,
        source: 'audio_fingerprint',
        resolved_url: fp.spotifyUrl || null,
        resolved_via: 'audd-fingerprint',
        match_quality: 0.85,
        status: 'review',
        location_hint: null,
        search_query: `${fp.artist} ${fp.track} Spotify`,
      })
    }
  }

  return entities
}

// ---------------------------------------------------------------------------
// 5. Enhanced Music Resolution (Spotify + AudD)
// ---------------------------------------------------------------------------

// Module-level cache for Spotify access token
let _spotifyToken: string | null = null
let _spotifyTokenExpiry = 0

async function getSpotifyToken(): Promise<string | null> {
  const clientId = Deno.env.get('SPOTIFY_CLIENT_ID')
  const clientSecret = Deno.env.get('SPOTIFY_CLIENT_SECRET')
  if (!clientId || !clientSecret) return null

  // Return cached token if still valid (with 60s buffer)
  if (_spotifyToken && Date.now() < _spotifyTokenExpiry - 60_000) {
    return _spotifyToken
  }

  try {
    const resp = await fetch('https://accounts.spotify.com/api/token', {
      method: 'POST',
      headers: {
        'Authorization': 'Basic ' + btoa(`${clientId}:${clientSecret}`),
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: 'grant_type=client_credentials',
    })

    if (!resp.ok) {
      console.error(`[instagram-import] Spotify auth failed: ${resp.status}`)
      return null
    }

    const data = await resp.json()
    _spotifyToken = data.access_token
    _spotifyTokenExpiry = Date.now() + (data.expires_in * 1000)
    console.log('[instagram-import] Spotify token obtained')
    return _spotifyToken
  } catch (err) {
    console.error('[instagram-import] Spotify auth error:', err)
    return null
  }
}

function normalizeForComparison(s: string): string {
  return s.toLowerCase()
    .replace(/['']/g, "'")
    .replace(/[^\w\s']/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

async function searchSpotify(
  artist: string,
  track: string
): Promise<{ url: string; quality: number } | null> {
  const token = await getSpotifyToken()
  if (!token) return null

  // Build query — use field filters when we have both parts
  let q = ''
  if (artist && track) {
    q = `track:${track} artist:${artist}`
  } else if (track) {
    q = track
  } else if (artist) {
    q = `artist:${artist}`
  } else {
    return null
  }

  try {
    const params = new URLSearchParams({ type: 'track', q, limit: '5' })
    const resp = await fetch(`https://api.spotify.com/v1/search?${params}`, {
      headers: { 'Authorization': `Bearer ${token}` },
    })

    if (!resp.ok) {
      console.error(`[instagram-import] Spotify search failed: ${resp.status}`)
      return null
    }

    const data = await resp.json()
    const items = data.tracks?.items
    if (!items || items.length === 0) return null

    // Score each result
    const normTrack = normalizeForComparison(track || '')
    const normArtist = normalizeForComparison(artist || '')

    let bestUrl = ''
    let bestScore = 0

    for (const item of items) {
      const itemTrack = normalizeForComparison(item.name || '')
      const itemArtists = (item.artists || []).map((a: { name: string }) =>
        normalizeForComparison(a.name)
      )

      let score = 0

      // Track name matching
      if (normTrack) {
        if (itemTrack === normTrack) {
          score += 0.5
        } else if (itemTrack.includes(normTrack) || normTrack.includes(itemTrack)) {
          score += 0.3
        }
      }

      // Artist matching
      if (normArtist) {
        if (itemArtists.some((a: string) => a === normArtist)) {
          score += 0.5
        } else if (itemArtists.some((a: string) => a.includes(normArtist) || normArtist.includes(a))) {
          score += 0.3
        }
      }

      // If we only had one of artist/track, scale the score
      if (!normTrack || !normArtist) {
        score = Math.min(score * 1.5, 0.9)
      }

      if (score > bestScore) {
        bestScore = score
        bestUrl = item.external_urls?.spotify || ''
      }
    }

    if (bestUrl && bestScore > 0) {
      console.log(`[instagram-import] Spotify: "${artist} - ${track}" -> ${bestUrl} (score: ${bestScore})`)
      return { url: bestUrl, quality: bestScore }
    }

    return null
  } catch (err) {
    console.error('[instagram-import] Spotify search error:', err)
    return null
  }
}

interface FingerprintResult {
  track: string
  artist: string
  offset: number          // seconds into the video
  spotifyUrl?: string
  _matched?: boolean      // internal: set when assigned to an entity
}

async function fingerprintAllTracks(videoUrl: string): Promise<FingerprintResult[]> {
  const apiKey = Deno.env.get('AUDD_API_KEY')
  if (!apiKey) return []

  try {
    const params = new URLSearchParams({
      api_token: apiKey,
      url: videoUrl,          // AudD fetches server-side — no upload needed
      return: 'spotify',
      accurate_offsets: 'true',
    })

    console.log('[instagram-import] AudD enterprise: scanning video for all tracks')

    const resp = await fetch('https://enterprise.audd.io/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: params.toString(),
    })

    if (!resp.ok) {
      console.error(`[instagram-import] AudD enterprise error: ${resp.status}`)
      return []
    }

    const data = await resp.json()

    if (data.status !== 'success' || !data.result || !Array.isArray(data.result)) {
      console.log('[instagram-import] AudD enterprise: no results')
      return []
    }

    // Enterprise response: { result: [ { offset, songs: [{ artist, title, spotify }] } ] }
    // Each chunk has an array of song matches — take the best one per chunk
    const seen = new Map<string, FingerprintResult>()

    for (const chunk of data.result) {
      const songs = chunk.songs
      if (!songs || !Array.isArray(songs) || songs.length === 0) continue

      // Take the first (best) song from each chunk
      const song = songs[0]
      if (!song.artist && !song.title) continue

      const key = normalizeForComparison(`${song.artist || ''} ${song.title || ''}`)
      if (seen.has(key)) continue // deduplicate — keep earliest offset

      seen.set(key, {
        track: song.title || '',
        artist: song.artist || '',
        offset: chunk.offset || 0,
        spotifyUrl: song.spotify?.external_urls?.spotify || undefined,
      })
    }

    const results = Array.from(seen.values()).sort((a, b) => a.offset - b.offset)
    console.log(`[instagram-import] AudD: found ${results.length} tracks`)
    for (const r of results) {
      console.log(`  [${r.offset}s] ${r.artist} - ${r.track}${r.spotifyUrl ? ' ✓ Spotify' : ''}`)
    }
    return results
  } catch (err) {
    console.error('[instagram-import] AudD fingerprint error:', err)
    return []
  }
}

function matchFingerprintToEntity(
  entity: Entity,
  fingerprints: FingerprintResult[]
): FingerprintResult | null {
  const normName = normalizeForComparison(entity.name)

  // First pass: match by normalized name comparison
  for (const fp of fingerprints) {
    if (fp._matched) continue
    const fpName = normalizeForComparison(`${fp.artist} ${fp.track}`)
    const fpReversed = normalizeForComparison(`${fp.track} ${fp.artist}`)
    if (normName.includes(fpName) || fpName.includes(normName) ||
        normName.includes(fpReversed) || fpReversed.includes(normName)) {
      fp._matched = true
      return fp
    }
    // Also check artist or track individually
    const normArtist = normalizeForComparison(fp.artist)
    const normTrack = normalizeForComparison(fp.track)
    if (normName.includes(normArtist) && normName.includes(normTrack)) {
      fp._matched = true
      return fp
    }
  }

  // Second pass: assign first unmatched fingerprint (by offset order)
  for (const fp of fingerprints) {
    if (fp._matched) continue
    fp._matched = true
    return fp
  }

  return null
}

function isMusicEntity(entity: Entity): boolean {
  return entity.type === 'song' || entity.category === 'listen'
}

function isOriginalAudio(reel: ReelData): boolean {
  const track = reel.audio_track
  if (!track) return true
  const lower = track.toLowerCase()
  return lower.includes('original audio') ||
    lower.includes('original sound') ||
    lower.startsWith('original audio -')
}

function parseArtistTrack(
  entityName: string,
  audioTrack: string | null
): { artist: string; track: string } {
  // Try audio_track first (format: "Artist - Track Name")
  const source = audioTrack || entityName
  const separatorMatch = source.match(/^(.+?)\s*[-–—]\s*(.+)$/)
  if (separatorMatch) {
    let artist = separatorMatch[1].trim()
    let track = separatorMatch[2].trim()
    // Clean up feat./ft. in track name — move to artist
    const featMatch = track.match(/^(.+?)\s*\(?\s*(?:feat\.?|ft\.?)\s*(.+?)\)?\s*$/i)
    if (featMatch) {
      track = featMatch[1].trim()
      artist = `${artist}, ${featMatch[2].trim()}`
    }
    return { artist, track }
  }

  // No separator found — use full name as track
  return { artist: '', track: source.trim() }
}

// ---------------------------------------------------------------------------
// 6. Pin Creation
// ---------------------------------------------------------------------------

function generateId(): string {
  const ts = Date.now()
  const rand = Math.random().toString(36).substring(2, 8)
  return `link_${ts}_${rand}`
}

function createPins(
  reel: ReelData,
  extraction: ExtractionResult,
  transcript: string | null
): { source_pin: Pin; derived_pins: Pin[] } {
  const now = Math.floor(Date.now() / 1000)

  // Source pin
  const source_pin: Pin = {
    id: generateId(),
    url: reel.url,
    title: `Reel by @${reel.author_username}`,
    description: (reel.caption || '').slice(0, 200),
    image: reel.thumbnail_url,
    domain: 'instagram.com',
    category: 'follow',
    content_type: 'social',
    type_confidence: 1.0,
    source: 'social',
    source_id: 'instagram',
    instagram: {
      shortcode: reel.shortcode,
      media_type: 'reel',
      author_username: reel.author_username,
      audio_track: reel.audio_track,
      tagged_location: reel.tagged_location,
      tagged_accounts: reel.tagged_accounts,
      transcript,
      extracted_entities_count: extraction.entities.length,
    },
    addedAt: now,
  }

  // Derived pins
  const derived_pins: Pin[] = extraction.entities
    .filter(e => e.status !== 'discarded' && e.resolved_url)
    .map(entity => {
      let domain = ''
      try { domain = new URL(entity.resolved_url!).hostname.replace('www.', '') } catch {}

      return {
        id: generateId(),
        url: entity.resolved_url!,
        title: entity.name,
        description: `From @${reel.author_username}: ${extraction.post_summary}`,
        image: null,
        domain,
        category: entity.category || 'uncategorized',
        content_type: isMusicEntity(entity) ? 'music' : (entity.type || 'generic'),
        type_confidence: entity.confidence,
        source: 'social',
        source_url: reel.url,
        extraction: {
          method: transcript ? 'ai-caption+transcript' : 'ai-caption',
          source_platform: 'instagram',
          source_shortcode: reel.shortcode,
          confidence: entity.confidence,
          entity_type: entity.type,
          entity_source: entity.source,
          match_quality: entity.match_quality || 0,
          resolved_via: entity.resolved_via,
        },
        addedAt: now,
      }
    })

  return { source_pin, derived_pins }
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  const headers = { ...corsHeaders, 'Content-Type': 'application/json' }

  try {
    const body = await req.json()
    const { url, urls, posts } = body

    // Single URL mode
    if (url) {
      // Validate
      if (!url.includes('instagram.com')) {
        return new Response(
          JSON.stringify({ error: 'URL must be an Instagram URL' }),
          { status: 400, headers }
        )
      }

      console.log(`[instagram-import] Processing: ${url}`)
      const startTime = Date.now()

      // Step 1: Extract reel metadata
      const reel = await extractReel(url)
      console.log(`[instagram-import] Extracted: @${reel.author_username}, caption ${reel.caption.length} chars`)

      // Step 2: Transcribe audio
      const transcript = await transcribeAudio(reel)

      // Step 3: Extract entities
      const extraction = await extractEntities(reel, transcript)
      const expectedCount = (extraction as Record<string, unknown>).expected_count as number | undefined
      if (expectedCount && extraction.entities.length < expectedCount) {
        console.warn(`[instagram-import] Extraction gap: expected ${expectedCount}, found ${extraction.entities.length} entities`)
      }
      console.log(`[instagram-import] Found ${extraction.entities.length} entities (expected: ${expectedCount ?? 'unknown'})`)

      // Step 4: Resolve entities
      extraction.entities = await resolveAllEntities(extraction.entities, reel)

      // Step 5: Create pins
      const { source_pin, derived_pins } = createPins(reel, extraction, transcript)

      const elapsed = ((Date.now() - startTime) / 1000).toFixed(1)
      console.log(`[instagram-import] Done in ${elapsed}s: 1 source + ${derived_pins.length} derived pins`)

      const unresolvedEntities = extraction.entities.filter(
        e => e.status !== 'discarded' && !e.resolved_url
      )

      return new Response(
        JSON.stringify({
          source_pin,
          derived_pins,
          transcript,
          entities: extraction.entities,
          unresolved_entities: unresolvedEntities,
          post_category: extraction.post_category,
          post_summary: extraction.post_summary,
          stats: {
            elapsed_seconds: parseFloat(elapsed),
            entities_found: extraction.entities.length,
            entities_resolved: derived_pins.length,
            entities_unresolved: unresolvedEntities.length,
            entities_review: extraction.entities.filter(e => e.status === 'review').length,
            entities_discarded: extraction.entities.filter(e => e.status === 'discarded').length,
          },
        }),
        { status: 200, headers }
      )
    }

    // Batch URL mode
    if (urls && Array.isArray(urls)) {
      const results = []
      for (const u of urls) {
        try {
          const reel = await extractReel(u)
          const transcript = await transcribeAudio(reel)
          const extraction = await extractEntities(reel, transcript)
          extraction.entities = await resolveAllEntities(extraction.entities, reel)

          const pins = createPins(reel, extraction, transcript)
          results.push({ url: u, ...pins, entities: extraction.entities, status: 'ok' })
        } catch (err) {
          results.push({ url: u, status: 'error', error: String(err) })
        }

        // Rate limit between posts
        await new Promise(r => setTimeout(r, 1000))
      }

      return new Response(JSON.stringify({ results }), { status: 200, headers })
    }

    // Pre-parsed batch mode (from browser extension)
    if (posts && Array.isArray(posts)) {
      const results = []
      for (const post of posts) {
        try {
          // Build reel data from pre-parsed extension data
          const reel: ReelData = {
            url: post.url || `https://instagram.com/reel/${post.shortcode}/`,
            shortcode: post.shortcode,
            caption: post.caption || '',
            author_username: post.author_username || '',
            thumbnail_url: post.media_urls?.thumbnail || post.display_url || null,
            video_url: post.media_urls?.video || post.video_url || null,
            duration: post.duration || null,
            audio_track: post.audio_track || null,
            tagged_location: post.tagged_location || null,
            tagged_accounts: post.tagged_accounts || [],
            auto_transcript: null,
            view_count: post.view_count || null,
            like_count: post.like_count || null,
          }

          const transcript = await transcribeAudio(reel)
          const extraction = await extractEntities(reel, transcript)
          extraction.entities = await resolveAllEntities(extraction.entities, reel)

          const pins = createPins(reel, extraction, transcript)
          results.push({ url: reel.url, ...pins, entities: extraction.entities, status: 'ok' })
        } catch (err) {
          results.push({ url: post.url || post.shortcode, status: 'error', error: String(err) })
        }

        await new Promise(r => setTimeout(r, 1000))
      }

      return new Response(JSON.stringify({ results }), { status: 200, headers })
    }

    return new Response(
      JSON.stringify({ error: 'Provide "url", "urls", or "posts" in request body' }),
      { status: 400, headers }
    )

  } catch (err) {
    console.error('[instagram-import] Error:', err)
    return new Response(
      JSON.stringify({ error: String(err) }),
      { status: 500, headers }
    )
  }
})
