// Supabase Edge Function: analyze-content
// Sense-Making Agent — classifies content, extracts entities, produces practical + taste tags.
// This function handles "understanding" the content; create-pin handles visual representation.
//
// POST /functions/v1/analyze-content
// Body: { url, title?, description? }
// Returns: {
//   content_type, type_confidence, type_source,
//   content_structure,
//   entities[],
//   practical_tags[], taste_tags[],
//   summary
// }
const VERSION = '1.0.0'
console.log(`[analyze-content] v${VERSION} - Sense-Making Agent`)

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

// Expanded content types (includes new types from sense-making plan)
const CONTENT_TYPES = [
  'product', 'article', 'book', 'video', 'music', 'repository', 'social',
  'document', 'tool', 'place', 'recipe', 'event', 'newsletter', 'dataset', 'unknown'
]

// Content structure types
const CONTENT_STRUCTURES = [
  'original_expression', 'curated_collection', 'summary', 'review', 'reference'
]

// JSON-LD types for title resolution (moved from enrich-link)
const JSON_LD_TITLE_TYPES = new Set([
  'TVEpisode', 'VideoObject', 'Movie', 'TVSeries', 'Episode', 'Clip',
  'Article', 'NewsArticle', 'BlogPosting', 'Review',
  'Product', 'Book', 'Recipe',
  'MusicRecording', 'MusicAlbum', 'PodcastEpisode',
  'SoftwareApplication', 'Course', 'Event', 'CreativeWork'
])

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    let { url, title, description } = await req.json()

    if (!url) {
      return new Response(
        JSON.stringify({ error: 'URL is required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    console.log('[analyze-content] Processing:', url)

    const domain = new URL(url).hostname.replace('www.', '')
    const path = new URL(url).pathname

    // ========================================
    // STEP 0: Platform API metadata — resolve titles for sites that block scraping
    // ========================================
    const isYouTube = domain.includes('youtube.com') || domain.includes('youtu.be')
    let platformMeta: { title?: string, author?: string, description?: string } | null = null

    if (isYouTube) {
      const ytData = await lookupYouTube(url)
      if (ytData) {
        platformMeta = {
          title: ytData.title,
          author: ytData.channelTitle,
          description: ytData.description?.slice(0, 500)
        }
      }
    } else if (domain.includes('vimeo.com')) {
      const vimeoData = await resolveOembedMetadata(url, domain)
      if (vimeoData) {
        platformMeta = { title: vimeoData.title, author: vimeoData.author || undefined }
      }
    }

    // Override generic titles with platform-resolved ones
    if (platformMeta?.title) {
      const genericTitles = ['youtube', 'youtu.be', 'vimeo', 'watch', '']
      if (!title || genericTitles.includes(title.toLowerCase().trim())) {
        console.log('[analyze-content] Platform API resolved title:', platformMeta.title)
        title = platformMeta.title
      }
    }
    if (platformMeta?.description && (!description || description.length < 20)) {
      description = platformMeta.description
    }

    // ========================================
    // STEP 0.5: JSON-LD title resolution for non-platform URLs
    // ========================================
    if (title && !isYouTube && /[\|–—]/.test(title)) {
      console.log('[analyze-content] Title has separators, trying JSON-LD resolution:', title)
      const jsonLdTitle = await resolveJsonLdTitle(url)
      if (jsonLdTitle && jsonLdTitle !== title) {
        console.log('[analyze-content] JSON-LD resolved better title:', jsonLdTitle)
        title = jsonLdTitle
      }
    }

    // ========================================
    // STEP 1: Content Type Classification (rules → domain cache → AI)
    // ========================================
    let contentType = 'unknown'
    let typeConfidence = 0
    let typeSource: 'rules' | 'cache' | 'ai' = 'rules'

    // Rules-based: known platform → known type
    if (isYouTube || domain.includes('vimeo.com') || domain.includes('dailymotion.com')) {
      contentType = 'video'
      typeConfidence = 1.0
      console.log('[analyze-content] Video platform detected:', domain)
    } else if (
      domain.includes('spotify.com') || domain.includes('soundcloud.com') ||
      domain.includes('bandcamp.com') || domain.includes('beatport.com') ||
      domain.includes('music.apple.com') || domain.includes('tidal.com') ||
      domain.includes('deezer.com') || domain.includes('audiomack.com') ||
      domain.includes('music.youtube.com')
    ) {
      contentType = 'music'
      typeConfidence = 1.0
      console.log('[analyze-content] Music platform detected:', domain)
    } else if (domain.includes('github.com') || domain.includes('gitlab.com')) {
      contentType = 'repository'
      typeConfidence = 0.95
      console.log('[analyze-content] Code platform detected:', domain)
    } else if (
      domain.includes('instagram.com') || domain.includes('tiktok.com') ||
      domain.includes('twitter.com') || domain.includes('x.com')
    ) {
      contentType = 'social'
      typeConfidence = 0.9
      console.log('[analyze-content] Social platform detected:', domain)
    } else if (
      domain.includes('maps.google.com') || domain.includes('yelp.com') ||
      domain.includes('tripadvisor.com') || domain.includes('opentable.com')
    ) {
      contentType = 'place'
      typeConfidence = 0.95
      console.log('[analyze-content] Place platform detected:', domain)
    } else if (domain.includes('eventbrite.com') || domain.includes('meetup.com')) {
      contentType = 'event'
      typeConfidence = 0.9
      console.log('[analyze-content] Event platform detected:', domain)
    } else if (
      domain.includes('goodreads.com') || domain.includes('openlibrary.org') ||
      (domain.includes('amazon.com') && path.includes('/dp/') && (title?.toLowerCase().includes('book') || path.includes('/books/')))
    ) {
      contentType = 'book'
      typeConfidence = 0.9
      console.log('[analyze-content] Book platform detected:', domain)
    }

    // Domain profile cache (if rules didn't match)
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    const supabase = createClient(supabaseUrl, supabaseServiceKey)

    if (contentType === 'unknown') {
      const { data: profile } = await supabase
        .from('domain_profiles')
        .select('*')
        .eq('domain', domain)
        .single()

      if (profile && profile.confidence > 0.85) {
        console.log('[analyze-content] Cache hit:', profile.primary_type, profile.confidence)
        contentType = profile.primary_type
        typeConfidence = profile.confidence
        typeSource = 'cache'
      }
    }

    // ========================================
    // STEP 2: AI Sense-Making (classification + entities + tags + structure)
    // Single Claude call for all sense-making outputs
    // ========================================
    let entities: any[] = []
    let practicalTags: string[] = []
    let tasteTags: string[] = []
    let contentStructure: string | null = null
    let summary: string | null = null

    const apiKey = Deno.env.get('ANTHROPIC_API_KEY')
    const hasInput = title || description

    if (apiKey && hasInput) {
      console.log('[analyze-content] Step 2: AI sense-making')

      const needsClassification = contentType === 'unknown'
      const classificationBlock = needsClassification ? `
"content_type": one of [${CONTENT_TYPES.join(', ')}],
"type_confidence": 0.0-1.0,` : ''

      const prompt = `Analyze this content and produce structured metadata.

URL: ${url}
Title: ${title || 'N/A'}
Description: ${description?.slice(0, 500) || 'N/A'}
${contentType !== 'unknown' ? `Known content_type: ${contentType}` : ''}

Respond with JSON only:
{${classificationBlock}
  "content_structure": one of ["original_expression", "curated_collection", "summary", "review", "reference"],
  "entities": [{"type": "restaurant|product|brand|song|album|person|place|food|event|book|tool|concept|generic", "name": "canonical name", "confidence": 0.0-1.0}],
  "practical_tags": ["3-8 objective factual tags, e.g. restaurant, italian, monitor, electronics"],
  "taste_tags": ["3-8 subjective aesthetic tags, e.g. minimalist, vintage, upscale, cozy"],
  "summary": "one-sentence summary of the content"
}

Guidelines:
- practical_tags: objective, factual, searchable classification. What IS this about.
- taste_tags: subjective aesthetic/cultural/vibe tags. What does this FEEL like.
- entities: the main real-world things referenced (top 3-5). Not generic concepts.
- content_structure: how the content is organized (original work, list, review, etc.)
- Keep tags lowercase, use underscores for multi-word tags.`

      try {
        const response = await fetch('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-api-key': apiKey,
            'anthropic-version': '2023-06-01'
          },
          body: JSON.stringify({
            model: 'claude-3-5-haiku-20241022',
            max_tokens: 800,
            messages: [{ role: 'user', content: prompt }]
          })
        })

        if (!response.ok) {
          console.error('[analyze-content] Anthropic API error:', response.status)
        } else {
          const data = await response.json()
          const text = data.content?.[0]?.text || ''
          const match = text.match(/\{[\s\S]*\}/)

          if (match) {
            const result = JSON.parse(match[0])

            // Classification (if AI was asked to classify)
            if (needsClassification && result.content_type && CONTENT_TYPES.includes(result.content_type)) {
              contentType = result.content_type
              typeConfidence = result.type_confidence || 0.8
              typeSource = 'ai'

              // Update domain profile cache
              await updateDomainProfile(supabase, domain, path, { type: contentType, confidence: typeConfidence })
            }

            // Content structure
            if (result.content_structure && CONTENT_STRUCTURES.includes(result.content_structure)) {
              contentStructure = result.content_structure
            }

            // Entities
            if (Array.isArray(result.entities)) {
              entities = result.entities
                .filter((e: any) => e.name && e.type)
                .slice(0, 5)
                .map((e: any) => ({
                  type: e.type,
                  name: e.name,
                  confidence: e.confidence || 0.8
                }))
            }

            // Tags
            if (Array.isArray(result.practical_tags)) {
              practicalTags = result.practical_tags
                .filter((t: any) => typeof t === 'string')
                .slice(0, 8)
                .map((t: string) => t.toLowerCase().replace(/\s+/g, '_'))
            }
            if (Array.isArray(result.taste_tags)) {
              tasteTags = result.taste_tags
                .filter((t: any) => typeof t === 'string')
                .slice(0, 8)
                .map((t: string) => t.toLowerCase().replace(/\s+/g, '_'))
            }

            // Summary
            if (typeof result.summary === 'string') {
              summary = result.summary.slice(0, 200)
            }

            console.log('[analyze-content] AI result:', {
              content_type: contentType,
              content_structure: contentStructure,
              entities: entities.length,
              practical_tags: practicalTags.length,
              taste_tags: tasteTags.length
            })
          }
        }
      } catch (e) {
        console.error('[analyze-content] AI sense-making error:', e)
      }
    } else if (!apiKey) {
      console.log('[analyze-content] No ANTHROPIC_API_KEY, skipping AI sense-making')
    } else {
      console.log('[analyze-content] No title or description, skipping AI sense-making')
    }

    // ========================================
    // Build response
    // ========================================
    const response: Record<string, any> = {
      content_type: contentType,
      type_confidence: typeConfidence,
      type_source: typeSource,
      content_structure: contentStructure,
      entities,
      practical_tags: practicalTags,
      taste_tags: tasteTags,
      summary
    }

    // Include platform-resolved title if meaningful
    if (platformMeta?.title && title && title !== platformMeta.title) {
      response.title = title
    } else if (platformMeta?.title) {
      response.title = platformMeta.title
    }
    if (platformMeta?.author) {
      response.author = platformMeta.author
    }

    console.log('[analyze-content] Complete:', {
      content_type: contentType,
      type_source: typeSource,
      content_structure: contentStructure,
      entities: entities.length,
      practical_tags: practicalTags.length,
      taste_tags: tasteTags.length
    })

    return new Response(
      JSON.stringify(response),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )

  } catch (error) {
    console.error('[analyze-content] Error:', error)
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})

