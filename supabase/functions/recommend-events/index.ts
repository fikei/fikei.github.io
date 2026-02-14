// Supabase Edge Function: recommend-events
// Recommends upcoming events based on a user's Boards profile.
//
// Hybrid approach:
// 1. Query events + discord_event_cache for upcoming events
// 2. Keyword pre-filter: score events against profile signals
// 3. AI ranking: Claude Haiku ranks top candidates with relevance explanations
//
// POST /functions/v1/recommend-events
// Body: { profile: { categories, artists, genres, keywords, domains, contentTypes }, filters? }
// Returns: { events: [...], meta: { eventsScanned, profileSignals, algorithm } }

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const jsonHeaders = { ...corsHeaders, 'Content-Type': 'application/json' }

// --- Supabase client ---

function getSupabase() {
  const url = Deno.env.get('SUPABASE_URL')!
  const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  return createClient(url, key)
}

// --- Types ---

interface EventProfile {
  categories: Record<string, number>
  artists: string[]
  genres: string[]
  keywords: string[]
  domains: Record<string, number>
  contentTypes: Record<string, number>
}

interface EventFilters {
  dateRange?: { start: string; end: string }
  contentTypes?: string[]
  maxResults?: number
}

interface CandidateEvent {
  id: string
  name: string
  venue: string
  date: string
  time: string | null
  genre: string | null
  content_type: string | null
  url: string
  image_url: string | null
  price: string | null
  city: string | null
  description: string | null
  tags: string[] | null
  source: string
  keywordScore: number
}

interface RankedEvent {
  id: string
  name: string
  venue: string
  date: string
  time: string | null
  genre: string | null
  content_type: string | null
  url: string
  image_url: string | null
  price: string | null
  city: string | null
  relevance: {
    score: number
    reasons: string[]
    matchedSignals: string[]
  }
}

// --- Fetch upcoming events from both sources ---

async function fetchUpcomingEvents(
  filters: EventFilters
): Promise<CandidateEvent[]> {
  const supabase = getSupabase()
  const today = new Date().toISOString().split('T')[0]
  const endDate = filters.dateRange?.end ||
    new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]
  const startDate = filters.dateRange?.start || today

  // Query events table
  let query = supabase
    .from('events')
    .select('id, name, venue, date, time, genre, content_type, url, image_url, price, city, description, tags, source_id')
    .gte('date', startDate)
    .lte('date', endDate)
    .order('date', { ascending: true })
    .limit(500)

  if (filters.contentTypes?.length) {
    query = query.in('content_type', filters.contentTypes)
  }

  const { data: scrapedEvents, error: scrapedError } = await query

  if (scrapedError) {
    console.error('[recommend-events] Error fetching events:', scrapedError)
  }

  // Query discord_event_cache
  const { data: discordCache, error: discordError } = await supabase
    .from('discord_event_cache')
    .select('events, guild_id, channel_id')
    .gt('expires_at', new Date().toISOString())

  if (discordError) {
    console.error('[recommend-events] Error fetching discord cache:', discordError)
  }

  // Normalize scraped events
  const events: CandidateEvent[] = (scrapedEvents || []).map(e => ({
    id: e.id,
    name: e.name,
    venue: e.venue,
    date: e.date,
    time: e.time,
    genre: e.genre,
    content_type: e.content_type,
    url: e.url,
    image_url: e.image_url,
    price: e.price,
    city: e.city,
    description: e.description,
    tags: e.tags,
    source: e.source_id || 'scraped',
    keywordScore: 0,
  }))

  // Normalize discord events
  if (discordCache) {
    for (const row of discordCache) {
      const discordEvents = (row.events as any[]) || []
      for (const de of discordEvents) {
        // Skip past events
        if (de.date && de.date < startDate) continue
        if (de.date && de.date > endDate) continue

        events.push({
          id: `discord-${row.guild_id}-${row.channel_id}-${de.date}-${(de.name || '').slice(0, 20)}`,
          name: de.name || de.title || '',
          venue: de.venue || '',
          date: de.date || '',
          time: de.time || null,
          genre: de.genre || null,
          content_type: de.contentType || de.content_type || 'music',
          url: de.url || '',
          image_url: de.image_url || null,
          price: de.price || null,
          city: de.city || null,
          description: de.description || null,
          tags: de.tags || null,
          source: 'discord',
          keywordScore: 0,
        })
      }
    }
  }

  // Deduplicate by name+date+venue (case-insensitive)
  const seen = new Set<string>()
  return events.filter(e => {
    const key = `${e.name.toLowerCase().trim()}|${e.date}|${e.venue.toLowerCase().trim()}`
    if (seen.has(key)) return false
    seen.add(key)
    return e.name.length > 0
  })
}

// --- Keyword pre-filter: score events against profile ---

