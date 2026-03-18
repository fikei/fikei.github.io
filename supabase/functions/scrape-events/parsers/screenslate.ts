// Screen Slate scraper — JSON API based
// Ported from events/index.html fetchScreenSlate()

import { type ScrapedEvent, fetchUrl } from './utils.ts'
import type { EventSource } from '../sources.ts'

const CITY_IDS: Record<string, string> = {
  'bay-area': '10970',
  'new-york': '10969',
}

export async function scrapeScreenSlate(source: EventSource): Promise<ScrapedEvent[]> {
  const baseUrl = 'https://www.screenslate.com'
  const cityId = CITY_IDS[source.region] || ''
  const dayRange = 7

  // Phase 1: Fetch showtimes per day
  const allShowtimes: Array<{ nid: string; time: string; note: string; timestamp: string; dateStr: string }> = []

  for (let dayOffset = 0; dayOffset < dayRange; dayOffset++) {
    const d = new Date(Date.now() + dayOffset * 86400000)
    const dateStr = d.toISOString().split('T')[0]
    const dateParam = dateStr.replace(/-/g, '')
    let apiUrl = `${baseUrl}/api/screenings/date?_format=json&date=${dateParam}`
    if (cityId) apiUrl += `&field_city_target_id=${cityId}`

    try {
      const text = await fetchUrl(apiUrl)
      const data = JSON.parse(text)
      if (!Array.isArray(data)) continue

      const items = data
        .filter((item: any) => item.nid)
        .map((item: any) => ({
          nid: String(item.nid),
          time: item.field_time || '',
          note: item.field_note || '',
          timestamp: item.field_timestamp || '',
          dateStr,
        }))
      allShowtimes.push(...items)
    } catch (e) {
      console.error(`[scrape-events] ScreenSlate fetch failed for ${dateStr}: ${(e as Error).message}`)
      if (dayOffset === 0) throw e
      break
    }
  }

  if (allShowtimes.length === 0) return []

  // Phase 2: Batch-enrich via JSON:API
  const uniqueNids = [...new Set(allShowtimes.map(s => s.nid))]
  const enrichmentMap = await enrichNids(uniqueNids, baseUrl)

  // Phase 3: Group showtimes by nid+date
  const groups = new Map<string, typeof allShowtimes>()
  allShowtimes.forEach(s => {
    const key = `${s.nid}|${s.dateStr}`
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key)!.push(s)
  })

  const events: ScrapedEvent[] = []
  groups.forEach((showtimes) => {
    const first = showtimes[0]
    const enriched = enrichmentMap.get(first.nid) || {} as any

    const times = showtimes.map(s => {
      const note = s.note ? ` (${s.note})` : ''
      return s.time + note
    })

    let name = enriched.title || `Screening #${first.nid}`
    const venue = enriched.venue || ''
    if (venue && name.toLowerCase().endsWith(' at ' + venue.toLowerCase())) {
      name = name.substring(0, name.length - (' at ' + venue).length)
    }

    const series = enriched.series || ''
    const price = enriched.price || ''
    const url = enriched.url || ''
    const pathAlias = enriched.path || ''
    const eventUrl = url.startsWith('http') ? url : (pathAlias ? baseUrl + pathAlias : '')

    events.push({
      date: first.dateStr,
      time: times.join(', '),
      name, venue,
      address: enriched.address || '',
      city: '',
      genre: series || 'film',
      price, ages: '',
      url: eventUrl,
      source: source.id,
      contentType: 'film',
    })
  })

  return events
}

interface EnrichedScreening {
  title: string
  venue: string
  address: string
  series: string
  price: string
  url: string
  path: string
}

async function enrichNids(nids: string[], baseUrl: string): Promise<Map<string, EnrichedScreening>> {
  const result = new Map<string, EnrichedScreening>()
  const BATCH_SIZE = 40

  for (let i = 0; i < nids.length; i += BATCH_SIZE) {
    const batch = nids.slice(i, i + BATCH_SIZE)
    const filterParams = batch.map((nid, idx) =>
      `filter[drupal_internal__nid][value][${idx}]=${nid}`
    ).join('&')
    const apiUrl = `${baseUrl}/jsonapi/node/screening?${filterParams}`
      + `&filter[drupal_internal__nid][operator]=IN`
      + `&include=field_venue,field_series`
      + `&fields[node--screening]=title,drupal_internal__nid,field_url,path,field_venue,field_series`
      + `&fields[node--venue]=title,field_address,field_ticket_info`
      + `&fields[node--series]=title`

    try {
      const text = await fetchUrl(apiUrl)
      const json = JSON.parse(text)

      const included = new Map<string, any>()
      if (Array.isArray(json.included)) {
        json.included.forEach((ent: any) => {
          included.set(`${ent.type}:${ent.id}`, ent)
        })
      }

      if (Array.isArray(json.data)) {
        json.data.forEach((node: any) => {
          const nid = String(node.attributes?.drupal_internal__nid || '')
          if (!nid) return

          let venue = '', address = '', price = ''
          const venueRef = node.relationships?.field_venue?.data
          if (venueRef) {
            const venueEnt = included.get(`${venueRef.type}:${venueRef.id}`)
            if (venueEnt) {
              venue = venueEnt.attributes?.title || ''
              address = venueEnt.attributes?.field_address || ''
              price = venueEnt.attributes?.field_ticket_info || ''
            }
          }

          let series = ''
          const seriesRef = node.relationships?.field_series?.data
          if (seriesRef) {
            const seriesEnt = included.get(`${seriesRef.type}:${seriesRef.id}`)
            if (seriesEnt) series = seriesEnt.attributes?.title || ''
          }

          const fieldUrl = node.attributes?.field_url
          const url = typeof fieldUrl === 'string' ? fieldUrl
            : (fieldUrl?.uri || fieldUrl?.url || '')

          result.set(nid, {
            title: node.attributes?.title || '',
            venue, address, series, price, url,
            path: node.attributes?.path?.alias || '',
          })
        })
      }
    } catch (e) {
      console.error(`[scrape-events] ScreenSlate enrichment batch failed: ${(e as Error).message}`)
    }
  }

  return result
}
