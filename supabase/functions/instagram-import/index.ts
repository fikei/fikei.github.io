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
  status: 'auto' | 'review' | 'discarded'
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

const EXTRACTION_PROMPT = `Analyze this Instagram Reel post. Extract every real-world entity mentioned or referenced — places, products, brands, songs, restaurants, events, people, recipes, tools, etc.

For each entity:
- type: place | product | brand | song | food | event | person | generic
- name: canonical name (e.g., "Blue Bottle Coffee" not "this coffee spot")
- location_hint: any geographic context (e.g., "Valencia St, San Francisco")
- category: which board category (eat, go, wear, watch, listen, use, follow, read)
- confidence: 0.0-1.0
- source: which input it came from ("caption" | "transcript" | "audio_track" | "tagged_location" | "tagged_account")
- search_query: a search query to find this entity's primary website or listing

Be aggressive about extraction. If someone says "this place" while tagged at a location, that's a place entity. If a song is playing, that's a song entity. If they mention a brand, that's a brand entity.

Return ONLY valid JSON, no markdown fences:
{
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
  console.log(`[instagram-import] Entity extraction input: ${userMessage.length} chars`)

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
        { role: 'user', content: `${EXTRACTION_PROMPT}\n\n---\n\n${userMessage}` }
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

async function searchDuckDuckGo(query: string): Promise<string | null> {
  const encoded = encodeURIComponent(query)
  const url = `https://html.duckduckgo.com/html/?q=${encoded}`

  try {
    const resp = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
      },
    })

    const html = await resp.text()
    const match = html.match(/class="result__a"[^>]*href="([^"]+)"/)
    if (match) {
      const resultUrl = match[1]
      // DuckDuckGo wraps URLs in a redirect
      try {
        const parsed = new URL(resultUrl)
        const uddg = parsed.searchParams.get('uddg')
        if (uddg) return uddg
      } catch { /* not a redirect URL */ }
      return resultUrl
    }
  } catch {
    // Search failed — return null
  }

  return null
}

async function resolveEntity(entity: Entity): Promise<Entity> {
  const searchQuery = entity.search_query || (() => {
    switch (entity.type) {
      case 'place': return `${entity.name} ${entity.location_hint || ''} Google Maps`.trim()
      case 'song': return `${entity.name} Spotify`
      case 'brand': return `${entity.name} official site`
      case 'product': return `${entity.name} buy`
      case 'person': return `${entity.name} Instagram`
      default: return entity.name
    }
  })()

  const url = await searchDuckDuckGo(searchQuery)
  entity.resolved_url = url
  entity.resolved_via = url ? 'duckduckgo-search' : null
  return entity
}

async function resolveAllEntities(entities: Entity[]): Promise<Entity[]> {
  const results: Entity[] = []

  for (const entity of entities) {
    if (entity.confidence < 0.5) {
      entity.resolved_url = null
      entity.status = 'discarded'
      results.push(entity)
      continue
    }

    entity.status = entity.confidence >= 0.7 ? 'auto' : 'review'
    const resolved = await resolveEntity(entity)
    results.push(resolved)

    console.log(`[instagram-import] Resolved: ${entity.name} -> ${resolved.resolved_url || 'NOT FOUND'}`)

    // Rate limit: 500ms between searches
    await new Promise(r => setTimeout(r, 500))
  }

  return results
}

// ---------------------------------------------------------------------------
// 5. Pin Creation
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
        content_type: entity.type || 'generic',
        type_confidence: entity.confidence,
        source: 'social',
        source_url: reel.url,
        extraction: {
          method: transcript ? 'ai-caption+transcript' : 'ai-caption',
          source_platform: 'instagram',
          source_shortcode: reel.shortcode,
          confidence: entity.confidence,
          entity_type: entity.type,
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
      console.log(`[instagram-import] Found ${extraction.entities.length} entities`)

      // Step 4: Resolve entities
      extraction.entities = await resolveAllEntities(extraction.entities)

      // Step 5: Create pins
      const { source_pin, derived_pins } = createPins(reel, extraction, transcript)

      const elapsed = ((Date.now() - startTime) / 1000).toFixed(1)
      console.log(`[instagram-import] Done in ${elapsed}s: 1 source + ${derived_pins.length} derived pins`)

      return new Response(
        JSON.stringify({
          source_pin,
          derived_pins,
          transcript,
          entities: extraction.entities,
          post_category: extraction.post_category,
          post_summary: extraction.post_summary,
          stats: {
            elapsed_seconds: parseFloat(elapsed),
            entities_found: extraction.entities.length,
            entities_resolved: derived_pins.length,
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
          extraction.entities = await resolveAllEntities(extraction.entities)
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
          extraction.entities = await resolveAllEntities(extraction.entities)
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
