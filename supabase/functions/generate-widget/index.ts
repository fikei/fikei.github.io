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

// Scrape product image from Bing Images
async function scrapeProductImage(query: string): Promise<string | null> {
  try {
    const searchUrl = `https://www.bing.com/images/search?q=${encodeURIComponent(query + ' product')}&first=1`

    const response = await fetch(searchUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.5',
      }
    })

    if (!response.ok) {
      console.log('[scrape] Bing search failed:', response.status)
      return null
    }

    const html = await response.text()

    // Bing embeds image URLs in murl parameter or data attributes
    const patterns = [
      /murl&quot;:&quot;(https?:\/\/[^&]+\.(?:jpg|jpeg|png|webp)[^&]*)&quot;/i,
      /murl":"(https?:\/\/[^"]+\.(?:jpg|jpeg|png|webp)[^"]*)"/i,
      /data-src="(https?:\/\/[^"]+\.(?:jpg|jpeg|png|webp)[^"]*)"/i,
      /src="(https?:\/\/tse\d+\.mm\.bing\.net\/[^"]+)"/i,
    ]

    for (const pattern of patterns) {
      const match = html.match(pattern)
      if (match && match[1]) {
        const imageUrl = match[1].replace(/\\u002f/g, '/').replace(/&amp;/g, '&')
        console.log('[scrape] Found image for:', query)
        return imageUrl
      }
    }

    console.log('[scrape] No image found for:', query)
    return null
  } catch (error) {
    console.error('[scrape] Error:', error)
    return null
  }
}

// Enrich suggestions with shopping URLs and scraped images
async function enrichSuggestions(suggestions: any[]): Promise<any[]> {
  const enriched = await Promise.all(
    suggestions.map(async (sug) => {
      const searchQuery = sug.searchQuery || sug.name

      // Create Google Shopping search URL
      const productUrl = `https://www.google.com/search?tbm=shop&q=${encodeURIComponent(searchQuery)}`

      // Scrape actual product image
      const productImage = await scrapeProductImage(searchQuery)

      return {
        ...sug,
        productUrl,
        productImage,
        vendor: sug.brand
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

    // For complete-the-look widget, enrich suggestions with shopping URLs and scraped images
    if (widgetId === 'complete-the-look' && content.suggestions && Array.isArray(content.suggestions)) {
      content.suggestions = await enrichSuggestions(content.suggestions)
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
