// Supabase Edge Function: generate-widget
// Generates AI content for widgets based on PRD prompts
// Uses Shopify JSON API (primary), SERP API (secondary), and HTML scraping (fallback) for product images
//
// POST /functions/v1/generate-widget
// Body: { widgetId, prompt, items: Array<{ id, title, description, image, url }> }
// Returns: { content: object, cached: boolean, meta: { confidence, eligibility, timing } }
//
// Phase 1 Features:
// - Confidence scoring (AI returns confidence 0.0-1.0)
// - Eligibility engine (widgets must earn existence)
// - Instrumentation (track success/failure for validation)

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'

// Phase 2: Config-driven widget system
import {
  checkEligibility as checkEligibilityFromConfig,
  getConfidenceConfig,
  getWidget,
  buildPrompt,
  discoverWidgets,
  getRegistrySummary,
} from './config/registry.ts'
import type { EligibilityContext, EligibilityDecision } from './config/schema.ts'

// Phase 2.5a: Design system constraints for AI prompts
import {
  buildDesignSystemPrompt,
  validateWidgetHtml,
  sanitizeWidgetHtml,
  resolveTemplate,
  boardsTemplateMap,
} from './config/design-system.ts'

// Visual standards: category aesthetic context for AI prompts
import { buildCategoryPrompt } from './config/visual-standards.ts'

// CORS headers for browser requests
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

