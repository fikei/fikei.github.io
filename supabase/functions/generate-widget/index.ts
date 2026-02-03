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
  // Streetwear
  {
    name: 'Stüssy',
    searchUrl: (q: string) => `https://www.stussy.com/search?q=${encodeURIComponent(q)}`,
    imagePatterns: [
      /src="(https:\/\/cdn\.shopify\.com\/[^"]+)"/i,
    ],
    keywords: ['stussy', 'stüssy']
  },
  {
    name: 'Palace',
    searchUrl: (q: string) => `https://www.palaceskateboards.com/search?q=${encodeURIComponent(q)}`,
    imagePatterns: [
      /src="(https:\/\/cdn\.shopify\.com\/[^"]+)"/i,
    ],
    keywords: ['palace']
  },
  {
    name: 'BAPE',
    searchUrl: (q: string) => `https://us.bape.com/search?q=${encodeURIComponent(q)}`,
    imagePatterns: [
      /src="(https:\/\/cdn\.shopify\.com\/[^"]+)"/i,
    ],
    keywords: ['bape', 'a bathing ape', 'bathing ape']
  },
  {
    name: 'Kith',
    searchUrl: (q: string) => `https://kith.com/search?q=${encodeURIComponent(q)}`,
    imagePatterns: [
      /src="(https:\/\/cdn\.shopify\.com\/[^"]+)"/i,
    ],
    keywords: ['kith']
  },
  {
    name: 'Noah',
    searchUrl: (q: string) => `https://noahny.com/search?q=${encodeURIComponent(q)}`,
    imagePatterns: [
      /src="(https:\/\/cdn\.shopify\.com\/[^"]+)"/i,
    ],
    keywords: ['noah']
  },
  {
    name: 'Aimé Leon Dore',
    searchUrl: (q: string) => `https://www.aimeleondore.com/search?q=${encodeURIComponent(q)}`,
    imagePatterns: [
      /src="(https:\/\/cdn\.shopify\.com\/[^"]+)"/i,
    ],
    keywords: ['aime leon dore', 'aimé leon dore', 'ald']
  },
  {
    name: 'Awake NY',
    searchUrl: (q: string) => `https://awakenyclothing.com/search?q=${encodeURIComponent(q)}`,
    imagePatterns: [
      /src="(https:\/\/cdn\.shopify\.com\/[^"]+)"/i,
    ],
    keywords: ['awake ny', 'awake']
  },
  {
    name: 'Brain Dead',
    searchUrl: (q: string) => `https://wearebraindead.com/search?q=${encodeURIComponent(q)}`,
    imagePatterns: [
      /src="(https:\/\/cdn\.shopify\.com\/[^"]+)"/i,
    ],
    keywords: ['brain dead', 'braindead']
  },
  // Japanese Brands
  {
    name: 'WTAPS',
    searchUrl: (q: string) => `https://www.wtaps.com/search?q=${encodeURIComponent(q)}`,
    imagePatterns: [
      /src="(https:\/\/[^"]+wtaps[^"]+\.jpg[^"]*)"/i,
      /src="(https:\/\/cdn\.shopify\.com\/[^"]+)"/i,
    ],
    keywords: ['wtaps']
  },
  {
    name: 'Neighborhood',
    searchUrl: (q: string) => `https://www.neighborhood.jp/search?q=${encodeURIComponent(q)}`,
    imagePatterns: [
      /src="(https:\/\/[^"]+neighborhood[^"]+\.jpg[^"]*)"/i,
    ],
    keywords: ['neighborhood', 'nbhd']
  },
  {
    name: 'Kapital',
    searchUrl: (q: string) => `https://www.kapital-webshop.jp/search?q=${encodeURIComponent(q)}`,
    imagePatterns: [
      /src="(https:\/\/[^"]+kapital[^"]+\.jpg[^"]*)"/i,
    ],
    keywords: ['kapital']
  },
  {
    name: 'Visvim',
    searchUrl: (q: string) => `https://www.visvim.tv/search?q=${encodeURIComponent(q)}`,
    imagePatterns: [
      /src="(https:\/\/[^"]+visvim[^"]+\.jpg[^"]*)"/i,
    ],
    keywords: ['visvim']
  },
  {
    name: 'Undercover',
    searchUrl: (q: string) => `https://undercoverism.com/search?q=${encodeURIComponent(q)}`,
    imagePatterns: [
      /src="(https:\/\/[^"]+undercover[^"]+\.jpg[^"]*)"/i,
    ],
    keywords: ['undercover', 'undercoverism']
  },
  {
    name: 'Comme des Garçons',
    searchUrl: (q: string) => `https://shop.doverstreetmarket.com/search?q=${encodeURIComponent(q + ' comme des garcons')}`,
    imagePatterns: [
      /src="(https:\/\/cdn\.shopify\.com\/[^"]+)"/i,
    ],
    keywords: ['comme des garcons', 'cdg', 'comme des garçons']
  },
  {
    name: 'Sacai',
    searchUrl: (q: string) => `https://www.sacai.jp/search?q=${encodeURIComponent(q)}`,
    imagePatterns: [
      /src="(https:\/\/[^"]+sacai[^"]+\.jpg[^"]*)"/i,
    ],
    keywords: ['sacai']
  },
  {
    name: 'Needles',
    searchUrl: (q: string) => `https://www.needles.jp/search?q=${encodeURIComponent(q)}`,
    imagePatterns: [
      /src="(https:\/\/[^"]+needles[^"]+\.jpg[^"]*)"/i,
    ],
    keywords: ['needles', 'nepenthes']
  },
  // Scandinavian / European
  {
    name: 'Norse Projects',
    searchUrl: (q: string) => `https://www.norseprojects.com/search?q=${encodeURIComponent(q)}`,
    imagePatterns: [
      /src="(https:\/\/cdn\.shopify\.com\/[^"]+)"/i,
    ],
    keywords: ['norse projects', 'norse']
  },
  {
    name: 'Our Legacy',
    searchUrl: (q: string) => `https://www.ourlegacy.com/search?q=${encodeURIComponent(q)}`,
    imagePatterns: [
      /src="(https:\/\/cdn\.shopify\.com\/[^"]+)"/i,
    ],
    keywords: ['our legacy']
  },
  {
    name: 'Arket',
    searchUrl: (q: string) => `https://www.arket.com/en_usd/search.html?q=${encodeURIComponent(q)}`,
    imagePatterns: [
      /src="(https:\/\/[^"]+arket[^"]+\.jpg[^"]*)"/i,
    ],
    keywords: ['arket']
  },
  {
    name: 'GANNI',
    searchUrl: (q: string) => `https://www.ganni.com/en-us/search?q=${encodeURIComponent(q)}`,
    imagePatterns: [
      /src="(https:\/\/[^"]+ganni[^"]+\.jpg[^"]*)"/i,
    ],
    keywords: ['ganni']
  },
  // Contemporary Designer
  {
    name: 'Lemaire',
    searchUrl: (q: string) => `https://www.lemaire.fr/search?q=${encodeURIComponent(q)}`,
    imagePatterns: [
      /src="(https:\/\/cdn\.shopify\.com\/[^"]+)"/i,
    ],
    keywords: ['lemaire']
  },
  {
    name: 'Jil Sander',
    searchUrl: (q: string) => `https://www.jilsander.com/en-us/search?q=${encodeURIComponent(q)}`,
    imagePatterns: [
      /src="(https:\/\/[^"]+jilsander[^"]+\.jpg[^"]*)"/i,
    ],
    keywords: ['jil sander']
  },
  {
    name: 'Maison Margiela',
    searchUrl: (q: string) => `https://www.maisonmargiela.com/en-us/search?q=${encodeURIComponent(q)}`,
    imagePatterns: [
      /src="(https:\/\/[^"]+margiela[^"]+\.jpg[^"]*)"/i,
    ],
    keywords: ['margiela', 'maison margiela', 'mmm']
  },
  {
    name: 'Rick Owens',
    searchUrl: (q: string) => `https://www.rickowens.eu/en-US/search?q=${encodeURIComponent(q)}`,
    imagePatterns: [
      /src="(https:\/\/[^"]+rickowens[^"]+\.jpg[^"]*)"/i,
    ],
    keywords: ['rick owens', 'drkshdw']
  },
  {
    name: 'Ami Paris',
    searchUrl: (q: string) => `https://www.amiparis.com/us/search?q=${encodeURIComponent(q)}`,
    imagePatterns: [
      /src="(https:\/\/[^"]+amiparis[^"]+\.jpg[^"]*)"/i,
    ],
    keywords: ['ami', 'ami paris']
  },
  // DTC / Modern Basics
  {
    name: 'Everlane',
    searchUrl: (q: string) => `https://www.everlane.com/search?q=${encodeURIComponent(q)}`,
    imagePatterns: [
      /src="(https:\/\/[^"]+everlane[^"]+\.jpg[^"]*)"/i,
    ],
    keywords: ['everlane']
  },
  {
    name: 'Outlier',
    searchUrl: (q: string) => `https://outlier.nyc/search?q=${encodeURIComponent(q)}`,
    imagePatterns: [
      /src="(https:\/\/cdn\.shopify\.com\/[^"]+)"/i,
    ],
    keywords: ['outlier']
  },
  {
    name: 'Reigning Champ',
    searchUrl: (q: string) => `https://reigningchamp.com/search?q=${encodeURIComponent(q)}`,
    imagePatterns: [
      /src="(https:\/\/cdn\.shopify\.com\/[^"]+)"/i,
    ],
    keywords: ['reigning champ']
  },
  {
    name: 'Todd Snyder',
    searchUrl: (q: string) => `https://www.toddsnyder.com/search?q=${encodeURIComponent(q)}`,
    imagePatterns: [
      /src="(https:\/\/cdn\.shopify\.com\/[^"]+)"/i,
    ],
    keywords: ['todd snyder']
  },
  {
    name: 'Buck Mason',
    searchUrl: (q: string) => `https://www.buckmason.com/search?q=${encodeURIComponent(q)}`,
    imagePatterns: [
      /src="(https:\/\/cdn\.shopify\.com\/[^"]+)"/i,
    ],
    keywords: ['buck mason']
  },
  {
    name: 'Taylor Stitch',
    searchUrl: (q: string) => `https://www.taylorstitch.com/search?q=${encodeURIComponent(q)}`,
    imagePatterns: [
      /src="(https:\/\/cdn\.shopify\.com\/[^"]+)"/i,
    ],
    keywords: ['taylor stitch']
  },
  {
    name: 'Alex Mill',
    searchUrl: (q: string) => `https://www.alexmill.com/search?q=${encodeURIComponent(q)}`,
    imagePatterns: [
      /src="(https:\/\/cdn\.shopify\.com\/[^"]+)"/i,
    ],
    keywords: ['alex mill']
  },
  {
    name: 'Corridor',
    searchUrl: (q: string) => `https://corridornyc.com/search?q=${encodeURIComponent(q)}`,
    imagePatterns: [
      /src="(https:\/\/cdn\.shopify\.com\/[^"]+)"/i,
    ],
    keywords: ['corridor']
  },
  // Specialty Footwear
  {
    name: 'Dr. Martens',
    searchUrl: (q: string) => `https://www.drmartens.com/us/en/search?q=${encodeURIComponent(q)}`,
    imagePatterns: [
      /src="(https:\/\/[^"]+drmartens[^"]+\.jpg[^"]*)"/i,
    ],
    keywords: ['dr martens', 'dr. martens', 'doc martens', '1460', '1461']
  },
  {
    name: 'Birkenstock',
    searchUrl: (q: string) => `https://www.birkenstock.com/us/search/?q=${encodeURIComponent(q)}`,
    imagePatterns: [
      /src="(https:\/\/[^"]+birkenstock[^"]+\.jpg[^"]*)"/i,
    ],
    keywords: ['birkenstock', 'boston', 'arizona']
  },
  {
    name: 'Clarks',
    searchUrl: (q: string) => `https://www.clarks.com/en-us/search?q=${encodeURIComponent(q)}`,
    imagePatterns: [
      /src="(https:\/\/[^"]+clarks[^"]+\.jpg[^"]*)"/i,
    ],
    keywords: ['clarks', 'desert boot', 'wallabee']
  },
  {
    name: 'Paraboot',
    searchUrl: (q: string) => `https://www.paraboot.com/en/search?q=${encodeURIComponent(q)}`,
    imagePatterns: [
      /src="(https:\/\/[^"]+paraboot[^"]+\.jpg[^"]*)"/i,
    ],
    keywords: ['paraboot', 'michael', 'chambord']
  },
  {
    name: 'Blundstone',
    searchUrl: (q: string) => `https://www.blundstone.com/search?q=${encodeURIComponent(q)}`,
    imagePatterns: [
      /src="(https:\/\/[^"]+blundstone[^"]+\.jpg[^"]*)"/i,
    ],
    keywords: ['blundstone']
  },
  {
    name: 'Red Wing',
    searchUrl: (q: string) => `https://www.redwingshoes.com/search?q=${encodeURIComponent(q)}`,
    imagePatterns: [
      /src="(https:\/\/[^"]+redwing[^"]+\.jpg[^"]*)"/i,
    ],
    keywords: ['red wing', 'iron ranger', 'moc toe']
  },
  // Premium Denim
  {
    name: 'Naked & Famous',
    searchUrl: (q: string) => `https://www.nakedandfamousdenim.com/search?q=${encodeURIComponent(q)}`,
    imagePatterns: [
      /src="(https:\/\/cdn\.shopify\.com\/[^"]+)"/i,
    ],
    keywords: ['naked and famous', 'naked & famous', 'n&f']
  },
  {
    name: '3sixteen',
    searchUrl: (q: string) => `https://www.3sixteen.com/search?q=${encodeURIComponent(q)}`,
    imagePatterns: [
      /src="(https:\/\/cdn\.shopify\.com\/[^"]+)"/i,
    ],
    keywords: ['3sixteen']
  },
  {
    name: 'Iron Heart',
    searchUrl: (q: string) => `https://www.ironheartamerica.com/search?q=${encodeURIComponent(q)}`,
    imagePatterns: [
      /src="(https:\/\/cdn\.shopify\.com\/[^"]+)"/i,
    ],
    keywords: ['iron heart']
  },
  {
    name: 'Nudie Jeans',
    searchUrl: (q: string) => `https://www.nudiejeans.com/search?q=${encodeURIComponent(q)}`,
    imagePatterns: [
      /src="(https:\/\/[^"]+nudiejeans[^"]+\.jpg[^"]*)"/i,
    ],
    keywords: ['nudie', 'nudie jeans']
  },
  {
    name: 'orSlow',
    searchUrl: (q: string) => `https://www.orslow.jp/search?q=${encodeURIComponent(q)}`,
    imagePatterns: [
      /src="(https:\/\/[^"]+orslow[^"]+\.jpg[^"]*)"/i,
    ],
    keywords: ['orslow', 'or slow']
  },
  // Bags & Accessories
  {
    name: 'Porter-Yoshida',
    searchUrl: (q: string) => `https://www.yoshidakaban.com/search?q=${encodeURIComponent(q)}`,
    imagePatterns: [
      /src="(https:\/\/[^"]+yoshida[^"]+\.jpg[^"]*)"/i,
    ],
    keywords: ['porter', 'porter-yoshida', 'yoshida', 'tanker']
  },
  {
    name: 'Topo Designs',
    searchUrl: (q: string) => `https://topodesigns.com/search?q=${encodeURIComponent(q)}`,
    imagePatterns: [
      /src="(https:\/\/cdn\.shopify\.com\/[^"]+)"/i,
    ],
    keywords: ['topo designs', 'topo']
  },
  {
    name: 'Cotopaxi',
    searchUrl: (q: string) => `https://www.cotopaxi.com/search?q=${encodeURIComponent(q)}`,
    imagePatterns: [
      /src="(https:\/\/[^"]+cotopaxi[^"]+\.jpg[^"]*)"/i,
    ],
    keywords: ['cotopaxi']
  },
  {
    name: 'Bellroy',
    searchUrl: (q: string) => `https://bellroy.com/search?q=${encodeURIComponent(q)}`,
    imagePatterns: [
      /src="(https:\/\/[^"]+bellroy[^"]+\.jpg[^"]*)"/i,
    ],
    keywords: ['bellroy']
  },
  // Eyewear
  {
    name: 'Warby Parker',
    searchUrl: (q: string) => `https://www.warbyparker.com/search?q=${encodeURIComponent(q)}`,
    imagePatterns: [
      /src="(https:\/\/[^"]+warbyparker[^"]+\.jpg[^"]*)"/i,
    ],
    keywords: ['warby parker', 'warby']
  },
  {
    name: 'Moscot',
    searchUrl: (q: string) => `https://moscot.com/search?q=${encodeURIComponent(q)}`,
    imagePatterns: [
      /src="(https:\/\/cdn\.shopify\.com\/[^"]+)"/i,
    ],
    keywords: ['moscot', 'lemtosh', 'miltzen']
  },
  {
    name: 'Garrett Leight',
    searchUrl: (q: string) => `https://www.garrettleight.com/search?q=${encodeURIComponent(q)}`,
    imagePatterns: [
      /src="(https:\/\/cdn\.shopify\.com\/[^"]+)"/i,
    ],
    keywords: ['garrett leight', 'glco']
  },
  // Jewelry / Small Accessories
  {
    name: 'Miansai',
    searchUrl: (q: string) => `https://www.miansai.com/search?q=${encodeURIComponent(q)}`,
    imagePatterns: [
      /src="(https:\/\/cdn\.shopify\.com\/[^"]+)"/i,
    ],
    keywords: ['miansai']
  },
  {
    name: 'Vitaly',
    searchUrl: (q: string) => `https://www.vitalydesign.com/search?q=${encodeURIComponent(q)}`,
    imagePatterns: [
      /src="(https:\/\/cdn\.shopify\.com\/[^"]+)"/i,
    ],
    keywords: ['vitaly']
  },
  // Athletic / Performance (more niche)
  {
    name: 'On Running',
    searchUrl: (q: string) => `https://www.on-running.com/en-us/search?q=${encodeURIComponent(q)}`,
    imagePatterns: [
      /src="(https:\/\/[^"]+on-running[^"]+\.jpg[^"]*)"/i,
    ],
    keywords: ['on running', 'on cloud', 'cloudmonster']
  },
  {
    name: 'Satisfy Running',
    searchUrl: (q: string) => `https://www.satisfyrunning.com/search?q=${encodeURIComponent(q)}`,
    imagePatterns: [
      /src="(https:\/\/cdn\.shopify\.com\/[^"]+)"/i,
    ],
    keywords: ['satisfy', 'satisfy running']
  },
  {
    name: 'District Vision',
    searchUrl: (q: string) => `https://districtvision.com/search?q=${encodeURIComponent(q)}`,
    imagePatterns: [
      /src="(https:\/\/cdn\.shopify\.com\/[^"]+)"/i,
    ],
    keywords: ['district vision']
  },
  // More Outdoor / Technical
  {
    name: 'Snow Peak',
    searchUrl: (q: string) => `https://www.snowpeak.com/search?q=${encodeURIComponent(q)}`,
    imagePatterns: [
      /src="(https:\/\/[^"]+snowpeak[^"]+\.jpg[^"]*)"/i,
    ],
    keywords: ['snow peak', 'snowpeak']
  },
  {
    name: 'And Wander',
    searchUrl: (q: string) => `https://www.andwander.com/search?q=${encodeURIComponent(q)}`,
    imagePatterns: [
      /src="(https:\/\/[^"]+andwander[^"]+\.jpg[^"]*)"/i,
    ],
    keywords: ['and wander']
  },
  {
    name: 'Goldwin',
    searchUrl: (q: string) => `https://www.goldwin.us/search?q=${encodeURIComponent(q)}`,
    imagePatterns: [
      /src="(https:\/\/[^"]+goldwin[^"]+\.jpg[^"]*)"/i,
    ],
    keywords: ['goldwin']
  },
  // Socks / Underwear DTC
  {
    name: 'Anonymous Ism',
    searchUrl: (q: string) => `https://anonymousism.com/search?q=${encodeURIComponent(q)}`,
    imagePatterns: [
      /src="(https:\/\/cdn\.shopify\.com\/[^"]+)"/i,
    ],
    keywords: ['anonymous ism']
  },
  {
    name: 'Stance',
    searchUrl: (q: string) => `https://www.stance.com/search?q=${encodeURIComponent(q)}`,
    imagePatterns: [
      /src="(https:\/\/[^"]+stance[^"]+\.jpg[^"]*)"/i,
    ],
    keywords: ['stance']
  },
]

