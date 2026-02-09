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
    let imageScores: Record<string, any> | null = null
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
            // Tier 2 validation: check image loads, dimensions, format
            console.log('[enrich-link] Validating image via Tier 2:', result.url)
            const validation = await validateImageTier2(result.url)

            if (!validation.pass) {
              console.log('[enrich-link] Tier 2 rejected:', result.url, validation.reason, validation.checks.filter(c => !c.pass))
              continue // Try next strategy
            }

            imageUrl = result.url
            imageSource = result.source
            imageScores = {
              visual_quality: validation.scores.visual_quality,
              distinctiveness: validation.scores.distinctiveness,
              tier2_checks: validation.checks,
              dimensions: validation.dimensions || null,
              file_size: validation.fileSize || null,
              content_type_header: validation.contentType || null,
              evaluated_at: new Date().toISOString(),
              evaluation_method: 'tier2_technical'
            }
            console.log('[enrich-link] Image validated via', strategy, ':', imageUrl,
              validation.dimensions ? `${validation.dimensions.width}x${validation.dimensions.height}` : '')
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

      const updatePayload: Record<string, any> = {
        content_type: contentType,
        type_confidence: typeConfidence,
        image: imageUrl,
        image_source: imageSource,
        image_resolved_at: new Date().toISOString()
      }
      if (imageScores) {
        updatePayload.image_scores = imageScores
      }
      await supabase
        .from('links')
        .update(updatePayload)
        .eq('id', linkId)
    }

    // Return result
    const response = {
      content_type: contentType,
      type_confidence: typeConfidence,
      type_source: typeSource,
      image_url: imageUrl,
      image_source: imageSource,
      image_scores: imageScores,
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
    // Use a more browser-like User-Agent to avoid bot blocks
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.5',
        'Cache-Control': 'no-cache'
      }
    })

    if (!response.ok) {
      console.log('[scrape] HTTP error:', response.status, 'for', url)
      return null
    }

    const html = await response.text()
    const base = new URL(url)

    // Helper to resolve relative URLs
    const resolveUrl = (imgUrl: string): string => {
      if (!imgUrl) return ''
      if (imgUrl.startsWith('//')) return `https:${imgUrl}`
      if (imgUrl.startsWith('/')) return `${base.origin}${imgUrl}`
      if (!imgUrl.startsWith('http')) return `${base.origin}/${imgUrl}`
      return imgUrl
    }

    // 1. Try og:image first
    const ogMatch = html.match(/<meta[^>]*property="og:image"[^>]*content="([^"]+)"/i)
      || html.match(/<meta[^>]*content="([^"]+)"[^>]*property="og:image"/i)

    if (ogMatch?.[1]) {
      const imageUrl = resolveUrl(ogMatch[1])
      // Skip if it looks like a logo/placeholder
      if (!isLikelyLogo(imageUrl)) {
        console.log('[scrape] Found og:image:', imageUrl)
        return { url: imageUrl, source: 'scraped' }
      }
      console.log('[scrape] Skipping og:image (likely logo):', imageUrl)
    }

    // 2. Try twitter:image
    const twitterMatch = html.match(/<meta[^>]*name="twitter:image"[^>]*content="([^"]+)"/i)
      || html.match(/<meta[^>]*content="([^"]+)"[^>]*name="twitter:image"/i)

    if (twitterMatch?.[1]) {
      const imageUrl = resolveUrl(twitterMatch[1])
      if (!isLikelyLogo(imageUrl)) {
        console.log('[scrape] Found twitter:image:', imageUrl)
        return { url: imageUrl, source: 'scraped' }
      }
    }

    // 3. Try JSON-LD structured data (common in Shopify, e-commerce)
    const jsonLdMatches = html.matchAll(/<script[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/gi)
    for (const match of jsonLdMatches) {
      try {
        const jsonLd = JSON.parse(match[1])
        // Handle Product schema
        const product = jsonLd['@type'] === 'Product' ? jsonLd : jsonLd['@graph']?.find((item: any) => item['@type'] === 'Product')
        if (product?.image) {
          const productImage = Array.isArray(product.image) ? product.image[0] : product.image
          const imageUrl = typeof productImage === 'string' ? productImage : productImage?.url
          if (imageUrl && !isLikelyLogo(imageUrl)) {
            console.log('[scrape] Found JSON-LD product image:', imageUrl)
            return { url: resolveUrl(imageUrl), source: 'scraped' }
          }
        }
      } catch (e) {
        // JSON parse error, continue
      }
    }

    // 4. Try Shopify CDN pattern (common in Shopify stores)
    const shopifyMatch = html.match(/https:\/\/cdn\.shopify\.com\/s\/files\/[^"'\s]+\.(?:jpg|jpeg|png|webp)/i)
    if (shopifyMatch?.[0] && !isLikelyLogo(shopifyMatch[0])) {
      console.log('[scrape] Found Shopify CDN image:', shopifyMatch[0])
      return { url: shopifyMatch[0], source: 'scraped' }
    }

    // 5. Try first large image in srcset (common in Next.js sites)
    const srcsetMatch = html.match(/srcset="([^"]+)"/i)
    if (srcsetMatch?.[1]) {
      const srcsetParts = srcsetMatch[1].split(',').map(s => s.trim())
      // Get the largest image (usually last in srcset)
      const largestSrc = srcsetParts[srcsetParts.length - 1]?.split(' ')[0]
      if (largestSrc && !isLikelyLogo(largestSrc)) {
        console.log('[scrape] Found srcset image:', largestSrc)
        return { url: resolveUrl(largestSrc), source: 'scraped' }
      }
    }

    console.log('[scrape] No suitable image found for:', url)

  } catch (e) {
    console.error('[scrape] Error:', e)
  }

  return null
}