// Brand configurations with Shopify domains where applicable
// shopifyDomain = use JSON API (most reliable)
// searchUrl + imagePatterns = HTML scraping fallback
// categories = what product types this brand actually makes (prevents AI hallucinations)
const BRANDS: BrandConfig[] = [
  // === SHOPIFY STORES (most reliable - use JSON API) ===
  // Streetwear
  { name: 'Stüssy', shopifyDomain: 'www.stussy.com', keywords: ['stussy', 'stüssy'], categories: ['t-shirts', 'hoodies', 'jackets', 'pants', 'shorts', 'hats', 'bags'] },
  { name: 'Palace', shopifyDomain: 'shop.palaceskateboards.com', keywords: ['palace'], categories: ['t-shirts', 'hoodies', 'jackets', 'pants', 'shorts', 'hats'] },
  { name: 'BAPE', shopifyDomain: 'us.bape.com', keywords: ['bape', 'a bathing ape'], categories: ['t-shirts', 'hoodies', 'jackets', 'pants', 'shorts', 'hats', 'sneakers'] },
  { name: 'Kith', shopifyDomain: 'kith.com', keywords: ['kith'], categories: ['t-shirts', 'hoodies', 'sweaters', 'jackets', 'pants', 'shorts', 'sneakers', 'hats'] },
  { name: 'Noah', shopifyDomain: 'noahny.com', keywords: ['noah'], categories: ['t-shirts', 'shirts', 'hoodies', 'jackets', 'pants', 'shorts', 'hats'] },
  { name: 'Aimé Leon Dore', shopifyDomain: 'www.aimeleondore.com', keywords: ['aime leon dore', 'ald'], categories: ['t-shirts', 'shirts', 'sweaters', 'hoodies', 'jackets', 'pants', 'shorts', 'sneakers', 'hats'] },
  { name: 'Awake NY', shopifyDomain: 'awakenyclothing.com', keywords: ['awake ny', 'awake'], categories: ['t-shirts', 'hoodies', 'jackets', 'pants', 'hats'] },
  { name: 'Brain Dead', shopifyDomain: 'wearebraindead.com', keywords: ['brain dead', 'braindead'], categories: ['t-shirts', 'hoodies', 'jackets', 'pants', 'hats', 'bags'] },

  // Scandinavian / European
  { name: 'Norse Projects', shopifyDomain: 'www.norseprojects.com', keywords: ['norse projects'], categories: ['t-shirts', 'shirts', 'sweaters', 'hoodies', 'jackets', 'coats', 'pants', 'shorts', 'hats'] },
  { name: 'Our Legacy', shopifyDomain: 'www.ourlegacy.com', keywords: ['our legacy'], categories: ['t-shirts', 'shirts', 'sweaters', 'jackets', 'coats', 'pants', 'shorts', 'boots', 'loafers'] },

  // Contemporary Designer (Shopify)
  { name: 'Lemaire', shopifyDomain: 'www.lemaire.fr', keywords: ['lemaire'], categories: ['shirts', 'sweaters', 'jackets', 'coats', 'pants', 'bags'] },
  { name: 'Common Projects', shopifyDomain: 'www.commonprojects.com', keywords: ['common projects', 'achilles'], categories: ['sneakers', 'boots', 'loafers'] },

  // DTC / Modern Basics
  { name: 'Outlier', shopifyDomain: 'outlier.nyc', keywords: ['outlier'], categories: ['t-shirts', 'shirts', 'pants', 'shorts', 'jackets'] },
  { name: 'Reigning Champ', shopifyDomain: 'reigningchamp.com', keywords: ['reigning champ'], categories: ['t-shirts', 'hoodies', 'sweaters', 'jackets', 'pants', 'shorts'] },
  { name: 'Todd Snyder', shopifyDomain: 'www.toddsnyder.com', keywords: ['todd snyder'], categories: ['t-shirts', 'shirts', 'sweaters', 'hoodies', 'jackets', 'coats', 'pants', 'shorts', 'chinos'] },
  { name: 'Buck Mason', shopifyDomain: 'www.buckmason.com', keywords: ['buck mason'], categories: ['t-shirts', 'shirts', 'sweaters', 'hoodies', 'jackets', 'pants', 'jeans', 'shorts'] },
  { name: 'Taylor Stitch', shopifyDomain: 'www.taylorstitch.com', keywords: ['taylor stitch'], categories: ['t-shirts', 'shirts', 'sweaters', 'jackets', 'coats', 'pants', 'jeans', 'shorts', 'boots'] },
  { name: 'Alex Mill', shopifyDomain: 'www.alexmill.com', keywords: ['alex mill'], categories: ['t-shirts', 'shirts', 'sweaters', 'jackets', 'pants', 'shorts', 'chinos'] },
  { name: 'Corridor', shopifyDomain: 'corridornyc.com', keywords: ['corridor'], categories: ['shirts', 'sweaters', 'jackets', 'pants', 'shorts'] },

  // Premium Denim
  { name: 'Naked & Famous', shopifyDomain: 'www.nakedandfamousdenim.com', keywords: ['naked and famous', 'naked & famous'], categories: ['jeans', 'shirts', 'jackets'] },
  { name: '3sixteen', shopifyDomain: 'www.3sixteen.com', keywords: ['3sixteen'], categories: ['jeans', 't-shirts', 'shirts', 'jackets'] },
  { name: 'Iron Heart', shopifyDomain: 'www.ironheartamerica.com', keywords: ['iron heart'], categories: ['jeans', 'shirts', 'jackets', 'boots', 'belts'] },

  // Bags & Accessories - NOTE: Bellroy does NOT make belts, jewelry, or rings
  { name: 'Topo Designs', shopifyDomain: 'topodesigns.com', keywords: ['topo designs', 'topo'], categories: ['bags', 'backpacks', 'hats', 'jackets'] },
  { name: 'Bellroy', shopifyDomain: 'bellroy.com', keywords: ['bellroy'], categories: ['wallets', 'bags', 'backpacks'] },

  // Eyewear
  { name: 'Moscot', shopifyDomain: 'moscot.com', keywords: ['moscot', 'lemtosh'], categories: ['sunglasses', 'eyeglasses'] },
  { name: 'Garrett Leight', shopifyDomain: 'www.garrettleight.com', keywords: ['garrett leight'], categories: ['sunglasses', 'eyeglasses'] },

  // Jewelry
  { name: 'Miansai', shopifyDomain: 'www.miansai.com', keywords: ['miansai'], categories: ['jewelry', 'rings', 'wallets', 'belts'] },
  { name: 'Vitaly', shopifyDomain: 'www.vitalydesign.com', keywords: ['vitaly'], categories: ['jewelry', 'rings'] },

  // Performance
  { name: 'Satisfy Running', shopifyDomain: 'www.satisfyrunning.com', keywords: ['satisfy', 'satisfy running'], categories: ['t-shirts', 'shorts', 'jackets', 'hats', 'sunglasses'] },
  { name: 'District Vision', shopifyDomain: 'districtvision.com', keywords: ['district vision'], categories: ['sunglasses', 't-shirts', 'shorts', 'jackets', 'hats'] },

  // Socks
  { name: 'Anonymous Ism', shopifyDomain: 'anonymousism.com', keywords: ['anonymous ism'], categories: ['socks'] },

  // === NON-SHOPIFY (use search URL + patterns) ===
  // Athletic / Sneakers
  {
    name: 'Nike',
    searchUrl: (q: string) => `https://www.nike.com/w?q=${encodeURIComponent(q)}`,
    imagePatterns: [/src="(https:\/\/static\.nike\.com\/[^"]+)"/i],
    productLinkPatterns: [/href="(https:\/\/www\.nike\.com\/t\/[^"]+)"/i, /href="(\/t\/[^"]+)"/i],
    baseUrl: 'https://www.nike.com',
    keywords: ['nike', 'jordan', 'air jordan', 'air max', 'dunk', 'air force'],
    categories: ['sneakers', 't-shirts', 'hoodies', 'jackets', 'pants', 'shorts', 'hats', 'bags', 'socks']
  },
  {
    name: 'Adidas',
    searchUrl: (q: string) => `https://www.adidas.com/us/search?q=${encodeURIComponent(q)}`,
    imagePatterns: [/src="(https:\/\/assets\.adidas\.com\/[^"]+)"/i],
    productLinkPatterns: [/href="(\/us\/[^"]+\.html)"/i],
    baseUrl: 'https://www.adidas.com',
    keywords: ['adidas', 'samba', 'gazelle', 'stan smith', 'superstar', 'ultraboost'],
    categories: ['sneakers', 't-shirts', 'hoodies', 'jackets', 'pants', 'shorts', 'hats', 'bags', 'socks']
  },
  {
    name: 'New Balance',
    searchUrl: (q: string) => `https://www.newbalance.com/search/?q=${encodeURIComponent(q)}`,
    imagePatterns: [/src="(https:\/\/nb\.scene7\.com\/[^"]+)"/i],
    productLinkPatterns: [/href="(\/pd\/[^"]+)"/i, /href="(https:\/\/www\.newbalance\.com\/pd\/[^"]+)"/i],
    baseUrl: 'https://www.newbalance.com',
    keywords: ['new balance', '990', '550', '2002r', '574', '327'],
    categories: ['sneakers', 't-shirts', 'hoodies', 'jackets', 'pants', 'shorts', 'hats', 'bags', 'socks']
  },
  {
    name: 'Converse',
    searchUrl: (q: string) => `https://www.converse.com/search?q=${encodeURIComponent(q)}`,
    imagePatterns: [/src="(https:\/\/www\.converse\.com\/[^"]+\.jpg[^"]*)"/i],
    productLinkPatterns: [/href="(\/shop\/p\/[^"]+)"/i],
    baseUrl: 'https://www.converse.com',
    keywords: ['converse', 'chuck taylor', 'all star'],
    categories: ['sneakers', 't-shirts', 'hoodies', 'jackets', 'hats', 'bags']
  },
  {
    name: 'Vans',
    searchUrl: (q: string) => `https://www.vans.com/search?q=${encodeURIComponent(q)}`,
    imagePatterns: [/src="(https:\/\/images\.vans\.com\/[^"]+)"/i],
    productLinkPatterns: [/href="(\/en-us\/[^"]+\.html)"/i],
    baseUrl: 'https://www.vans.com',
    keywords: ['vans', 'old skool', 'sk8-hi', 'authentic'],
    categories: ['sneakers', 't-shirts', 'hoodies', 'jackets', 'pants', 'shorts', 'hats', 'bags', 'socks']
  },
  {
    name: 'ASICS',
    searchUrl: (q: string) => `https://www.asics.com/us/en-us/search?q=${encodeURIComponent(q)}`,
    imagePatterns: [/src="(https:\/\/images\.asics\.com\/[^"]+)"/i],
    productLinkPatterns: [/href="(\/us\/en-us\/[^"]+\.html)"/i],
    baseUrl: 'https://www.asics.com',
    keywords: ['asics', 'gel-lyte', 'gel-kayano', 'gel-1130'],
    categories: ['sneakers', 't-shirts', 'shorts', 'jackets']
  },
  {
    name: 'Hoka',
    searchUrl: (q: string) => `https://www.hoka.com/en/us/search?q=${encodeURIComponent(q)}`,
    imagePatterns: [/src="(https:\/\/[^"]+hoka[^"]+\.(jpg|png|webp)[^"]*)"/i],
    productLinkPatterns: [/href="(\/en\/us\/[^"]+\.html)"/i],
    baseUrl: 'https://www.hoka.com',
    keywords: ['hoka', 'bondi', 'clifton', 'speedgoat'],
    categories: ['sneakers', 'sandals']
  },
  {
    name: 'Salomon',
    searchUrl: (q: string) => `https://www.salomon.com/en-us/search?q=${encodeURIComponent(q)}`,
    imagePatterns: [/src="(https:\/\/[^"]+salomon[^"]+\.(jpg|png|webp)[^"]*)"/i],
    productLinkPatterns: [/href="(\/en-us\/shop[^"]+\.html)"/i],
    baseUrl: 'https://www.salomon.com',
    keywords: ['salomon', 'xt-6', 'xt-4', 'speedcross'],
    categories: ['sneakers', 'boots', 'jackets', 'pants', 'shorts', 'backpacks']
  },

  // Basics
  {
    name: 'Uniqlo',
    searchUrl: (q: string) => `https://www.uniqlo.com/us/en/search?q=${encodeURIComponent(q)}`,
    imagePatterns: [/src="(https:\/\/image\.uniqlo\.com\/[^"]+)"/i],
    productLinkPatterns: [/href="(\/us\/en\/products\/[^"]+)"/i],
    baseUrl: 'https://www.uniqlo.com',
    keywords: ['uniqlo'],
    categories: ['t-shirts', 'shirts', 'sweaters', 'hoodies', 'jackets', 'coats', 'pants', 'jeans', 'shorts', 'chinos', 'socks', 'hats', 'bags', 'belts']
  },
  {
    name: 'COS',
    searchUrl: (q: string) => `https://www.cos.com/en_usd/search.html?q=${encodeURIComponent(q)}`,
    imagePatterns: [/src="(https:\/\/[^"]+cos[^"]+\.(jpg|png|webp)[^"]*)"/i],
    productLinkPatterns: [/href="(\/en_usd\/[^"]+\.html)"/i],
    baseUrl: 'https://www.cos.com',
    keywords: ['cos'],
    categories: ['t-shirts', 'shirts', 'sweaters', 'jackets', 'coats', 'pants', 'shorts', 'dress-shoes', 'boots', 'bags', 'scarves']
  },

  // Workwear
  {
    name: 'Carhartt WIP',
    searchUrl: (q: string) => `https://us.carhartt-wip.com/search?q=${encodeURIComponent(q)}`,
    imagePatterns: [/src="(https:\/\/cdn\.shopify\.com\/[^"]+)"/i],
    productLinkPatterns: [/href="(\/products\/[^"]+)"/i],
    baseUrl: 'https://us.carhartt-wip.com',
    keywords: ['carhartt', 'carhartt wip'],
    categories: ['t-shirts', 'shirts', 'sweaters', 'hoodies', 'jackets', 'coats', 'pants', 'shorts', 'hats', 'bags', 'socks']
  },
  {
    name: "Levi's",
    searchUrl: (q: string) => `https://www.levi.com/US/en_US/search/${encodeURIComponent(q)}`,
    imagePatterns: [/src="(https:\/\/[^"]+levi[^"]+\.(jpg|png|webp)[^"]*)"/i],
    productLinkPatterns: [/href="(\/US\/en_US\/p\/[^"]+)"/i],
    baseUrl: 'https://www.levi.com',
    keywords: ['levi', 'levis', '501', '511', '512'],
    categories: ['jeans', 't-shirts', 'shirts', 'jackets', 'shorts', 'belts']
  },

  // Outdoor
  {
    name: 'Patagonia',
    searchUrl: (q: string) => `https://www.patagonia.com/search/?q=${encodeURIComponent(q)}`,
    imagePatterns: [/src="(https:\/\/[^"]+patagonia[^"]+\.(jpg|png|webp)[^"]*)"/i],
    productLinkPatterns: [/href="(\/product\/[^"]+)"/i],
    baseUrl: 'https://www.patagonia.com',
    keywords: ['patagonia', 'nano puff', 'better sweater'],
    categories: ['t-shirts', 'shirts', 'sweaters', 'hoodies', 'jackets', 'coats', 'vests', 'pants', 'shorts', 'hats', 'bags', 'backpacks']
  },
  {
    name: 'The North Face',
    searchUrl: (q: string) => `https://www.thenorthface.com/en-us/search?q=${encodeURIComponent(q)}`,
    imagePatterns: [/src="(https:\/\/[^"]+thenorthface[^"]+\.(jpg|png|webp)[^"]*)"/i],
    productLinkPatterns: [/href="(\/en-us\/[^"]+\/[^"]+\-NF[^"]+)"/i],
    baseUrl: 'https://www.thenorthface.com',
    keywords: ['north face', 'nuptse', 'denali'],
    categories: ['t-shirts', 'hoodies', 'jackets', 'coats', 'vests', 'pants', 'shorts', 'hats', 'bags', 'backpacks', 'boots']
  },
  {
    name: "Arc'teryx",
    searchUrl: (q: string) => `https://arcteryx.com/us/en/search?q=${encodeURIComponent(q)}`,
    imagePatterns: [/src="(https:\/\/[^"]+arcteryx[^"]+\.(jpg|png|webp)[^"]*)"/i],
    productLinkPatterns: [/href="(\/us\/en\/shop\/[^"]+)"/i],
    baseUrl: 'https://arcteryx.com',
    keywords: ['arcteryx', "arc'teryx", 'atom', 'beta', 'alpha'],
    categories: ['t-shirts', 'shirts', 'sweaters', 'hoodies', 'jackets', 'coats', 'vests', 'pants', 'shorts', 'hats', 'bags', 'backpacks', 'boots', 'gloves']
  },

  // Footwear
  {
    name: 'Dr. Martens',
    searchUrl: (q: string) => `https://www.drmartens.com/us/en/search?q=${encodeURIComponent(q)}`,
    imagePatterns: [/src="(https:\/\/[^"]+drmartens[^"]+\.(jpg|png|webp)[^"]*)"/i],
    productLinkPatterns: [/href="(\/us\/en\/[^"]+\/p\/[^"]+)"/i],
    baseUrl: 'https://www.drmartens.com',
    keywords: ['dr martens', 'dr. martens', 'doc martens', '1460', '1461'],
    categories: ['boots', 'loafers', 'sandals', 'bags']
  },
  {
    name: 'Birkenstock',
    searchUrl: (q: string) => `https://www.birkenstock.com/us/search/?q=${encodeURIComponent(q)}`,
    imagePatterns: [/src="(https:\/\/[^"]+birkenstock[^"]+\.(jpg|png|webp)[^"]*)"/i],
    productLinkPatterns: [/href="(\/us\/[^"]+\/[^"]+\.html)"/i],
    baseUrl: 'https://www.birkenstock.com',
    keywords: ['birkenstock', 'boston', 'arizona'],
    categories: ['sandals', 'loafers', 'boots']
  },
  {
    name: 'Clarks',
    searchUrl: (q: string) => `https://www.clarks.com/en-us/search?q=${encodeURIComponent(q)}`,
    imagePatterns: [/src="(https:\/\/[^"]+clarks[^"]+\.(jpg|png|webp)[^"]*)"/i],
    productLinkPatterns: [/href="(\/en-us\/[^"]+\/[^"]+\.html)"/i, /href="(https:\/\/www\.clarks\.com\/en-us\/[^"]+\.html)"/i],
    baseUrl: 'https://www.clarks.com',
    keywords: ['clarks', 'desert boot', 'wallabee'],
    categories: ['boots', 'loafers', 'dress-shoes', 'sandals']
  },
  {
    name: 'Red Wing',
    searchUrl: (q: string) => `https://www.redwingshoes.com/search?q=${encodeURIComponent(q)}`,
    imagePatterns: [/src="(https:\/\/[^"]+redwing[^"]+\.(jpg|png|webp)[^"]*)"/i],
    productLinkPatterns: [/href="(\/heritage\/[^"]+)"/i, /href="(\/work\/[^"]+)"/i],
    baseUrl: 'https://www.redwingshoes.com',
    keywords: ['red wing', 'iron ranger', 'moc toe'],
    categories: ['boots']
  },

  // Watches
  {
    name: 'Timex',
    searchUrl: (q: string) => `https://www.timex.com/search?q=${encodeURIComponent(q)}`,
    imagePatterns: [/src="(https:\/\/[^"]+timex[^"]+\.(jpg|png|webp)[^"]*)"/i],
    productLinkPatterns: [/href="(\/[^"]+\/[^"]+\.html)"/i],
    baseUrl: 'https://www.timex.com',
    keywords: ['timex', 'weekender', 'marlin'],
    categories: ['watches']
  },
  {
    name: 'Casio',
    searchUrl: (q: string) => `https://www.casio.com/us/search?q=${encodeURIComponent(q)}`,
    imagePatterns: [/src="(https:\/\/[^"]+casio[^"]+\.(jpg|png|webp)[^"]*)"/i],
    productLinkPatterns: [/href="(\/us\/watches\/[^"]+)"/i],
    baseUrl: 'https://www.casio.com',
    keywords: ['casio', 'g-shock', 'f-91w'],
    categories: ['watches']
  },
  {
    name: 'Seiko',
    searchUrl: (q: string) => `https://www.seikowatches.com/us-en/search?q=${encodeURIComponent(q)}`,
    imagePatterns: [/src="(https:\/\/[^"]+seiko[^"]+\.(jpg|png|webp)[^"]*)"/i],
    productLinkPatterns: [/href="(\/us-en\/products\/[^"]+)"/i],
    baseUrl: 'https://www.seikowatches.com',
    keywords: ['seiko', 'presage', 'prospex'],
    categories: ['watches']
  },
]

