// Eventbrite organizer-page parser.
// Source URL is the org page (https://www.eventbrite.com/o/<slug>-<numeric-id>);
// events come from the public showmore JSON endpoint, no auth required:
//   GET https://www.eventbrite.com/org/{orgId}/showmore/?type=future&page_size=50&page=N
//
// Per PRD event-source-architecture §8.4 (resolved): class is assigned
// per-source, not per-platform — org pages with community signal are class
// 'venue'/'community' even though Eventbrite *search* is a demoted discovery
// feed. Only orgs that appeared in the Agape #events channel get registered.

import { type ScrapedEvent } from './utils.ts'
import type { EventSource } from '../sources.ts'

interface EbEvent {
  url?: string
  is_free?: boolean
  name?: { text?: string }
  start?: { local?: string }
  end?: { local?: string }
  venue?: {
    name?: string
    address?: { city?: string; localized_address_display?: string }
  }
  ticket_availability?: {
    minimum_ticket_price?: { major_value?: string; display?: string }
  }
}

export async function scrapeEventbriteOrg(source: EventSource): Promise<ScrapedEvent[]> {
  const idMatch = source.url.match(/(\d+)\/?$/)
  if (!idMatch) throw new Error(`eventbrite-org source URL must end in the numeric org id: ${source.url}`)
  const orgId = idMatch[1]

  const events: ScrapedEvent[] = []
  let page = 1
  const MAX_PAGES = 3 // 150 future events is plenty for any single org

  while (page <= MAX_PAGES) {
    const resp = await fetch(
      `https://www.eventbrite.com/org/${orgId}/showmore/?type=future&page_size=50&page=${page}`,
      { headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)' } },
    )
    if (!resp.ok) throw new Error(`Eventbrite org API ${resp.status} for org ${orgId}`)
    const data = await resp.json()
    const batch: EbEvent[] = data?.data?.events || []

    for (const e of batch) {
      const start = e.start?.local || ''
      if (!start || !e.name?.text) continue
      const price = e.is_free ? 'Free'
        : (e.ticket_availability?.minimum_ticket_price?.display || '')
      events.push({
        source: source.id,
        date: start.split('T')[0],
        time: (start.split('T')[1] || '').slice(0, 5),
        name: e.name.text,
        venue: e.venue?.name || source.name,
        address: e.venue?.address?.localized_address_display || '',
        city: e.venue?.address?.city || '',
        price,
        promoter: source.name,
        url: e.url || source.url,
        contentType: source.category,
      })
    }

    if (!data?.data?.has_next_page) break
    page++
  }

  return events
}
