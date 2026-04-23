// iCal parser — text-based, no DOM needed
// Ported from events/index.html fetchIcal() + parseIcal()

import { type ScrapedEvent, fetchUrl, parseLocationString } from './utils.ts'
import type { EventSource } from '../sources.ts'

export async function scrapeIcal(source: EventSource): Promise<ScrapedEvent[]> {
  const text = await fetchUrl(source.url)
  return parseIcal(text, source.id)
}

function parseIcal(text: string, sourceId: string): ScrapedEvent[] {
  const events: ScrapedEvent[] = []
  const blocks = text.split('BEGIN:VEVENT')

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
    let url = get('URL')
    if (!url) {
      const desc = get('DESCRIPTION')
      const m = desc.match(/https?:\/\/[^\s\\]+/)
      if (m) url = m[0]
    }

    events.push({
      date: dtstart ? parseIcalDate(dtstart) : '',
      time: '',
      name: get('SUMMARY'),
      venue: loc.venue,
      address: loc.address,
      city: loc.city,
      genre: '', price: '', ages: '',
      url: url || '',
      source: sourceId,
    })
  }

  return events
}

function parseIcalDate(str: string): string {
  const clean = str.replace(/[^0-9T]/g, '')
  if (clean.length >= 8) return `${clean.substring(0, 4)}-${clean.substring(4, 6)}-${clean.substring(6, 8)}`
  return str
}