// Product categories that brands can make
type ProductCategory =
  | 'sneakers' | 'boots' | 'sandals' | 'dress-shoes' | 'loafers'  // footwear
  | 't-shirts' | 'shirts' | 'sweaters' | 'hoodies' | 'jackets' | 'coats' | 'vests'  // tops/outerwear
  | 'jeans' | 'pants' | 'shorts' | 'chinos'  // bottoms
  | 'watches' | 'sunglasses' | 'eyeglasses' | 'bags' | 'backpacks' | 'wallets' | 'belts' | 'hats' | 'scarves' | 'gloves' | 'socks' | 'jewelry' | 'rings'  // accessories

// Type for brand configuration
interface BrandConfig {
  name: string
  keywords: string[]
  categories: ProductCategory[]    // What this brand actually makes
  shopifyDomain?: string
  searchUrl?: (q: string) => string
  imagePatterns?: RegExp[]
  productLinkPatterns?: RegExp[]  // Patterns to extract actual product page URLs
  baseUrl?: string                 // Base URL for relative product links
}

// Extract supported brand names for AI prompt
const SUPPORTED_BRAND_NAMES = BRANDS.map(b => b.name)

// Build brand -> categories mapping for AI prompt
function getBrandCategoriesPrompt(): string {
  return BRANDS.map(b => `  - ${b.name}: ${b.categories.join(', ')}`).join('\n')
}

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