function scoreEventAgainstProfile(
  event: CandidateEvent,
  profile: EventProfile
): number {
  let score = 0
  const eventText = [
    event.name,
    event.venue,
    event.genre,
    event.description,
    ...(event.tags || []),
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase()

  // Artist match (highest signal, 10 points per match)
  for (const artist of profile.artists) {
    if (artist.length > 2 && eventText.includes(artist.toLowerCase())) {
      score += 10
    }
  }

  // Genre match (5 points per match)
  for (const genre of profile.genres) {
    if (genre.length > 2 && eventText.includes(genre.toLowerCase())) {
      score += 5
    }
  }

  // Keyword match (2 points per match)
  for (const keyword of profile.keywords) {
    if (keyword.length > 3 && eventText.includes(keyword.toLowerCase())) {
      score += 2
    }
  }

  // Content type affinity (3 points if event type matches user's top content types)
  if (event.content_type) {
    const typeMap: Record<string, string[]> = {
      music: ['music', 'listen'],
      film: ['video', 'watch'],
      comedy: ['comedy'],
      theater: ['theater'],
    }
    const eventCategories = typeMap[event.content_type] || []
    for (const cat of eventCategories) {
      if (profile.categories[cat] > 0 || profile.contentTypes[cat] > 0) {
        score += 3
      }
    }
  }

  return score
}

function preFilterEvents(
  events: CandidateEvent[],
  profile: EventProfile,
  maxCandidates: number = 50
): CandidateEvent[] {
  // Score all events
  for (const event of events) {
    event.keywordScore = scoreEventAgainstProfile(event, profile)
  }

  // Sort by score descending, then by date ascending for ties
  events.sort((a, b) => {
    if (b.keywordScore !== a.keywordScore) return b.keywordScore - a.keywordScore
    return a.date.localeCompare(b.date)
  })

  // Return top candidates (include all with score > 0, up to max)
  const withScore = events.filter(e => e.keywordScore > 0)
  if (withScore.length > 0) {
    return withScore.slice(0, maxCandidates)
  }

  // If no keyword matches, return the soonest events for AI to evaluate
  return events.slice(0, Math.min(20, maxCandidates))
}

// --- AI ranking with Claude Haiku ---

async function rankEventsWithAI(
  candidates: CandidateEvent[],
  profile: EventProfile,
  maxResults: number
): Promise<{ rankings: Array<{ event_index: number; score: number; reasons: string[] }>, confidence: number }> {
  const apiKey = Deno.env.get('ANTHROPIC_API_KEY')
  if (!apiKey) {
    console.warn('[recommend-events] No ANTHROPIC_API_KEY, falling back to keyword-only')
    return { rankings: [], confidence: 0 }
  }

  // Build profile summary
  const profileSummary = []
  if (profile.artists.length > 0) {
    profileSummary.push(`Artists/creators they follow: ${profile.artists.slice(0, 15).join(', ')}`)
  }
  if (profile.genres.length > 0) {
    profileSummary.push(`Genres/tags: ${profile.genres.slice(0, 10).join(', ')}`)
  }
  if (profile.keywords.length > 0) {
    profileSummary.push(`Keywords from saved content: ${profile.keywords.slice(0, 15).join(', ')}`)
  }
  const topCategories = Object.entries(profile.categories)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([cat, count]) => `${cat} (${count})`)
  if (topCategories.length > 0) {
    profileSummary.push(`Content categories: ${topCategories.join(', ')}`)
  }

  // Build events list
  const eventsList = candidates.map((e, i) =>
    `${i + 1}. "${e.name}" at ${e.venue || 'TBA'} on ${e.date}${e.genre ? ` [${e.genre}]` : ''}${e.content_type ? ` (${e.content_type})` : ''}${e.description ? ` — ${e.description.slice(0, 100)}` : ''}`
  ).join('\n')

  const prompt = `You are an event recommendation engine. Given a user's interests and upcoming events, rank the events by relevance to the user.

USER INTERESTS:
${profileSummary.join('\n')}

CANDIDATE EVENTS:
${eventsList}

Return a JSON object with:
- "rankings": array of the top ${maxResults} most relevant events, each with:
  - "event_index": the event number (1-based)
  - "score": relevance score 0.0-1.0
  - "reasons": array of 1-2 short reasons referencing specific user interests
- "confidence": overall confidence in recommendations (0.0-1.0)

RULES:
- Only include events scoring above 0.3
- Reasons must reference specific user interests (artist names, genres, keywords)
- Prefer exact artist/genre matches over vague keyword overlap
- If no events are relevant, return {"rankings": [], "confidence": 0}
- Keep each reason under 15 words

Respond with valid JSON only.`

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-3-haiku-20240307',
        max_tokens: 512,
        messages: [{ role: 'user', content: prompt }],
      }),
    })

    if (!response.ok) {
      console.error('[recommend-events] Anthropic API error:', response.status)
      return { rankings: [], confidence: 0 }
    }

    const data = await response.json()
    const textContent = data.content?.[0]?.text || ''

    // Parse JSON (handle markdown wrapping)
    let cleaned = textContent
      .replace(/```json\n?/g, '')
      .replace(/```\n?/g, '')
      .trim()

    let parsed: any
    try {
      parsed = JSON.parse(cleaned)
    } catch {
      const firstBrace = cleaned.indexOf('{')
      const lastBrace = cleaned.lastIndexOf('}')
      if (firstBrace >= 0 && lastBrace > firstBrace) {
        parsed = JSON.parse(cleaned.substring(firstBrace, lastBrace + 1))
      } else {
        console.error('[recommend-events] Failed to parse AI response')
        return { rankings: [], confidence: 0 }
      }
    }

    return {
      rankings: parsed.rankings || [],
      confidence: parsed.confidence || 0,
    }
  } catch (err) {
    console.error('[recommend-events] AI ranking error:', err)
    return { rankings: [], confidence: 0 }
  }
}

