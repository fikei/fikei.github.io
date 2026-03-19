// RSS/Atom feed parser
// Ported from events/index.html fetchRss()
// Note: deno-dom doesn't fully support text/xml, so we parse as text/html
// and use regex fallbacks for RSS-specific elements.

import { type ScrapedEvent, fetchUrl, parseHtml, extractLocationFromHtml } from './utils.ts'
import type { EventSource } from '../sources.ts'

export async function scrapeRss(source: EventSource): Promise<ScrapedEvent[]> {
  const text = await fetchUrl(source.url)

  // Try DOM parsing first (works for well-formed RSS that deno-dom can handle)
  const doc = parseHtml(text)
  const events: ScrapedEvent[] = []

  if (doc) {
    let items = doc.querySelectorAll('item')
    if (!items || items.length === 0) items = doc.querySelectorAll('entry')

    if (items && items.length > 0) {
      items.forEach((item: any) => {
        const getText = (tag: string) => {
          const el = item.querySelector(tag)
          return el ? (el.textContent || '').trim() : ''
        }

        const pubDate = getText('pubDate') || getText('published') || getText('updated') || ''
        const description = getText('description') || getText('content') || getText('summary') || ''
        const loc = extractLocationFromHtml(description)

        let date = ''
        if (pubDate) {
          try { date = new Date(pubDate).toISOString().split('T')[0] }
          catch (_e) { date = pubDate.substring(0, 10) }
        }

        const linkEl = item.querySelector('link')
        const link = getText('link') || linkEl?.getAttribute('href') || ''

        events.push({
          date, time: '',
          name: getText('title'),
          venue: loc.venue, address: loc.address, city: loc.city,
          genre: '', price: '', ages: '',
          url: link,
          source: source.id,
        })
      })

      return events
    }
  }

  // Regex fallback for RSS items if DOM parsing didn't find any
  const itemRegex = /<item>([\s\S]*?)<\/item>/gi
  let match
  while ((match = itemRegex.exec(text)) !== null) {
    const itemXml = match[1]
    const getTag = (tag: string) => {
      const m = itemXml.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, 'i'))
      return m ? m[1].replace(/<!\[CDATA\[|\]\]>/g, '').trim() : ''
    }

    const pubDate = getTag('pubDate') || getTag('published')
    let date = ''
    if (pubDate) {
      try { date = new Date(pubDate).toISOString().split('T')[0] }
      catch (_e) { date = pubDate.substring(0, 10) }
    }

    const description = getTag('description') || getTag('content:encoded')
    const loc = extractLocationFromHtml(description)

    events.push({
      date, time: '',
      name: getTag('title'),
      venue: loc.venue, address: loc.address, city: loc.city,
      genre: '', price: '', ages: '',
      url: getTag('link'),
      source: source.id,
    })
  }

  return events
}
