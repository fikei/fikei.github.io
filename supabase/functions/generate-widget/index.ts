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

// Direct brand website configurations
const BRANDS = [
  // Athletic / Sneakers
  {
    name: 'Nike',
    searchUrl: (q: string) => `https://www.nike.com/w?q=${encodeURIComponent(q)}`,
    imagePatterns: [
      /src="(https:\/\/static\.nike\.com\/[^"]+)"/i,
      /"image":\s*"(https:\/\/static\.nike\.com\/[^"]+)"/i,
    ],
    keywords: ['nike', 'jordan', 'air jordan', 'air max', 'dunk', 'air force']
  },
  {
    name: 'Adidas',
    searchUrl: (q: string) => `https://www.adidas.com/us/search?q=${encodeURIComponent(q)}`,
    imagePatterns: [
      /src="(https:\/\/assets\.adidas\.com\/[^"]+)"/i,
    ],
    keywords: ['adidas', 'yeezy', 'samba', 'gazelle', 'stan smith', 'superstar', 'ultraboost']
  },
  {
    name: 'New Balance',
    searchUrl: (q: string) => `https://www.newbalance.com/search/?q=${encodeURIComponent(q)}`,
    imagePatterns: [
      /src="(https:\/\/nb\.scene7\.com\/[^"]+)"/i,
    ],
    keywords: ['new balance', '990', '550', '2002r', '1906', '574', '327']
  },
  {
    name: 'Puma',
    searchUrl: (q: string) => `https://us.puma.com/us/en/search?q=${encodeURIComponent(q)}`,
    imagePatterns: [
      /src="(https:\/\/images\.puma\.com\/[^"]+)"/i,
    ],
    keywords: ['puma', 'suede', 'clyde']
  },
  {
    name: 'Reebok',
    searchUrl: (q: string) => `https://www.reebok.com/us/search?q=${encodeURIComponent(q)}`,
    imagePatterns: [
      /src="(https:\/\/assets\.reebok\.com\/[^"]+)"/i,
    ],
    keywords: ['reebok', 'club c', 'classic leather']
  },
  {
    name: 'Converse',
    searchUrl: (q: string) => `https://www.converse.com/search?q=${encodeURIComponent(q)}`,
    imagePatterns: [
      /src="(https:\/\/www\.converse\.com\/[^"]+\.jpg[^"]*)"/i,
    ],
    keywords: ['converse', 'chuck taylor', 'all star']
  },
  {
    name: 'Vans',
    searchUrl: (q: string) => `https://www.vans.com/search?q=${encodeURIComponent(q)}`,
    imagePatterns: [
      /src="(https:\/\/images\.vans\.com\/[^"]+)"/i,
    ],
    keywords: ['vans', 'old skool', 'sk8-hi', 'authentic', 'era']
  },
  {
    name: 'ASICS',
    searchUrl: (q: string) => `https://www.asics.com/us/en-us/search?q=${encodeURIComponent(q)}`,
    imagePatterns: [
      /src="(https:\/\/images\.asics\.com\/[^"]+)"/i,
    ],
    keywords: ['asics', 'gel-lyte', 'gel-kayano', 'gel-1130']
  },
  {
    name: 'Hoka',
    searchUrl: (q: string) => `https://www.hoka.com/en/us/search?q=${encodeURIComponent(q)}`,
    imagePatterns: [
      /src="(https:\/\/[^"]+hoka[^"]+\.jpg[^"]*)"/i,
    ],
    keywords: ['hoka', 'bondi', 'clifton', 'speedgoat']
  },
  {
    name: 'Salomon',
    searchUrl: (q: string) => `https://www.salomon.com/en-us/search?q=${encodeURIComponent(q)}`,
    imagePatterns: [
      /src="(https:\/\/[^"]+salomon[^"]+\.jpg[^"]*)"/i,
    ],
    keywords: ['salomon', 'xt-6', 'xt-4', 'speedcross']
  },
  // Luxury / Designer
  {
    name: 'Common Projects',
    searchUrl: (q: string) => `https://www.commonprojects.com/search?q=${encodeURIComponent(q)}`,
    imagePatterns: [
      /src="(https:\/\/cdn\.shopify\.com\/[^"]+)"/i,
    ],
    keywords: ['common projects', 'achilles']
  },
  {
    name: 'A.P.C.',
    searchUrl: (q: string) => `https://www.apc.fr/wwus/search?q=${encodeURIComponent(q)}`,
    imagePatterns: [
      /src="(https:\/\/[^"]+apc[^"]+\.jpg[^"]*)"/i,
    ],
    keywords: ['a.p.c.', 'apc', 'petit new standard', 'petit standard']
  },
  {
    name: 'Acne Studios',
    searchUrl: (q: string) => `https://www.acnestudios.com/us/en/search?q=${encodeURIComponent(q)}`,
    imagePatterns: [
      /src="(https:\/\/[^"]+acnestudios[^"]+\.jpg[^"]*)"/i,
    ],
    keywords: ['acne studios', 'acne']
  },
  // Fast Fashion / Basics
  {
    name: 'Uniqlo',
    searchUrl: (q: string) => `https://www.uniqlo.com/us/en/search?q=${encodeURIComponent(q)}`,
    imagePatterns: [
      /src="(https:\/\/image\.uniqlo\.com\/[^"]+)"/i,
    ],
    keywords: ['uniqlo']
  },
  {
    name: 'COS',
    searchUrl: (q: string) => `https://www.cos.com/en_usd/search.html?q=${encodeURIComponent(q)}`,
    imagePatterns: [
      /src="(https:\/\/[^"]+cos[^"]+\.jpg[^"]*)"/i,
    ],
    keywords: ['cos']
  },
  {
    name: 'Zara',
    searchUrl: (q: string) => `https://www.zara.com/us/en/search?searchTerm=${encodeURIComponent(q)}`,
    imagePatterns: [
      /src="(https:\/\/static\.zara\.net\/[^"]+)"/i,
    ],
    keywords: ['zara']
  },
  {
    name: 'H&M',
    searchUrl: (q: string) => `https://www2.hm.com/en_us/search-results.html?q=${encodeURIComponent(q)}`,
    imagePatterns: [
      /src="(https:\/\/[^"]+hm\.com[^"]+\.jpg[^"]*)"/i,
    ],
    keywords: ['h&m', 'hm']
  },
  {
    name: 'Gap',
    searchUrl: (q: string) => `https://www.gap.com/browse/search.do?searchText=${encodeURIComponent(q)}`,
    imagePatterns: [
      /src="(https:\/\/[^"]+gap[^"]+\.jpg[^"]*)"/i,
    ],
    keywords: ['gap']
  },
  // Workwear / Heritage
  {
    name: 'Carhartt WIP',
    searchUrl: (q: string) => `https://us.carhartt-wip.com/search?q=${encodeURIComponent(q)}`,
    imagePatterns: [
      /src="(https:\/\/[^"]+carhartt[^"]+\.jpg[^"]*)"/i,
      /src="(https:\/\/cdn\.shopify\.com\/[^"]+)"/i,
    ],
    keywords: ['carhartt', 'carhartt wip']
  },
  {
    name: 'Dickies',
    searchUrl: (q: string) => `https://www.dickies.com/search?q=${encodeURIComponent(q)}`,
    imagePatterns: [
      /src="(https:\/\/[^"]+dickies[^"]+\.jpg[^"]*)"/i,
    ],
    keywords: ['dickies', '874']
  },
  {
    name: 'Levi\'s',
    searchUrl: (q: string) => `https://www.levi.com/US/en_US/search/${encodeURIComponent(q)}`,
    imagePatterns: [
      /src="(https:\/\/[^"]+levi[^"]+\.jpg[^"]*)"/i,
    ],
    keywords: ['levi', 'levis', '501', '505', '511', '512']
  },
  // Outdoor / Technical
  {
    name: 'Patagonia',
    searchUrl: (q: string) => `https://www.patagonia.com/search/?q=${encodeURIComponent(q)}`,
    imagePatterns: [
      /src="(https:\/\/[^"]+patagonia[^"]+\.jpg[^"]*)"/i,
    ],
    keywords: ['patagonia', 'nano puff', 'better sweater', 'retro-x']
  },
  {
    name: 'The North Face',
    searchUrl: (q: string) => `https://www.thenorthface.com/en-us/search?q=${encodeURIComponent(q)}`,
    imagePatterns: [
      /src="(https:\/\/[^"]+thenorthface[^"]+\.jpg[^"]*)"/i,
    ],
    keywords: ['north face', 'nuptse', 'denali']
  },
  {
    name: 'Arc\'teryx',
    searchUrl: (q: string) => `https://arcteryx.com/us/en/search?q=${encodeURIComponent(q)}`,
    imagePatterns: [
      /src="(https:\/\/[^"]+arcteryx[^"]+\.jpg[^"]*)"/i,
    ],
    keywords: ['arcteryx', 'arc\'teryx', 'atom', 'beta', 'alpha']
  },
  // Watches / Accessories
  {
    name: 'Timex',
    searchUrl: (q: string) => `https://www.timex.com/search?q=${encodeURIComponent(q)}`,
    imagePatterns: [
      /src="(https:\/\/[^"]+timex[^"]+\.jpg[^"]*)"/i,
    ],
    keywords: ['timex', 'weekender', 'marlin', 'q timex']
  },
  {
    name: 'Casio',
    searchUrl: (q: string) => `https://www.casio.com/us/search?q=${encodeURIComponent(q)}`,
    imagePatterns: [
      /src="(https:\/\/[^"]+casio[^"]+\.jpg[^"]*)"/i,
    ],
    keywords: ['casio', 'g-shock', 'f-91w', 'a168']
  },
  {
    name: 'Seiko',
    searchUrl: (q: string) => `https://www.seikowatches.com/us-en/search?q=${encodeURIComponent(q)}`,
    imagePatterns: [
      /src="(https:\/\/[^"]+seiko[^"]+\.jpg[^"]*)"/i,
    ],
    keywords: ['seiko', 'presage', 'prospex', 'skx']
  },
]