// Scrape product image AND product link from brand website (fallback)
async function scrapeHtml(brand: BrandConfig, query: string): Promise<{ image: string | null, url: string }> {
  if (!brand.searchUrl || !brand.imagePatterns) {
    return { image: null, url: '' }
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

    // Try to find product link first (actual product page, not search results)
    let productUrl = searchUrl // Default to search URL
    if (brand.productLinkPatterns && brand.productLinkPatterns.length > 0) {
      for (const linkPattern of brand.productLinkPatterns) {
        const linkMatch = html.match(linkPattern)
        if (linkMatch && linkMatch[1]) {
          let foundUrl = linkMatch[1]
          // Make relative URLs absolute
          if (foundUrl.startsWith('/') && brand.baseUrl) {
            foundUrl = brand.baseUrl + foundUrl
          }
          foundUrl = foundUrl.replace(/&amp;/g, '&')
          console.log(`[scrape] ${brand.name} FOUND PRODUCT LINK: ${foundUrl}`)
          productUrl = foundUrl
          break
        }
      }
    }

    // Try to find image
    let imageUrl: string | null = null
    for (const pattern of brand.imagePatterns) {
      const match = html.match(pattern)
      if (match && match[1]) {
        imageUrl = match[1]
        if (imageUrl.startsWith('//')) {
          imageUrl = 'https:' + imageUrl
        }
        imageUrl = imageUrl.replace(/&amp;/g, '&')
        console.log(`[scrape] ${brand.name} FOUND IMAGE: ${imageUrl.substring(0, 80)}...`)
        break
      }
    }

    if (imageUrl || productUrl !== searchUrl) {
      return { image: imageUrl, url: productUrl }
    }

    console.log(`[scrape] ${brand.name} NO IMAGE OR PRODUCT LINK FOUND`)
    return { image: null, url: searchUrl }
  } catch (error) {
    console.error(`[scrape] ${brand.name} error:`, error.message)
    return { image: null, url: searchUrl }
  }
}

// Get the official brand URL (for when scraping fails)
function getBrandUrl(brandConfig: BrandConfig, query: string): string {
  // If Shopify, link to their search
  if (brandConfig.shopifyDomain) {
    return `https://${brandConfig.shopifyDomain}/search?q=${encodeURIComponent(query)}`
  }
  // If we have a searchUrl function, use it
  if (brandConfig.searchUrl) {
    return brandConfig.searchUrl(query)
  }
  // Fallback to brand homepage (extract from first keyword)
  return `https://www.${brandConfig.name.toLowerCase().replace(/[^a-z0-9]/g, '')}.com`
}

// Image resolution result with strategy tracking
interface ImageResolutionResult {
  image: string | null
  url: string
  strategy: 'shopify' | 'serp' | 'scrape' | 'none'
}

// Main function: try strategies in order of reliability
// Strategy order: Shopify API → SERP API → HTML scraping
// NEVER returns Google Shopping URLs - only official brand URLs
async function scrapeProductImage(brandName: string, query: string): Promise<ImageResolutionResult> {
  const brandConfig = findBrandConfig(brandName, query)

  if (!brandConfig) {
    console.log(`[scrape] No brand config for "${brandName}" - trying SERP API`)

    // Even without brand config, try SERP API
    recordImageStrategyResult('serp', false) // Will update if successful
    const serpResult = await trySerpApi(brandName, query)
    if (serpResult.image) {
      recordImageStrategyResult('serp', true)
      return { ...serpResult, strategy: 'serp' }
    }

    return {
      image: null,
      url: '',
      strategy: 'none'
    }
  }

  // Get the official brand URL to use as fallback
  const brandUrl = getBrandUrl(brandConfig, query)

  // Strategy 1: Shopify API (most reliable for Shopify stores)
  if (brandConfig.shopifyDomain) {
    recordImageStrategyResult('shopify', false)
    const result = await tryShopifyApi(brandConfig.shopifyDomain, query)
    if (result.image) {
      recordImageStrategyResult('shopify', true)
      return { ...result, strategy: 'shopify' }
    }
    console.log(`[scrape] Shopify API failed for ${brandConfig.name}, trying SERP API...`)
  }

  // Strategy 2: SERP API (reliable but costs money)
  const serpApiKey = Deno.env.get('SERP_API_KEY')
  if (serpApiKey) {
    recordImageStrategyResult('serp', false)
    const serpResult = await trySerpApi(brandConfig.name, query)
    if (serpResult.image) {
      recordImageStrategyResult('serp', true)
      return {
        image: serpResult.image,
        url: serpResult.url || brandUrl,
        strategy: 'serp'
      }
    }
    console.log(`[scrape] SERP API failed for ${brandConfig.name}, trying HTML scrape...`)
  }

  // Strategy 3: HTML scraping (unreliable but free)
  if (brandConfig.searchUrl && brandConfig.imagePatterns) {
    recordImageStrategyResult('scrape', false)
    const result = await scrapeHtml(brandConfig, query)
    if (result.image) {
      recordImageStrategyResult('scrape', true)
      return { ...result, strategy: 'scrape' }
    }
  }

  // Return official brand URL (NOT Google Shopping)
  console.log(`[scrape] No image found for "${brandName}" - returning brand URL: ${brandUrl}`)
  return {
    image: null,
    url: brandUrl,
    strategy: 'none'
  }
}

// Check if a brand is in our supported list
function isSupportedBrand(brandName: string): boolean {
  const brandLower = brandName.toLowerCase()
  return BRANDS.some(brand =>
    brand.keywords.some(kw => brandLower.includes(kw) || kw.includes(brandLower))
  )
}

// Get brand config by name
function getBrandByName(brandName: string): BrandConfig | null {
  const brandLower = brandName.toLowerCase()
  return BRANDS.find(brand =>
    brand.keywords.some(kw => brandLower.includes(kw) || kw.includes(brandLower))
  ) || null
}

