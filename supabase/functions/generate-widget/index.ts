// Supabase Edge Function: generate-widget
// Generates AI content for widgets based on PRD prompts
// Uses Shopify JSON API (primary) and HTML scraping (fallback) for product images
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

// Brand configurations with Shopify domains where applicable
// shopifyDomain = use JSON API (most reliable)
// searchUrl + imagePatterns = HTML scraping fallback
const BRANDS: BrandConfig[] = [
  // === SHOPIFY STORES (most reliable - use JSON API) ===
  // Streetwear
  { name: 'Stüssy', shopifyDomain: 'www.stussy.com', keywords: ['stussy', 'stüssy'] },
  { name: 'Palace', shopifyDomain: 'shop.palaceskateboards.com', keywords: ['palace'] },
  { name: 'BAPE', shopifyDomain: 'us.bape.com', keywords: ['bape', 'a bathing ape'] },
  { name: 'Kith', shopifyDomain: 'kith.com', keywords: ['kith'] },
  { name: 'Noah', shopifyDomain: 'noahny.com', keywords: ['noah'] },
  { name: 'Aimé Leon Dore', shopifyDomain: 'www.aimeleondore.com', keywords: ['aime leon dore', 'ald'] },
  { name: 'Awake NY', shopifyDomain: 'awakenyclothing.com', keywords: ['awake ny', 'awake'] },
  { name: 'Brain Dead', shopifyDomain: 'wearebraindead.com', keywords: ['brain dead', 'braindead'] },

  // Scandinavian / European
  { name: 'Norse Projects', shopifyDomain: 'www.norseprojects.com', keywords: ['norse projects'] },
  { name: 'Our Legacy', shopifyDomain: 'www.ourlegacy.com', keywords: ['our legacy'] },

  // Contemporary Designer (Shopify)
  { name: 'Lemaire', shopifyDomain: 'www.lemaire.fr', keywords: ['lemaire'] },
  { name: 'Common Projects', shopifyDomain: 'www.commonprojects.com', keywords: ['common projects', 'achilles'] },

  // DTC / Modern Basics
  { name: 'Outlier', shopifyDomain: 'outlier.nyc', keywords: ['outlier'] },
  { name: 'Reigning Champ', shopifyDomain: 'reigningchamp.com', keywords: ['reigning champ'] },
  { name: 'Todd Snyder', shopifyDomain: 'www.toddsnyder.com', keywords: ['todd snyder'] },
  { name: 'Buck Mason', shopifyDomain: 'www.buckmason.com', keywords: ['buck mason'] },
  { name: 'Taylor Stitch', shopifyDomain: 'www.taylorstitch.com', keywords: ['taylor stitch'] },
  { name: 'Alex Mill', shopifyDomain: 'www.alexmill.com', keywords: ['alex mill'] },
  { name: 'Corridor', shopifyDomain: 'corridornyc.com', keywords: ['corridor'] },

  // Premium Denim
  { name: 'Naked & Famous', shopifyDomain: 'www.nakedandfamousdenim.com', keywords: ['naked and famous', 'naked & famous'] },
  { name: '3sixteen', shopifyDomain: 'www.3sixteen.com', keywords: ['3sixteen'] },
  { name: 'Iron Heart', shopifyDomain: 'www.ironheartamerica.com', keywords: ['iron heart'] },

  // Bags & Accessories
  { name: 'Topo Designs', shopifyDomain: 'topodesigns.com', keywords: ['topo designs', 'topo'] },
  { name: 'Bellroy', shopifyDomain: 'bellroy.com', keywords: ['bellroy'] },

  // Eyewear
  { name: 'Moscot', shopifyDomain: 'moscot.com', keywords: ['moscot', 'lemtosh'] },
  { name: 'Garrett Leight', shopifyDomain: 'www.garrettleight.com', keywords: ['garrett leight'] },

  // Jewelry
  { name: 'Miansai', shopifyDomain: 'www.miansai.com', keywords: ['miansai'] },
  { name: 'Vitaly', shopifyDomain: 'www.vitalydesign.com', keywords: ['vitaly'] },

  // Performance
  { name: 'Satisfy Running', shopifyDomain: 'www.satisfyrunning.com', keywords: ['satisfy', 'satisfy running'] },
  { name: 'District Vision', shopifyDomain: 'districtvision.com', keywords: ['district vision'] },

  // Socks
  { name: 'Anonymous Ism', shopifyDomain: 'anonymousism.com', keywords: ['anonymous ism'] },

  // === NON-SHOPIFY (use search URL + patterns) ===
  // Athletic / Sneakers
  {
    name: 'Nike',
    searchUrl: (q: string) => `https://www.nike.com/w?q=${encodeURIComponent(q)}`,
    imagePatterns: [/src="(https:\/\/static\.nike\.com\/[^"]+)"/i],
    keywords: ['nike', 'jordan', 'air jordan', 'air max', 'dunk', 'air force']
  },
  {
    name: 'Adidas',
    searchUrl: (q: string) => `https://www.adidas.com/us/search?q=${encodeURIComponent(q)}`,
    imagePatterns: [/src="(https:\/\/assets\.adidas\.com\/[^"]+)"/i],
    keywords: ['adidas', 'samba', 'gazelle', 'stan smith', 'superstar', 'ultraboost']
  },
  {
    name: 'New Balance',
    searchUrl: (q: string) => `https://www.newbalance.com/search/?q=${encodeURIComponent(q)}`,
    imagePatterns: [/src="(https:\/\/nb\.scene7\.com\/[^"]+)"/i],
    keywords: ['new balance', '990', '550', '2002r', '574', '327']
  },
  {
    name: 'Converse',
    searchUrl: (q: string) => `https://www.converse.com/search?q=${encodeURIComponent(q)}`,
    imagePatterns: [/src="(https:\/\/www\.converse\.com\/[^"]+\.jpg[^"]*)"/i],
    keywords: ['converse', 'chuck taylor', 'all star']
  },
  {
    name: 'Vans',
    searchUrl: (q: string) => `https://www.vans.com/search?q=${encodeURIComponent(q)}`,
    imagePatterns: [/src="(https:\/\/images\.vans\.com\/[^"]+)"/i],
    keywords: ['vans', 'old skool', 'sk8-hi', 'authentic']
  },
  {
    name: 'ASICS',
    searchUrl: (q: string) => `https://www.asics.com/us/en-us/search?q=${encodeURIComponent(q)}`,
    imagePatterns: [/src="(https:\/\/images\.asics\.com\/[^"]+)"/i],
    keywords: ['asics', 'gel-lyte', 'gel-kayano', 'gel-1130']
  },
  {
    name: 'Hoka',
    searchUrl: (q: string) => `https://www.hoka.com/en/us/search?q=${encodeURIComponent(q)}`,
    imagePatterns: [/src="(https:\/\/[^"]+hoka[^"]+\.(jpg|png|webp)[^"]*)"/i],
    keywords: ['hoka', 'bondi', 'clifton', 'speedgoat']
  },
  {
    name: 'Salomon',
    searchUrl: (q: string) => `https://www.salomon.com/en-us/search?q=${encodeURIComponent(q)}`,
    imagePatterns: [/src="(https:\/\/[^"]+salomon[^"]+\.(jpg|png|webp)[^"]*)"/i],
    keywords: ['salomon', 'xt-6', 'xt-4', 'speedcross']
  },

  // Basics
  {
    name: 'Uniqlo',
    searchUrl: (q: string) => `https://www.uniqlo.com/us/en/search?q=${encodeURIComponent(q)}`,
    imagePatterns: [/src="(https:\/\/image\.uniqlo\.com\/[^"]+)"/i],
    keywords: ['uniqlo']
  },
  {
    name: 'COS',
    searchUrl: (q: string) => `https://www.cos.com/en_usd/search.html?q=${encodeURIComponent(q)}`,
    imagePatterns: [/src="(https:\/\/[^"]+cos[^"]+\.(jpg|png|webp)[^"]*)"/i],
    keywords: ['cos']
  },

  // Workwear
  {
    name: 'Carhartt WIP',
    searchUrl: (q: string) => `https://us.carhartt-wip.com/search?q=${encodeURIComponent(q)}`,
    imagePatterns: [/src="(https:\/\/cdn\.shopify\.com\/[^"]+)"/i],
    keywords: ['carhartt', 'carhartt wip']
  },
  {
    name: "Levi's",
    searchUrl: (q: string) => `https://www.levi.com/US/en_US/search/${encodeURIComponent(q)}`,
    imagePatterns: [/src="(https:\/\/[^"]+levi[^"]+\.(jpg|png|webp)[^"]*)"/i],
    keywords: ['levi', 'levis', '501', '511', '512']
  },

  // Outdoor
  {
    name: 'Patagonia',
    searchUrl: (q: string) => `https://www.patagonia.com/search/?q=${encodeURIComponent(q)}`,
    imagePatterns: [/src="(https:\/\/[^"]+patagonia[^"]+\.(jpg|png|webp)[^"]*)"/i],
    keywords: ['patagonia', 'nano puff', 'better sweater']
  },
  {
    name: 'The North Face',
    searchUrl: (q: string) => `https://www.thenorthface.com/en-us/search?q=${encodeURIComponent(q)}`,
    imagePatterns: [/src="(https:\/\/[^"]+thenorthface[^"]+\.(jpg|png|webp)[^"]*)"/i],
    keywords: ['north face', 'nuptse', 'denali']
  },
  {
    name: "Arc'teryx",
    searchUrl: (q: string) => `https://arcteryx.com/us/en/search?q=${encodeURIComponent(q)}`,
    imagePatterns: [/src="(https:\/\/[^"]+arcteryx[^"]+\.(jpg|png|webp)[^"]*)"/i],
    keywords: ['arcteryx', "arc'teryx", 'atom', 'beta', 'alpha']
  },

  // Footwear
  {
    name: 'Dr. Martens',
    searchUrl: (q: string) => `https://www.drmartens.com/us/en/search?q=${encodeURIComponent(q)}`,
    imagePatterns: [/src="(https:\/\/[^"]+drmartens[^"]+\.(jpg|png|webp)[^"]*)"/i],
    keywords: ['dr martens', 'dr. martens', 'doc martens', '1460', '1461']
  },
  {
    name: 'Birkenstock',
    searchUrl: (q: string) => `https://www.birkenstock.com/us/search/?q=${encodeURIComponent(q)}`,
    imagePatterns: [/src="(https:\/\/[^"]+birkenstock[^"]+\.(jpg|png|webp)[^"]*)"/i],
    keywords: ['birkenstock', 'boston', 'arizona']
  },
  {
    name: 'Clarks',
    searchUrl: (q: string) => `https://www.clarks.com/en-us/search?q=${encodeURIComponent(q)}`,
    imagePatterns: [/src="(https:\/\/[^"]+clarks[^"]+\.(jpg|png|webp)[^"]*)"/i],
    keywords: ['clarks', 'desert boot', 'wallabee']
  },
  {
    name: 'Red Wing',
    searchUrl: (q: string) => `https://www.redwingshoes.com/search?q=${encodeURIComponent(q)}`,
    imagePatterns: [/src="(https:\/\/[^"]+redwing[^"]+\.(jpg|png|webp)[^"]*)"/i],
    keywords: ['red wing', 'iron ranger', 'moc toe']
  },

  // Watches
  {
    name: 'Timex',
    searchUrl: (q: string) => `https://www.timex.com/search?q=${encodeURIComponent(q)}`,
    imagePatterns: [/src="(https:\/\/[^"]+timex[^"]+\.(jpg|png|webp)[^"]*)"/i],
    keywords: ['timex', 'weekender', 'marlin']
  },
  {
    name: 'Casio',
    searchUrl: (q: string) => `https://www.casio.com/us/search?q=${encodeURIComponent(q)}`,
    imagePatterns: [/src="(https:\/\/[^"]+casio[^"]+\.(jpg|png|webp)[^"]*)"/i],
    keywords: ['casio', 'g-shock', 'f-91w']
  },
  {
    name: 'Seiko',
    searchUrl: (q: string) => `https://www.seikowatches.com/us-en/search?q=${encodeURIComponent(q)}`,
    imagePatterns: [/src="(https:\/\/[^"]+seiko[^"]+\.(jpg|png|webp)[^"]*)"/i],
    keywords: ['seiko', 'presage', 'prospex']
  },
]

