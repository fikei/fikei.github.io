// iCal parser — text-based, no DOM needed
// Ported from events/index.html fetchIcal() + parseIcal()

import { type ScrapedEvent, fetchUrl, parseLocationString } from './utils.ts'
import type { EventSource } from '../sources.ts'

export async function scrapeIcal(source: EventSource): Promise<ScrapedEvent[]> {
  const text = await fetchUrl(source.url)
  return parseIcal(text, source.id, source.category)
}

function parseIcal(text: string, sourceId: string, category?: string): ScrapedEvent[] {
  // RFC 5545 line-unfolding: CRLF + (SPACE|TAB) continues the previous line.
  const unfolded = text.replace(/\r?\n[ \t]/g, '')

  const events: ScrapedEvent[] = []
  const blocks = unfolded.split('BEGIN:VEVENT')

  for (let i = 1; i < blocks.length; i++) {
    const block = blocks[i].split('END:VEVENT')[0]
    const get = (key: string) => {
      const re = new RegExp(key + '[^:]*:(.+)', 'i')
      const m = block.match(re)
      return m ? m[1].trim().replace(/\\n/g, ' ').replace(/\\,/g, ',') : ''
    }

    const dtstart = get('DTSTART')
    const loc = parseLocationString(get('LOCATION'))

    // URL: prefer URL field, else first https link in DESCRIPTION (Luma, etc.)
    const descRaw = get('DESCRIPTION')
    let url = get('URL')
    if (!url) {
      const m = descRaw.match(/https?:\/\/[^\s\\]+/)
      if (m) url = m[0]
    }
    // Strip the stock "Get up-to-date information at: <url>" preamble for cleaner text
    const description = descRaw
      .replace(/^Get up-to-date information at:\s*https?:\/\/\S+\s*/i, '')
      .trim()
      .slice(0, 1500)

    events.push({
      date: dtstart ? parseIcalDate(dtstart) : '',
      time: '',
      name: get('SUMMARY'),
      venue: loc.venue,
      address: loc.address,
      city: loc.city,
      genre: '', price: '', ages: '',
      url: url || '',
      description,
      source: sourceId,
      contentType: category,
    })
  }

  return events
}

function parseIcalDate(str: string): string {
  const clean = str.replace(/[^0-9T]/g, '')
  if (clean.length >= 8) return `${clean.substring(0, 4)}-${clean.substring(4, 6)}-${clean.substring(6, 8)}`
  return str
}
