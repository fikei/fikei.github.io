// Bonobo Network scraper (Squarespace)
// Ported from events/index.html fetchBonobo()

import { type ScrapedEvent, fetchUrl, parseHtml, parseFuzzyDate } from './utils.ts'
import type { EventSource } from '../sources.ts'

export async function scrapeBonobo(source: EventSource): Promise<ScrapedEvent[]> {
  const baseUrl = 'https://www.bonobonetwork.com'

  // Strategy 1: Squarespace JSON endpoint
  try {
    const jsonUrl = source.url + (source.url.includes('?') ? '&' : '?') + 'format=json'
    const text = await fetchUrl(jsonUrl)
    const data = JSON.parse(text)
    const items = data.items || data.upcoming || []
    if (items.length > 0) {
      return items.map((item: any) => {
        const name = item.title || ''
        if (!name) return null
        const startMs = item.startDate
        let date = '', time = ''
        if (startMs) {
          const d = new Date(startMs)
          date = d.toISOString().split('T')[0]
          const hours = d.getHours().toString().padStart(2, '0')
          const mins = d.getMinutes().toString().padStart(2, '0')
          if (hours !== '00' || mins !== '00') time = hours + ':' + mins
        }
        const venue = item.location?.addressTitle || item.location?.addressLine1 || ''
        const city = item.location?.addressLine2 || ''
        const url = item.fullUrl ? baseUrl + item.fullUrl : (item.sourceUrl || '')
        return {
          date, time, name, venue, city, genre: '', url,
          source: source.id, contentType: 'social',
        } as ScrapedEvent
      }).filter(Boolean) as ScrapedEvent[]
    }
  } catch (e) {
    console.log(`[scrape-events] Bonobo JSON failed: ${(e as Error).message}`)
  }

  // Strategy 2: Fetch HTML and parse
  const text = await fetchUrl(source.url)
  const doc = parseHtml(text)
  if (!doc) return []

  const events: ScrapedEvent[] = []

  // Strategy 2a: JSON-LD
  const ldScripts = doc.querySelectorAll('script[type="application/ld+json"]')
  ldScripts.forEach((script: any) => {
    try {
      const data = JSON.parse(script.textContent || '')
      const items = Array.isArray(data) ? data : (data['@graph'] || [data])
      items.forEach((item: any) => {
        if (!item['@type'] || !['Event', 'SocialEvent'].includes(item['@type'])) return
        const name = item.name || ''
        const startDate = item.startDate || ''
        if (!name || !startDate) return
        const d = new Date(startDate)
        const date = d.toISOString().split('T')[0]
        const hours = d.getHours().toString().padStart(2, '0')
        const mins = d.getMinutes().toString().padStart(2, '0')
        const time = (hours !== '00' || mins !== '00') ? hours + ':' + mins : ''
        events.push({
          date, time, name,
          venue: item.location?.name || '',
          city: item.location?.address?.addressLocality || '',
          genre: '', url: item.url || '',
          source: source.id, contentType: 'social',
        })
      })
    } catch (_e) { /* ignore */ }
  })

  if (events.length > 0) return events

  // Strategy 2b: Squarespace HTML structure
  const eventEls = doc.querySelectorAll('.eventlist-event, [class*="eventlist"], [class*="summary-item"], article[class*="event"], [data-type="events"] article')
  eventEls.forEach((el: any) => {
    const titleEl = el.querySelector('.eventlist-title a, [class*="title"] a, h1 a, h2 a, h3 a')
    const dateEl = el.querySelector('time, .event-date, [class*="date"], [datetime]')

    const name = titleEl?.textContent?.trim() || el.querySelector('h1, h2, h3')?.textContent?.trim() || ''
    if (!name) return

    let date = '', time = ''
    const dateAttr = dateEl?.getAttribute('datetime') || dateEl?.textContent?.trim() || ''
    if (dateAttr) {
      try {
        const d = new Date(dateAttr)
        if (!isNaN(d.getTime())) {
          date = d.toISOString().split('T')[0]
          const hours = d.getHours().toString().padStart(2, '0')
          const mins = d.getMinutes().toString().padStart(2, '0')
          if (hours !== '00' || mins !== '00') time = hours + ':' + mins
        }
      } catch (_e) { /* ignore */ }
    }
    if (!date) {
      const parsed = parseFuzzyDate(dateAttr)
      if (parsed) date = parsed
    }

    const href = titleEl?.getAttribute('href') || ''
    const url = href.startsWith('http') ? href : (href ? baseUrl + href : '')

    events.push({ date: date || '', time, name, venue: '', city: '', genre: '', url, source: source.id, contentType: 'social' })
  })

  return events
}