// Find brand config by keyword match
function findBrandConfig(brandName: string, productName: string): typeof BRANDS[0] | null {
  const searchText = `${brandName} ${productName}`.toLowerCase()

  for (const brand of BRANDS) {
    if (brand.keywords.some(kw => searchText.includes(kw))) {
      return brand
    }
  }
  return null
}

// Scrape product image from brand website
async function scrapeBrandImage(brand: typeof BRANDS[0], query: string): Promise<{ image: string | null, url: string }> {
  const searchUrl = brand.searchUrl(query)

  try {
    console.log(`[scrape] Trying ${brand.name}: ${query}`)

    const response = await fetch(searchUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
      }
    })

    if (!response.ok) {
      console.log(`[scrape] ${brand.name} failed:`, response.status)
      return { image: null, url: searchUrl }
    }

    const html = await response.text()

    // Try each pattern
    for (const pattern of brand.imagePatterns) {
      const match = html.match(pattern)
      if (match && match[1]) {
        let imageUrl = match[1]
        if (imageUrl.startsWith('//')) {
          imageUrl = 'https:' + imageUrl
        }
        imageUrl = imageUrl.replace(/&amp;/g, '&')
        console.log(`[scrape] Found image from ${brand.name}`)
        return { image: imageUrl, url: searchUrl }
      }
    }

    console.log(`[scrape] No image found on ${brand.name}`)
    return { image: null, url: searchUrl }
  } catch (error) {
    console.error(`[scrape] ${brand.name} error:`, error)
    return { image: null, url: searchUrl }
  }
}

// Main scraping function
async function scrapeProductImage(brandName: string, query: string): Promise<{ image: string | null, url: string }> {
  const brandConfig = findBrandConfig(brandName, query)

  if (brandConfig) {
    const result = await scrapeBrandImage(brandConfig, query)
    if (result.image) {
      return result
    }
  }

  // Return Google Shopping as fallback URL (no image)
  return {
    image: null,
    url: `https://www.google.com/search?tbm=shop&q=${encodeURIComponent(query)}`
  }
}

// Enrich suggestions with scraped images from brand websites
async function enrichSuggestions(suggestions: any[]): Promise<any[]> {
  const enriched = await Promise.all(
    suggestions.map(async (sug) => {
      const searchQuery = sug.searchQuery || sug.name
      const brandName = sug.brand || ''

      // Scrape image from brand website, get product URL
      const result = await scrapeProductImage(brandName, searchQuery)

      return {
        ...sug,
        productUrl: result.url,
        productImage: result.image,
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
