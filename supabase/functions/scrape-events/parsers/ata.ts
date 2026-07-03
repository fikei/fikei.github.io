// Artists' Television Access (atasite.org/calendar) parser.
// WordPress with a server-rendered month table: cells contain
//   <strong>DAY</strong><br />8:00 pm <a class="calendarlink" href="...">Title</a>
// Month navigation via ?mm=M&yy=YYYY. Fetches the current and next month.

import { type ScrapedEvent, fetchUrl } from './utils.ts'
import type { EventSource } from '../sources.ts'

const MONTHS = ['january','february','march','april','may','june','july','august','september','october','november','december']

function to24h(time: string): string {
  const m = time.match(/(\d{1,2}):(\d{2})\s*(am|pm)/i)
  if (!m) return ''
  let h = parseInt(m[1], 10)
  const ampm = m[3].toLowerCase()
  if (ampm === 'pm' && h !== 12) h += 12
  if (ampm === 'am' && h === 12) h = 0
  return `${String(h).padStart(2, '0')}:${m[2]}`
}

function parseMonthPage(html: string, source: EventSource): ScrapedEvent[] {
  const events: ScrapedEvent[] = []

  const header = html.match(/class="calendar-month"[^>]*>([A-Za-z]+)(?:&nbsp;|\s)+(\d{4})/)
  if (!header) return events
  const month = MONTHS.indexOf(header[1].toLowerCase()) + 1
  const year = parseInt(header[2], 10)
  if (month === 0 || !year) return events

  const table = html.match(/<table class="calendar-block">([\s\S]*?)<\/table>/)
  if (!table) return events

  for (const cell of table[1].split(/<td[^>]*>/).slice(1)) {
    const dayMatch = cell.match(/<strong>(\d{1,2})<\/strong>/)
    if (!dayMatch) continue
    const day = parseInt(dayMatch[1], 10)
    const date = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`

    const entryRe = /(\d{1,2}:\d{2}\s*(?:am|pm))\s*<a class="calendarlink" href="([^"]+)"[^>]*>([^<]+)<\/a>/gi
    let m: RegExpExecArray | null
    while ((m = entryRe.exec(cell)) !== null) {
      events.push({
        source: source.id,
        date,
        time: to24h(m[1]),
        name: m[3].trim(),
        venue: 'ATA',
        address: '992 Valencia St',
        city: 'San Francisco',
        url: m[2],
        contentType: source.category,
      })
    }
  }
  return events
}

export async function scrapeAta(source: EventSource): Promise<ScrapedEvent[]> {
  const now = new Date()
  const next = new Date(now.getFullYear(), now.getMonth() + 1, 1)
  const base = source.url.replace(/\/+$/, '')

  const pages = await Promise.all([
    fetchUrl(`${base}/`),
    fetchUrl(`${base}/?mm=${next.getMonth() + 1}&yy=${next.getFullYear()}`),
  ])

  const all: ScrapedEvent[] = []
  for (const html of pages) all.push(...parseMonthPage(html, source))
  return all
}
