// FAMSF (de Young / Legion of Honor) calendar parser
// Server-rendered Twill CMS with structured event cards

import { type ScrapedEvent, fetchUrl, parseHtml, parseFuzzyDate, resolveUrl } from './utils.ts'
import type { EventSource } from '../sources.ts'

export async function scrapeFamsf(source: EventSource): Promise<ScrapedEvent[]> {
  const html = await fetchUrl(source.url)
  const doc = parseHtml(html)
  if (!doc) return []

  const events: ScrapedEvent[] = []
  const cards = doc.querySelectorAll('div[data-behavior="BlockLink"]')

  cards.forEach((card: any) => {
    try {
      // Title + URL
      const titleLink = card.querySelector('h3 a[data-BlockLink-target], h3 a')
      if (!titleLink) return
      const name = (titleLink.textContent || '').replace(/\s+/g, ' ').trim()
      if (!name) return
      const url = resolveUrl(titleLink.getAttribute('href') || '', source.url)

      // Date — <time datetime="YYYY-MM-DD"> or text fallback
      const timeEl = card.querySelector('time[datetime]')
      let date = ''
      let time = ''

      if (timeEl) {
        date = timeEl.getAttribute('datetime') || ''
        if (!date) date = parseFuzzyDate((timeEl.textContent || '').trim())

        // Time is text after the backslash separator in the parent <p>
        const parentP = timeEl.parentElement
        if (parentP) {
          const fullText = (parentP.textContent || '').trim()
          const slashIdx = fullText.indexOf('\\')
          if (slashIdx !== -1) {
            time = fullText.substring(slashIdx + 1).trim()
          }
        }
      } else {
        // Recurring events — date is free text like "Tues–Sun \ Noon + 2 pm"
        const dateP = card.querySelector('p.order-3, p.f-body-1')
        if (dateP) {
          const text = (dateP.textContent || '').replace(/\s+/g, ' ').trim()
          const slashIdx = text.indexOf('\\')
          if (slashIdx !== -1) {
            date = parseFuzzyDate(text.substring(0, slashIdx).trim())
            time = text.substring(slashIdx + 1).trim()
          } else {
            date = parseFuzzyDate(text)
          }
        }
      }

      // Venue — badge class indicates which museum
      let venue = ''
      const dyBadge = card.querySelector('span.border-dy, span.text-dy')
      const lohBadge = card.querySelector('span.border-loh, span.text-loh')
      if (dyBadge) venue = 'de Young'
      else if (lohBadge) venue = 'Legion of Honor'
      else {
        // Fallback: read badge text
        const badge = card.querySelector('div.order-1 span')
        if (badge) venue = (badge.textContent || '').replace(/\s+/g, ' ').trim()
      }

      events.push({
        source: source.id,
        date,
        time,
        name,
        venue: venue || 'FAMSF',
        city: 'San Francisco',
        url,
        contentType: 'art',
      })
    } catch (_e) { /* skip broken card */ }
  })

  return events
}
