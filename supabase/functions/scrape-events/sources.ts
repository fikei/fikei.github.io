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
  // Bay Area
  { id: '19hz-bayarea', name: '19hz', category: 'music', type: 'html', url: 'https://19hz.info/eventlisting_BayArea.php', region: 'bay-area', description: 'Electronic music & nightlife' },
  { id: 'ra-bayarea', name: 'Resident Advisor SF', category: 'music', type: 'ra', url: 'https://ra.co/events/us/sanfrancisco', region: 'bay-area', description: 'Electronic music events' },
  { id: 'sf-punchline', name: 'Punchline SF', category: 'comedy', type: 'html', url: 'https://www.punchlinecomedyclub.com/events', region: 'bay-area', description: 'Stand-up comedy' },
  { id: 'cobbs-sf', name: "Cobb's Comedy Club", category: 'comedy', type: 'html', url: 'https://www.cobbscomedy.com/events', region: 'bay-area', description: 'Comedy & variety' },
  { id: 'screenslate-sf', name: 'Screen Slate', category: 'film', type: 'screenslate', url: 'https://www.screenslate.com/listings', region: 'bay-area', description: 'Repertory & arthouse cinema' },
  // Los Angeles
  { id: '19hz-losangeles', name: '19hz Los Angeles', category: 'music', type: 'html', url: 'https://19hz.info/eventlisting_LosAngeles.php', region: 'los-angeles', description: 'Electronic music & nightlife' },
  // New York
  { id: '19hz-newyork', name: '19hz New York', category: 'music', type: 'html', url: 'https://19hz.info/eventlisting_NewYork.php', region: 'new-york', description: 'Electronic music & nightlife' },
  { id: 'screenslate-nyc', name: 'Screen Slate', category: 'film', type: 'screenslate', url: 'https://www.screenslate.com/listings', region: 'new-york', description: 'Repertory & arthouse cinema' },
  // Seattle
  { id: '19hz-seattle', name: '19hz Seattle', category: 'music', type: 'html', url: 'https://19hz.info/eventlisting_Seattle.php', region: 'seattle', description: 'Electronic music & nightlife' },
  // Bay Area — Tech & Networking
  { id: 'garysguide-sf', name: "Gary's Guide SF", category: 'tech', type: 'garysguide', url: 'https://www.garysguide.com/events?region=sf', region: 'bay-area', description: 'Tech & startup events' },
  { id: 'bonobo-sf', name: 'Bonobo Network', category: 'social', type: 'bonobo', url: 'https://www.bonobonetwork.com/events', region: 'bay-area', description: 'Social & community events' },
  // Bay Area — Art
  { id: 'sfmoma-events', name: 'SFMOMA', category: 'art', type: 'sfmoma', url: 'https://www.sfmoma.org/events/', region: 'bay-area', description: 'Museum events & artist talks' },
  { id: 'sfmoma-exhibitions', name: 'SFMOMA Exhibitions', category: 'art', type: 'sfmoma', url: 'https://www.sfmoma.org/exhibitions/', region: 'bay-area', description: 'Current & upcoming exhibitions' },
  { id: 'famsf-events', name: 'de Young / Legion of Honor', category: 'art', type: 'html', url: 'https://www.famsf.org/calendar', region: 'bay-area', description: 'Fine arts museum events' },
  // Bay Area — Design
  { id: 'sfdesignweek', name: 'SF Design Week', category: 'design', type: 'html', url: 'https://www.sfdesignweek.org/events', region: 'bay-area', description: 'Design talks, workshops & exhibitions' },
  // Bay Area — Literary
  { id: 'citylights-sf', name: 'City Lights Books', category: 'literary', type: 'html', url: 'https://citylights.com/events/', region: 'bay-area', description: 'Author readings & poetry events' },
  { id: 'sfpl-events', name: 'SF Public Library', category: 'literary', type: 'html', url: 'https://sfpl.org/events', region: 'bay-area', description: 'Library programs & author talks' },
  { id: 'commonwealthclub-sf', name: 'Commonwealth Club', category: 'literary', type: 'html', url: 'https://www.commonwealthclub.org/events', region: 'bay-area', description: 'Speaker events & public affairs' },
  // Bay Area — Sound Art
  { id: 'audium-sf', name: 'Audium', category: 'music', type: 'html', url: 'https://www.audium.org/calendar/', region: 'bay-area', description: 'Sound-sculptured space performances' },
  // New York — Tech & Networking
  { id: 'garysguide-nyc', name: "Gary's Guide NYC", category: 'tech', type: 'garysguide', url: 'https://www.garysguide.com/events?region=nyc', region: 'new-york', description: 'Tech & startup events' },
]
