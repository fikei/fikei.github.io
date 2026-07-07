// SeeTickets WordPress-widget parser.
// Venues on the SeeTickets WP plugin (The Chapel, Rickshaw Stop, ...) server-
// render complete event cards — earlier verification misread them as JS-only:
//   <p class="... title"><a href="https://wl.seetickets.us/event/...">Name</a></p>
//   <p class="... date">Sat Nov 14</p>
//   ... doortime/showtime spans, ages, price, genre, headliners
// Dates have no year: infer current year, rolling forward if >45 days past.

import { type ScrapedEvent, fetchUrl } from './utils.ts'
import type { EventSource } from '../sources.ts'

const MONTHS: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
  jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
}

function ptToday(): Date {
  const s = new Intl.DateTimeFormat('sv-SE', { timeZone: 'America/Los_Angeles' }).format(new Date())
  return new Date(s + 'T00:00:00')
}

function inferDate(monthName: string, day: number): string {
  const month = MONTHS[monthName.toLowerCase().slice(0, 3)]
  if (!month) return ''
  const today = ptToday()
  let year = today.getFullYear()
  const candidate = new Date(year, month - 1, day)
  // A listing more than ~45 days in the past is next year's show
  if ((today.getTime() - candidate.getTime()) / 86400000 > 45) year += 1
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

function to24h(time: string): string {
  const m = time.match(/(\d{1,2})(?::(\d{2}))?\s*(AM|PM)/i)
  if (!m) return ''
  let h = parseInt(m[1], 10)
  if (m[3].toUpperCase() === 'PM' && h !== 12) h += 12
  if (m[3].toUpperCase() === 'AM' && h === 12) h = 0
  return `${String(h).padStart(2, '0')}:${m[2] || '00'}`
}

function textOf(cardHtml: string, cls: string): string {
  const m = cardHtml.match(new RegExp(`class="[^"]*\\b${cls}\\b[^"]*"[^>]*>([\\s\\S]*?)</p>`))
  if (!m) return ''
  return m[1].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
}

export async function scrapeSeeticketsWp(source: EventSource): Promise<ScrapedEvent[]> {
  const html = await fetchUrl(source.url)
  const events: ScrapedEvent[] = []

  // Cards start at the content container; split and parse each segment
  const segments = html.split('seetickets-list-event-content-container').slice(1)
  const seen = new Set<string>()

  for (const seg of segments) {
    const card = seg.slice(0, 4000)
    const titleM = card.match(/class="[^"]*\btitle\b[^"]*"[^>]*>\s*<a href="(https:\/\/wl\.(?:seetickets|eventim)\.us\/event\/[^"]+)"[^>]*>([\s\S]*?)<\/a>/)
    const dateM = textOf(card, 'date').match(/([A-Za-z]{3,9})\s+(\d{1,2})/)
    if (!titleM || !dateM) continue

    const url = titleM[1].split('?')[0]
    const name = titleM[2].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
    const date = inferDate(dateM[1], parseInt(dateM[2], 10))
    if (!name || !date) continue

    const key = `${date}|${name}`
    if (seen.has(key)) continue
    seen.add(key)

    const showM = card.match(/class="see-showtime[^"]*"[^>]*>([^<]+)</)
    const doorM = card.match(/class="see-doortime[^"]*"[^>]*>([^<]+)</)
    const time = to24h((showM?.[1] || doorM?.[1] || '').trim())
    const agesM = card.match(/class="ages"[^>]*>([^<]+)</)
    const priceM = card.match(/class="price"[^>]*>([^<]+)</)
    const genre = textOf(card, 'genre')
    const promoter = textOf(card, 'header')

    events.push({
      source: source.id,
      date,
      time,
      name,
      venue: source.name,
      city: 'San Francisco',
      genre,
      price: (priceM?.[1] || '').trim(),
      ages: (agesM?.[1] || '').trim(),
      promoter,
      url,
      contentType: source.category,
    })
  }

  return events
}
