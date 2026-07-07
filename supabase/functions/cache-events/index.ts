// Supabase Edge Function: cache-events
// Accepts scraped events from the client, deduplicates via event_key, upserts to DB.
// Triggers enrichment for new events that have URLs.
// Also accepts sourceOutcomes for persistent health tracking.
//
// POST /functions/v1/cache-events
// Body: { events: Event[], sourceOutcomes?: SourceOutcome[] }
// Returns: { cached, updated, enrichQueued, healthUpdated, errors }

const VERSION = '1.7.0'
console.log(`[cache-events] v${VERSION} - music_type classification at insert (enrichment refines)`)

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

function jsonResponse(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

// Generate SHA-256 event key matching the DB helper function
async function generateEventKey(source: string, date: string, name: string, venue: string): Promise<string> {
  const normalized = `${source}|${date}|${name.trim().toLowerCase()}|${venue.trim().toLowerCase()}`
  const data = new TextEncoder().encode(normalized)
  const hashBuffer = await crypto.subtle.digest('SHA-256', data)
  return Array.from(new Uint8Array(hashBuffer))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('')
}

// Source-agnostic key so the same event scraped from two sources can be
// merged in the UI. Strips diacritics (Café → cafe) and collapses whitespace;
// SQL backfill in migration 088 matches this except diacritics (converges on
// next scrape since updates rewrite the key).
function normalizeForKey(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim()
    .replace(/\s+/g, ' ')
}

async function generateCanonicalKey(date: string, name: string, venue: string): Promise<string> {
  const normalized = `${date}|${normalizeForKey(name)}|${normalizeForKey(venue)}`
  const data = new TextEncoder().encode(normalized)
  const hashBuffer = await crypto.subtle.digest('SHA-256', data)
  return Array.from(new Uint8Array(hashBuffer))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('')
}

interface ScrapedEvent {
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
  description?: string
  postedBy?: string
  recommendedBy?: string[]
  // Per-event visibility override (used by add-event, where visibility
  // depends on the submitted URL's platform, not the source's class)
  visibility?: 'public' | 'private'
}

// --- Source classes & visibility (PRD event-source-architecture §2–3) ---

interface SourceMeta { source_class: string; demoted: boolean }

async function loadSourceClasses(supabase: ReturnType<typeof createClient>): Promise<Map<string, SourceMeta>> {
  const map = new Map<string, SourceMeta>()
  const { data } = await supabase.from('event_sources').select('id, source_class, demoted')
  for (const row of data || []) {
    map.set(row.id as string, { source_class: (row.source_class as string) || 'discovery', demoted: !!row.demoted })
  }
  return map
}

// Visibility by source class: curation (Agape) and private-ticketing rows are
// always private; demoted discovery feeds are private until corroborated by
// the Agape channel (upgrade handled in resolveCanonicalKeys); everything
// else is public.
function visibilityFor(sourceId: string, classes: Map<string, SourceMeta>): 'public' | 'private' {
  const meta = classes.get(sourceId)
  if (!meta) return 'public'
  if (meta.source_class === 'curation' || meta.source_class === 'private-ticketing') return 'private'
  if (meta.demoted) return 'private'
  return 'public'
}

// --- Music-type classification (insert-time; enrich-event's AI refines) ---
const MUSIC_CONTENT_TYPES = ['music', 'dj-set', 'live-music', 'festival']
const MUSIC_TYPE_KEYWORDS: Array<[string, string[]]> = [
  ['electronic', ['electronic','techno','house','dj','dance','edm','bass','dubstep','drum & bass','dnb','trance','rave','club','garage','breaks','glitch','hyphy']],
  ['rock', ['rock','indie','alternative','punk','metal','grunge','shoegaze','emo','psychedelic','post-']],
  ['pop', ['pop']],
  ['hiphop', ['hip-hop','hip hop','rap','r&b','rnb','soul','funk']],
  ['jazz', ['jazz','blues','swing']],
  ['folk', ['folk','country','americana','bluegrass','singer-songwriter','singer/songwriter','acoustic','tribute']],
  ['world', ['latin','reggae','afrobeat','cumbia','salsa','brazilian','perreo','world']],
]

function classifyMusicType(ev: ScrapedEvent): string | null {
  const ct = ev.contentType || ''
  if (!MUSIC_CONTENT_TYPES.includes(ct)) return null
  const hay = ((ev.genre || '') + (ct === 'dj-set' ? ' dj' : '')).toLowerCase()
  for (const [key, kws] of MUSIC_TYPE_KEYWORDS) {
    if (kws.some(k => hay.includes(k))) return key
  }
  return 'other-music'
}

// --- Canonical URL (dedup ladder rung 1) ---
// Only per-event pages on known platforms qualify — a canonical URL must
// uniquely identify one event, so venue homepages and generic listings are
// excluded to avoid welding unrelated events together.

const EVENT_URL_PATTERNS: RegExp[] = [
  /^https?:\/\/partiful\.com\/e\/[\w-]+$/,
  /^https?:\/\/(?:[a-z]{2}\.)?ra\.co\/events\/\d+$/,
  /^https?:\/\/lu\.ma\/[\w.-]+$/,
  /^https?:\/\/eventbrite\.com\/e\/[\w-]+$/,
  /^https?:\/\/dice\.fm\/(?:event|partner)\/[\w/-]+$/,
  /^https?:\/\/shotgun\.live\/(?:[a-z]{2}\/)?events\/[\w-]+$/,
  /^https?:\/\/tixr\.com\/groups\/[\w-]+\/events\/[\w-]+$/,
  /^https?:\/\/[\w-]+\.secretparty\.io\/[\w-]+$/,
  /^https?:\/\/(?:wl\.)?seetickets\.us\/event\/[\w/-]+$/,
  /^https?:\/\/meetup\.com\/[\w-]+\/events\/\d+$/,
]

function canonicalizeEventUrl(raw: string | undefined | null): string | null {
  if (!raw) return null
  try {
    const u = new URL(raw)
    u.hash = ''
    u.search = ''
    let s = u.toString().toLowerCase().replace(/\/+$/, '')
    s = s.replace('://www.', '://').replace('://luma.com/', '://lu.ma/')
    return EVENT_URL_PATTERNS.some(p => p.test(s)) ? s : null
  } catch {
    return null
  }
}

// --- Fuzzy venue+date+name match (dedup ladder rung 2) ---
// Only runs for curation-class rows at known nightlife venues, where the
// collision probability with 19hz/RA is high (PRD §4 conservative policy:
// prefer duplicate cards over false merges everywhere else).

const NIGHTLIFE_VENUES = [
  'public works', 'the midway', 'midway', 'great northern', '1015 folsom',
  'f8', '1192 folsom', 'audio', 'undergroundsf', 'underground sf', 'gray area',
  'monarch', 'halcyon', 'dna lounge', 'the endup', 'temple', 'the foundry',
  'el rio', 'rickshaw stop', 'brick and mortar', 'bottom of the hill',
  'the chapel', 'the independent', 'bimbos 365', 'new parish', 'fox oakland',
  'the knockout', 'make out room', 'public sf', 'phoenix hotel',
]

function isNightlifeVenue(venue: string): boolean {
  const nv = normalizeForKey(venue).replace(/^the /, '')
  if (!nv) return false
  return NIGHTLIFE_VENUES.some(w => {
    const wv = w.replace(/^the /, '')
    if (nv === wv) return true
    if (wv.length > 4 && (nv.includes(wv) || wv.includes(nv))) return true
    return false
  })
}

function levenshtein(a: string, b: string): number {
  if (a === b) return 0
  const m = a.length, n = b.length
  if (m === 0) return n
  if (n === 0) return m
  let prev = Array.from({ length: n + 1 }, (_, i) => i)
  for (let i = 1; i <= m; i++) {
    const cur = [i]
    for (let j = 1; j <= n; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1))
    }
    prev = cur
  }
  return prev[n]
}