// Type for brand configuration
interface BrandConfig {
  name: string
  keywords: string[]
  shopifyDomain?: string
  searchUrl?: (q: string) => string
  imagePatterns?: RegExp[]
}

// Extract supported brand names for AI prompt
const SUPPORTED_BRAND_NAMES = BRANDS.map(b => b.name)

// Find brand config by keyword match
function findBrandConfig(brandName: string, productName: string): BrandConfig | null {
  const searchText = `${brandName} ${productName}`.toLowerCase()
  console.log(`[findBrand] Looking for brand in: "${searchText}"`)

  for (const brand of BRANDS) {
    const matchedKeyword = brand.keywords.find(kw => searchText.includes(kw))
    if (matchedKeyword) {
      console.log(`[findBrand] MATCH! Found "${matchedKeyword}" -> ${brand.name} (${brand.shopifyDomain ? 'Shopify' : 'HTML scrape'})`)
      return brand
    }
  }
  console.log(`[findBrand] NO MATCH found for: "${searchText}"`)
  return null
}

// Try Shopify JSON API (most reliable method)
async function tryShopifyApi(domain: string, query: string): Promise<{ image: string | null, url: string }> {
  const searchUrl = `https://${domain}/search?q=${encodeURIComponent(query)}`

  // Try multiple Shopify endpoints
  const endpoints = [
    `https://${domain}/search/suggest.json?q=${encodeURIComponent(query)}&resources[type]=product&resources[limit]=4`,
    `https://${domain}/products.json?limit=10`,
  ]

  for (const endpoint of endpoints) {
    try {
      console.log(`[shopify] Trying: ${endpoint}`)

      const response = await fetch(endpoint, {
        headers: {
          'Accept': 'application/json',
          'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
        }
      })

      if (!response.ok) {
        console.log(`[shopify] ${domain} endpoint returned ${response.status}`)
        continue
      }

      const data = await response.json()
      console.log(`[shopify] ${domain} got JSON response`)

      // Handle suggest endpoint format
      if (data.resources?.results?.products) {
        const products = data.resources.results.products
        console.log(`[shopify] ${domain} found ${products.length} products via suggest`)

        // Find product matching query
        const queryLower = query.toLowerCase()
        const match = products.find((p: any) =>
          p.title?.toLowerCase().includes(queryLower) ||
          queryLower.includes(p.title?.toLowerCase()?.split(' ')[0])
        ) || products[0]

        if (match?.image) {
          console.log(`[shopify] ${domain} SUCCESS - found image: ${match.image.substring(0, 60)}...`)
          return {
            image: match.image.startsWith('//') ? 'https:' + match.image : match.image,
            url: match.url ? `https://${domain}${match.url}` : searchUrl
          }
        }
      }

      // Handle products.json format
      if (data.products && Array.isArray(data.products)) {
        console.log(`[shopify] ${domain} found ${data.products.length} products via products.json`)

        const queryLower = query.toLowerCase()
        const match = data.products.find((p: any) =>
          p.title?.toLowerCase().includes(queryLower)
        ) || data.products[0]

        if (match?.images?.[0]?.src) {
          console.log(`[shopify] ${domain} SUCCESS - found image from products.json`)
          return {
            image: match.images[0].src,
            url: `https://${domain}/products/${match.handle}`
          }
        }
      }

    } catch (error) {
      console.log(`[shopify] ${domain} error: ${error.message}`)
    }
  }

  console.log(`[shopify] ${domain} no image found via API`)
  return { image: null, url: searchUrl }
}

