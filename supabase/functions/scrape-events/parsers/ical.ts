// iCal parser — text-based, no DOM needed
// Ported from events/index.html fetchIcal() + parseIcal()

import { type ScrapedEvent, fetchUrl, parseLocationString } from './utils.ts'
import type { EventSource } from '../sources.ts'

// UTC iCal timestamps (Luma publishes DTSTART:...Z) must be converted to the
// source region's timezone — naively slicing the date put every evening event
// on the next day and dropped the time entirely.
const REGION_TZ: Record<string, string> = {
  'bay-area': 'America/Los_Angeles',
  'los-angeles': 'America/Los_Angeles',
  'seattle': 'America/Los_Angeles',
  'new-york': 'America/New_York',
}

export async function scrapeIcal(source: EventSource): Promise<ScrapedEvent[]> {
  const text = await fetchUrl(source.url)
  const tz = REGION_TZ[source.region] || 'America/Los_Angeles'
  return parseIcal(text, source.id, source.category, tz)
}

function icalToLocal(raw: string, tz: string): { date: string; time: string } {
  const clean = raw.replace(/[^0-9TZ]/g, '')
  const m = clean.match(/^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})?(Z)?)?/)
  if (!m) return { date: '', time: '' }
  const [, y, mo, d, hh, mm, ss, z] = m
  if (!hh) return { date: `${y}-${mo}-${d}`, time: '' } // all-day
  if (!z) return { date: `${y}-${mo}-${d}`, time: `${hh}:${mm}` } // TZID/floating: already local
  const utc = new Date(Date.UTC(+y, +mo - 1, +d, +hh, +mm, +(ss || 0)))
  // sv-SE formats as "YYYY-MM-DD HH:MM"
  const local = new Intl.DateTimeFormat('sv-SE', {
    timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false,
  }).format(utc)
  const [date, time] = local.split(' ')
  return { date, time: time || '' }
}

function parseIcal(text: string, sourceId: string, category: string | undefined, tz: string): ScrapedEvent[] {
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
    const { date: startDate, time: startTime } = dtstart ? icalToLocal(dtstart, tz) : { date: '', time: '' }
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
      date: startDate,
      time: startTime,
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

