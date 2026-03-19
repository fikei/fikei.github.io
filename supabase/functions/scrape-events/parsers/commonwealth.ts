// Commonwealth Club events parser
// Server-rendered Drupal with node--type-event teaser cards

import { type ScrapedEvent, fetchUrl, parseHtml, parseFuzzyDate, resolveUrl } from './utils.ts'
import type { EventSource } from '../sources.ts'

export async function scrapeCommonwealth(source: EventSource): Promise<ScrapedEvent[]> {
  const html = await fetchUrl(source.url)
  const doc = parseHtml(html)
  if (!doc) return []

  const events: ScrapedEvent[] = []
  const nodes = doc.querySelectorAll('.node--type-event.node--view-mode-teaser')

  nodes.forEach((node: any) => {
    try {
      // Title + URL
      const titleLink = node.querySelector('.field--name-node-title h3 a')
      if (!titleLink) return
      const name = (titleLink.textContent || '').replace(/\s+/g, ' ').trim()
      if (!name) return
      const url = resolveUrl(titleLink.getAttribute('href') || '', source.url)

      // Date + Time — "Thu, Mar 19 / 7:00 PM PDT"
      const dateEl = node.querySelector('.field--name-field-event-date')
      let date = ''
      let time = ''
      if (dateEl) {
        const raw = (dateEl.textContent || '').replace(/\s+/g, ' ').trim()
        const parsed = parseCommonwealthDate(raw)
        date = parsed.date
        time = parsed.time
      }

      // Venue/Region — "San Francisco", "San Rafael", etc.
      const regionEl = node.querySelector('.field--name-field-region .field__item')
      const venue = regionEl
        ? 'Commonwealth Club — ' + (regionEl.textContent || '').replace(/\s+/g, ' ').trim()
        : 'Commonwealth Club'

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
    } catch (_e) { /* skip broken node */ }
  })

  return events
}

/** Parse "Thu, Mar 19 / 7:00 PM PDT" or "Tue, Apr 1 / 12:00 PM PDT" */
function parseCommonwealthDate(raw: string): { date: string; time: string } {
  // Split on "/" separator
  const slashIdx = raw.indexOf('/')
  if (slashIdx !== -1) {
    const datePart = raw.substring(0, slashIdx).trim()
    const timePart = raw.substring(slashIdx + 1).replace(/[A-Z]{2,4}$/, '').trim() // strip timezone
    return { date: parseFuzzyDate(datePart), time: timePart }
  }
  return { date: parseFuzzyDate(raw), time: '' }
}