// Check if a brand makes a specific product category
function brandMakesCategory(brandName: string, productCategory: string): boolean {
  const brand = getBrandByName(brandName)
  if (!brand) return false

  const categoryLower = productCategory.toLowerCase()

  // Map common product terms to our category types
  const categoryMapping: Record<string, ProductCategory[]> = {
    'belt': ['belts'],
    'belts': ['belts'],
    'ring': ['rings', 'jewelry'],
    'rings': ['rings', 'jewelry'],
    'jewelry': ['jewelry', 'rings'],
    'bracelet': ['jewelry'],
    'necklace': ['jewelry'],
    'wallet': ['wallets'],
    'wallets': ['wallets'],
    'bag': ['bags', 'backpacks'],
    'bags': ['bags', 'backpacks'],
    'backpack': ['backpacks', 'bags'],
    'watch': ['watches'],
    'watches': ['watches'],
    'sunglasses': ['sunglasses'],
    'glasses': ['sunglasses', 'eyeglasses'],
    'eyeglasses': ['eyeglasses'],
    'sneaker': ['sneakers'],
    'sneakers': ['sneakers'],
    'boot': ['boots'],
    'boots': ['boots'],
    'sandal': ['sandals'],
    'sandals': ['sandals'],
    'loafer': ['loafers'],
    'loafers': ['loafers'],
    'shoe': ['sneakers', 'boots', 'loafers', 'dress-shoes'],
    'shoes': ['sneakers', 'boots', 'loafers', 'dress-shoes'],
    't-shirt': ['t-shirts'],
    'tee': ['t-shirts'],
    'shirt': ['shirts', 't-shirts'],
    'hoodie': ['hoodies'],
    'sweatshirt': ['hoodies', 'sweaters'],
    'sweater': ['sweaters'],
    'jacket': ['jackets'],
    'coat': ['coats', 'jackets'],
    'vest': ['vests'],
    'pants': ['pants', 'jeans', 'chinos'],
    'jeans': ['jeans'],
    'shorts': ['shorts'],
    'chinos': ['chinos', 'pants'],
    'hat': ['hats'],
    'cap': ['hats'],
    'beanie': ['hats'],
    'socks': ['socks'],
    'scarf': ['scarves'],
    'gloves': ['gloves'],
  }

  // Find matching categories for the product
  const matchingCategories = categoryMapping[categoryLower] || []

  // Check if brand has any of the matching categories
  if (matchingCategories.length > 0) {
    return matchingCategories.some(cat => brand.categories.includes(cat))
  }

  // If no specific mapping, check if any brand category contains the term
  return brand.categories.some(cat => cat.includes(categoryLower) || categoryLower.includes(cat))
}

// Get a brand that actually makes a product category
function getBrandForProductCategory(productCategory: string): string {
  const categoryLower = productCategory.toLowerCase()

  // Find brands that make this product type
  const matchingBrands = BRANDS.filter(brand => {
    const categoryMapping: Record<string, ProductCategory[]> = {
      'belt': ['belts'],
      'belts': ['belts'],
      'ring': ['rings', 'jewelry'],
      'rings': ['rings', 'jewelry'],
      'jewelry': ['jewelry', 'rings'],
      'wallet': ['wallets'],
      'watch': ['watches'],
      'sunglasses': ['sunglasses'],
      'sneaker': ['sneakers'],
      'boot': ['boots'],
      'sandal': ['sandals'],
    }

    const matchingCategories = categoryMapping[categoryLower] || []
    if (matchingCategories.length > 0) {
      return matchingCategories.some(cat => brand.categories.includes(cat))
    }
    return brand.categories.some(cat => cat.includes(categoryLower))
  })

  if (matchingBrands.length > 0) {
    return matchingBrands[Math.floor(Math.random() * matchingBrands.length)].name
  }

  // Fallback to generic brand selection
  return getRandomSupportedBrand('accessories')
}

// Get a random supported brand for a category (legacy, used as fallback)
function getRandomSupportedBrand(category: string): string {
  const categoryBrands: Record<string, string[]> = {
    footwear: ['New Balance', 'Nike', 'Adidas', 'Vans', 'Converse', 'Common Projects', 'Clarks', 'Dr. Martens'],
    tops: ['Reigning Champ', 'Todd Snyder', 'Buck Mason', 'Taylor Stitch', 'Uniqlo', 'COS', 'Carhartt WIP'],
    bottoms: ['Naked & Famous', '3sixteen', "Levi's", 'Carhartt WIP', 'Outlier', 'Buck Mason'],
    outerwear: ['Patagonia', 'The North Face', "Arc'teryx", 'Carhartt WIP', 'Norse Projects'],
    accessories: ['Timex', 'Casio', 'Seiko', 'Bellroy', 'Moscot', 'Miansai', 'Topo Designs']
  }
  const brands = categoryBrands[category] || categoryBrands['accessories']
  return brands[Math.floor(Math.random() * brands.length)]
}

// Extract product type from suggestion name/description for validation
function extractProductType(suggestion: any): string | null {
  const name = (suggestion.name || '').toLowerCase()
  const category = (suggestion.category || '').toLowerCase()

  // Check for specific product types in the name
  const productTypes = [
    'belt', 'ring', 'bracelet', 'necklace', 'jewelry',
    'wallet', 'bag', 'backpack', 'watch', 'sunglasses', 'glasses',
    'sneaker', 'boot', 'sandal', 'loafer', 'shoe',
    't-shirt', 'tee', 'shirt', 'hoodie', 'sweatshirt', 'sweater',
    'jacket', 'coat', 'vest', 'pants', 'jeans', 'shorts', 'chinos',
    'hat', 'cap', 'beanie', 'socks', 'scarf', 'gloves'
  ]

  for (const type of productTypes) {
    if (name.includes(type)) return type
    if (category.includes(type)) return type
  }

  return category || null
}

// Validate and fix suggestions - filter out unsupported brands AND invalid brand/category combos
function validateSuggestions(suggestions: any[]): any[] {
  console.log('[validate] Checking', suggestions.length, 'suggestions for valid brands and categories')

  const validated = suggestions.map((sug, index) => {
    const brandName = sug.brand || ''
    const isBrandSupported = isSupportedBrand(brandName)
    const productType = extractProductType(sug)

    console.log(`[validate ${index}] "${sug.name}" - brand: "${brandName}" - category: "${productType}"`)

    // Check if brand is supported
    if (!isBrandSupported && brandName) {
      // Replace with a brand that makes this product type
      const newBrand = productType
        ? getBrandForProductCategory(productType)
        : getRandomSupportedBrand(sug.category || 'accessories')

      console.log(`[validate ${index}] REPLACING unsupported brand "${brandName}" with "${newBrand}"`)
      return {
        ...sug,
        brand: newBrand,
        searchQuery: `${newBrand} ${sug.name.replace(new RegExp(brandName, 'gi'), '').trim()}`.trim()
      }
    }

    // Check if brand actually makes this product type (combats hallucinations like "Bellroy belt")
    if (isBrandSupported && productType) {
      const makesCat = brandMakesCategory(brandName, productType)

      if (!makesCat) {
        // Find a brand that actually makes this product type
        const newBrand = getBrandForProductCategory(productType)
        console.log(`[validate ${index}] HALLUCINATION: "${brandName}" doesn't make "${productType}" - replacing with "${newBrand}"`)
        return {
          ...sug,
          brand: newBrand,
          searchQuery: `${newBrand} ${sug.name.replace(new RegExp(brandName, 'gi'), '').trim()}`.trim()
        }
      }

      console.log(`[validate ${index}] OK: "${brandName}" makes "${productType}"`)
    }

    return sug
  })

  return validated
}