function fuzzyNameMatch(a: string, b: string): boolean {
  const na = normalizeForKey(a).replace(/[^a-z0-9 ]/g, '')
  const nb = normalizeForKey(b).replace(/[^a-z0-9 ]/g, '')
  if (!na || !nb) return false
  if (na === nb) return true
  if (na.length >= 6 && nb.length >= 6 && (na.includes(nb) || nb.includes(na))) return true
  return levenshtein(na, nb) <= 3
}

function fuzzyVenueMatch(a: string, b: string): boolean {
  const na = normalizeForKey(a).replace(/^the /, '').replace(/[^a-z0-9 ]/g, '')
  const nb = normalizeForKey(b).replace(/^the /, '').replace(/[^a-z0-9 ]/g, '')
  if (!na || !nb) return false
  if (na === nb) return true
  if (na.length >= 5 && nb.length >= 5 && (na.includes(nb) || nb.includes(na))) return true
  return levenshtein(na, nb) <= 2
}

// --- Dedup ladder (PRD §4): mutate rows in place to adopt canonical identity ---
// Rung 1: canonical URL match against existing rows (any direction — a public
//         listing arriving after a Discord post adopts the Discord row's key,
//         and vice versa, so merges are stable regardless of timing).
// Rung 2: curation rows at nightlife venues fuzzy-match venue+date+name.
// Rung 3: corroboration upgrades — demoted-feed rows sharing identity with an
//         Agape row become public (PRD §2.1); direction-agnostic.
async function resolveCanonicalKeys(
  supabase: ReturnType<typeof createClient>,
  rows: Record<string, unknown>[],
  classes: Map<string, SourceMeta>,
): Promise<{ urlAdopted: number; fuzzyAdopted: number; upgraded: number }> {
  let urlAdopted = 0, fuzzyAdopted = 0, upgraded = 0

  // Rung 1: URL adoption
  const urls = [...new Set(rows.map(r => r.canonical_url as string | null).filter(Boolean))] as string[]
  const urlToKey = new Map<string, string>()
  for (let i = 0; i < urls.length; i += 100) {
    const chunk = urls.slice(i, i + 100)
    const { data } = await supabase
      .from('events')
      .select('canonical_url, canonical_key')
      .in('canonical_url', chunk)
    for (const row of data || []) {
      if (row.canonical_url && row.canonical_key) urlToKey.set(row.canonical_url as string, row.canonical_key as string)
    }
  }
  for (const r of rows) {
    const cu = r.canonical_url as string | null
    if (cu && urlToKey.has(cu) && r.canonical_key !== urlToKey.get(cu)) {
      r.canonical_key = urlToKey.get(cu)
      urlAdopted++
    }
  }

  // Rung 2: tiered fuzzy match for curation rows at nightlife venues
  const fuzzyRows = rows.filter(r =>
    classes.get(r.source_id as string)?.source_class === 'curation' &&
    isNightlifeVenue((r.venue as string) || '')
  )
  if (fuzzyRows.length > 0) {
    const dates = [...new Set(fuzzyRows.map(r => r.date as string))]
    const { data: candidates } = await supabase
      .from('events')
      .select('date, name, venue, canonical_key, source_id')
      .in('date', dates.slice(0, 50))
      .neq('source_id', fuzzyRows[0].source_id as string)
    for (const r of fuzzyRows) {
      const match = (candidates || []).find(c =>
        c.date === r.date &&
        fuzzyVenueMatch(c.venue as string, r.venue as string) &&
        fuzzyNameMatch(c.name as string, r.name as string)
      )
      if (match && match.canonical_key && r.canonical_key !== match.canonical_key) {
        r.canonical_key = match.canonical_key
        fuzzyAdopted++
      }
    }
  }

  // Rung 3: corroboration upgrades for demoted feeds
  const demotedIds = [...classes.entries()].filter(([, m]) => m.demoted).map(([id]) => id)
  if (demotedIds.length > 0) {
    // 3a. Incoming demoted rows already corroborated by a stored Agape row → public
    const demotedRows = rows.filter(r => demotedIds.includes(r.source_id as string))
    if (demotedRows.length > 0) {
      const keys = [...new Set(demotedRows.map(r => r.canonical_key as string))]
      const corroborated = new Set<string>()
      for (let i = 0; i < keys.length; i += 100) {
        const { data } = await supabase
          .from('events')
          .select('canonical_key')
          .in('canonical_key', keys.slice(i, i + 100))
          .eq('source_id', 'discord-agape-events')
        for (const row of data || []) corroborated.add(row.canonical_key as string)
      }
      for (const r of demotedRows) {
        if (corroborated.has(r.canonical_key as string) && r.visibility !== 'public') {
          r.visibility = 'public'
          upgraded++
        }
      }
    }
    // 3b. Incoming Agape rows corroborate stored demoted rows → flip them public
    const agapeKeys = [...new Set(rows
      .filter(r => classes.get(r.source_id as string)?.source_class === 'curation')
      .map(r => r.canonical_key as string))]
    for (let i = 0; i < agapeKeys.length; i += 100) {
      const { data } = await supabase
        .from('events')
        .update({ visibility: 'public' })
        .in('canonical_key', agapeKeys.slice(i, i + 100))
        .in('source_id', demotedIds)
        .eq('visibility', 'private')
        .select('id')
      upgraded += data?.length || 0
    }
  }

  return { urlAdopted, fuzzyAdopted, upgraded }
}

