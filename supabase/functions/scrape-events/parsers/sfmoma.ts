// SFMOMA scraper — HTML parsing
// Ported from events/index.html fetchSFMOMA()

import { type ScrapedEvent, fetchUrl, parseHtml } from './utils.ts'
import type { EventSource } from '../sources.ts'

export async function scrapeSFMOMA(source: EventSource): Promise<ScrapedEvent[]> {
  const text = await fetchUrl(source.url)
  const doc = parseHtml(text)
  if (!doc) return []

  const today = new Date().toISOString().split('T')[0]
  const isExhibitions = source.url.includes('/exhibitions')

  if (isExhibitions) {
    return parseExhibitions(doc, source, today)
  } else {
    return parseEvents(doc, source, today)
  }
}

function parseExhibitions(doc: any, source: EventSource, today: string): ScrapedEvent[] {
  const items = doc.querySelectorAll('.exhibitionsgrid-wrapper-grid-item[href*="/exhibition/"]')
  const events: ScrapedEvent[] = []

  items.forEach((item: any) => {
    const title = item.querySelector('.exhibitionsgrid-wrapper-grid-item-text-title')?.textContent?.trim() || ''
    const dateText = item.querySelector('.exhibitionsgrid-wrapper-grid-item-text-date')?.textContent?.trim() || ''
    const desc = item.querySelector('.exhibitionsgrid-wrapper-grid-item-text-desc')?.textContent?.trim() || ''
    const location = item.querySelector('.exhibitionsgrid-wrapper-grid-item-location')?.textContent?.trim() || ''
    const url = item.getAttribute('href') || ''
    const fullUrl = url.startsWith('http') ? url : 'https://www.sfmoma.org' + url

    const parsed = parseSFMOMADate(dateText)
    if (!parsed.date) return

    // Skip past exhibitions
    if (parsed.endDate && parsed.endDate < today) return

    events.push({
      date: parsed.date,
      endDate: parsed.endDate || '',
      time: '',
      name: title,
      description: desc,
      venue: location ? 'SFMOMA ' + location : 'SFMOMA',
      city: 'San Francisco',
      url: fullUrl,
      source: source.id,
      contentType: 'exhibition',
    })
  })

  return events
}

function parseEvents(doc: any, source: EventSource, today: string): ScrapedEvent[] {
  const items = doc.querySelectorAll('.archive--grid-wrapper-grid-item-link')
  const events: ScrapedEvent[] = []

  items.forEach((item: any) => {
    const title = item.querySelector('.archive--grid-wrapper-grid-item-text-title')?.textContent?.trim() || ''
    const subtitle = item.querySelector('.archive--grid-wrapper-grid-item-text-subtitle')?.textContent?.trim() || ''
    const supertitle = item.querySelector('.archive--grid-wrapper-grid-item-text-supertitle')?.textContent?.trim() || ''
    const url = item.getAttribute('href') || ''
    const fullUrl = url.startsWith('http') ? url : 'https://www.sfmoma.org' + url

    const parsed = parseSFMOMADate(subtitle)
    if (!parsed.date) return

    const eventEnd = parsed.endDate || parsed.date
    if (eventEnd < today) return

    let contentType = 'art'
    const st = supertitle.toLowerCase()
    if (st.includes('film') || st.includes('screening')) contentType = 'film'

    events.push({
      date: parsed.date,
      endDate: parsed.endDate || '',
      time: parsed.time || '',
      name: title,
      venue: 'SFMOMA',
      city: 'San Francisco',
      url: fullUrl,
      source: source.id,
      contentType,
      genre: supertitle || '',
    })
  })

  return events
}

function parseSFMOMADate(dateText: string): { date: string; endDate: string; time: string; isAllDay: boolean } {
  const text = (dateText || '').replace(/\u2013|\u2014|&ndash;|&mdash;/g, '\u2013').trim()

  // "Ongoing"
  if (/^ongoing$/i.test(text)) {
    const today = new Date().toISOString().split('T')[0]
    return { date: today, endDate: '', time: '', isAllDay: true }
  }

  // "Closing Apr 19, 2026"
  const closingMatch = text.match(/^closing\s+(.+)$/i)
  if (closingMatch) {
    const end = parseSimpleDate(closingMatch[1])
    const today = new Date().toISOString().split('T')[0]
    return { date: today, endDate: end || '', time: '', isAllDay: true }
  }

  // "Opened Jan 17, 2026"
  const openedMatch = text.match(/opened\s+(.+)$/i)
  if (openedMatch) {
    const start = parseSimpleDate(openedMatch[1])
    return { date: start || '', endDate: '', time: '', isAllDay: true }
  }

  const rangeText = text.replace(/\s*\(.*?\)\s*/g, '').trim()
  const rangeParts = rangeText.split('\u2013')

  // Events page: "Thursday, Mar 12, 2026 | 6 p.m."
  const timeSplit = text.split('|')
  const datePart = timeSplit[0].replace(/\s*\(.*?\)\s*/g, '').trim()
  const timePart = timeSplit.length > 1 ? timeSplit[1].trim() : ''

  // Multi-day event: "Thursday, Mar 12–Friday, Mar 13, 2026 | 10 a.m."
  const multiDayMatch = datePart.match(/^(?:\w+,\s+)?(\w+\s+\d+)\s*\u2013\s*(?:\w+,\s+)?(\w+\s+\d+),?\s+(\d{4})$/)
  if (multiDayMatch) {
    const start = parseSimpleDate(multiDayMatch[1] + ', ' + multiDayMatch[3])
    const end = parseSimpleDate(multiDayMatch[2] + ', ' + multiDayMatch[3])
    return { date: start || '', endDate: end || '', time: timePart, isAllDay: !timePart }
  }

  // Single day: "Thursday, Mar 12, 2026"
  const singleDayMatch = datePart.match(/^(?:\w+,\s+)?(\w+\s+\d+,?\s+\d{4})$/)
  if (singleDayMatch) {
    const d = parseSimpleDate(singleDayMatch[1])
    return { date: d || '', endDate: '', time: timePart, isAllDay: false }
  }

  // Exhibition range: "November 15, 2025–May 3, 2026"
  if (rangeParts.length === 2) {
    const start = parseSimpleDate(rangeParts[0].trim())
    let end = parseSimpleDate(rangeParts[1].trim())
    if (!end && start) {
      const year = start.substring(0, 4)
      end = parseSimpleDate(rangeParts[1].trim() + ', ' + year)
    }
    return { date: start || '', endDate: end || '', time: '', isAllDay: true }
  }

  const simple = parseSimpleDate(text)
  return { date: simple || '', endDate: '', time: '', isAllDay: false }
}

function parseSimpleDate(str: string): string {
  if (!str) return ''
  const cleaned = str.replace(/,/g, '').trim()
  const d = new Date(cleaned)
  if (isNaN(d.getTime())) return ''
  return d.toISOString().split('T')[0]
}