// Find brand config by keyword match
function findBrandConfig(brandName: string, productName: string): typeof BRANDS[0] | null {
  const searchText = `${brandName} ${productName}`.toLowerCase()
  console.log(`[findBrand] Looking for brand in: "${searchText}"`)

  for (const brand of BRANDS) {
    const matchedKeyword = brand.keywords.find(kw => searchText.includes(kw))
    if (matchedKeyword) {
      console.log(`[findBrand] MATCH! Found "${matchedKeyword}" -> ${brand.name}`)
      return brand
    }
  }
  console.log(`[findBrand] NO MATCH found for: "${searchText}"`)
  return null
}

// Scrape product image from brand website
async function scrapeBrandImage(brand: typeof BRANDS[0], query: string): Promise<{ image: string | null, url: string }> {
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
      console.log(`[scrape] ${brand.name} failed with status: ${response.status}`)
      return { image: null, url: searchUrl }
    }

    const html = await response.text()
    console.log(`[scrape] ${brand.name} HTML length: ${html.length} chars`)

    // Check if we got a real page or redirect/block
    if (html.length < 1000) {
      console.log(`[scrape] ${brand.name} HTML too short, might be blocked. First 500 chars:`, html.substring(0, 500))
    }

    // Try each pattern
    for (let i = 0; i < brand.imagePatterns.length; i++) {
      const pattern = brand.imagePatterns[i]
      console.log(`[scrape] ${brand.name} trying pattern ${i}: ${pattern.toString().substring(0, 50)}...`)
      const match = html.match(pattern)
      if (match && match[1]) {
        let imageUrl = match[1]
        if (imageUrl.startsWith('//')) {
          imageUrl = 'https:' + imageUrl
        }
        imageUrl = imageUrl.replace(/&amp;/g, '&')
        console.log(`[scrape] ${brand.name} FOUND IMAGE with pattern ${i}: ${imageUrl.substring(0, 100)}...`)
        return { image: imageUrl, url: searchUrl }
      } else {
        console.log(`[scrape] ${brand.name} pattern ${i} no match`)
      }
    }

    // Log a sample of src attributes we DID find
    const srcMatches = html.match(/src="([^"]+)"/gi)?.slice(0, 5) || []
    console.log(`[scrape] ${brand.name} sample src attributes found:`, srcMatches)

    console.log(`[scrape] ${brand.name} NO IMAGE FOUND after trying all patterns`)
    return { image: null, url: searchUrl }
  } catch (error) {
    console.error(`[scrape] ${brand.name} EXCEPTION:`, error.message || error)
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
  console.log('[enrich] Starting enrichment for', suggestions.length, 'suggestions')
  console.log('[enrich] Raw AI suggestions:', JSON.stringify(suggestions, null, 2))

  const enriched = await Promise.all(
    suggestions.map(async (sug, index) => {
      const searchQuery = sug.searchQuery || sug.name
      const brandName = sug.brand || ''

      console.log(`[enrich ${index}] Processing: "${sug.name}"`)
      console.log(`[enrich ${index}] - brand from AI: "${brandName}"`)
      console.log(`[enrich ${index}] - searchQuery from AI: "${searchQuery}"`)
      console.log(`[enrich ${index}] - AI gave us these fields:`, Object.keys(sug))

      // Scrape image from brand website, get product URL
      const result = await scrapeProductImage(brandName, searchQuery)

      console.log(`[enrich ${index}] - scrape result: image=${result.image ? 'YES' : 'NULL'}, url=${result.url}`)

      return {
        ...sug,
        productUrl: result.url,
        productImage: result.image,
        vendor: sug.brand
      }
    })
  )

  console.log('[enrich] Final enriched suggestions:', JSON.stringify(enriched.map(s => ({
    name: s.name,
    brand: s.brand,
    productImage: s.productImage ? s.productImage.substring(0, 50) + '...' : null,
    productUrl: s.productUrl
  })), null, 2))

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