// ========================================
// oEmbed Metadata Resolution (Vimeo)
// ========================================
async function resolveOembedMetadata(
  url: string,
  domain: string
): Promise<{ title: string, author: string | null, thumbnail: string | null } | null> {
  if (domain.includes('vimeo.com')) {
    try {
      const resp = await fetch(
        `https://vimeo.com/api/oembed.json?url=${encodeURIComponent(url)}`
      )
      if (resp.ok) {
        const data = await resp.json()
        if (data.title) {
          return {
            title: data.title,
            author: data.author_name || null,
            thumbnail: data.thumbnail_url || null
          }
        }
      }
    } catch (e) {
      console.error('[analyze-content] Vimeo oEmbed error:', e)
    }
  }
  return null
}

// ========================================
// JSON-LD Title Resolution
// ========================================
async function resolveJsonLdTitle(url: string): Promise<string | null> {
  try {
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.5',
      }
    })
    if (!response.ok) return null

    const html = await response.text()
    const jsonLdMatches = html.matchAll(/<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)

    for (const match of jsonLdMatches) {
      try {
        const ld = JSON.parse(match[1])
        const candidates = ld['@graph'] ? ld['@graph'] : [ld]
        for (const item of candidates) {
          if (item?.name && JSON_LD_TITLE_TYPES.has(item['@type'])) {
            if (item.name.length < 5) continue
            console.log('[analyze-content] JSON-LD resolved title:', item.name, 'from @type:', item['@type'])
            return item.name
          }
        }
      } catch (_e) { /* JSON parse error, continue */ }
    }
  } catch (e) {
    console.log('[analyze-content] JSON-LD fetch failed:', (e as Error).message)
  }
  return null
}

