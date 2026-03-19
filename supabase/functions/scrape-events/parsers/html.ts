// HTML Table Scraper — handles 19hz and generic table formats
// Ported from events/index.html parseHtmlTable()

import { type ScrapedEvent, fetchUrl, parseHtml, parseFuzzyDate, parseEventName, parseLocationString, resolveUrl } from './utils.ts'
import type { EventSource } from '../sources.ts'

export async function scrapeHtml(source: EventSource): Promise<ScrapedEvent[]> {
  const text = await fetchUrl(source.url)
  return parseHtmlTable(text, source.id, source.url)
}

function parseHtmlTable(html: string, sourceId: string, baseUrl: string): ScrapedEvent[] {
  const doc = parseHtml(html)
  if (!doc) return []

  const tables = Array.from(doc.querySelectorAll('table'))
  if (tables.length === 0) return []

  // Prefer the largest table
  const table = tables.reduce((a, b) =>
    (b.querySelectorAll('tr').length > a.querySelectorAll('tr').length ? b : a), tables[0])

  // Detect headers
  const headers: string[] = []
  table.querySelectorAll('thead th, tr:first-child th').forEach((th: any) => {
    headers.push((th.textContent || '').trim().toLowerCase().replace(/\s+/g, ' '))
  })

  // Count columns from first data row
  let rows = Array.from(table.querySelectorAll('tbody tr'))
  if (rows.length === 0) rows = Array.from(table.querySelectorAll('tr')).filter((r: any) => !r.querySelector('th'))
  if (rows.length === 0) return []

  const colCount = (rows[0] as any).querySelectorAll('td').length

  // Build column map
  const colMap: Record<string, any> = {}
  let format = 'unknown'

  if (headers.length > 0) {
    headers.forEach((h, i) => {
      if ((/^date/.test(h) || h === 'date/time' || h === 'when') && colMap.date === undefined) colMap.date = i
      else if ((/event|title|artist/.test(h) || (h === 'name')) && colMap.name === undefined) { colMap.name = i; if (h.includes('venue') || h.includes('@')) colMap._nameHasVenue = true }
      else if (/genre|tag|style|music|type/.test(h) && colMap.genre === undefined) colMap.genre = i
      else if (/venue|location|place/.test(h) && colMap.location === undefined) colMap.location = i
      else if (h === 'time' && colMap.time === undefined) colMap.time = i
      else if (/price|cost|\$/.test(h) && colMap.price === undefined) colMap.price = i
      else if (/age/.test(h) && !(/price/.test(h)) && colMap.ages === undefined) colMap.ages = i
      else if (/promoter|organizer|host|present/.test(h) && colMap.promoter === undefined) colMap.promoter = i
      else if (/link|url/.test(h) && colMap.links === undefined) colMap.links = i
    })
    const dateHeader = headers[colMap.date] || ''
    if (dateHeader.includes('time') && colMap.time === undefined) colMap._dateHasTime = true
    const priceHeader = headers[colMap.price] || ''
    if (priceHeader.includes('age') && colMap.ages === undefined) colMap._priceHasAge = true
    const nameHeader = headers[colMap.name] || ''
    if (nameHeader.includes('venue') || nameHeader.includes('@')) colMap._nameHasVenue = true
    format = 'header-detected'
  }

  // Positional fallback
  if (colMap.date === undefined && colMap.name === undefined) {
    if (colCount >= 10) {
      Object.assign(colMap, { date: 0, name: 1, genre: 2, location: 3, time: 4, price: 5, ages: 6, promoter: 7 })
      format = '11-col-raw'
    } else if (colCount >= 7) {
      Object.assign(colMap, { date: 0, name: 1, genre: 2, location: 3, time: 4, price: 5, ages: 6, promoter: 7 })
      format = '8-col'
    } else if (colCount === 6) {
      Object.assign(colMap, { date: 0, name: 1, genre: 2, price: 3, promoter: 4, links: 5 })
      colMap._dateHasTime = true
      colMap._nameHasVenue = true
      colMap._priceHasAge = true
      format = '6-col-combined'
    } else if (colCount >= 4) {
      Object.assign(colMap, { date: 0, name: 1, location: 2, time: 3 })
      format = '4-col-minimal'
    }
  }

  // Parse rows
  const events: ScrapedEvent[] = []
  rows.forEach((row: any) => {
    const cells = row.querySelectorAll('td')
    if (cells.length < 2) return

    const getCell = (key: string) => colMap[key] !== undefined && cells[colMap[key]] ? cells[colMap[key]] : null
    const getText = (key: string) => { const c = getCell(key); return c ? (c.textContent || '').replace(/\s+/g, ' ').trim() : '' }
    const getCellLinks = (key: string) => {
      const c = getCell(key)
      if (!c) return []
      return Array.from(c.querySelectorAll('a')).map((a: any) => ({
        href: a.getAttribute('href') || '',
        text: (a.textContent || '').trim(),
      })).filter((l: any) => l.href && l.href !== '#' && !l.href.startsWith('javascript:'))
    }

    // DATE
    const rawDate = getText('date')
    let date = '', time = ''
    if (colMap._dateHasTime) {
      const timeMatch = rawDate.match(/\(([^)]+)\)/)
      if (timeMatch) {
        time = timeMatch[1].trim()
        date = parseFuzzyDate(rawDate.substring(0, rawDate.indexOf('(')).trim())
      } else {
        date = parseFuzzyDate(rawDate)
      }
    } else {
      date = parseFuzzyDate(rawDate)
      time = getText('time')
    }

    // NAME
    const rawName = getText('name')
    if (!rawName) return

    let eventTitle = rawName
    let venueFromName = '', cityFromName = ''

    if (colMap._nameHasVenue || rawName.includes(' @ ')) {
      const parsed = parseEventName(rawName)
      eventTitle = parsed.title
      venueFromName = parsed.venue
      cityFromName = parsed.city
    }

    // LOCATION
    const rawLocation = getText('location')
    let locVenue = '', locAddress = '', locCity = ''
    if (rawLocation) {
      const locCityMatch = rawLocation.match(/\(([^)]+)\)\s*$/)
      if (locCityMatch) {
        locCity = locCityMatch[1].trim()
        const before = rawLocation.substring(0, rawLocation.lastIndexOf('(')).trim()
        const locParts = before.split(',').map((s: string) => s.trim())
        locVenue = locParts[0] || ''
        locAddress = locParts.slice(1).join(', ')
      } else {
        const locParsed = parseLocationString(rawLocation)
        locVenue = locParsed.venue
        locAddress = locParsed.address
        locCity = locParsed.city
      }
    }

    const venue = locVenue || venueFromName
    const city = locCity || cityFromName
    const address = locAddress

    // GENRE
    let genre = getText('genre')
    if (genre.startsWith(rawName)) genre = genre.substring(rawName.length).replace(/^\t+/, '').trim()
    genre = genre.replace(/\t+/g, ', ').replace(/,\s*,/g, ',').replace(/^,\s*/, '').replace(/,\s*$/, '').trim()

    // PRICE + AGES
    let price = getText('price')
    let ages = getText('ages')
    if (colMap._priceHasAge || (!ages && price && /\|/.test(price))) {
      const parts = price.split(/\s*\|\s*/)
      if (parts.length >= 2) {
        const lastPart = parts[parts.length - 1].trim()
        if (/^\d+\+$|^all\s*ages?$/i.test(lastPart) || /age/i.test(lastPart)) {
          ages = lastPart
          price = parts.slice(0, -1).join(', ')
        }
      }
    }
    price = price.trim()
    if (/^free$/i.test(price)) price = 'Free'
    ages = ages.trim()
    if (/^all\s*ages?$/i.test(ages)) ages = 'All Ages'

    // PROMOTER
    let promoter = getText('promoter')
    promoter = promoter.replace(/\t+/g, ' ').trim()

    // URLs
    const nameLinks = getCellLinks('name')
    const linksCellLinks = getCellLinks('links')
    const allRowLinks = Array.from(row.querySelectorAll('a'))
      .map((a: any) => ({ href: a.getAttribute('href') || '', text: (a.textContent || '').trim() }))
      .filter((l: any) => l.href && l.href !== '#' && !l.href.startsWith('javascript:'))

    let bestUrl = ''
    if (nameLinks.length > 0) bestUrl = (nameLinks[0] as any).href
    else if (linksCellLinks.length > 0) bestUrl = (linksCellLinks[0] as any).href
    else if (allRowLinks.length > 0) bestUrl = (allRowLinks[0] as any).href

    events.push({
      date, time, name: eventTitle,
      venue, address, city,
      genre, price, ages,
      promoter,
      url: resolveUrl(bestUrl, baseUrl),
      source: sourceId,
    })
  })

  return events
}
