// Supabase Edge Function: generate-widget
// Generates AI content for widgets based on PRD prompts
// Now includes product search to find actual vendor URLs and images
//
// POST /functions/v1/generate-widget
// Body: { widgetId, prompt, items: Array<{ id, title, description, image, url }> }
// Returns: { content: object, cached: boolean }

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'

// CORS headers for browser requests
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

// Product search result
interface ProductSearchResult {
  productUrl: string | null
  productImage: string | null
  vendor: string | null
  price: string | null
}

// Search for actual product URL and image using Google Shopping
async function searchProduct(query: string): Promise<ProductSearchResult> {
  console.log('[product-search] Searching for:', query)

  try {
    // Use Google Shopping search
    const searchUrl = `https://www.google.com/search?tbm=shop&q=${encodeURIComponent(query)}`

    const response = await fetch(searchUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.5',
      }
    })

    if (!response.ok) {
      console.log('[product-search] Google search failed:', response.status)
      return { productUrl: null, productImage: null, vendor: null, price: null }
    }

    const html = await response.text()

    // Extract first product link (look for actual merchant URLs, not Google redirect)
    // Google Shopping embeds merchant URLs in data attributes and links

    // Try to find product image (usually in img tags with shopping results)
    const imageMatch = html.match(/data-src="(https:\/\/[^"]+(?:\.jpg|\.png|\.webp)[^"]*)"/i) ||
                       html.match(/src="(https:\/\/encrypted-tbn[^"]+)"/i) ||
                       html.match(/<img[^>]+src="(https:\/\/[^"]+)"/i)

    // Try to find merchant URL (look for actual product page links)
    const urlMatch = html.match(/href="\/url\?url=(https?:\/\/[^&"]+)/i) ||
                     html.match(/data-merchant-url="(https?:\/\/[^"]+)"/i) ||
                     html.match(/href="(https?:\/\/(?!www\.google)[^"]+(?:\/product|\/p\/|\/dp\/)[^"]*)"/i)

    // Try to find price
    const priceMatch = html.match(/\$[\d,]+(?:\.\d{2})?/)

    // Try to find vendor/merchant name
    const vendorMatch = html.match(/data-merchant="([^"]+)"/i) ||
                        html.match(/class="[^"]*merchant[^"]*"[^>]*>([^<]+)</i)

    const productUrl = urlMatch ? decodeURIComponent(urlMatch[1]) : null
    const productImage = imageMatch ? imageMatch[1] : null
    const vendor = vendorMatch ? vendorMatch[1] : null
    const price = priceMatch ? priceMatch[0] : null

    console.log('[product-search] Found:', { productUrl: !!productUrl, productImage: !!productImage, vendor, price })

    return { productUrl, productImage, vendor, price }
  } catch (error) {
    console.error('[product-search] Error:', error)
    return { productUrl: null, productImage: null, vendor: null, price: null }
  }
}

// Enrich suggestions with actual product URLs and images
async function enrichSuggestions(suggestions: any[]): Promise<any[]> {
  console.log('[enrich] Enriching', suggestions.length, 'suggestions')

  const enriched = await Promise.all(
    suggestions.map(async (sug) => {
      const searchQuery = sug.searchQuery || sug.name
      const result = await searchProduct(searchQuery)

      return {
        ...sug,
        productUrl: result.productUrl,
        productImage: result.productImage,
        vendor: result.vendor || sug.brand,
        price: result.price || sug.price
      }
    })
  )

  return enriched
}

// Types for widget generation
interface WearItem {
  id: string
  title: string
  description?: string
  image?: string
  url: string
}

interface WidgetRequest {
  widgetId: string
  prompt: string
  items: WearItem[]
}

// Simple in-memory cache (per-instance, resets on cold start)
const cache = new Map<string, { content: object; timestamp: number }>()
const CACHE_TTL = 60 * 60 * 1000 // 1 hour

function getCacheKey(widgetId: string, items: WearItem[]): string {
  const itemIds = items.map(i => i.id).sort().join(',')
  return `${widgetId}:${itemIds}`
}

serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const { widgetId, prompt, items } = await req.json() as WidgetRequest

    if (!widgetId || !prompt || !items || items.length === 0) {
      return new Response(
        JSON.stringify({ error: 'widgetId, prompt, and items are required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    console.log('[generate-widget]', widgetId, '- Processing', items.length, 'items')

    // Check cache
    const cacheKey = getCacheKey(widgetId, items)
    const cached = cache.get(cacheKey)
    if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
      console.log('[generate-widget] Cache hit for', cacheKey)
      return new Response(
        JSON.stringify({ content: cached.content, cached: true }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Get API key from environment
    const apiKey = Deno.env.get('ANTHROPIC_API_KEY')
    if (!apiKey) {
      console.error('[generate-widget] ANTHROPIC_API_KEY not set')
      return new Response(
        JSON.stringify({ error: 'AI service not configured' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Build the items context for the AI
    const itemsContext = items.map((item, i) =>
      `${i + 1}. ID: ${item.id}
   Title: ${item.title}
   ${item.description ? `Description: ${item.description}` : ''}
   URL: ${item.url}`
    ).join('\n\n')

    const fullPrompt = `${prompt}

Here are the items to analyze:

${itemsContext}

Respond with valid JSON only, no markdown or explanation.`

    console.log('[generate-widget] Calling Claude API...')

    // Call Claude API
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-3-haiku-20240307',
        max_tokens: 1024,
        messages: [{
          role: 'user',
          content: fullPrompt
        }]
      })
    })

    if (!response.ok) {
      const errorText = await response.text()
      console.error('[generate-widget] Claude API error:', response.status, errorText)
      return new Response(
        JSON.stringify({ error: 'AI generation failed', details: response.status }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    const aiResponse = await response.json()
    const textContent = aiResponse.content?.[0]?.text

    if (!textContent) {
      console.error('[generate-widget] No content in AI response')
      return new Response(
        JSON.stringify({ error: 'No content generated' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Parse the JSON response
    let content: any
    try {
      // Clean up potential markdown code blocks
      const cleanedText = textContent
        .replace(/```json\n?/g, '')
        .replace(/```\n?/g, '')
        .trim()
      content = JSON.parse(cleanedText)
    } catch (parseError) {
      console.error('[generate-widget] Failed to parse AI response:', textContent)
      return new Response(
        JSON.stringify({ error: 'Invalid AI response format', raw: textContent }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // For complete-the-look widget, enrich suggestions with actual product URLs and images
    if (widgetId === 'complete-the-look' && content.suggestions && Array.isArray(content.suggestions)) {
      console.log('[generate-widget] Enriching suggestions with product data...')
      try {
        content.suggestions = await enrichSuggestions(content.suggestions)
        console.log('[generate-widget] Suggestions enriched successfully')
      } catch (enrichError) {
        console.error('[generate-widget] Failed to enrich suggestions:', enrichError)
        // Continue with un-enriched suggestions
      }
    }

    // Cache the result
    cache.set(cacheKey, { content, timestamp: Date.now() })
    console.log('[generate-widget] Success, cached result for', cacheKey)

    return new Response(
      JSON.stringify({ content, cached: false }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )

  } catch (error) {
    console.error('[generate-widget] Error:', error)
    return new Response(
      JSON.stringify({ error: 'Internal server error', message: error.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})
