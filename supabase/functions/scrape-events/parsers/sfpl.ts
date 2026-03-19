// SF Public Library events parser
// Server-rendered Drupal with article.event--teaser cards

import { type ScrapedEvent, fetchUrl, parseHtml, parseFuzzyDate, resolveUrl } from './utils.ts'
import type { EventSource } from '../sources.ts'

export async function scrapeSfpl(source: EventSource): Promise<ScrapedEvent[]> {
  const html = await fetchUrl(source.url, { timeoutMs: 20000 })
  const doc = parseHtml(html)
  if (!doc) return []

  const events: ScrapedEvent[] = []
  const articles = doc.querySelectorAll('article.event--teaser')

  articles.forEach((article: any) => {
    try {
      // Title
      const titleLink = article.querySelector('h2.event__title a, h3.event__title a')
      if (!titleLink) return
      const name = (titleLink.textContent || '').replace(/\s+/g, ' ').trim()
      if (!name) return

      // URL — prefer article[about] for canonical path
      const aboutPath = article.getAttribute('about') || ''
      const hrefPath = titleLink.getAttribute('href') || ''
      const url = resolveUrl(aboutPath || hrefPath, source.url)

      // Date + Time — "Thursday, 3/19/2026, 9:00 - 6:00"
      const dateEl = article.querySelector('span.date-display-range, .event__date .field__item')
      let date = ''
      let time = ''
      if (dateEl) {
        const raw = (dateEl.textContent || '').replace(/\s+/g, ' ').trim()
        const parsed = parseSfplDate(raw)
        date = parsed.date
        time = parsed.time
      }

      // Venue
      const venueEl = article.querySelector('a.location--short-label, .event__location .field--name-name')
      const venue = venueEl ? (venueEl.textContent || '').replace(/\s+/g, ' ').trim() : 'SF Public Library'

      events.push({
        source: source.id,
        date,
        time,
        name,
        venue,
        city: 'San Francisco',
        url,
        contentType: 'literary',
      })
    } catch (_e) { /* skip broken article */ }
  })

  return events
}

/** Parse SFPL date format: "Thursday, 3/19/2026, 9:00 - 6:00" or "Wednesday, 3/19/2026" */
function parseSfplDate(raw: string): { date: string; time: string } {
  // Try "Weekday, M/D/YYYY, TIME"
  const match = raw.match(/\w+,\s*(\d{1,2})\/(\d{1,2})\/(\d{4})(?:,\s*(.+))?/)
  if (match) {
    const month = match[1].padStart(2, '0')
    const day = match[2].padStart(2, '0')
    const year = match[3]
    const time = (match[4] || '').trim()
    return { date: `${year}-${month}-${day}`, time }
  }

  // Fallback
  return { date: parseFuzzyDate(raw), time: '' }
}
