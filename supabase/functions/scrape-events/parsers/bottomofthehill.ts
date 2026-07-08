// Bottom of the Hill (bottomofthehill.com/RSS.xml) parser.
// FeedForAll RSS where the event date lives in the item TITLE, not pubDate:
//   <title>2026  10/18  :  heavens to betsy ~ TBA ~ TBA</title>
//   <description><b>lineup</b><br />7:30PM doors -- music 8:30PM<br />$35<br /> (all ages)</description>

import { type ScrapedEvent, fetchUrl } from './utils.ts'
import type { EventSource } from '../sources.ts'

function decodeEntities(s: string): string {
  return s
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"').replace(/&#0?39;/g, "'")
}

function to24h(time: string): string {
  const m = time.match(/(\d{1,2})(?::(\d{2}))?\s*([AP]M)/i)
  if (!m) return ''
  let h = parseInt(m[1], 10)
  const ampm = m[3].toUpperCase()
  if (ampm === 'PM' && h !== 12) h += 12
  if (ampm === 'AM' && h === 12) h = 0
  if (h > 23) return ''
  const out = `${String(h).padStart(2, '0')}:${m[2] || '00'}`
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(out) ? out : ''
}

export async function scrapeBottomOfTheHill(source: EventSource): Promise<ScrapedEvent[]> {
  const xml = await fetchUrl(source.url)
  const events: ScrapedEvent[] = []

  // The feed is an append-only edit log: every upstream edit (lineup change,
  // "----now All Ages" note, cancellation) adds a NEW <item> for the same
  // per-date page and the old items stay — 100+ pages appear 2-3x. Group by
  // link and keep only the newest pubDate: the venue's latest word.
  const newestByLink = new Map<string, { ts: number; item: string }>()
  for (const item of xml.split('<item>').slice(1)) {
    const link = item.match(/<link>([\s\S]*?)<\/link>/)?.[1]?.trim() || source.url
    const pub = item.match(/<pubDate>([\s\S]*?)<\/pubDate>/)?.[1]?.trim() || ''
    const ts = pub ? new Date(pub).getTime() || 0 : 0
    const prev = newestByLink.get(link)
    if (!prev || ts > prev.ts) newestByLink.set(link, { ts, item })
  }

  for (const { item } of newestByLink.values()) {
    const title = item.match(/<title>([\s\S]*?)<\/title>/)?.[1] || ''
    const desc = decodeEntities(item.match(/<description>([\s\S]*?)<\/description>/)?.[1] || '')
    const link = item.match(/<link>([\s\S]*?)<\/link>/)?.[1]?.trim() || source.url

    const dm = title.match(/(\d{4})\s+(\d{1,2})\/(\d{1,2})\s*:\s*([\s\S]+)/)
    if (!dm) continue
    const date = `${dm[1]}-${dm[2].padStart(2, '0')}-${dm[3].padStart(2, '0')}`

    // The feed contains the venue's full archive (900+ items, years back) —
    // only ingest recent/future events
    const cutoff = new Date()
    cutoff.setDate(cutoff.getDate() - 7)
    if (date < cutoff.toISOString().split('T')[0]) continue

    // Strip inline edit annotations ("----now All Ages", "----now this show
    // is not announced...") — they're notes, not lineup
    const name = dm[4].split('~')
      .map(s => s.replace(/\s*-{2,}\s*now\b[\s\S]*$/i, '').trim())
      .filter(s => s && s.toUpperCase() !== 'TBA')
      .join(', ')
    if (!name) continue

    const descText = desc.replace(/<[^>]+>/g, ' ')
    const time = to24h(descText.match(/music\s+(\d{1,2}(?::\d{2})?\s*[AP]M)/i)?.[1]
      || descText.match(/(\d{1,2}(?::\d{2})?\s*[AP]M)\s*doors/i)?.[1] || '')
    const price = descText.match(/\$\d+(?:\.\d{2})?/)?.[0] || ''
    const ages = descText.match(/\((all ages|21\s*(?:and|\+|&) ?(?:over|up)?|18\s*(?:and|\+|&) ?(?:over|up)?)\)?/i)?.[1] || ''

    events.push({
      source: source.id,
      date,
      time,
      name,
      venue: 'Bottom of the Hill',
      address: '1233 17th St',
      city: 'San Francisco',
      price,
      ages: ages ? ages.replace(/\s+/g, ' ').trim() : '',
      url: link,
      contentType: source.category,
    })
  }
  return events
}
