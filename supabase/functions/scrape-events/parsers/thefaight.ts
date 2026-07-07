// The Faight Collective (thefaight.com/events) parser.
// Server-rendered event cards:
//   <div id="slug" class="event-card">…>JUL<…>7<…class="event-title">Open Mic<
//   …class="event-time">6:00 PM – 10:00 PM…>downstairs<
// Dates carry no year — infer the nearest future occurrence (a month more
// than one month in the past rolls to next year).

import { type ScrapedEvent, fetchUrl } from './utils.ts'
import type { EventSource } from '../sources.ts'

const MONTHS: Record<string, number> = {
  JAN: 1, FEB: 2, MAR: 3, APR: 4, MAY: 5, JUN: 6,
  JUL: 7, AUG: 8, SEP: 9, OCT: 10, NOV: 11, DEC: 12,
}

function to24h(time: string): string {
  const m = time.match(/(\d{1,2})(?::(\d{2}))?\s*(AM|PM)/i)
  if (!m) return ''
  let h = parseInt(m[1], 10)
  const mins = m[2] || '00'
  const ampm = m[3].toUpperCase()
  if (ampm === 'PM' && h !== 12) h += 12
  if (ampm === 'AM' && h === 12) h = 0
  return `${String(h).padStart(2, '0')}:${mins}`
}

export async function scrapeTheFaight(source: EventSource): Promise<ScrapedEvent[]> {
  const html = await fetchUrl(source.url, {
    headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36' },
  })

  // PT-local "now" for year inference
  const now = new Date(new Intl.DateTimeFormat('sv-SE', { timeZone: 'America/Los_Angeles' }).format(new Date()) + 'T00:00:00')

  const events: ScrapedEvent[] = []
  const blocks = html.split(/(?=<div id="[\w-]+" class="event-card")/).slice(1)

  for (const raw of blocks) {
    const block = raw.replace(/<svg[\s\S]*?<\/svg>/g, '')
    const id = block.match(/^<div id="([\w-]+)"/)?.[1] || ''
    const title = block.match(/class="event-title"[^>]*>([\s\S]*?)<\//)?.[1]
    const dateM = block.match(/>(JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)<[\s\S]*?>(\d{1,2})</)
    if (!title || !dateM) continue

    const month = MONTHS[dateM[1]]
    const day = parseInt(dateM[2], 10)
    // Nearest future year: if the date is more than a month behind PT-today,
    // it belongs to next year
    let year = now.getFullYear()
    const candidate = new Date(year, month - 1, day)
    if (candidate.getTime() < now.getTime() - 35 * 86400000) year += 1
    const date = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`

    // "6:00 PM – 10:00 PM" → start time; keep full range in the string
    const timeM = block.match(/class="event-time"[^>]*>([\s\S]*?)<\//)
    const timeText = timeM ? timeM[1].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim() : ''
    const startM = timeText.match(/(\d{1,2}(?::\d{2})?\s*(?:AM|PM))/i)

    events.push({
      source: source.id,
      date,
      time: startM ? to24h(startM[1]) : '',
      name: title.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim(),
      venue: 'The Faight Collective',
      address: '475 Haight St',
      city: 'San Francisco',
      url: `https://www.thefaight.com/events#${id}`,
      contentType: 'social',
    })
  }

  console.log(`[scrape-events] thefaight: ${events.length} events parsed`)
  return events
}
