// JSON feed parser
// Ported from events/index.html fetchJson()

import { type ScrapedEvent, fetchUrl, parseLocationString } from './utils.ts'
import type { EventSource } from '../sources.ts'

export async function scrapeJson(source: EventSource): Promise<ScrapedEvent[]> {
  const text = await fetchUrl(source.url)
  const data = JSON.parse(text)

  const items = Array.isArray(data)
    ? data
    : (data.events || data.items || data.results || [])

  if (!Array.isArray(items) || items.length === 0) return []

  // Helper: unwrap WordPress {rendered: "..."} objects
  const unwrapWP = (v: any) => (v && typeof v === 'object' && v.rendered != null) ? v.rendered : v

  return items.map((item: any) => {
    const title = unwrapWP(item.name) || unwrapWP(item.title) || unwrapWP(item.summary) || ''
    const excerpt = unwrapWP(item.excerpt) || unwrapWP(item.description) || ''
    const loc = parseLocationString(item.location || item.venue || item.address || '')

    return {
      date: (item.date || item.start_date || item.startDate || item.start || '').substring(0, 10),
      time: item.time || '',
      name: typeof title === 'string' ? title.replace(/<[^>]*>/g, '').trim() : String(title),
      description: typeof excerpt === 'string' ? excerpt.replace(/<[^>]*>/g, '').trim() : '',
      venue: item.venue?.name || item.venue_name || loc.venue,
      address: item.venue?.address || item.address || loc.address,
      city: item.venue?.city || item.city || loc.city,
      genre: item.genre || item.category || '',
      price: item.price || item.cost || '',
      ages: item.ages || item.age_restriction || '',
      url: item.url || item.link || '',
      source: source.id,
    } as ScrapedEvent
  })
}