// Patterns that indicate a logo/icon rather than product image
const LOGO_PATTERNS = [
  /logo/i, /icon/i, /favicon/i, /brand/i, /avatar/i,
  /placeholder/i, /default/i, /blank/i, /spacer/i,
  /pixel/i, /1x1/i, /transparent/i, /sprite/i,
  /tracking/i, /beacon/i, /badge/i, /button/i,
  /banner-ad/i, /ad-banner/i, /widget-icon/i
]

// Known CDN placeholder URL patterns
const PLACEHOLDER_URL_PATTERNS = [
  /no-image/i, /noimage/i, /no_image/i,
  /missing/i, /not-found/i, /not_found/i,
  /fallback/i,
  /placeholder\.(jpg|png|gif|svg|webp)/i,
  /default\.(jpg|png|gif|svg|webp)/i,
  /blank\.(jpg|png|gif|svg|webp)/i
]

function isLikelyLogo(url: string): boolean {
  return LOGO_PATTERNS.some(p => p.test(url))
}

function isPlaceholderUrl(url: string): boolean {
  return PLACEHOLDER_URL_PATTERNS.some(p => p.test(url))
}

// ========================================
// Tier 2: Server-Side Image Validation
// ========================================

// Known-good image sources that bypass Tier 2 checks
const KNOWN_GOOD_SOURCES = [
  /img\.youtube\.com\/vi\//,
  /i\.vimeocdn\.com\//,
  /opengraph\.githubassets\.com\//,
  /i\.scdn\.co\//,
  /mosaic\.scdn\.co\//,
  /image\.tmdb\.org\//,
  /m\.media-amazon\.com\//,
  /images-na\.ssl-images-amazon\.com\//
]

// Card context minimum dimensions
const CARD_THRESHOLDS: Record<string, { minWidth: number, minHeight: number, maxAspect: number }> = {
  grid:   { minWidth: 300, minHeight: 200, maxAspect: 3 },
  hero:   { minWidth: 600, minHeight: 400, maxAspect: 2.5 },
  thumb:  { minWidth: 100, minHeight: 100, maxAspect: 2 },
  widget: { minWidth: 200, minHeight: 200, maxAspect: 2 }
}

// Valid image content types
const VALID_IMAGE_TYPES = [
  'image/jpeg', 'image/png', 'image/webp', 'image/avif', 'image/gif', 'image/svg+xml'
]

interface Tier2Result {
  pass: boolean
  reason?: string
  scores: {
    visual_quality: number
    distinctiveness: number
  }
  checks: Array<{ check: string, pass: boolean, detail?: string }>
  dimensions?: { width: number, height: number }
  fileSize?: number
  contentType?: string
}

