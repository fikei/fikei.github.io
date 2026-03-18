// Shared utilities for parsers — ported from events/index.html

import { DOMParser } from 'https://deno.land/x/deno_dom@v0.1.38/deno-dom-wasm.ts'

export { DOMParser }

export interface ScrapedEvent {
  source: string
  date: string
  time?: string
  name: string
  venue: string
  address?: string
  city?: string
  genre?: string
  price?: string
  ages?: string
  promoter?: string
  url: string
  contentType?: string
  endDate?: string
  description?: string
  imageUrl?: string
}

const USER_AGENT = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'

/** Direct fetch with browser-like headers. No CORS proxy needed server-side. */
export async function fetchUrl(url: string, options?: {
  method?: string
  body?: string
  headers?: Record<string, string>
  timeoutMs?: number
}): Promise<string> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), options?.timeoutMs || 15000)

  try {
    const resp = await fetch(url, {
      method: options?.method || 'GET',
      headers: {
        'User-Agent': USER_AGENT,
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
        ...(options?.headers || {}),
      },
      body: options?.body,
      signal: controller.signal,
    })

    if (!resp.ok) {
      throw new Error(`HTTP ${resp.status} ${resp.statusText}`)
    }

    return await resp.text()
  } finally {
    clearTimeout(timeout)
  }
}

/** Parse HTML string into a DOM document */
export function parseHtml(html: string) {
  return new DOMParser().parseFromString(html, 'text/html')
}

/** Parse XML string into a DOM document */
export function parseXml(xml: string) {
  return new DOMParser().parseFromString(xml, 'text/html') // deno-dom doesn't support text/xml; use text/html
}

/** Parse fuzzy date strings like "Feb 8", "Sat Feb 08", "February 8, 2025" into YYYY-MM-DD */
export function parseFuzzyDate(str: string): string {
  if (!str) return ''
  str = str.replace(/\s+/g, ' ').trim()

  // ISO format
  const isoMatch = str.match(/(\d{4})-(\d{2})-(\d{2})/)
  if (isoMatch) return isoMatch[0]

  // Month-day patterns
  const monthMatch = str.match(/(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\w*[\s.:]+(\d{1,2})(?:\s*,?\s*(\d{4}))?/i)
  if (monthMatch) {
    const months: Record<string, string> = { jan: '01', feb: '02', mar: '03', apr: '04', may: '05', jun: '06', jul: '07', aug: '08', sep: '09', oct: '10', nov: '11', dec: '12' }
    const month = months[monthMatch[1].substring(0, 3).toLowerCase()]
    const day = monthMatch[2].padStart(2, '0')
    const year = monthMatch[3] || new Date().getFullYear().toString()
    return `${year}-${month}-${day}`
  }

  // Try native Date as last resort
  try {
    const d = new Date(str)
    if (!isNaN(d.getTime()) && d.getFullYear() > 2000) return d.toISOString().split('T')[0]
  } catch (_e) { /* ignore */ }

  return str
}

/** Parse "Venue, Address, City" or "Venue (City)" location strings */
export function parseLocationString(str: string): { venue: string; address: string; city: string } {
  if (!str) return { venue: '', address: '', city: '' }
  const parts = str.split(',').map(s => s.trim())
  if (parts.length >= 3) return { venue: parts[0], address: parts[1], city: parts[2].replace(/\s+\d{5}(-\d{4})?$/, '').trim() }
  if (parts.length === 2) {
    if (/^\d/.test(parts[0])) return { venue: '', address: parts[0], city: parts[1] }
    return { venue: parts[0], address: '', city: parts[1] }
  }
  return { venue: str, address: '', city: '' }
}

/** Parse "Event Title: Artists @ Venue Name (City)" */
export function parseEventName(raw: string): { title: string; venue: string; city: string } {
  let title = raw
  let venue = ''
  let city = ''

  // Extract city from trailing "(City Name)"
  const cityMatch = raw.match(/\(([^)]+)\)\s*$/)
  if (cityMatch) {
    const candidate = cityMatch[1].trim()
    if (!/^\d+\+$|^doors|^starts|^\$|^free|^all\s*ages/i.test(candidate)) {
      city = candidate
      raw = raw.substring(0, raw.lastIndexOf('(' + candidate)).trim()
    }
  }

  // Split on " @ " to separate event from venue
  const atIdx = raw.lastIndexOf(' @ ')
  if (atIdx !== -1) {
    title = raw.substring(0, atIdx).trim()
    venue = raw.substring(atIdx + 3).trim()
  } else {
    title = raw
  }

  title = title.replace(/:\s*$/, '').trim()
  return { title, venue, city }
}

/** Resolve relative URLs against a base */
export function resolveUrl(href: string, baseUrl: string): string {
  if (!href) return ''
  if (href.startsWith('http://') || href.startsWith('https://')) return href
  try { return new URL(href, baseUrl).href } catch (_e) { return href }
}

/** Extract location hints from HTML content (for RSS) */
export function extractLocationFromHtml(html: string): { venue: string; address: string; city: string } {
  const text = html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ')
  const m = text.match(/(?:location|where|venue|place|address)\s*:\s*([^.]+)/i)
  return m ? parseLocationString(m[1].trim()) : { venue: '', address: '', city: '' }
}