// --- Main handler ---

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const { profile, filters = {} } = await req.json() as {
      profile: EventProfile
      filters?: EventFilters
    }

    // Validate profile
    if (!profile) {
      return new Response(
        JSON.stringify({ error: 'profile is required' }),
        { status: 400, headers: jsonHeaders }
      )
    }

    const maxResults = filters.maxResults || 5
    const startTime = Date.now()

    // Count profile signals
    const profileSignals =
      (profile.artists?.length || 0) +
      (profile.genres?.length || 0) +
      (profile.keywords?.length || 0)

    console.log(`[recommend-events] Profile: ${profileSignals} signals, ${Object.keys(profile.categories || {}).length} categories`)

    // Step 1: Fetch upcoming events
    const allEvents = await fetchUpcomingEvents(filters)
    console.log(`[recommend-events] Fetched ${allEvents.length} upcoming events`)

    if (allEvents.length === 0) {
      return new Response(
        JSON.stringify({
          events: [],
          meta: { eventsScanned: 0, profileSignals, algorithm: 'none' },
        }),
        { headers: jsonHeaders }
      )
    }

    // Step 2: Keyword pre-filter
    const candidates = preFilterEvents(allEvents, profile, 50)
    const hasKeywordMatches = candidates.some(c => c.keywordScore > 0)
    console.log(`[recommend-events] Pre-filtered to ${candidates.length} candidates (keyword matches: ${hasKeywordMatches})`)

    // Step 3: AI ranking (if we have signals and API key)
    let rankedEvents: RankedEvent[] = []
    let algorithm: 'hybrid' | 'keyword-only' = 'keyword-only'

    if (profileSignals > 0 && candidates.length > 0) {
      const { rankings, confidence } = await rankEventsWithAI(candidates, profile, maxResults)

      if (rankings.length > 0) {
        algorithm = 'hybrid'
        rankedEvents = rankings
          .filter(r => r.event_index >= 1 && r.event_index <= candidates.length)
          .map(r => {
            const event = candidates[r.event_index - 1]
            return {
              id: event.id,
              name: event.name,
              venue: event.venue,
              date: event.date,
              time: event.time,
              genre: event.genre,
              content_type: event.content_type,
              url: event.url,
              image_url: event.image_url,
              price: event.price,
              city: event.city,
              relevance: {
                score: r.score,
                reasons: r.reasons || [],
                matchedSignals: [],
              },
            }
          })

        console.log(`[recommend-events] AI ranked ${rankedEvents.length} events (confidence: ${confidence})`)
      }
    }

    // Fallback: use keyword-scored events if AI didn't produce results
    if (rankedEvents.length === 0 && hasKeywordMatches) {
      rankedEvents = candidates
        .filter(c => c.keywordScore > 0)
        .slice(0, maxResults)
        .map(event => ({
          id: event.id,
          name: event.name,
          venue: event.venue,
          date: event.date,
          time: event.time,
          genre: event.genre,
          content_type: event.content_type,
          url: event.url,
          image_url: event.image_url,
          price: event.price,
          city: event.city,
          relevance: {
            score: Math.min(event.keywordScore / 20, 1),
            reasons: ['Matches keywords from your saved content'],
            matchedSignals: [],
          },
        }))
    }

    const elapsed = Date.now() - startTime
    console.log(`[recommend-events] Done in ${elapsed}ms: ${rankedEvents.length} results (${algorithm})`)

    return new Response(
      JSON.stringify({
        events: rankedEvents,
        meta: {
          eventsScanned: allEvents.length,
          profileSignals,
          algorithm,
        },
      }),
      { headers: jsonHeaders }
    )
  } catch (err) {
    console.error('[recommend-events] Error:', err)
    return new Response(
      JSON.stringify({ error: 'Internal error', detail: String(err) }),
      { status: 500, headers: jsonHeaders }
    )
  }
})
