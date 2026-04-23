// Source registry — canonical list of stock event sources.
// Ported from events/index.html STOCK_SOURCES.

export interface EventSource {
  id: string
  name: string
  category: string
  type: string
  url: string
  region: string
  description: string
}

export const STOCK_SOURCES: EventSource[] = [
  // Bay Area — Music
  { id: '19hz-bayarea', name: '19hz', category: 'music', type: 'html', url: 'https://19hz.info/eventlisting_BayArea.php', region: 'bay-area', description: 'Electronic music & nightlife' },
  { id: 'ra-bayarea', name: 'Resident Advisor SF', category: 'music', type: 'ra', url: 'https://ra.co/events/us/sanfrancisco', region: 'bay-area', description: 'Electronic music events' },
  // Bay Area — Film
  { id: 'screenslate-sf', name: 'Screen Slate', category: 'film', type: 'screenslate', url: 'https://www.screenslate.com/listings', region: 'bay-area', description: 'Repertory & arthouse cinema' },
  // Los Angeles
  { id: '19hz-losangeles', name: '19hz Los Angeles', category: 'music', type: 'html', url: 'https://19hz.info/eventlisting_LosAngeles.php', region: 'los-angeles', description: 'Electronic music & nightlife' },
  // New York
  { id: 'screenslate-nyc', name: 'Screen Slate', category: 'film', type: 'screenslate', url: 'https://www.screenslate.com/listings', region: 'new-york', description: 'Repertory & arthouse cinema' },
  // Seattle
  { id: '19hz-seattle', name: '19hz Seattle', category: 'music', type: 'html', url: 'https://19hz.info/eventlisting_Seattle.php', region: 'seattle', description: 'Electronic music & nightlife' },
  // Bay Area — Tech & Networking
  { id: 'garysguide-sf', name: "Gary's Guide SF", category: 'tech', type: 'garysguide', url: 'https://www.garysguide.com/events?region=sf', region: 'bay-area', description: 'Tech & startup events' },
  // Bay Area — Social (Luma discover feed)
  { id: 'luma-sf', name: 'Luma SF', category: 'social', type: 'ical', url: 'https://api2.luma.com/ics/get?entity=discover&id=discplace-BDj7GNbGlsF7Cka', region: 'bay-area', description: "What's happening in San Francisco" },
  // New York — Tech & Networking
  { id: 'garysguide-nyc', name: "Gary's Guide NYC", category: 'tech', type: 'garysguide', url: 'https://www.garysguide.com/events?region=nyc', region: 'new-york', description: 'Tech & startup events' },
]

// Removed sources (unfixable server-side):
// - 19hz-newyork: 404 — page does not exist
// - sf-punchline: Next.js SPA, event data in RSC JSON hydration — needs headless browser
// - cobbs-sf: Next.js SPA, same as punchline — needs headless browser
// - citylights-sf: Sucuri WAF JS challenge blocks server-side fetch
// - audium-sf: WordPress ai1ec calendar plugin, JS-rendered — needs headless browser
// - sfdesignweek: No events until April 2026, Tribe Events plugin when live
