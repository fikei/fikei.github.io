// Gary's Guide scraper — HTML table parsing
// Ported from events/index.html fetchGarysGuide()

import { type ScrapedEvent, fetchUrl, parseHtml, parseFuzzyDate } from './utils.ts'
import type { EventSource } from '../sources.ts'

export async function scrapeGarysGuide(source: EventSource): Promise<ScrapedEvent[]> {
  const text = await fetchUrl(source.url)
  const doc = parseHtml(text)
  if (!doc) return []

  const events: ScrapedEvent[] = []
  const baseUrl = 'https://www.garysguide.com'
  const seen = new Set<string>()

  // Strategy 1: Parse table rows containing .ftitle event links
  let currentDayDate = ''
  const allRows = doc.querySelectorAll('tr')

  allRows.forEach((tr: any) => {
    const tds = tr.querySelectorAll('td')
    if (!tds || tds.length === 0) return

    // Check for day header row
    const firstTdText = (tds[0]?.textContent || '').trim()
    const dayMatch = firstTdText.match(/(Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday),?\s+([\w]+\.?\s+\d{1,2})/i)
    if (dayMatch) {
      const parsed = parseFuzzyDate(dayMatch[2])
      if (parsed) currentDayDate = parsed
      return
    }

    // Look for event link
    const titleFont = tr.querySelector('.ftitle')
    const linkEl = titleFont ? titleFont.querySelector('a') : tr.querySelector('a[href*="/events/"]')
    if (!linkEl) return
    const href = linkEl.getAttribute('href') || ''
    if (!href.includes('/events/') || href.includes('?')) return
    const fullUrl = href.startsWith('http') ? href : baseUrl + href
    if (seen.has(fullUrl)) return
    seen.add(fullUrl)

    const name = (linkEl.textContent || '').trim()
    if (!name || name.length < 3) return

    // Extract venue and city from .fdescription
    let venue = '', city = ''
    const descFont = tr.querySelector('.fdescription')
    if (descFont) {
      const venueEl = descFont.querySelector('b')
      if (venueEl) venue = (venueEl.textContent || '').trim()
      const descText = (descFont.textContent || '').trim()
      const parts = descText.replace(venue, '').replace(/^[\s,]+/, '').split(',').map((s: string) => s.trim()).filter(Boolean)
      if (parts.length > 0) city = parts[parts.length - 1]
    }

    // Extract date and time from sibling td cells
    let date = currentDayDate || ''
    let time = ''
    for (const td of tds) {
      const tdText = (td.textContent || '').trim()
      const dateTimeMatch = tdText.match(/([\w]+\.?\s+\d{1,2})\s*(\d{1,2}:\d{2}\s*(am|pm)?)/i)
      if (dateTimeMatch) {
        const parsed = parseFuzzyDate(dateTimeMatch[1])
        if (parsed) date = parsed
        time = dateTimeMatch[2].trim()
        break
      }
      const dateOnly = tdText.match(/^([\w]+\.?\s+\d{1,2})$/)
      if (dateOnly) {
        const parsed = parseFuzzyDate(dateOnly[1])
        if (parsed) date = parsed
      }
      const timeOnly = tdText.match(/^(\d{1,2}:\d{2}\s*(am|pm)?)$/i)
      if (timeOnly) time = timeOnly[1].trim()
    }

    events.push({ date, time, name, venue, city, genre: 'Tech', url: fullUrl, source: source.id, contentType: 'tech' })
  })

  if (events.length > 0) return events

  // Strategy 2: Fallback — find all .ftitle links
  const ftitleLinks = doc.querySelectorAll('.ftitle a')
  ftitleLinks.forEach((link: any) => {
    const href = link.getAttribute('href') || ''
    if (!href.includes('/events/') || href.includes('?')) return
    const fullUrl = href.startsWith('http') ? href : baseUrl + href
    if (seen.has(fullUrl)) return
    seen.add(fullUrl)
    const name = (link.textContent || '').trim()
    if (!name || name.length < 3) return
    events.push({ date: '', time: '', name, venue: '', city: '', genre: 'Tech', url: fullUrl, source: source.id, contentType: 'tech' })
  })

  return events
}
