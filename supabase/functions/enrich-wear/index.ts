// Supabase Edge Function: enrich-wear
// Extracts style attributes from wear/fashion items using AI
//
// POST /functions/v1/enrich-wear
// Body: { items: Array<{ id, url, title, description, image }> }
// Returns: { results: Array<{ id, attributes }> }

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'

// CORS headers for browser requests
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

// Types for wear item enrichment
interface WearItem {
  id: string
  url: string
  title: string
  description?: string
  image?: string
}

interface WearAttributes {
  brand: string | null
  colors: string[]
  materials: string[]
  category: 'tops' | 'bottoms' | 'footwear' | 'accessories' | 'outerwear' | 'dresses' | 'unknown'
  priceRange: 'budget' | 'mid' | 'premium' | 'luxury' | 'unknown'
  style: string[]
  fit: string | null
  season: string[]
}

interface EnrichmentResult {
  id: string
  attributes: WearAttributes
  confidence: number
}

serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const { items } = await req.json() as { items: WearItem[] }

    if (!items || !Array.isArray(items) || items.length === 0) {
      return new Response(
        JSON.stringify({ error: 'Items array is required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    console.log('[enrich-wear] Processing', items.length, 'items')

    const results: EnrichmentResult[] = []

    // Process items in batches to respect API limits
    const batchSize = 5
    for (let i = 0; i < items.length; i += batchSize) {
      const batch = items.slice(i, i + batchSize)
      const batchResults = await Promise.all(
        batch.map(item => enrichWearItem(item))
      )
      results.push(...batchResults)
    }

    console.log('[enrich-wear] Complete:', results.length, 'items enriched')

    return new Response(
      JSON.stringify({ results }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )

  } catch (error) {
    console.error('[enrich-wear] Error:', error)
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})

// Enrich a single wear item with AI-extracted attributes
async function enrichWearItem(item: WearItem): Promise<EnrichmentResult> {
  const apiKey = Deno.env.get('ANTHROPIC_API_KEY')

  // Default empty result
  const defaultResult: EnrichmentResult = {
    id: item.id,
    attributes: {
      brand: null,
      colors: [],
      materials: [],
      category: 'unknown',
      priceRange: 'unknown',
      style: [],
      fit: null,
      season: []
    },
    confidence: 0
  }

  if (!apiKey) {
    console.log('[enrich-wear] No ANTHROPIC_API_KEY, returning default')
    return defaultResult
  }

  try {
    // Try to extract from page if we have a URL
    let pageContext = ''
    if (item.url) {
      try {
        const scraped = await scrapeProductPage(item.url)
        if (scraped) {
          pageContext = `\nScraped page data:\n${scraped}`
        }
      } catch (e) {
        console.log('[enrich-wear] Scrape failed:', e)
      }
    }

    const prompt = `Analyze this fashion/clothing item and extract attributes.

Title: ${item.title || 'Unknown'}
Description: ${item.description?.slice(0, 500) || 'N/A'}
URL: ${item.url || 'N/A'}
${pageContext}

Extract these attributes in JSON format:
{
  "brand": "brand name or null if unknown",
  "colors": ["array of colors detected", "e.g. black, white, navy"],
  "materials": ["array of materials", "e.g. cotton, polyester, leather"],
  "category": "one of: tops, bottoms, footwear, accessories, outerwear, dresses, unknown",
  "priceRange": "one of: budget (<$50), mid ($50-150), premium ($150-500), luxury (>$500), unknown",
  "style": ["array of style descriptors", "e.g. minimalist, streetwear, classic, bohemian"],
  "fit": "e.g. relaxed, slim, oversized, regular, or null",
  "season": ["array of seasons", "e.g. spring, summer, fall, winter, all-season"]
}

Be conservative - only include attributes you're confident about based on the data provided.
Respond with JSON only.`

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-3-haiku-20240307',
        max_tokens: 500,
        messages: [{ role: 'user', content: prompt }]
      })
    })

    if (!response.ok) {
      console.error('[enrich-wear] Anthropic API error:', response.status)
      return defaultResult
    }

    const data = await response.json()
    const text = data.content?.[0]?.text || ''
    const match = text.match(/\{[\s\S]*\}/)

    if (match) {
      const parsed = JSON.parse(match[0])

      // Validate and clean the result
      const attributes: WearAttributes = {
        brand: typeof parsed.brand === 'string' ? parsed.brand : null,
        colors: Array.isArray(parsed.colors) ? parsed.colors.slice(0, 5) : [],
        materials: Array.isArray(parsed.materials) ? parsed.materials.slice(0, 5) : [],
        category: validateCategory(parsed.category),
        priceRange: validatePriceRange(parsed.priceRange),
        style: Array.isArray(parsed.style) ? parsed.style.slice(0, 4) : [],
        fit: typeof parsed.fit === 'string' ? parsed.fit : null,
        season: Array.isArray(parsed.season) ? parsed.season.slice(0, 4) : []
      }

      // Calculate confidence based on how many fields were populated
      const populatedFields = [
        attributes.brand,
        attributes.colors.length > 0,
        attributes.materials.length > 0,
        attributes.category !== 'unknown',
        attributes.priceRange !== 'unknown',
        attributes.style.length > 0,
        attributes.fit,
        attributes.season.length > 0
      ].filter(Boolean).length

      const confidence = populatedFields / 8

      console.log('[enrich-wear] Enriched:', item.id, 'confidence:', confidence)

      return {
        id: item.id,
        attributes,
        confidence
      }
    }
  } catch (e) {
    console.error('[enrich-wear] Error enriching item:', item.id, e)
  }

  return defaultResult
}