// Scrape product image from brand website (fallback)
async function scrapeHtml(brand: BrandConfig, query: string): Promise<{ image: string | null, url: string }> {
  if (!brand.searchUrl || !brand.imagePatterns) {
    return { image: null, url: `https://www.google.com/search?tbm=shop&q=${encodeURIComponent(query)}` }
  }

  const searchUrl = brand.searchUrl(query)

  try {
    console.log(`[scrape] Trying ${brand.name}: "${query}"`)
    console.log(`[scrape] URL: ${searchUrl}`)

    const response = await fetch(searchUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
      }
    })

    console.log(`[scrape] ${brand.name} response status: ${response.status}`)

    if (!response.ok) {
      return { image: null, url: searchUrl }
    }

    const html = await response.text()
    console.log(`[scrape] ${brand.name} HTML length: ${html.length} chars`)

    // Try each pattern
    for (const pattern of brand.imagePatterns) {
      const match = html.match(pattern)
      if (match && match[1]) {
        let imageUrl = match[1]
        if (imageUrl.startsWith('//')) {
          imageUrl = 'https:' + imageUrl
        }
        imageUrl = imageUrl.replace(/&amp;/g, '&')
        console.log(`[scrape] ${brand.name} FOUND IMAGE: ${imageUrl.substring(0, 80)}...`)
        return { image: imageUrl, url: searchUrl }
      }
    }

    console.log(`[scrape] ${brand.name} NO IMAGE FOUND`)
    return { image: null, url: searchUrl }
  } catch (error) {
    console.error(`[scrape] ${brand.name} error:`, error.message)
    return { image: null, url: searchUrl }
  }
}