/**
 * Tier 2 server-side image validation.
 * Uses HEAD request + optional partial download to check dimensions, format, and file size.
 */
async function validateImageTier2(imageUrl: string, cardContext: string = 'grid'): Promise<Tier2Result> {
  const checks: Array<{ check: string, pass: boolean, detail?: string }> = []
  let visualQuality = 1.0
  let distinctiveness = 1.0
  let dimensions: { width: number, height: number } | undefined
  let fileSize: number | undefined
  let contentType: string | undefined

  // Known-good source bypass
  if (KNOWN_GOOD_SOURCES.some(p => p.test(imageUrl))) {
    checks.push({ check: 'known_good_source', pass: true, detail: 'trusted source' })
    return {
      pass: true,
      scores: { visual_quality: 0.9, distinctiveness: 1.0 },
      checks,
      dimensions: undefined,
      fileSize: undefined,
      contentType: undefined
    }
  }

  // Placeholder URL check
  if (isPlaceholderUrl(imageUrl)) {
    return {
      pass: false,
      reason: 'placeholder_url',
      scores: { visual_quality: 0, distinctiveness: 0 },
      checks: [{ check: 'placeholder_url', pass: false }]
    }
  }

  try {
    // HEAD request to get metadata without downloading full image
    const headResponse = await fetch(imageUrl, {
      method: 'HEAD',
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; ctrl.rodeo image validator)',
        'Accept': 'image/*'
      }
    })

    // Check 1: Image loads (HTTP 200)
    if (!headResponse.ok) {
      checks.push({ check: 'http_status', pass: false, detail: `HTTP ${headResponse.status}` })
      return {
        pass: false,
        reason: 'http_error',
        scores: { visual_quality: 0, distinctiveness: 0 },
        checks
      }
    }
    checks.push({ check: 'http_status', pass: true })

    // Check 2: Content-Type is an image
    contentType = headResponse.headers.get('content-type')?.split(';')[0]?.trim() || ''
    const isValidType = VALID_IMAGE_TYPES.some(t => contentType!.startsWith(t))
    checks.push({ check: 'content_type', pass: isValidType, detail: contentType })
    if (!isValidType) {
      return {
        pass: false,
        reason: 'not_image',
        scores: { visual_quality: 0, distinctiveness: 0 },
        checks,
        contentType
      }
    }

    // Check 3: File size (from Content-Length header)
    const contentLength = headResponse.headers.get('content-length')
    if (contentLength) {
      fileSize = parseInt(contentLength, 10)

      // Too small — likely placeholder/pixel
      if (fileSize < 5000) { // 5KB
        visualQuality = Math.min(visualQuality, 0.1)
        distinctiveness = Math.min(distinctiveness, 0.1)
        checks.push({ check: 'file_size', pass: false, detail: `${fileSize} bytes (< 5KB minimum)` })
      }
      // Very small — suspicious but not definitive
      else if (fileSize < 15000) { // 15KB
        visualQuality = Math.min(visualQuality, 0.5)
        checks.push({ check: 'file_size', pass: true, detail: `${fileSize} bytes (small but acceptable)` })
      } else {
        checks.push({ check: 'file_size', pass: true, detail: `${fileSize} bytes` })
      }
    } else {
      checks.push({ check: 'file_size', pass: true, detail: 'no Content-Length header' })
    }

    // Check 4: Redirect detection — if final URL differs significantly, might be error page
    const finalUrl = headResponse.url
    if (finalUrl && finalUrl !== imageUrl) {
      const finalLower = finalUrl.toLowerCase()
      if (finalLower.includes('error') || finalLower.includes('404') || finalLower.includes('not-found')) {
        checks.push({ check: 'redirect_check', pass: false, detail: `redirected to error page: ${finalUrl}` })
        return {
          pass: false,
          reason: 'redirect_to_error',
          scores: { visual_quality: 0, distinctiveness: 0 },
          checks,
          contentType,
          fileSize
        }
      }
      checks.push({ check: 'redirect_check', pass: true, detail: `redirected to ${finalUrl}` })
    }

    // Check 5: Try to extract dimensions by partial download (first 32KB for JPEG/PNG headers)
    try {
      const partialResponse = await fetch(imageUrl, {
        headers: {
          'Range': 'bytes=0-32768',
          'User-Agent': 'Mozilla/5.0 (compatible; ctrl.rodeo image validator)',
          'Accept': 'image/*'
        }
      })

      if (partialResponse.ok || partialResponse.status === 206) {
        const buffer = await partialResponse.arrayBuffer()
        const bytes = new Uint8Array(buffer)
        dimensions = extractDimensions(bytes, contentType!)

        if (dimensions) {
          const thresholds = CARD_THRESHOLDS[cardContext] || CARD_THRESHOLDS.grid
          const aspect = dimensions.width / dimensions.height

          // Resolution check
          if (dimensions.width < 50 || dimensions.height < 50) {
            visualQuality = 0
            checks.push({ check: 'dimensions', pass: false, detail: `${dimensions.width}x${dimensions.height} (below absolute minimum 50px)` })
          } else if (dimensions.width < thresholds.minWidth || dimensions.height < thresholds.minHeight) {
            visualQuality = Math.min(visualQuality, 0.4)
            checks.push({ check: 'dimensions', pass: false, detail: `${dimensions.width}x${dimensions.height} (below ${cardContext} minimum ${thresholds.minWidth}x${thresholds.minHeight})` })
          } else {
            checks.push({ check: 'dimensions', pass: true, detail: `${dimensions.width}x${dimensions.height}` })
          }

          // Aspect ratio check
          if (aspect > thresholds.maxAspect || aspect < (1 / thresholds.maxAspect)) {
            visualQuality = Math.min(visualQuality, 0.3)
            checks.push({ check: 'aspect_ratio', pass: false, detail: `${aspect.toFixed(2)} (outside ${thresholds.maxAspect}:1 limit)` })
          } else {
            checks.push({ check: 'aspect_ratio', pass: true, detail: `${aspect.toFixed(2)}` })
          }
        } else {
          checks.push({ check: 'dimensions', pass: true, detail: 'could not extract from headers' })
        }
      }
    } catch (e) {
      // Partial download failed — not critical, skip dimension checks
      checks.push({ check: 'dimensions', pass: true, detail: 'partial download failed, skipping' })
    }

  } catch (e) {
    checks.push({ check: 'network', pass: false, detail: (e as Error).message })
    return {
      pass: false,
      reason: 'network_error',
      scores: { visual_quality: 0, distinctiveness: 0 },
      checks
    }
  }

  const pass = visualQuality > 0 && distinctiveness > 0

  return {
    pass,
    reason: !pass ? 'below_quality_threshold' : undefined,
    scores: { visual_quality: visualQuality, distinctiveness },
    checks,
    dimensions,
    fileSize,
    contentType
  }
}