// Validate category value
function validateCategory(value: string): WearAttributes['category'] {
  const valid = ['tops', 'bottoms', 'footwear', 'accessories', 'outerwear', 'dresses']
  return valid.includes(value) ? value as WearAttributes['category'] : 'unknown'
}

// Validate price range value
function validatePriceRange(value: string): WearAttributes['priceRange'] {
  const valid = ['budget', 'mid', 'premium', 'luxury']
  return valid.includes(value) ? value as WearAttributes['priceRange'] : 'unknown'
}

// Scrape additional product data from URL
async function scrapeProductPage(url: string): Promise<string | null> {
  try {
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
      }
    })

    if (!response.ok) return null

    const html = await response.text()

    // Extract relevant data
    const extracted: string[] = []

    // Extract JSON-LD product data (Shopify, e-commerce sites)
    const jsonLdMatches = html.matchAll(/<script[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/gi)
    for (const match of jsonLdMatches) {
      try {
        const jsonLd = JSON.parse(match[1])
        if (jsonLd['@type'] === 'Product') {
          if (jsonLd.brand?.name) extracted.push(`Brand: ${jsonLd.brand.name}`)
          if (jsonLd.color) extracted.push(`Color: ${jsonLd.color}`)
          if (jsonLd.material) extracted.push(`Material: ${jsonLd.material}`)
          if (jsonLd.offers?.price) extracted.push(`Price: ${jsonLd.offers.priceCurrency || '$'}${jsonLd.offers.price}`)
          if (jsonLd.description) extracted.push(`Description: ${jsonLd.description.slice(0, 300)}`)
        }
      } catch (e) {
        // JSON parse error, continue
      }
    }

    // Extract meta description
    const descMatch = html.match(/<meta[^>]*name="description"[^>]*content="([^"]+)"/i)
    if (descMatch?.[1]) {
      extracted.push(`Meta description: ${descMatch[1].slice(0, 200)}`)
    }

    // Extract product title variations
    const h1Match = html.match(/<h1[^>]*>([^<]+)<\/h1>/i)
    if (h1Match?.[1]) {
      extracted.push(`H1: ${h1Match[1].trim()}`)
    }

    return extracted.length > 0 ? extracted.join('\n') : null

  } catch (e) {
    console.error('[scrape] Error:', e)
    return null
  }
}