// Main function: try Shopify API first, then HTML scraping
async function scrapeProductImage(brandName: string, query: string): Promise<{ image: string | null, url: string }> {
  const brandConfig = findBrandConfig(brandName, query)

  if (!brandConfig) {
    console.log(`[scrape] No brand config for "${brandName}" - falling back to Google Shopping`)
    return {
      image: null,
      url: `https://www.google.com/search?tbm=shop&q=${encodeURIComponent(query)}`
    }
  }

  // Try Shopify API first (most reliable)
  if (brandConfig.shopifyDomain) {
    const result = await tryShopifyApi(brandConfig.shopifyDomain, query)
    if (result.image) {
      return result
    }
    console.log(`[scrape] Shopify API failed for ${brandConfig.name}, trying HTML scrape...`)
  }

  // Fallback to HTML scraping
  if (brandConfig.searchUrl && brandConfig.imagePatterns) {
    const result = await scrapeHtml(brandConfig, query)
    if (result.image) {
      return result
    }
  }

  // Ultimate fallback
  return {
    image: null,
    url: `https://www.google.com/search?tbm=shop&q=${encodeURIComponent(query)}`
  }
}

// Enrich suggestions with scraped images from brand websites
async function enrichSuggestions(suggestions: any[]): Promise<any[]> {
  console.log('[enrich] Starting enrichment for', suggestions.length, 'suggestions')
  console.log('[enrich] Raw AI suggestions:', JSON.stringify(suggestions, null, 2))

  const enriched = await Promise.all(
    suggestions.map(async (sug, index) => {
      const searchQuery = sug.searchQuery || sug.name
      const brandName = sug.brand || ''

      console.log(`[enrich ${index}] Processing: "${sug.name}"`)
      console.log(`[enrich ${index}] - brand from AI: "${brandName}"`)
      console.log(`[enrich ${index}] - searchQuery: "${searchQuery}"`)

      const result = await scrapeProductImage(brandName, searchQuery)

      console.log(`[enrich ${index}] - result: image=${result.image ? 'YES' : 'NULL'}`)

      return {
        ...sug,
        productUrl: result.url,
        productImage: result.image,
        vendor: sug.brand
      }
    })
  )

  console.log('[enrich] Final results:', enriched.map(s => ({
    name: s.name,
    brand: s.brand,
    hasImage: !!s.productImage
  })))

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

    // Add supported brands constraint to prompt
    const brandConstraint = `

IMPORTANT - ONLY SUGGEST THESE BRANDS (we can only show images from these):
${SUPPORTED_BRAND_NAMES.join(', ')}

For each suggestion, you MUST use a brand from this list. Pick the most appropriate brand for the item type.`

    const fullPrompt = `${prompt}${brandConstraint}

Here are the items to analyze:

${itemsContext}

Respond with valid JSON only, no markdown or explanation.`

    console.log('[generate-widget] Calling Claude API...')
    console.log('[generate-widget] Supported brands:', SUPPORTED_BRAND_NAMES.length)

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