// ========================================
// YouTube Data API v3
// ========================================
interface YouTubeVideoData {
  videoId: string
  title: string
  description: string
  channelTitle: string
  publishedAt: string
  thumbnailUrl: string | null
  duration: number | null
  tags: string[]
  categoryId: string | null
  viewCount: number | null
  likeCount: number | null
}

function extractYouTubeVideoId(url: string): string | null {
  const match = url.match(/(?:v=|youtu\.be\/|\/shorts\/)([^&\?\/]+)/)
  return match?.[1] || null
}

function parseISO8601Duration(iso: string | null): number | null {
  if (!iso) return null
  const match = iso.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/)
  if (!match) return null
  return (parseInt(match[1] || '0') * 3600) +
         (parseInt(match[2] || '0') * 60) +
         parseInt(match[3] || '0')
}

async function lookupYouTube(url: string): Promise<YouTubeVideoData | null> {
  const videoId = extractYouTubeVideoId(url)
  if (!videoId) return null

  const apiKey = Deno.env.get('YOUTUBE_API_KEY')
  if (!apiKey) {
    console.log('[analyze-content] No YOUTUBE_API_KEY, trying oEmbed fallback')
    // oEmbed fallback for basic metadata
    try {
      const resp = await fetch(`https://www.youtube.com/oembed?url=${encodeURIComponent(url)}&format=json`)
      if (resp.ok) {
        const data = await resp.json()
        return {
          videoId,
          title: data.title || '',
          description: '',
          channelTitle: data.author_name || '',
          publishedAt: '',
          thumbnailUrl: data.thumbnail_url || `https://img.youtube.com/vi/${videoId}/hqdefault.jpg`,
          duration: null,
          tags: [],
          categoryId: null,
          viewCount: null,
          likeCount: null
        }
      }
    } catch (_e) { /* oEmbed failed */ }
    return null
  }

  try {
    const apiUrl = `https://www.googleapis.com/youtube/v3/videos?id=${videoId}&key=${apiKey}&part=snippet,contentDetails,statistics`
    const resp = await fetch(apiUrl)
    if (!resp.ok) {
      console.error('[analyze-content] YouTube API error:', resp.status)
      return null
    }

    const { items } = await resp.json()
    if (!items || items.length === 0) return null

    const video = items[0]
    const snippet = video.snippet || {}
    const contentDetails = video.contentDetails || {}
    const statistics = video.statistics || {}

    const thumbs = snippet.thumbnails || {}
    const thumbnailUrl = thumbs.maxres?.url
      || thumbs.standard?.url
      || thumbs.high?.url
      || thumbs.medium?.url
      || thumbs.default?.url
      || `https://img.youtube.com/vi/${videoId}/hqdefault.jpg`

    return {
      videoId,
      title: snippet.title || '',
      description: snippet.description || '',
      channelTitle: snippet.channelTitle || '',
      publishedAt: snippet.publishedAt || '',
      thumbnailUrl,
      duration: parseISO8601Duration(contentDetails.duration),
      tags: snippet.tags || [],
      categoryId: snippet.categoryId || null,
      viewCount: statistics.viewCount ? parseInt(statistics.viewCount, 10) : null,
      likeCount: statistics.likeCount ? parseInt(statistics.likeCount, 10) : null
    }
  } catch (e) {
    console.error('[analyze-content] YouTube API lookup error:', e)
    return null
  }
}

