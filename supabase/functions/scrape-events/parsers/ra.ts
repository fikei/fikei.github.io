// Resident Advisor GraphQL scraper
// Ported from events/index.html fetchRA()

import { type ScrapedEvent, fetchUrl } from './utils.ts'
import type { EventSource } from '../sources.ts'

const RA_AREAS: Record<string, number> = {
  sanfrancisco: 218, losangeles: 8, newyork: 9, seattle: 208,
}

export async function scrapeRA(source: EventSource): Promise<ScrapedEvent[]> {
  const today = new Date().toISOString().split('T')[0]
  const endDate = new Date(Date.now() + 14 * 86400000).toISOString().split('T')[0]

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

  const variables = {
    filters: { areas: { eq: areaId }, listingDate: { gte: today, lte: endDate } },
    filterOptions: { eventType: true, genre: true },
    page: 1, pageSize: 100,
  }

  // GraphQL API call — direct fetch with RA headers
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
    console.log(`[scrape-events] RA GraphQL errors: ${JSON.stringify(gqlData.errors.map((e: any) => e.message))}`)
  }

  const listings = gqlData?.data?.eventListings?.data || []
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
