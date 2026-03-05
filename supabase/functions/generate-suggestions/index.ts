// Supabase Edge Function: generate-suggestions
// Generates 9 daily personalized episode suggestions based on user interests + trending news
//
// POST /functions/v1/generate-suggestions
// Body: { topics: string[], userId?: string }
// Returns: { suggestions: [...], generatedAt: string }

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

interface Suggestion {
  id: string
  title: string
  topic: string
  mode: string
  category: 'topStory' | 'trending' | 'interest' | 'deepDive' | 'wormhole'
  rank: number
}

// ============================================================
// Stage 1: Fetch trending headlines via SerpAPI Google News
// ============================================================

async function fetchTrendingHeadlines(): Promise<{ title: string; snippet: string }[]> {
  const serpApiKey = Deno.env.get('SERP_API_KEY')
  if (!serpApiKey) throw new Error('SERP_API_KEY not configured')

  console.log('[Stage 1] Fetching trending headlines via SerpAPI Google News')
  const params = new URLSearchParams({
    engine: 'google_news',
    q: 'top stories today',
    gl: 'us',
    hl: 'en',
    api_key: serpApiKey,
  })

  const resp = await fetch(`https://serpapi.com/search?${params}`)
  if (!resp.ok) {
    console.error(`[Stage 1] SerpAPI error: ${resp.status}`)
    return []
  }

  const data = await resp.json()
  const results = data.news_results || []

  const headlines = results.slice(0, 15).map((r: any) => ({
    title: r.title || '',
    snippet: r.snippet || r.title || '',
  }))

  console.log(`[Stage 1] Got ${headlines.length} trending headlines`)
  return headlines
}

// ============================================================
// Stage 2: Generate suggestions via Claude
// ============================================================

async function generateSuggestions(
  headlines: { title: string; snippet: string }[],
  userTopics: string[]
): Promise<Suggestion[]> {
  const anthropicKey = Deno.env.get('ANTHROPIC_API_KEY')
  if (!anthropicKey) throw new Error('ANTHROPIC_API_KEY not configured')

  const today = new Date().toLocaleDateString('en-US', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  })

  const headlinesText = headlines
    .map((h, i) => `${i + 1}. ${h.title}`)
    .join('\n')

  const validModes = ['news', 'deep-dive', 'investigative', 'opinion', 'wormhole']

  const prompt = `You are a podcast recommendation engine. Today is ${today}.

Here are today's top headlines:
${headlinesText}

The user is interested in: ${userTopics.join(', ')}

Generate exactly 9 podcast episode suggestions as a JSON array. Each suggestion has: title, topic, mode, category, rank.

Rules:
1. **topStory (rank 0):** A branded compound title covering 3-4 of today's biggest stories. Format: "The Daily Brief: Topic1, Topic2, Topic3" — use "The Daily Brief" as the brand. The topic field should be a comma-separated list of the key subjects. Mode must be "news".

2. **trending (ranks 1-3):** 3 trending news topics from the headlines above, ranked by importance. Each gets a descriptive, compelling title that explains what the episode will cover (NOT just the topic name). Mode must be "news".

3. **interest (ranks 4-6):** One suggestion per user interest (use the first 3 interests: ${userTopics.slice(0, 3).join(', ')}). For each:
   - Pick a RANDOM mode from: ${validModes.join(', ')}
   - Generate a creative, descriptive title that's specific and compelling (e.g. "Why Nuclear Power Is Making a Comeback" not "Nuclear Energy")
   - The topic should match the interest area

4. **deepDive (rank 7):** A deep dive into one of the user's interest areas. Mode must be "deep-dive". Use a descriptive title.

5. **wormhole (rank 8):** An unexpected, weird angle on one of the user's topic areas — something they haven't thought about. Mode must be "wormhole". Use a creative, intriguing title.

Return ONLY a JSON array of 9 objects with these exact fields:
- title (string): The episode title
- topic (string): The underlying topic for generation
- mode (string): One of ${validModes.join(', ')}
- category (string): One of topStory, trending, interest, deepDive, wormhole
- rank (number): 0-8 as specified above

Return ONLY the JSON array, no markdown formatting.`

  console.log('[Stage 2] Calling Claude for suggestion generation')

  const resp = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': anthropicKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 4096,
      messages: [{ role: 'user', content: prompt }],
    }),
  })

  if (!resp.ok) {
    const errText = await resp.text()
    console.error(`[Stage 2] Claude error: ${resp.status} - ${errText}`)
    throw new Error(`Claude API error: ${resp.status}`)
  }

  const result = await resp.json()
  const content = result.content?.[0]?.text || '[]'

  // Parse JSON (handle potential markdown wrapping)
  let cleaned = content.trim()
  if (cleaned.startsWith('```')) {
    cleaned = cleaned.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '')
  }

  const parsed = JSON.parse(cleaned) as any[]
  console.log(`[Stage 2] Generated ${parsed.length} suggestions`)

  // Assign UUIDs
  return parsed.map((s: any) => ({
    id: crypto.randomUUID(),
    title: s.title,
    topic: s.topic,
    mode: s.mode,
    category: s.category,
    rank: s.rank,
  }))
}

// ============================================================
// Stage 3: Log suggestions to database
// ============================================================

async function logSuggestions(
  supabase: any,
  suggestions: Suggestion[],
  userId: string | null,
  generatedAt: string
): Promise<void> {
  if (!userId) return

  const rows = suggestions.map((s) => ({
    user_id: userId,
    suggestion_id: s.id,
    title: s.title,
    topic: s.topic,
    mode: s.mode,
    category: s.category,
    rank: s.rank,
    was_tapped: false,
    generated_at: generatedAt,
  }))

  const { error } = await supabase.from('echo_suggestion_log').insert(rows)
  if (error) {
    console.error('[Stage 3] Failed to log suggestions:', error.message)
  } else {
    console.log(`[Stage 3] Logged ${rows.length} suggestions to echo_suggestion_log`)
  }
}

// ============================================================
// Main handler
// ============================================================

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const { topics, userId } = await req.json()

    if (!topics || !Array.isArray(topics) || topics.length === 0) {
      return new Response(
        JSON.stringify({ error: 'topics array is required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    console.log(`[generate-suggestions] Topics: ${topics.join(', ')}, userId: ${userId || 'anonymous'}`)

    // Stage 1: Fetch trending headlines
    const headlines = await fetchTrendingHeadlines()

    // Stage 2: Generate suggestions via Claude
    const suggestions = await generateSuggestions(headlines, topics)

    const generatedAt = new Date().toISOString()

    // Stage 3: Log to database (non-blocking)
    const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? ''
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    if (supabaseUrl && supabaseKey) {
      const supabase = createClient(supabaseUrl, supabaseKey)
      // Fire and forget — don't block the response
      logSuggestions(supabase, suggestions, userId || null, generatedAt).catch((e) =>
        console.error('[Log] Error:', e)
      )
    }

    return new Response(
      JSON.stringify({ suggestions, generatedAt }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  } catch (err) {
    console.error('[generate-suggestions] Error:', err)
    return new Response(
      JSON.stringify({ error: err.message || 'Internal server error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})