// ========================================
// Update Domain Profile Cache
// ========================================
async function updateDomainProfile(
  supabase: any,
  domain: string,
  path: string,
  result: { type: string, confidence: number }
) {
  try {
    const { data: existing } = await supabase
      .from('domain_profiles')
      .select('*')
      .eq('domain', domain)
      .single()

    if (existing) {
      const typesSeen = existing.types_seen || {}
      typesSeen[result.type] = (typesSeen[result.type] || 0) + 1

      const types = Object.keys(typesSeen)
      const total = Object.values(typesSeen).reduce((a: number, b: number) => a + b, 0) as number
      const dominant = Object.entries(typesSeen).sort((a, b) => (b[1] as number) - (a[1] as number))[0]
      const dominantRatio = (dominant[1] as number) / total

      await supabase
        .from('domain_profiles')
        .update({
          types_seen: typesSeen,
          sample_count: total,
          primary_type: dominant[0],
          confidence: dominantRatio,
          classification: types.length === 1 || dominantRatio > 0.9 ? 'single_type' : 'multi_type',
          updated_at: new Date().toISOString()
        })
        .eq('domain', domain)
    } else {
      await supabase
        .from('domain_profiles')
        .insert({
          domain,
          primary_type: result.type,
          types_seen: { [result.type]: 1 },
          sample_count: 1,
          confidence: result.confidence,
          classification: 'unknown'
        })
    }
  } catch (e) {
    console.error('[analyze-content] Domain profile update error:', e)
  }
}