// Enrichment result with stats for instrumentation
interface EnrichmentResult {
  suggestions: any[]
  stats: {
    requested: number
    found: number
    strategies: Record<string, number>
  }
  brandsReplaced: number
  categoryCorrected: number
}

// Enrich suggestions with scraped images from brand websites
async function enrichSuggestions(suggestions: any[]): Promise<EnrichmentResult> {
  console.log('[enrich] Starting enrichment for', suggestions.length, 'suggestions')
  console.log('[enrich] Raw AI suggestions:', JSON.stringify(suggestions, null, 2))

  // First validate brands and track corrections
  const originalBrands = suggestions.map(s => s.brand)
  const validatedSuggestions = validateSuggestions(suggestions)
  const brandsReplaced = validatedSuggestions.filter((s, i) =>
    s.brand !== originalBrands[i]
  ).length

  // Track strategy usage
  const strategyStats: Record<string, number> = {
    shopify: 0,
    serp: 0,
    scrape: 0,
    none: 0
  }
  let imagesFound = 0

  const enriched = await Promise.all(
    validatedSuggestions.map(async (sug, index) => {
      const searchQuery = sug.searchQuery || sug.name
      const brandName = sug.brand || ''

      console.log(`[enrich ${index}] Processing: "${sug.name}"`)
      console.log(`[enrich ${index}] - brand: "${brandName}"`)
      console.log(`[enrich ${index}] - searchQuery: "${searchQuery}"`)

      const result = await scrapeProductImage(brandName, searchQuery)

      // Track stats
      strategyStats[result.strategy]++
      if (result.image) imagesFound++

      console.log(`[enrich ${index}] - result: image=${result.image ? 'YES' : 'NULL'}, strategy=${result.strategy}`)

      return {
        ...sug,
        productUrl: result.url,
        productImage: result.image,
        vendor: sug.brand,
        _imageStrategy: result.strategy // Internal tracking
      }
    })
  )

  console.log('[enrich] Final results:', enriched.map(s => ({
    name: s.name,
    brand: s.brand,
    hasImage: !!s.productImage,
    strategy: s._imageStrategy
  })))

  return {
    suggestions: enriched,
    stats: {
      requested: suggestions.length,
      found: imagesFound,
      strategies: strategyStats
    },
    brandsReplaced,
    categoryCorrected: 0 // TODO: track category corrections
  }
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
const cache = new Map<string, { content: object; timestamp: number; meta?: WidgetMeta }>()
const CACHE_TTL = 60 * 60 * 1000 // 1 hour

function getCacheKey(widgetId: string, items: WearItem[]): string {
  const itemIds = items.map(i => i.id).sort().join(',')
  return `${widgetId}:${itemIds}`
}

// =============================================================================
// PHASE 2: CONFIG-DRIVEN ELIGIBILITY ENGINE
// Eligibility rules are now defined in config/widgets/*.ts
// =============================================================================

// Wrapper to use config-driven eligibility with local types
function checkEligibility(context: { widgetId: string; items: WearItem[]; category?: string; userPrefs?: Record<string, any> }): EligibilityDecision {
  // Convert local WearItem[] to config EligibilityContext format
  const configContext: EligibilityContext = {
    widgetId: context.widgetId,
    items: context.items.map(item => ({
      id: item.id,
      title: item.title,
      description: item.description,
      image: item.image,
      url: item.url
    })),
    category: context.category,
    userPrefs: context.userPrefs
  }

  return checkEligibilityFromConfig(context.widgetId, configContext)
}

// =============================================================================
// PHASE 2: CONFIG-DRIVEN CONFIDENCE SCORING
// Confidence thresholds are now defined in config/widgets/*.ts
// getConfidenceConfig is imported from ./config/registry.ts
// =============================================================================

// =============================================================================
// PHASE 1: INSTRUMENTATION & VALIDATION
// Track what works, what fails, feed back into system
// =============================================================================

interface WidgetMeta {
  widgetId: string
  eligibility: EligibilityDecision
  confidence: number
  timing: {
    total: number
    ai: number
    enrichment: number
  }
  imageStats: {
    requested: number
    found: number
    strategies: Record<string, number> // shopify: 2, serp: 1, scrape: 0
  }
  validation: {
    brandsReplaced: number
    categoryCorrected: number
    // Phase 2.5a: Design system class validation
    unknownClasses?: string[]
    classesUsed?: string[]
    htmlSanitized?: boolean
  }
}

// In-memory instrumentation log (would be persisted to Supabase in production)
const instrumentationLog: Array<{
  timestamp: number
  widgetId: string
  success: boolean
  meta: Partial<WidgetMeta>
  error?: string
}> = []

function logInstrumentation(entry: typeof instrumentationLog[0]) {
  instrumentationLog.push(entry)
  // Keep last 100 entries in memory
  if (instrumentationLog.length > 100) {
    instrumentationLog.shift()
  }
  console.log('[instrumentation]', JSON.stringify(entry))
}

// =============================================================================
// PHASE 0: SERP API INTEGRATION
// More reliable image source than HTML scraping
// =============================================================================

async function trySerpApi(brandName: string, productName: string): Promise<{ image: string | null, url: string }> {
  const serpApiKey = Deno.env.get('SERP_API_KEY')

  if (!serpApiKey) {
    console.log('[serp] SERP_API_KEY not configured, skipping')
    return { image: null, url: '' }
  }

  const searchQuery = `${brandName} ${productName} product`

  try {
    console.log(`[serp] Searching for: "${searchQuery}"`)

    // Use SerpApi Google Shopping endpoint
    const params = new URLSearchParams({
      api_key: serpApiKey,
      engine: 'google_shopping',
      q: searchQuery,
      num: '5'
    })

    const response = await fetch(`https://serpapi.com/search?${params}`)

    if (!response.ok) {
      console.log(`[serp] API returned ${response.status}`)
      return { image: null, url: '' }
    }

    const data = await response.json()

    // Try shopping_results first
    if (data.shopping_results && data.shopping_results.length > 0) {
      const result = data.shopping_results[0]
      console.log(`[serp] Found shopping result: ${result.title}`)
      return {
        image: result.thumbnail || null,
        url: result.link || ''
      }
    }

    // Fallback to inline_shopping_results
    if (data.inline_shopping_results && data.inline_shopping_results.length > 0) {
      const result = data.inline_shopping_results[0]
      console.log(`[serp] Found inline shopping result: ${result.title}`)
      return {
        image: result.thumbnail || null,
        url: result.link || ''
      }
    }

    console.log('[serp] No shopping results found')
    return { image: null, url: '' }

  } catch (error) {
    console.error('[serp] Error:', error.message)
    return { image: null, url: '' }
  }
}

// Image strategy health tracking
const imageStrategyHealth: Record<string, { attempts: number; successes: number }> = {
  shopify: { attempts: 0, successes: 0 },
  serp: { attempts: 0, successes: 0 },
  scrape: { attempts: 0, successes: 0 }
}

function recordImageStrategyResult(strategy: string, success: boolean) {
  if (!imageStrategyHealth[strategy]) {
    imageStrategyHealth[strategy] = { attempts: 0, successes: 0 }
  }
  imageStrategyHealth[strategy].attempts++
  if (success) imageStrategyHealth[strategy].successes++
}

function getImageStrategySuccessRate(strategy: string): number {
  const health = imageStrategyHealth[strategy]
  if (!health || health.attempts === 0) return 0.5 // Assume 50% for unknown
  return health.successes / health.attempts
}

// Extended request with Phase 1 options
interface ExtendedWidgetRequest extends WidgetRequest {
  category?: string
  userPrefs?: Record<string, any>
  skipEligibility?: boolean // For testing
  tasteContext?: TasteContext | null // Taste Engine profile context
}

// Taste Engine context (passed from client, optional)
interface TasteContext {
  domains?: { label: string; summary: string; spanning_categories: string[]; confidence: number }[]
  axes?: { axis: string; position: number; low_label: string; high_label: string }[]
  sensibility?: string | null
  // Legacy compat fields
  clusters?: { label: string; domain: string; pinCount: number }[]
  bridges?: any[]
  motifs?: string[]
}

serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  const startTime = Date.now()
  let aiTime = 0
  let enrichmentTime = 0

  try {
    const requestBody = await req.json()

    // ========================================================================
    // PHASE 2: Widget Discovery Endpoint
    // POST { action: 'discover', category, items }
    // Returns eligible widgets for a category without generating AI content
    // ========================================================================
    if (requestBody.action === 'discover') {
      const { category, items, userPrefs } = requestBody as {
        action: string
        category: string
        items: WearItem[]
        userPrefs?: Record<string, any>
      }

      if (!category || !items || items.length === 0) {
        return new Response(
          JSON.stringify({ error: 'category and items are required for discovery' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )
      }

      const configItems = items.map(item => ({
        id: item.id,
        title: item.title,
        description: item.description,
        image: item.image,
        url: item.url
      }))

      const discoveries = discoverWidgets(category, configItems, userPrefs)

      return new Response(
        JSON.stringify({
          widgets: discoveries.map(d => {
            const dsTemplate = resolveTemplate(d.widget.rendering.template)
            const dsName = boardsTemplateMap[d.widget.rendering.template] || d.widget.rendering.template
            return {
              widgetId: d.widgetId,
              name: d.widget.name,
              description: d.widget.description,
              zone: d.widget.rendering.zone,
              template: d.widget.rendering.template,
              fallbackTemplate: d.widget.rendering.fallbackTemplate,
              cssClass: d.widget.rendering.cssClass,
              priority: d.widget.rendering.priority,
              eligibility: d.eligibility,
              // Include prompt template so the frontend can generate
              // content for widgets not yet in its local registry
              promptTemplate: d.widget.generation.promptTemplate,
              constraints: d.widget.generation.constraints || [],
              // Phase 2.5a: Design system template mapping
              designSystem: dsTemplate ? {
                templateName: dsName,
                bodyModifier: dsTemplate.bodyModifier,
                validSizes: dsTemplate.validSizes,
                structure: dsTemplate.structure,
              } : null,
            }
          }),
          category,
          itemCount: items.length,
          timestamp: Date.now()
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // ========================================================================
    // PHASE 2: Registry Summary Endpoint
    // POST { action: 'registry' }
    // Returns all registered widgets and their metadata
    // ========================================================================
    if (requestBody.action === 'registry') {
      return new Response(
        JSON.stringify({ widgets: getRegistrySummary(), timestamp: Date.now() }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // ========================================================================
    // Standard widget generation (existing flow)
    // ========================================================================
    const { widgetId, prompt, items, category, userPrefs, skipEligibility, tasteContext } = requestBody as ExtendedWidgetRequest

    if (!widgetId || !prompt || !items || items.length === 0) {
      return new Response(
        JSON.stringify({ error: 'widgetId, prompt, and items are required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    console.log('[generate-widget]', widgetId, '- Processing', items.length, 'items')

    // ==========================================================================
    // PHASE 1: ELIGIBILITY CHECK
    // Widget must "earn" existence through eligibility rules
    // ==========================================================================
    const eligibilityContext: EligibilityContext = {
      widgetId,
      items,
      category,
      userPrefs
    }
    const eligibility = checkEligibility(eligibilityContext)

    console.log('[generate-widget] Eligibility check:', {
      eligible: eligibility.eligible,
      score: eligibility.score.toFixed(2),
      rules: eligibility.rules.map(r => `${r.name}:${r.passed ? '✓' : '✗'}`)
    })

    // If not eligible and not skipping, return early
    if (!eligibility.eligible && !skipEligibility) {
      console.log('[generate-widget] Widget not eligible, suppressing')

      logInstrumentation({
        timestamp: Date.now(),
        widgetId,
        success: false,
        meta: { eligibility },
        error: 'Not eligible'
      })

      return new Response(
        JSON.stringify({
          content: null,
          cached: false,
          suppressed: true,
          reason: 'eligibility_failed',
          meta: {
            widgetId,
            eligibility,
            confidence: 0,
            timing: { total: Date.now() - startTime, ai: 0, enrichment: 0 }
          }
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Check cache
    const cacheKey = getCacheKey(widgetId, items)
    const cached = cache.get(cacheKey)
    if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
      console.log('[generate-widget] Cache hit for', cacheKey)
      return new Response(
        JSON.stringify({
          content: cached.content,
          cached: true,
          meta: cached.meta || { eligibility }
        }),
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

    // Add supported brands constraint to prompt with category mappings
    const brandConstraint = `

CRITICAL - ONLY SUGGEST PRODUCTS FROM THESE BRANDS AND ONLY THE CATEGORIES THEY ACTUALLY MAKE:

${getBrandCategoriesPrompt()}

RULES:
1. For each suggestion, ONLY use a brand from the list above
2. ONLY suggest product types that brand actually makes (per the categories listed)
3. If suggesting a belt, ONLY use brands with "belts" in their categories (e.g., Miansai, Iron Heart, Levi's, Uniqlo)
4. If suggesting a ring or jewelry, ONLY use Miansai or Vitaly
5. If suggesting a wallet or bag, consider Bellroy, Topo Designs, or Lemaire
6. If a brand doesn't make a product type, DO NOT suggest it - pick a different brand that does make it`

    // ==========================================================================
    // PHASE 1: CONFIDENCE SCORING
    // Ask AI to include confidence in response
    // ==========================================================================
    const confidenceInstruction = `

IMPORTANT: Include a "confidence" field (0.0 to 1.0) in your response indicating how confident you are in your suggestions based on:
- How well you understand the items
- How relevant your suggestions are
- Whether you have enough context

Example: "confidence": 0.85`

    // ==========================================================================
    // PHASE 2.5a: DESIGN SYSTEM CONSTRAINTS
    // Tell the AI about the widget's template structure and allowed classes
    // ==========================================================================
    const widgetDef = getWidget(widgetId)
    const templateName = widgetDef?.rendering?.template || ''
    const dsConstraint = buildDesignSystemPrompt(templateName)

    // ==========================================================================
    // VISUAL STANDARDS: CATEGORY AESTHETIC CONTEXT
    // Tell the AI about the visual mood/palette of this board category
    // so recommendations are aesthetically coherent with the board
    // ==========================================================================
    const categoryContext = category ? buildCategoryPrompt(category) : ''

    // ==========================================================================
    // TASTE ENGINE: USER PREFERENCE CONTEXT
    // Inject taste profile so AI recommendations align with user's aesthetic
    // ==========================================================================
    let tasteConstraint = ''
    if (tasteContext) {
      const parts: string[] = []

      if (tasteContext.sensibility) {
        parts.push(`User's taste sensibility: ${tasteContext.sensibility}`)
      }

      if (tasteContext.domains && tasteContext.domains.length > 0) {
        const domainText = tasteContext.domains
          .slice(0, 5)
          .map(d => `"${d.label}"${d.summary ? ` — ${d.summary}` : ''}`)
          .join('; ')
        parts.push(`Taste domains: ${domainText}`)
      }

      if (tasteContext.axes && tasteContext.axes.length > 0) {
        const axisText = tasteContext.axes
          .map(a => `${a.axis}: ${a.position < 0.4 ? a.low_label : a.position > 0.6 ? a.high_label : 'balanced'} (${a.position.toFixed(1)})`)
          .join(', ')
        parts.push(`Aesthetic axes: ${axisText}`)
      }

      if (parts.length > 0) {
        tasteConstraint = `

USER TASTE PROFILE (use to personalize recommendations):
${parts.join('\n')}

IMPORTANT: Lean into the user's aesthetic preferences when making suggestions. Match their taste domains and axis positions. A user who leans "minimal" should get cleaner, simpler suggestions. A user who leans "artisanal" should get craft-forward options.`
      }
    }

    const fullPrompt = `${prompt}${brandConstraint}${dsConstraint}${categoryContext}${tasteConstraint}${confidenceInstruction}

Here are the items to analyze:

${itemsContext}

Respond with valid JSON only, no markdown or explanation.`

    console.log('[generate-widget] Calling Claude API...')
    console.log('[generate-widget] Supported brands:', SUPPORTED_BRAND_NAMES.length)

    const aiStartTime = Date.now()

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

    aiTime = Date.now() - aiStartTime

    if (!response.ok) {
      const errorText = await response.text()
      console.error('[generate-widget] Claude API error:', response.status, errorText)

      logInstrumentation({
        timestamp: Date.now(),
        widgetId,
        success: false,
        meta: { eligibility },
        error: `API error: ${response.status}`
      })

      return new Response(
        JSON.stringify({ error: 'AI generation failed', details: response.status }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    const aiResponse = await response.json()
    const textContent = aiResponse.content?.[0]?.text

    if (!textContent) {
      console.error('[generate-widget] No content in AI response')

      logInstrumentation({
        timestamp: Date.now(),
        widgetId,
        success: false,
        meta: { eligibility },
        error: 'No content in response'
      })

      return new Response(
        JSON.stringify({ error: 'No content generated' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Parse the JSON response - handle cases where AI adds preamble text
    let content: any
    try {
      // Clean up potential markdown code blocks
      let cleanedText = textContent
        .replace(/```json\n?/g, '')
        .replace(/```\n?/g, '')
        .trim()

      // Try direct parse first
      try {
        content = JSON.parse(cleanedText)
      } catch {
        // If that fails, try to extract JSON from the text
        // Look for first { and last }
        const firstBrace = cleanedText.indexOf('{')
        const lastBrace = cleanedText.lastIndexOf('}')

        if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
          const jsonStr = cleanedText.substring(firstBrace, lastBrace + 1)
          console.log('[generate-widget] Extracted JSON from position', firstBrace, 'to', lastBrace)
          content = JSON.parse(jsonStr)
        } else {
          throw new Error('No valid JSON object found')
        }
      }
    } catch (parseError) {
      console.error('[generate-widget] Failed to parse AI response:', textContent)

      logInstrumentation({
        timestamp: Date.now(),
        widgetId,
        success: false,
        meta: { eligibility },
        error: 'JSON parse error'
      })

      return new Response(
        JSON.stringify({ error: 'Invalid AI response format', raw: textContent }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // ==========================================================================
    // PHASE 1: CONFIDENCE THRESHOLD CHECK
    // ==========================================================================
    const confidence = typeof content.confidence === 'number' ? content.confidence : 0.7 // Default if not provided
    const confidenceConfig = getConfidenceConfig(widgetId)

    console.log('[generate-widget] Confidence:', confidence.toFixed(2), 'threshold:', confidenceConfig.threshold)

    if (confidence < confidenceConfig.threshold && !skipEligibility) {
      console.log('[generate-widget] Confidence below threshold, behavior:', confidenceConfig.fallbackBehavior)

      if (confidenceConfig.fallbackBehavior === 'suppress') {
        logInstrumentation({
          timestamp: Date.now(),
          widgetId,
          success: false,
          meta: { eligibility, confidence },
          error: 'Low confidence'
        })

        return new Response(
          JSON.stringify({
            content: null,
            cached: false,
            suppressed: true,
            reason: 'low_confidence',
            meta: {
              widgetId,
              eligibility,
              confidence,
              timing: { total: Date.now() - startTime, ai: aiTime, enrichment: 0 }
            }
          }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )
      }
      // 'degrade' behavior: continue but mark as low confidence
    }

    // Initialize meta for tracking
    let meta: WidgetMeta = {
      widgetId,
      eligibility,
      confidence,
      timing: { total: 0, ai: aiTime, enrichment: 0 },
      imageStats: { requested: 0, found: 0, strategies: {} },
      validation: { brandsReplaced: 0, categoryCorrected: 0 }
    }

    // Phase 2: Config-driven enrichment — use widget config instead of hard-coded widget ID
    const widgetConfig = getWidget(widgetId)
    const enrichmentEnabled = widgetConfig?.enrichment?.enabled ?? false

    if (enrichmentEnabled && content.suggestions && Array.isArray(content.suggestions)) {
      const enrichmentStart = Date.now()
      const enrichmentResult = await enrichSuggestions(content.suggestions)
      enrichmentTime = Date.now() - enrichmentStart

      content.suggestions = enrichmentResult.suggestions
      meta.imageStats = enrichmentResult.stats
      meta.validation = {
        brandsReplaced: enrichmentResult.brandsReplaced,
        categoryCorrected: enrichmentResult.categoryCorrected
      }
    }

    // ==========================================================================
    // PHASE 2.5a: DESIGN SYSTEM VALIDATION
    // If AI response contains HTML, validate w-* classes against allowlist
    // ==========================================================================
    if (content.html && typeof content.html === 'string') {
      const validation = validateWidgetHtml(content.html)
      if (!validation.valid) {
        console.log('[generate-widget] Unknown w-* classes detected:', validation.unknownClasses)
        content.html = sanitizeWidgetHtml(content.html)
        meta.validation = {
          ...meta.validation,
          unknownClasses: validation.unknownClasses,
          classesUsed: validation.classesUsed,
          htmlSanitized: true,
        }
      } else {
        meta.validation = {
          ...meta.validation,
          classesUsed: validation.classesUsed,
          htmlSanitized: false,
        }
      }
    }

    // Finalize timing
    meta.timing = {
      total: Date.now() - startTime,
      ai: aiTime,
      enrichment: enrichmentTime
    }

    // Cache the result with meta
    cache.set(cacheKey, { content, timestamp: Date.now(), meta })
    console.log('[generate-widget] Success, cached result for', cacheKey)

    // Log successful generation
    logInstrumentation({
      timestamp: Date.now(),
      widgetId,
      success: true,
      meta
    })

    return new Response(
      JSON.stringify({ content, cached: false, meta }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )

  } catch (error) {
    console.error('[generate-widget] Error:', error)

    logInstrumentation({
      timestamp: Date.now(),
      widgetId: 'unknown',
      success: false,
      meta: {},
      error: error.message
    })

    return new Response(
      JSON.stringify({ error: 'Internal server error', message: error.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})