interface SourceOutcome {
  sourceId: string
  sourceName: string
  sourceUrl: string
  sourceType: string
  eventCount: number
  ok: boolean
  errorReason?: string
  durationMs?: number
}

// --- Source Health Upsert (mirrors domain_profiles pattern from create-pin) ---

function deriveStatus(successRate: number, consecutiveFailures: number, totalScrapes: number, countDegraded = false): string {
  if (totalScrapes === 0) return 'unknown'
  // Most recent scrape succeeded — source is working, show as healthy
  // Low historical rates don't matter if the source is currently functioning
  if (consecutiveFailures === 0) {
    if (countDegraded) return 'degraded'
    return 'healthy'
  }
  // Broken: persistent failure pattern
  if (consecutiveFailures >= 6) return 'broken'
  if (totalScrapes >= 5 && successRate < 0.3) return 'broken'
  if (totalScrapes >= 2 && successRate === 0) return 'broken' // never worked after 2+ scrapes
  // Degraded: concerning failure pattern
  if (consecutiveFailures >= 3) return 'degraded'
  if (totalScrapes >= 3 && successRate < 0.65) return 'degraded'
  if (consecutiveFailures >= 1 && successRate < 0.5) return 'degraded' // early warning
  // Event count degradation: source works but returns far fewer events than peak
  if (countDegraded) return 'degraded'
  // Healthy
  if (successRate >= 0.8) return 'healthy'
  if (totalScrapes === 1 && successRate === 1.0) return 'healthy'
  return 'unknown'
}