/**
 * Extract image dimensions from the first bytes of an image file.
 * Supports JPEG (SOF markers) and PNG (IHDR chunk).
 */
function extractDimensions(bytes: Uint8Array, contentType: string): { width: number, height: number } | null {
  // PNG: width/height at bytes 16-23 in IHDR
  if (contentType.includes('png') && bytes.length >= 24) {
    if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4E && bytes[3] === 0x47) {
      const width = (bytes[16] << 24) | (bytes[17] << 16) | (bytes[18] << 8) | bytes[19]
      const height = (bytes[20] << 24) | (bytes[21] << 16) | (bytes[22] << 8) | bytes[23]
      if (width > 0 && height > 0 && width < 100000 && height < 100000) {
        return { width, height }
      }
    }
  }

  // JPEG: scan for SOF0 (0xFFC0) or SOF2 (0xFFC2) marker
  if (contentType.includes('jpeg') || contentType.includes('jpg')) {
    for (let i = 0; i < bytes.length - 9; i++) {
      if (bytes[i] === 0xFF && (bytes[i + 1] === 0xC0 || bytes[i + 1] === 0xC2)) {
        const height = (bytes[i + 5] << 8) | bytes[i + 6]
        const width = (bytes[i + 7] << 8) | bytes[i + 8]
        if (width > 0 && height > 0 && width < 100000 && height < 100000) {
          return { width, height }
        }
      }
    }
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
