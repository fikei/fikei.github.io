// Supabase Edge Function: enrich-link
// Handles AI classification and image resolution for links
//
// POST /functions/v1/enrich-link
// Body: { url, title?, description?, linkId?, skipClassification?, skipImage? }
// Returns: { content_type, type_confidence, type_source, image_url, image_source, cached }

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

// CORS headers for browser requests
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

// Content types and their image resolution strategies
const CONTENT_TYPES = ['product', 'article', 'video', 'music', 'repository', 'social', 'document', 'tool', 'unknown']

const IMAGE_STRATEGIES: Record<string, string[]> = {
  product: ['scrape', 'search', 'template'],
  article: ['scrape', 'search', 'template'],
  video: ['platform', 'scrape', 'template'],
  music: ['platform', 'search', 'template'],
  repository: ['platform', 'template'],
  social: ['platform', 'scrape', 'template'],
  document: ['template'],
  tool: ['scrape', 'favicon', 'template'],
  unknown: ['scrape', 'search', 'template']
}

serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const { url, title, description, linkId, skipClassification, skipImage } = await req.json()

    if (!url) {
      return new Response(
        JSON.stringify({ error: 'URL is required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    console.log('[enrich-link] Processing:', url)

    const domain = new URL(url).hostname.replace('www.', '')
    const path = new URL(url).pathname

    let contentType = 'unknown'
    let typeConfidence = 0
    let typeSource: 'cache' | 'rules' | 'ai' = 'rules'
    let imageUrl: string | null = null
    let imageSource: 'scraped' | 'platform' | 'searched' | 'generated' | 'template' = 'template'
    let cached = false

    // Initialize Supabase client
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    const supabase = createClient(supabaseUrl, supabaseServiceKey)

    // ========================================
    // STEP 1: Content Type Classification
    // ========================================
    if (!skipClassification) {
      console.log('[enrich-link] Step 1: Classification')

      // Check domain profile cache first
      const { data: profile } = await supabase
        .from('domain_profiles')
        .select('*')
        .eq('domain', domain)
        .single()

      if (profile && profile.confidence > 0.85) {
        console.log('[enrich-link] Cache hit:', profile.primary_type, profile.confidence)
        contentType = profile.primary_type
        typeConfidence = profile.confidence
        typeSource = 'cache'
        cached = true
      } else {
        // Try AI classification
        const aiResult = await classifyWithAI(url, title, description)
        console.log('[enrich-link] AI result:', aiResult)

        if (aiResult) {
          contentType = aiResult.type
          typeConfidence = aiResult.confidence
          typeSource = 'ai'

          // Update domain profile cache
          await updateDomainProfile(supabase, domain, path, aiResult)
        }
      }
    }

    // ========================================
    // STEP 2: Image Resolution
    // ========================================
    if (!skipImage) {
      console.log('[enrich-link] Step 2: Image resolution for type:', contentType)

      const strategies = IMAGE_STRATEGIES[contentType] || IMAGE_STRATEGIES.unknown

      for (const strategy of strategies) {
        console.log('[enrich-link] Trying strategy:', strategy)

        try {
          const result = await executeImageStrategy(strategy, url, title, description)
          if (result && result.url) {
            imageUrl = result.url
            imageSource = result.source
            console.log('[enrich-link] Image found via', strategy, ':', imageUrl)
            break
          }
        } catch (e) {
          console.error('[enrich-link] Strategy failed:', strategy, e)
        }
      }
    }

    // ========================================
    // STEP 3: Update link in database (if linkId provided)
    // ========================================
    if (linkId) {
      console.log('[enrich-link] Step 3: Updating link', linkId)

      await supabase
        .from('links')
        .update({
          content_type: contentType,
          type_confidence: typeConfidence,
          image: imageUrl,
          image_source: imageSource,
          enriched_at: new Date().toISOString()
        })
        .eq('id', linkId)
    }

    // Return result
    const response = {
      content_type: contentType,
      type_confidence: typeConfidence,
      type_source: typeSource,
      image_url: imageUrl,
      image_source: imageSource,
      cached
    }

    console.log('[enrich-link] Complete:', response)

    return new Response(
      JSON.stringify(response),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )

  } catch (error) {
    console.error('[enrich-link] Error:', error)
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})

// ========================================
// AI Classification using Anthropic
// ========================================
async function classifyWithAI(url: string, title: string, description: string): Promise<{ type: string, confidence: number } | null> {
  const apiKey = Deno.env.get('ANTHROPIC_API_KEY')

  if (!apiKey) {
    console.log('[enrich-link] No ANTHROPIC_API_KEY, skipping AI classification')
    return null
  }

  const prompt = `Classify this link into exactly one content type.

URL: ${url}
Title: ${title || 'N/A'}
Description: ${description?.slice(0, 300) || 'N/A'}

Content types:
- product: E-commerce product pages, items for sale
- article: Blog posts, news articles, written content
- video: Video content (YouTube, Vimeo, etc.)
- music: Music, podcasts, audio content
- repository: Code repositories, GitHub projects
- social: Social media posts, profiles
- document: PDFs, docs, spreadsheets
- tool: Web apps, SaaS, utilities
- unknown: Cannot determine

Respond with JSON only: {"type": "...", "confidence": 0.0-1.0}`

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-3-haiku-20240307',
        max_tokens: 100,
        messages: [{ role: 'user', content: prompt }]
      })
    })

    if (!response.ok) {
      console.error('[enrich-link] Anthropic API error:', response.status)
      return null
    }

    const data = await response.json()
    const text = data.content?.[0]?.text || ''
    const match = text.match(/\{[\s\S]*\}/)

    if (match) {
      const result = JSON.parse(match[0])
      // Validate type
      if (CONTENT_TYPES.includes(result.type)) {
        return result
      }
    }
  } catch (e) {
    console.error('[enrich-link] AI classification error:', e)
  }

  return null
}