async function upsertSourceHealth(
  supabase: ReturnType<typeof createClient>,
  outcome: SourceOutcome,
): Promise<void> {
  const isSuccess = outcome.ok && outcome.eventCount > 0
  const outcomeKey = isSuccess ? 'success'
    : (outcome.ok && outcome.eventCount === 0) ? 'zero_results'
    : (outcome.errorReason || 'unknown')

  const { data: existing } = await supabase
    .from('source_health')
    .select('*')
    .eq('source_id', outcome.sourceId)
    .single()

  if (existing) {
    const outcomesSeen = existing.outcomes_seen || {}
    outcomesSeen[outcomeKey] = (outcomesSeen[outcomeKey] || 0) + 1

    // Track peak event count (stored in JSONB to avoid migration).
    // The peak decays 0.5% per successful scrape (~34%/week at 12 scrapes/day)
    // so a listing-volume high from months ago doesn't flag the source as
    // degraded forever — count_drop should mean "recent drop", not
    // "smaller than the all-time record".
    const previousPeak = outcomesSeen.peak_event_count || 0
    if (isSuccess) {
      outcomesSeen.peak_event_count = Math.round(Math.max(outcome.eventCount, previousPeak * 0.995) * 10) / 10
    }
    const peakCount = outcomesSeen.peak_event_count || 0

    // Detect event count degradation: source returns >0 events but far fewer than peak
    // Threshold: >50% drop from peak, and peak must be meaningful (>20 events)
    const countDegraded = isSuccess && peakCount > 20 && outcome.eventCount < peakCount * 0.5
    if (countDegraded) {
      outcomesSeen.count_drop = (outcomesSeen.count_drop || 0) + 1
      console.log(`[cache-events] Count degradation: ${outcome.sourceId} returned ${outcome.eventCount} vs peak ${peakCount} (${Math.round(outcome.eventCount / peakCount * 100)}%)`)
    }

    const total = existing.total_scrapes + 1
    const successCount = existing.success_count + (isSuccess ? 1 : 0)
    const zeroCount = existing.zero_result_count + (outcomeKey === 'zero_results' ? 1 : 0)
    const errorCount = existing.error_count + (!outcome.ok ? 1 : 0)
    const successRate = total > 0 ? successCount / total : 1.0
    const consecutiveFailures = isSuccess ? 0 : existing.consecutive_failures + 1
    const status = deriveStatus(successRate, consecutiveFailures, total, countDegraded)

    await supabase.from('source_health').update({
      source_name: outcome.sourceName,
      source_url: outcome.sourceUrl,
      source_type: outcome.sourceType,
      outcomes_seen: outcomesSeen,
      total_scrapes: total,
      success_count: successCount,
      zero_result_count: zeroCount,
      error_count: errorCount,
      success_rate: successRate,
      consecutive_failures: consecutiveFailures,
      last_failure_reason: isSuccess ? existing.last_failure_reason : (outcome.errorReason || outcomeKey),
      last_failure_at: isSuccess ? existing.last_failure_at : new Date().toISOString(),
      last_success_at: isSuccess ? new Date().toISOString() : existing.last_success_at,
      last_success_event_count: isSuccess ? outcome.eventCount : existing.last_success_event_count,
      status,
      last_scraped_at: new Date().toISOString(),
    }).eq('source_id', outcome.sourceId)
  } else {
    const outcomesSeen: Record<string, unknown> = { [outcomeKey]: 1 }
    // Track peak event count from first scrape
    if (isSuccess && outcome.eventCount > 0) {
      outcomesSeen.peak_event_count = outcome.eventCount
    }
    await supabase.from('source_health').insert({
      source_id: outcome.sourceId,
      source_name: outcome.sourceName,
      source_url: outcome.sourceUrl,
      source_type: outcome.sourceType,
      outcomes_seen: outcomesSeen,
      total_scrapes: 1,
      success_count: isSuccess ? 1 : 0,
      zero_result_count: outcomeKey === 'zero_results' ? 1 : 0,
      error_count: !outcome.ok ? 1 : 0,
      success_rate: isSuccess ? 1.0 : 0.0,
      consecutive_failures: isSuccess ? 0 : 1,
      last_failure_reason: isSuccess ? null : (outcome.errorReason || outcomeKey),
      last_failure_at: isSuccess ? null : new Date().toISOString(),
      last_success_at: isSuccess ? new Date().toISOString() : null,
      last_success_event_count: isSuccess ? outcome.eventCount : null,
      status: 'unknown',
      last_scraped_at: new Date().toISOString(),
    })
  }
}

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  if (req.method !== 'POST') {
    return jsonResponse({ error: 'POST required' }, 405)
  }

  try {
    const body = await req.json() as { events?: ScrapedEvent[]; sourceOutcomes?: SourceOutcome[] }
    const events = body.events
    const sourceOutcomes = body.sourceOutcomes

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    const supabase = createClient(supabaseUrl, supabaseKey)

    // --- Process source health outcomes (if provided) ---
    let healthUpdated = 0
    if (sourceOutcomes && Array.isArray(sourceOutcomes) && sourceOutcomes.length > 0) {
      for (const outcome of sourceOutcomes) {
        if (!outcome.sourceId) continue
        try {
          await upsertSourceHealth(supabase, outcome)
          healthUpdated++
        } catch (err) {
          console.error(`[cache-events] Health upsert failed for ${outcome.sourceId}:`, (err as Error).message)
        }
      }
      console.log(`[cache-events] Health: updated ${healthUpdated}/${sourceOutcomes.length} sources`)
    }

    // --- If no events, return health-only result ---
    if (!events || !Array.isArray(events) || events.length === 0) {
      if (healthUpdated > 0) {
        return jsonResponse({ cached: 0, updated: 0, enrichQueued: 0, healthUpdated })
      }
      return jsonResponse({ error: 'events array required' }, 400)
    }

    if (events.length > 500) {
      return jsonResponse({ error: 'Max 500 events per request' }, 400)
    }

    let cached = 0
    let updated = 0
    const newEventIds: string[] = []
    const errors: string[] = []

    // Source taxonomy: class + demoted flag drive visibility and the dedup ladder
    const sourceClasses = await loadSourceClasses(supabase)

    // Build rows with event keys
    const rows = await Promise.all(events.map(async (ev) => {
      if (!ev.source || !ev.date || !ev.name || !ev.venue || !ev.url) return null
      const eventKey = await generateEventKey(ev.source, ev.date, ev.name, ev.venue)
      const canonicalKey = await generateCanonicalKey(ev.date, ev.name, ev.venue)
      return {
        event_key: eventKey,
        canonical_key: canonicalKey,
        canonical_url: canonicalizeEventUrl(ev.url),
        visibility: (ev.visibility === 'public' || ev.visibility === 'private')
          ? ev.visibility
          : visibilityFor(ev.source, sourceClasses),
        source_id: ev.source,
        date: ev.date,
        time: ev.time || null,
        name: ev.name,
        venue: ev.venue,
        address: ev.address || null,
        city: ev.city || null,
        genre: ev.genre || null,
        price: ev.price || null,
        ages: ev.ages || null,
        promoter: ev.promoter || null,
        url: ev.url,
        content_type: ev.contentType || null,
        music_type: classifyMusicType(ev),
        description: ev.description || null,
        posted_by: ev.postedBy || null,
        recommended_by: ev.recommendedBy && ev.recommendedBy.length > 0 ? ev.recommendedBy : null,
        scraped_at: new Date().toISOString(),
      }
    }))

    const validRows = rows.filter(Boolean) as Record<string, unknown>[]

    if (validRows.length === 0) {
      return jsonResponse({ cached: 0, updated: 0, enrichQueued: 0, healthUpdated, errors: ['No valid events'] })
    }

    // Dedup ladder: adopt canonical identity from existing rows (URL first,
    // then tiered fuzzy) and apply corroboration visibility upgrades.
    let ladder = { urlAdopted: 0, fuzzyAdopted: 0, upgraded: 0 }
    try {
      ladder = await resolveCanonicalKeys(supabase, validRows, sourceClasses)
      if (ladder.urlAdopted || ladder.fuzzyAdopted || ladder.upgraded) {
        console.log(`[cache-events] Dedup ladder: urlAdopted=${ladder.urlAdopted} fuzzyAdopted=${ladder.fuzzyAdopted} upgraded=${ladder.upgraded}`)
      }
    } catch (err) {
      // Non-fatal: rows keep their name/venue-derived canonical_key
      console.error('[cache-events] Dedup ladder failed:', (err as Error).message)
      errors.push(`Dedup ladder: ${(err as Error).message}`)
    }

    // Check which event_keys already exist. Chunked: .in() with 400 64-char
    // keys builds a ~26KB URL that the gateway rejects — and that failure was
    // silently swallowed, routing every row to insert, where the whole batch
    // died on the unique constraint. Months of scrapes were lost this way.
    const keys = validRows.map(r => r.event_key as string)
    const existingMap = new Map<string, { id: string; enrichment_status: string }>()
    for (let i = 0; i < keys.length; i += 100) {
      const chunk = keys.slice(i, i + 100)
      const { data: existing, error: existErr } = await supabase
        .from('events')
        .select('event_key, id, enrichment_status')
        .in('event_key', chunk)
      if (existErr) {
        // Not fatal: unmatched rows fall through to the insert path, which
        // ignores duplicates — worst case their scraped_at doesn't refresh.
        console.error(`[cache-events] Existence check chunk failed: ${existErr.message}`)
        errors.push(`Existence check: ${existErr.message}`)
        continue
      }
      for (const row of existing || []) {
        existingMap.set(row.event_key, { id: row.id, enrichment_status: row.enrichment_status })
      }
    }

    // Split into inserts and updates. De-dupe within batch by event_key so a
    // single intra-batch collision doesn't abort the whole insert (Postgres
    // unique-constraint violation kills a multi-row insert atomically).
    const seenKeys = new Set<string>()
    const toInsert: Record<string, unknown>[] = []
    const toUpdate: Record<string, unknown>[] = []
    for (const r of validRows) {
      const k = r.event_key as string
      if (existingMap.has(k)) { toUpdate.push(r); continue }
      if (seenKeys.has(k)) continue
      seenKeys.add(k)
      toInsert.push(r)
    }

    // Batch insert new events. ignoreDuplicates makes this immune to a stale
    // existence check — conflicting rows are skipped, never a batch-killing
    // constraint violation.
    if (toInsert.length > 0) {
      const { data: inserted, error: insertErr } = await supabase
        .from('events')
        .upsert(toInsert, { onConflict: 'event_key', ignoreDuplicates: true })
        .select('id, url, enrichment_status')

      if (insertErr) {
        console.error('[cache-events] Insert error:', insertErr.message)
        errors.push(`Insert: ${insertErr.message}`)
      } else {
        cached = inserted?.length || 0
        if (inserted) {
          for (const row of inserted) {
            if (row.url && row.enrichment_status === 'pending') {
              newEventIds.push(row.id)
            }
          }
        }
      }
    }

    // Refresh existing events with ONE bulk upsert per batch. The previous
    // per-row update loop (up to 400 sequential round-trips) blew the edge
    // function's time budget, so every batch after the first 504'd and its
    // events were silently lost — sources late in the run never refreshed.
    // Only scraper-owned columns are included; enrichment-owned columns
    // (description, image_url, tags, genre, content_type, enrichment_*) are
    // omitted so the upsert can't clobber AI-enriched values.
    if (toUpdate.length > 0) {
      const patchRows = toUpdate.map(row => ({
        event_key: row.event_key,
        canonical_key: row.canonical_key,
        canonical_url: row.canonical_url,
        visibility: row.visibility,
        source_id: row.source_id,
        date: row.date,
        time: row.time,
        name: row.name,
        venue: row.venue,
        address: row.address,
        city: row.city,
        price: row.price,
        ages: row.ages,
        promoter: row.promoter,
        url: row.url,
        posted_by: row.posted_by,
        recommended_by: row.recommended_by,
        scraped_at: row.scraped_at,
      }))
      const { data: upserted, error: upsertErr } = await supabase
        .from('events')
        .upsert(patchRows, { onConflict: 'event_key' })
        .select('id')

      if (upsertErr) {
        errors.push(`Bulk update: ${upsertErr.message}`)
      } else {
        updated = upserted?.length || patchRows.length
      }
    }

    // Trigger enrichment for new events (fire-and-forget, batch of up to 10)
    let enrichQueued = 0
    if (newEventIds.length > 0) {
      const batches = []
      for (let i = 0; i < newEventIds.length; i += 10) {
        batches.push(newEventIds.slice(i, i + 10))
      }

      for (const batch of batches) {
        try {
          fetch(`${supabaseUrl}/functions/v1/enrich-event`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${supabaseKey}`,
            },
            body: JSON.stringify({ eventIds: batch }),
          }).catch(err => {
            console.error('[cache-events] Enrich trigger failed:', err.message)
          })
          enrichQueued += batch.length
        } catch (err) {
          console.error('[cache-events] Failed to trigger enrichment:', err)
        }
      }
    }

    console.log(`[cache-events] cached=${cached} updated=${updated} enrichQueued=${enrichQueued} healthUpdated=${healthUpdated} errors=${errors.length}`)

    return jsonResponse({ cached, updated, enrichQueued, healthUpdated, errors: errors.length > 0 ? errors : undefined })
  } catch (err) {
    console.error('[cache-events] Error:', err)
    return jsonResponse({ error: (err as Error).message }, 500)
  }
})
