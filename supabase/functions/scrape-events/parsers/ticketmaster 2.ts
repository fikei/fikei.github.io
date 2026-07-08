// Ticketmaster Discovery API parser (venue-scoped).
// Source url convention: tm://<venueId> (e.g. tm://KovZpZAE6eeA for The
// Fillmore). Official API, free key, covers the LiveNation/AXS rooms whose
// own sites are unscrapeable (Fillmore, Warfield, Masonic, Independent,
// Castro, GAMH, Regency). dates.start.localDate/localTime are venue-local.
// Rate limits (5 req/s, 5k/day) are far above our 7 venues x 12 runs/day.

import { type ScrapedEvent } from './utils.ts'
import type { EventSource } from '../sources.ts'

interface TmEvent {
  name?: string
  url?: string
  dates?: { start?: { localDate?: string; localTime?: string } }
  priceRanges?: Array<{ min?: number; max?: number }>
  classifications?: Array<{
    segment?: { name?: string }
    genre?: { name?: string }
    subGenre?: { name?: string }
  }>
  promoters?: Array<{ name?: string }>
  ageRestrictions?: { legalAgeEnforced?: boolean }
  _embedded?: { venues?: Array<{ name?: string; city?: { name?: string } }> }
}

export async function scrapeTicketmaster(source: EventSource): Promise<ScrapedEvent[]> {
  const apiKey = Deno.env.get('TICKETMASTER_API_KEY')
  if (!apiKey) throw new Error('TICKETMASTER_API_KEY not configured')

  const venueId = source.url.replace(/^tm:\/\//, '').trim()
  if (!venueId || venueId.includes('/')) throw new Error(`ticketmaster source URL must be tm://<venueId>: ${source.url}`)

  const resp = await fetch(
    `https://app.ticketmaster.com/discovery/v2/events.json?venueId=${venueId}&size=100&sort=date,asc&apikey=${apiKey}`,
    { signal: AbortSignal.timeout(15000) },
  )
  if (!resp.ok) throw new Error(`Ticketmaster API ${resp.status}`)
  const data = await resp.json()
  const tmEvents: TmEvent[] = data?._embedded?.events || []

  const events: ScrapedEvent[] = []
  for (const e of tmEvents) {
    const date = e.dates?.start?.localDate
    if (!date || !e.name) continue

    const cls = (e.classifications || [])[0] || {}
    const genreParts = [cls.genre?.name, cls.subGenre?.name]
      .filter(g => g && g !== 'Undefined' && g !== 'Other')
    const price = e.priceRanges?.[0]
      ? (e.priceRanges[0].min === e.priceRanges[0].max
          ? `$${e.priceRanges[0].min}`
          : `$${e.priceRanges[0].min}-$${e.priceRanges[0].max}`)
      : ''

    events.push({
      source: source.id,
      date,
      time: (e.dates?.start?.localTime || '').slice(0, 5),
      name: e.name,
      venue: e._embedded?.venues?.[0]?.name || source.name,
      city: e._embedded?.venues?.[0]?.city?.name || 'San Francisco',
      genre: [...new Set(genreParts)].join(', '),
      price,
      ages: e.ageRestrictions?.legalAgeEnforced ? '21+' : '',
      promoter: e.promoters?.[0]?.name || '',
      url: e.url || '',
      contentType: source.category,
    })
  }
  return events
}
