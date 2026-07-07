// Resident Advisor GraphQL scraper
// Ported from events/index.html fetchRA()

import { type ScrapedEvent, fetchUrl } from './utils.ts'
import type { EventSource } from '../sources.ts'

const RA_AREAS: Record<string, number> = {
  sanfrancisco: 218, losangeles: 8, newyork: 9, seattle: 208,
}

export async function scrapeRA(source: EventSource): Promise<ScrapedEvent[]> {
  // PT-local window: a UTC "today" is tomorrow after 5pm PT, which dropped
  // same-evening events from evening cron runs
  const fmt = new Intl.DateTimeFormat('sv-SE', { timeZone: 'America/Los_Angeles' })
  const today = fmt.format(new Date())
  // 120-day window — festivals and big bookings publish months out.
  // Politeness: paged 100/request with an inter-page delay; worst case is
  // 8 requests per scrape x 12 cron runs/day = ~96 req/day against ra.co.
  const endDate = fmt.format(new Date(Date.now() + 120 * 86400000))

  // Extract area slug from URL
  const urlParts = source.url.replace(/\/$/, '').split('/')
  const areaSlug = urlParts[urlParts.length - 1]
  const areaId = RA_AREAS[areaSlug] || 218

  const query = `query GET_DEFAULT_EVENTS_LISTING($filters: FilterInputDtoInput, $filterOptions: FilterOptionsInputDtoInput, $page: Int, $pageSize: Int) {
    eventListings(filters: $filters, filterOptions: $filterOptions, page: $page, pageSize: $pageSize) {
      data {
        id listingDate
        event {
          id title date startTime endTime contentUrl
          venue { id name area { id name } }
          artists { id name }
        }
      }
      totalResults
    }
  }`

  // Paginate: 120 days of a metro area overflows several pages of 100
  const MAX_PAGES = 8
  const listings: any[] = []
  for (let page = 1; page <= MAX_PAGES; page++) {
    // Inter-page delay keeps us far from RA's rate limits / bot heuristics
    if (page > 1) await new Promise(r => setTimeout(r, 800))
    const variables = {
      filters: { areas: { eq: areaId }, listingDate: { gte: today, lte: endDate } },
      filterOptions: { eventType: true, genre: true },
      page, pageSize: 100,
    }

    const text = await fetchUrl('https://ra.co/graphql', {
      method: 'POST',
      body: JSON.stringify({ query, variables }),
      headers: {
        'Content-Type': 'application/json',
        'Referer': `https://ra.co/events/us/${areaSlug}`,
        'Origin': 'https://ra.co',
      },
    })

    const gqlData = JSON.parse(text)
    if (gqlData.errors) {
      console.log(`[scrape-events] RA GraphQL errors (page ${page}): ${JSON.stringify(gqlData.errors.map((e: any) => e.message))}`)
      break
    }
    const batch = gqlData?.data?.eventListings?.data || []
    listings.push(...batch)
    const total = gqlData?.data?.eventListings?.totalResults
    if (batch.length < 100 || (typeof total === 'number' && listings.length >= total)) break
  }
  console.log(`[scrape-events] RA ${areaSlug}: ${listings.length} listings over 120d window`)
  if (listings.length === 0) return []

  return listings.map((listing: any) => {
    const ev = listing.event
    if (!ev) return null

    let date = '', time = ''
    if (ev.startTime) {
      const d = new Date(ev.startTime)
      date = d.toISOString().split('T')[0]
      const h = d.getHours(), m = d.getMinutes()
      if (h !== 0 || m !== 0) time = h.toString().padStart(2, '0') + ':' + m.toString().padStart(2, '0')
    } else if (ev.date) {
      date = ev.date.split('T')[0]
    }

    return {
      date, time,
      name: ev.title || '',
      venue: ev.venue?.name || '',
      city: ev.venue?.area?.name || '',
      genre: 'Electronic',
      url: ev.contentUrl ? 'https://ra.co' + ev.contentUrl : '',
      source: source.id,
      contentType: 'music',
    } as ScrapedEvent
  }).filter(Boolean) as ScrapedEvent[]
}