// ========================================
// Update Domain Profile Cache
// ========================================
async function updateDomainProfile(supabase: any, domain: string, path: string, result: { type: string, confidence: number }) {
  try {
    // Get existing profile
    const { data: existing } = await supabase
      .from('domain_profiles')
      .select('*')
      .eq('domain', domain)
      .single()

    if (existing) {
      // Update types seen
      const typesSeen = existing.types_seen || {}
      typesSeen[result.type] = (typesSeen[result.type] || 0) + 1

      // Calculate if single or multi-type domain
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
      // Create new profile
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
    console.error('[enrich-link] Domain profile update error:', e)
  }
}

// ========================================
// Image Resolution Strategies
// ========================================
async function executeImageStrategy(
  strategy: string,
  url: string,
  title: string,
  description: string
): Promise<{ url: string, source: 'scraped' | 'platform' | 'searched' | 'generated' | 'template' } | null> {

  switch (strategy) {
    case 'platform':
      return await resolvePlatformImage(url)

    case 'scrape':
      return await scrapeImage(url)

    case 'search':
      return await searchImage(title)

    case 'favicon':
      return await resolveFavicon(url)

    case 'template':
    default:
      return null
  }
}

// Platform-specific image resolution (YouTube, GitHub, Vimeo)
async function resolvePlatformImage(url: string): Promise<{ url: string, source: 'platform' } | null> {
  const domain = new URL(url).hostname

  // YouTube
  if (domain.includes('youtube.com') || domain.includes('youtu.be')) {
    const videoId = url.match(/(?:v=|youtu\.be\/)([^&\?]+)/)?.[1]
    if (videoId) {
      return {
        url: `https://img.youtube.com/vi/${videoId}/hqdefault.jpg`,
        source: 'platform'
      }
    }
  }

  // Vimeo
  if (domain.includes('vimeo.com')) {
    const videoId = url.match(/vimeo\.com\/(\d+)/)?.[1]
    if (videoId) {
      try {
        const response = await fetch(`https://vimeo.com/api/v2/video/${videoId}.json`)
        if (response.ok) {
          const data = await response.json()
          if (data[0]?.thumbnail_large) {
            return { url: data[0].thumbnail_large, source: 'platform' }
          }
        }
      } catch (e) {
        console.error('[platform] Vimeo API error:', e)
      }
    }
  }

  // GitHub
  if (domain.includes('github.com')) {
    const match = url.match(/github\.com\/([^\/]+)\/([^\/]+)/)
    if (match) {
      return {
        url: `https://opengraph.githubassets.com/1/${match[1]}/${match[2]}`,
        source: 'platform'
      }
    }
  }

  return null
}

// Scrape OG image from URL (server-side, no CORS issues)
async function scrapeImage(url: string): Promise<{ url: string, source: 'scraped' } | null> {
  try {
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; BoardsBot/1.0; +https://boards.app)'
      }
    })

    if (!response.ok) return null

    const html = await response.text()

    // Try og:image first
    const ogMatch = html.match(/<meta[^>]*property="og:image"[^>]*content="([^"]+)"/i)
      || html.match(/<meta[^>]*content="([^"]+)"[^>]*property="og:image"/i)

    if (ogMatch?.[1]) {
      let imageUrl = ogMatch[1]
      // Handle relative URLs
      if (imageUrl.startsWith('/')) {
        const base = new URL(url)
        imageUrl = `${base.origin}${imageUrl}`
      }
      return { url: imageUrl, source: 'scraped' }
    }

    // Try twitter:image
    const twitterMatch = html.match(/<meta[^>]*name="twitter:image"[^>]*content="([^"]+)"/i)
      || html.match(/<meta[^>]*content="([^"]+)"[^>]*name="twitter:image"/i)

    if (twitterMatch?.[1]) {
      let imageUrl = twitterMatch[1]
      if (imageUrl.startsWith('/')) {
        const base = new URL(url)
        imageUrl = `${base.origin}${imageUrl}`
      }
      return { url: imageUrl, source: 'scraped' }
    }

  } catch (e) {
    console.error('[scrape] Error:', e)
  }

  return null
}

// Search for image using Unsplash API
async function searchImage(query: string): Promise<{ url: string, source: 'searched' } | null> {
  const accessKey = Deno.env.get('UNSPLASH_ACCESS_KEY')

  if (!accessKey || !query) return null

  try {
    const response = await fetch(
      `https://api.unsplash.com/search/photos?query=${encodeURIComponent(query)}&per_page=1`,
      {
        headers: {
          'Authorization': `Client-ID ${accessKey}`
        }
      }
    )

    if (!response.ok) return null

    const data = await response.json()
    if (data.results?.[0]?.urls?.regular) {
      return {
        url: data.results[0].urls.regular,
        source: 'searched'
      }
    }
  } catch (e) {
    console.error('[search] Unsplash error:', e)
  }

  return null
}

// Get high-res favicon
async function resolveFavicon(url: string): Promise<{ url: string, source: 'scraped' } | null> {
  try {
    const domain = new URL(url).hostname
    // Use Google's favicon service for high-res icons
    const faviconUrl = `https://www.google.com/s2/favicons?domain=${domain}&sz=128`

    // Verify it exists
    const response = await fetch(faviconUrl, { method: 'HEAD' })
    if (response.ok) {
      return { url: faviconUrl, source: 'scraped' }
    }
  } catch (e) {
    console.error('[favicon] Error:', e)
  }

  return null
}
