// Supabase Edge Function: generate-podcast
// 4-stage AI pipeline: source aggregation → bias classification → script generation → ElevenLabs TTS
//
// POST /functions/v1/generate-podcast
// Body: { topic: string, mode: "news" | "deep-dive" | "investigative" | "opinion" | "wormhole", userId?: string, biasPreference?: "left" | "center" | "right" | "balanced" }
// Returns: { episode: { id, topic, title, description, mode, transcript, sources, biasDistribution, audioUrls, durationSeconds, status } }

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const VERSION = '1.2.1'
console.log(`[generate-podcast] v${VERSION} - migrate to claude-sonnet-4-6 (Sonnet 4 retired)`)

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

// ============================================================
// Types
// ============================================================

interface Source {
  index: number
  title: string
  url: string
  domain: string
  snippet: string
  bias?: string
  type?: string
}

interface TranscriptCue {
  speaker: 'synthesizer' | 'challenger' | 'expert'
  text: string
  segment: string
  citations: number[]
}

interface BiasDistribution {
  left: number
  'center-left': number
  center: number
  'center-right': number
  right: number
  international: number
}

interface Episode {
  id: string
  topic: string
  title: string
  description: string
  mode: string
  transcript: TranscriptCue[]
  sources: Source[]
  biasDistribution: BiasDistribution
  audioUrls: string[]
  durationSeconds: number
  status: 'ready' | 'partial' | 'no-audio'
}

// ============================================================
// Mode configurations — search strategies, segments, word targets
// ============================================================

interface ModeConfig {
  searchStrategy: 'breaking' | 'broad' | 'investigative' | 'opinion' | 'lateral'
  segments: string[]
  targetWords: number
  voiceStyle: string  // prompt instructions for voice tone
  structurePrompt: string  // how to structure the argument
  scriptStyle: string  // how the script should read
}

const MODE_CONFIGS: Record<string, ModeConfig> = {
  news: {
    searchStrategy: 'breaking',
    segments: ['headline', 'context', 'key_developments', 'implications', 'wrap'],
    targetWords: 750,  // ~5 min at 150 wpm
    voiceStyle: 'Crisp, urgent, clear. Like the top of an NPR newscast.',
    structurePrompt: `Use the INVERTED TRIANGLE structure:
1. headline — the single most important thing (who, what, when, where)
2. context — essential background in 2-3 sentences
3. key_developments — the 2-3 most important new facts or developments
4. implications — why this matters, what happens next
5. wrap — one-sentence signoff

This is a 5-minute briefing. Be concise. No filler. Every sentence earns its place.`,
    scriptStyle: `Write like a tight news briefing. Short sentences. Active voice. Lead with the most important fact.
- synthesizer: anchor delivering the news clearly and concisely
- challenger: asks the one question the audience is thinking
- expert: provides the critical context in 1-2 sentences
Total ~750 words. No meandering. Cut anything that doesn't inform.
Voice direction: [serious tone] and [urgent] on synthesizer cues. Challenger asks one sharp question — can start with [cuts in]. Expert gives a [matter-of-fact] two-sentence verdict. Tight, clipped delivery. Em-dashes for pivots: "Three people are dead — and officials still have no answers."`,
  },

  'deep-dive': {
    searchStrategy: 'broad',
    segments: ['cold_open', 'context', 'history', 'argument_a', 'argument_b', 'expert_insight', 'cross_examination', 'synthesis'],
    targetWords: 3500,  // ~23 min at 150 wpm
    voiceStyle: 'Conversational but substantive. Like a long-form NPR feature.',
    structurePrompt: `Structure as a comprehensive exploration:
1. cold_open — drop the listener mid-conversation, as if they walked in on a discussion already happening. No "Welcome to the show." Start with a provocative statement or mid-thought
2. context — what's happening now and why it matters
3. history — how we got here (key turning points)
4. argument_a — the strongest case for one perspective
5. argument_b — the strongest counter-perspective
6. expert_insight — deeper technical or domain-specific analysis
7. cross_examination — challenge both sides, find the weak points
8. synthesis — what we actually know, what remains uncertain

This is a 20-30 minute deep dive. Go deep on context and history that a quick news briefing would skip.`,
    scriptStyle: `Write like a long-form NPR feature with real depth. Each segment should feel like a mini-chapter.
- synthesizer: guides the narrative, connects ideas, provides transitions
- challenger: probes assumptions, surfaces contradictions, plays devil's advocate
- expert: provides the depth — data, historical parallels, domain expertise
Total ~3500 words. Allow ideas to breathe. Use specific examples and data.
Voice direction: synthesizer uses [thoughtful] and [curious] transitions. Challenger uses [skeptical] and [hesitates] before pushing back. Expert uses [matter-of-fact] for data and [emphatic] for key insights. Use "uh" and "I mean" before complex explanations. Allow moments of genuine surprise: "[gasps] Wait, that can't be right."`,
  },

  investigative: {
    searchStrategy: 'investigative',
    segments: ['cold_open', 'the_question', 'evidence_trail', 'key_players', 'contradictions', 'expert_analysis', 'connecting_dots', 'what_we_know', 'unanswered'],
    targetWords: 4500,  // ~30 min at 150 wpm
    voiceStyle: 'Serious, methodical, building tension. Like a podcast version of investigative journalism.',
    structurePrompt: `Structure as an investigative narrative that follows the evidence:
1. cold_open — drop in mid-conversation. No formal intro. Start with a specific, gripping detail that makes the listener lean in
2. the_question — frame the central question this investigation is trying to answer
3. evidence_trail — walk through the key evidence chronologically, source by source
4. key_players — who is involved, what are their motivations and interests
5. contradictions — where do official narratives break down, what doesn't add up
6. expert_analysis — domain experts weigh in on what the evidence means
7. connecting_dots — the big picture: how individual facts form a pattern
8. what_we_know — state clearly and precisely what is established vs. alleged
9. unanswered — honest about what remains unknown, what needs further investigation

This is a 30-minute investigative episode. Follow the facts. Name sources. Be precise about what is established vs. what is alleged. Build narrative tension by revealing facts in order.`,
    scriptStyle: `Write like investigative journalism for audio. Precise. Source-heavy. Build narrative momentum.
- synthesizer: the investigative narrator — walks through evidence methodically, builds the case
- challenger: the skeptic — "but wait, how do we know that?", "who benefits from this narrative?"
- expert: the analyst — connects this to broader patterns, provides forensic-level detail
Total ~4500 words. Every claim needs a source. Distinguish clearly between fact, allegation, and inference. Use phrases like "according to [source]", "records show", "what we can verify is".
Voice direction: synthesizer uses [serious tone] throughout, [dramatic tone] before key reveals. Challenger uses [skeptical] "but wait, how do we know that?" and [scoffs] at weak claims. Expert uses [matter-of-fact] for evidence and [pause] before connecting dots. Use sentence fragments for impact: "11:47pm. Two hours before the press conference." Build with [whispers] for tension: "[whispers] And here's what they didn't want anyone to see."`,
  },

  opinion: {
    searchStrategy: 'opinion',
    segments: ['framing', 'perspective_1', 'steelman_1', 'perspective_2', 'steelman_2', 'perspective_3', 'clash', 'common_ground', 'listener_challenge'],
    targetWords: 4500,  // ~30 min at 150 wpm
    voiceStyle: 'Passionate but fair. Like a great roundtable debate where everyone gets their best shot.',
    structurePrompt: `Structure as a rigorous exploration of multiple perspectives:
1. framing — present the topic and why reasonable people disagree about it
2. perspective_1 — the strongest version of the first major viewpoint
3. steelman_1 — make this perspective even stronger than its proponents usually do
4. perspective_2 — the strongest version of the opposing viewpoint
5. steelman_2 — steelman this perspective too
6. perspective_3 — a third perspective that complicates the binary (could be international, historical, or non-obvious)
7. clash — direct confrontation of the strongest arguments from each side
8. common_ground — where do these perspectives actually agree, even if they don't realize it
9. listener_challenge — pose the question back to the listener with the best evidence from all sides

This is a 30-minute opinion exploration. The goal is NOT to be neutral — it's to make every perspective as strong as possible, then let them collide. The listener should feel genuinely torn.`,
    scriptStyle: `Write like a world-class debate where every participant is at their best. No straw men.
- synthesizer: the moderator — frames fairly, ensures each perspective gets its strongest airing
- challenger: the provocateur — deliberately takes each side to its logical extreme, asks "so what?"
- expert: the evidence-keeper — grounds opinions in data, history, and real-world outcomes
Total ~4500 words. Each perspective should be presented so well that the listener could mistake the show for actually advocating it. Use real quotes and data from sources.
Voice direction: challenger uses [interrupting] during clashes and [passionate] when advocating: "[cuts in] But that completely ignores—". Synthesizer stays [thoughtful] and measured: "[sighs] Look, I hear both sides, but..." Expert uses [emphatic] on data points. Use rhetorical questions: "Is that really the standard we want to set?" Disfluency matters here — "I mean, you know, that's — that's a really hard question."`,
  },

  wormhole: {
    searchStrategy: 'lateral',
    segments: ['hook', 'the_rabbit_hole', 'unexpected_connection', 'deep_weird', 'historical_parallel', 'expert_tangent', 'mind_blown', 'return_to_surface'],
    targetWords: 4500,  // ~30 min at 150 wpm
    voiceStyle: 'Curious, playful, increasingly amazed. Like discovering something incredible at 2am.',
    structurePrompt: `Structure as a journey down an unexpected rabbit hole:
1. hook — drop in mid-discovery. Start as if the hosts just found something wild: "—okay so I was reading about this and you're not going to believe—"
2. the_rabbit_hole — the first unexpected connection or fact that pulls us deeper
3. unexpected_connection — how this topic connects to something seemingly unrelated
4. deep_weird — the strangest, most surprising aspect — the thing that makes you go "wait, WHAT?"
5. historical_parallel — a bizarre historical echo or precedent nobody talks about
6. expert_tangent — an expert perspective that reframes everything
7. mind_blown — the moment where all the threads come together into something genuinely surprising
8. return_to_surface — come back to the original topic, but now the listener sees it completely differently

This is a 30-minute wormhole episode. The goal is to take a familiar topic and find the angle nobody is talking about. Think: "the real story behind the story", unexpected consequences, hidden connections, the absurd detail that reveals a deeper truth. Be genuinely curious and surprised.`,
    scriptStyle: `Write like the best late-night Wikipedia rabbit hole, but with the production quality of Radiolab.
- synthesizer: the curious guide — "okay but here's where it gets weird", genuinely delighted by discoveries
- challenger: the grounding voice — "hold on, is this actually true?", keeps things honest
- expert: the obsessive — knows the deep lore, the footnotes, the connections nobody else sees
Total ~4500 words. Prioritize surprise and genuine discovery. Use narrative cliffhangers between segments. The tone should be: "you're not going to believe this, but it's all real".
Voice direction: synthesizer uses [excited] builds to reveals: "[excited] And then — this is the part that broke my brain — it turns out..." Challenger uses [skeptical] grounding: "[scoffs] Hold on, is this actually true?" Expert uses [awe] for genuine wonder. All speakers should react: "[gasps] Wait. Wait, wait, wait." "[laughs] I know, right?" Use disfluency for discovery: "so it's, uh, it's actually connected to — okay you're not gonna believe this."`,
  },
}

// ============================================================
// In-memory cache (1-hour TTL)
// ============================================================

const cache = new Map<string, { episode: Episode; expiresAt: number }>()

function getCached(key: string): Episode | null {
  const entry = cache.get(key)
  if (!entry) return null
  if (Date.now() > entry.expiresAt) {
    cache.delete(key)
    return null
  }
  return entry.episode
}

function setCached(key: string, episode: Episode): void {
  cache.set(key, { episode, expiresAt: Date.now() + 60 * 60 * 1000 })
}

// ============================================================
// Stage 1: Source Aggregation via SerpAPI
// ============================================================

async function fetchSources(topic: string, mode: string = 'news'): Promise<Source[]> {
  const serpApiKey = Deno.env.get('SERP_API_KEY')
  if (!serpApiKey) throw new Error('SERP_API_KEY not configured')

  const config = MODE_CONFIGS[mode] ?? MODE_CONFIGS.news
  const allResults: Source[] = []
  let index = 1

  if (config.searchStrategy === 'breaking') {
    // NEWS: Google News for recency + recent analysis
    const newsQueries = [`${topic}`, `${topic} analysis perspectives`]
    for (const query of newsQueries) {
      console.log(`[Stage 1] SerpAPI Google News query: "${query}"`)
      const params = new URLSearchParams({
        api_key: serpApiKey, engine: 'google_news', q: query, hl: 'en', gl: 'us',
      })
      const t0 = Date.now()
      const res = await fetch(`https://serpapi.com/search.json?${params}`)
      console.log(`[Stage 1] SerpAPI News response: ${res.status} (${Date.now() - t0}ms)`)
      if (!res.ok) { console.error(`[Stage 1] SerpAPI News error:`, await res.text()); continue }
      const data = await res.json()
      for (const result of (data.news_results ?? []).slice(0, 6)) {
        const link = result.link ?? result.stories?.[0]?.link
        const title = result.title ?? result.stories?.[0]?.title
        if (!link || !title) continue
        try { allResults.push({ index: index++, title, url: link, domain: new URL(link).hostname.replace('www.', ''), snippet: result.snippet ?? result.date ?? '' }) } catch { continue }
      }
    }
    // Also grab recent opinion/analysis
    const analysisParams = new URLSearchParams({ api_key: serpApiKey, engine: 'google', q: `${topic} opinion analysis`, num: '6', hl: 'en', tbs: 'qdr:w' })
    const analysisRes = await fetch(`https://serpapi.com/search.json?${analysisParams}`)
    if (analysisRes.ok) {
      const data = await analysisRes.json()
      for (const result of (data.organic_results ?? []).slice(0, 4)) {
        if (!result.link || !result.title) continue
        try { allResults.push({ index: index++, title: result.title, url: result.link, domain: new URL(result.link).hostname.replace('www.', ''), snippet: result.snippet ?? '' }) } catch { continue }
      }
    }

  } else if (config.searchStrategy === 'investigative') {
    // INVESTIGATIVE: primary sources, documents, timelines, fact-checks
    const queries = [
      `${topic} investigation facts timeline`,
      `${topic} documents records evidence`,
      `${topic} fact check analysis`,
      `${topic} who what when where`,
    ]
    for (const query of queries) {
      console.log(`[Stage 1] SerpAPI query: "${query}"`)
      const params = new URLSearchParams({ api_key: serpApiKey, engine: 'google', q: query, num: '6', hl: 'en' })
      const t0 = Date.now()
      const res = await fetch(`https://serpapi.com/search.json?${params}`)
      console.log(`[Stage 1] SerpAPI response: ${res.status} (${Date.now() - t0}ms)`)
      if (!res.ok) { console.error(`[Stage 1] SerpAPI error:`, await res.text()); continue }
      const data = await res.json()
      for (const result of (data.organic_results ?? []).slice(0, 5)) {
        if (!result.link || !result.title) continue
        try { allResults.push({ index: index++, title: result.title, url: result.link, domain: new URL(result.link).hostname.replace('www.', ''), snippet: result.snippet ?? '' }) } catch { continue }
      }
    }

  } else if (config.searchStrategy === 'opinion') {
    // OPINION: explicitly seek diverse editorial perspectives
    const queries = [
      `${topic} editorial opinion`,
      `${topic} conservative perspective`,
      `${topic} progressive perspective`,
      `${topic} international view`,
    ]
    for (const query of queries) {
      console.log(`[Stage 1] SerpAPI query: "${query}"`)
      const params = new URLSearchParams({ api_key: serpApiKey, engine: 'google', q: query, num: '6', hl: 'en' })
      const t0 = Date.now()
      const res = await fetch(`https://serpapi.com/search.json?${params}`)
      console.log(`[Stage 1] SerpAPI response: ${res.status} (${Date.now() - t0}ms)`)
      if (!res.ok) { console.error(`[Stage 1] SerpAPI error:`, await res.text()); continue }
      const data = await res.json()
      for (const result of (data.organic_results ?? []).slice(0, 5)) {
        if (!result.link || !result.title) continue
        try { allResults.push({ index: index++, title: result.title, url: result.link, domain: new URL(result.link).hostname.replace('www.', ''), snippet: result.snippet ?? '' }) } catch { continue }
      }
    }

  } else if (config.searchStrategy === 'lateral') {
    // WORMHOLE: weird angles, unexpected connections, historical oddities
    const queries = [
      `${topic} unexpected surprising fact`,
      `${topic} history bizarre strange`,
      `${topic} connection nobody talks about`,
      `${topic} rabbit hole deep dive weird`,
    ]
    for (const query of queries) {
      console.log(`[Stage 1] SerpAPI query: "${query}"`)
      const params = new URLSearchParams({ api_key: serpApiKey, engine: 'google', q: query, num: '6', hl: 'en' })
      const t0 = Date.now()
      const res = await fetch(`https://serpapi.com/search.json?${params}`)
      console.log(`[Stage 1] SerpAPI response: ${res.status} (${Date.now() - t0}ms)`)
      if (!res.ok) { console.error(`[Stage 1] SerpAPI error:`, await res.text()); continue }
      const data = await res.json()
      for (const result of (data.organic_results ?? []).slice(0, 5)) {
        if (!result.link || !result.title) continue
        try { allResults.push({ index: index++, title: result.title, url: result.link, domain: new URL(result.link).hostname.replace('www.', ''), snippet: result.snippet ?? '' }) } catch { continue }
      }
    }

  } else {
    // BROAD (deep-dive default): depth + breadth
    const queries = [`${topic} debate perspectives`, `${topic} analysis research`]
    for (const query of queries) {
      console.log(`[Stage 1] SerpAPI query: "${query}"`)
      const params = new URLSearchParams({ api_key: serpApiKey, engine: 'google', q: query, num: '8', hl: 'en' })
      const t0 = Date.now()
      const res = await fetch(`https://serpapi.com/search.json?${params}`)
      console.log(`[Stage 1] SerpAPI response: ${res.status} (${Date.now() - t0}ms)`)
      if (!res.ok) { console.error(`[Stage 1] SerpAPI error:`, await res.text()); continue }
      const data = await res.json()
      for (const result of (data.organic_results ?? []).slice(0, 6)) {
        if (!result.link || !result.title) continue
        try { allResults.push({ index: index++, title: result.title, url: result.link, domain: new URL(result.link).hostname.replace('www.', ''), snippet: result.snippet ?? '' }) } catch { continue }
      }
    }
  }

  // Deduplicate by domain
  const seen = new Set<string>()
  const deduped: Source[] = []
  for (const source of allResults) {
    if (!seen.has(source.domain)) {
      seen.add(source.domain)
      deduped.push(source)
    }
  }
  console.log(`[Stage 1] Total: ${allResults.length} raw → ${deduped.length} deduped sources`)

  // Source diversity: round-robin across bias buckets
  const KNOWN_LEFT = new Set(['nytimes.com', 'washingtonpost.com', 'msnbc.com', 'theguardian.com', 'vox.com', 'slate.com', 'motherjones.com', 'huffpost.com', 'thenation.com', 'theatlantic.com', 'cnn.com'])
  const KNOWN_RIGHT = new Set(['foxnews.com', 'nationalreview.com', 'dailywire.com', 'washingtontimes.com', 'breitbart.com', 'nypost.com', 'wsj.com', 'freebeacon.com', 'thefederalist.com', 'dailycaller.com', 'newsmax.com'])
  const KNOWN_INTL = new Set(['bbc.com', 'bbc.co.uk', 'reuters.com', 'aljazeera.com', 'dw.com', 'france24.com', 'scmp.com', 'japantimes.co.jp'])

  function roughBias(domain: string): string {
    if (KNOWN_LEFT.has(domain)) return 'left'
    if (KNOWN_RIGHT.has(domain)) return 'right'
    if (KNOWN_INTL.has(domain)) return 'international'
    return 'center'
  }

  const buckets: Record<string, Source[]> = { left: [], center: [], right: [], international: [] }
  for (const s of deduped) { buckets[roughBias(s.domain)].push(s) }
  console.log(`[Stage 1] Diversity: L=${buckets.left.length} C=${buckets.center.length} R=${buckets.right.length} I=${buckets.international.length}`)

  const diverse: Source[] = []
  const TARGET = mode === 'news' ? 8 : 14
  const bucketKeys = ['left', 'center', 'right', 'international']
  const bucketIndices: Record<string, number> = { left: 0, center: 0, right: 0, international: 0 }

  let passes = 0
  while (diverse.length < TARGET && passes < 10) {
    let addedThisPass = false
    for (const key of bucketKeys) {
      if (bucketIndices[key] < buckets[key].length) {
        diverse.push(buckets[key][bucketIndices[key]])
        bucketIndices[key]++
        addedThisPass = true
        if (diverse.length >= TARGET) break
      }
    }
    if (!addedThisPass) break
    passes++
  }

  diverse.forEach((s, i) => { s.index = i + 1 })
  console.log(`[Stage 1] Final: ${diverse.length} diverse sources`)
  return diverse
}

// ============================================================
// Stage 2: Bias Classification via Claude
// ============================================================

async function classifySources(sources: Source[]): Promise<Source[]> {
  const anthropicKey = Deno.env.get('ANTHROPIC_API_KEY')
  if (!anthropicKey) throw new Error('ANTHROPIC_API_KEY not configured')

  const sourceList = sources.map(s => `${s.index}. [${s.domain}] ${s.title}\n   ${s.snippet}`).join('\n\n')

  const prompt = `Classify each source's political/ideological bias and content type.

Sources:
${sourceList}

For each source number, respond with JSON in this exact format (one object per line):
{"index": 1, "bias": "center-left", "type": "news"}

Bias categories: left, center-left, center, center-right, right, international
Type categories: news, opinion, analysis, research, government

Respond ONLY with the JSON objects, one per line, no other text.`

  console.log(`[Stage 2] Calling Claude for bias classification (${sources.length} sources)`)
  const t0 = Date.now()
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'x-api-key': anthropicKey, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
    body: JSON.stringify({ model: 'claude-sonnet-4-6', max_tokens: 1024, messages: [{ role: 'user', content: prompt }] }),
  })
  console.log(`[Stage 2] Claude response: ${res.status} (${Date.now() - t0}ms)`)

  if (!res.ok) { console.error('[Stage 2] Claude error:', await res.text()); return sources }

  const data = await res.json()
  const text: string = data.content?.[0]?.text ?? ''
  const classificationMap = new Map<number, { bias: string; type: string }>()
  for (const line of text.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed.startsWith('{')) continue
    try {
      const parsed = JSON.parse(trimmed)
      if (parsed.index && parsed.bias && parsed.type) classificationMap.set(parsed.index, { bias: parsed.bias, type: parsed.type })
    } catch { /* skip */ }
  }

  return sources.map(s => ({ ...s, bias: classificationMap.get(s.index)?.bias ?? 'center', type: classificationMap.get(s.index)?.type ?? 'news' }))
}

function computeBiasDistribution(sources: Source[]): BiasDistribution {
  const counts: Record<string, number> = { left: 0, 'center-left': 0, center: 0, 'center-right': 0, right: 0, international: 0 }
  for (const s of sources) { const bias = s.bias ?? 'center'; if (bias in counts) counts[bias]++ }
  const total = sources.length || 1
  return {
    left: Math.round((counts.left / total) * 100),
    'center-left': Math.round((counts['center-left'] / total) * 100),
    center: Math.round((counts.center / total) * 100),
    'center-right': Math.round((counts['center-right'] / total) * 100),
    right: Math.round((counts.right / total) * 100),
    international: Math.round((counts.international / total) * 100),
  }
}

// ============================================================
// Stage 3: Script Generation via Claude (two calls)
// ============================================================

async function generateScript(topic: string, sources: Source[], mode: string = 'news', biasPreference: string = 'balanced'): Promise<TranscriptCue[]> {
  const anthropicKey = Deno.env.get('ANTHROPIC_API_KEY')
  if (!anthropicKey) throw new Error('ANTHROPIC_API_KEY not configured')

  const config = MODE_CONFIGS[mode] ?? MODE_CONFIGS.news

  const sourcesSummary = sources
    .map(s => `[${s.index}] ${s.title} (${s.domain}, bias: ${s.bias ?? 'unknown'}, type: ${s.type ?? 'unknown'})\n    Snippet: ${s.snippet}`)
    .join('\n\n')

  const today = new Date().toISOString().slice(0, 10)

  // Date context for modes that need recency
  const dateContext = (mode === 'news' || mode === 'investigative')
    ? `\n\nToday's date is ${today}. Ground your discussion in current events and recent developments.`
    : `\n\nToday's date is ${today}.`

  // Bias preference framing
  const biasContext = biasPreference === 'balanced'
    ? '\n\nPresent all perspectives equally and fairly.'
    : biasPreference === 'left'
    ? '\n\nThe listener prefers a left-leaning perspective. Lead with progressive viewpoints but still present opposing views. Aim for 60% left, 20% center, 20% right.'
    : biasPreference === 'right'
    ? '\n\nThe listener prefers a right-leaning perspective. Lead with conservative viewpoints but still present opposing views. Aim for 60% right, 20% center, 20% left.'
    : '\n\nThe listener prefers a centrist perspective. Emphasize moderate, pragmatic viewpoints. Aim for 60% center, 20% left, 20% right.'

  // Call 1: Argument structuring
  const structurePrompt = `You are structuring a podcast episode on: "${topic}"
${dateContext}${biasContext}

${config.structurePrompt}

Available sources (with bias labels):
${sourcesSummary}

Three voices:
- synthesizer: balanced moderator, presents multiple views
- challenger: devil's advocate, pushes back on assumptions
- expert: domain specialist, provides depth

For each segment, specify:
1. Which speaker leads
2. Key points to cover
3. Which source indices to cite (use [1], [2], etc.)
4. Target word count (total ~${config.targetWords} words across all segments)

Segments: ${config.segments.join(', ')}

Respond with a JSON array:
[{"segment": "${config.segments[0]}", "speaker": "synthesizer", "keyPoints": ["..."], "citations": [1, 2], "targetWords": ${Math.round(config.targetWords / config.segments.length)}}, ...]`

  console.log(`[Stage 3a] Calling Claude for argument structure (mode: ${mode})`)
  const t1 = Date.now()
  const structureRes = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'x-api-key': anthropicKey, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
    body: JSON.stringify({ model: 'claude-sonnet-4-6', max_tokens: 2048, messages: [{ role: 'user', content: structurePrompt }] }),
  })
  console.log(`[Stage 3a] Claude response: ${structureRes.status} (${Date.now() - t1}ms)`)

  if (!structureRes.ok) {
    console.error('[Stage 3a] Claude error:', await structureRes.text())
    throw new Error(`Claude structure call failed: ${structureRes.status}`)
  }

  const structureData = await structureRes.json()
  const structureText: string = structureData.content?.[0]?.text ?? '[]'

  let argumentStructure: Array<{ segment: string; speaker: string; keyPoints: string[]; citations: number[]; targetWords: number }> = []
  try {
    const jsonMatch = structureText.match(/\[[\s\S]*\]/)
    if (jsonMatch) argumentStructure = JSON.parse(jsonMatch[0])
  } catch { console.error('[Stage 3a] Failed to parse argument structure') }

  if (argumentStructure.length === 0) {
    argumentStructure = config.segments.map((seg, i) => ({
      segment: seg,
      speaker: i % 3 === 0 ? 'synthesizer' : i % 3 === 1 ? 'challenger' : 'expert',
      keyPoints: [`Discuss ${topic} from the ${seg} perspective`],
      citations: sources.slice(0, 2).map(s => s.index),
      targetWords: Math.round(config.targetWords / config.segments.length),
    }))
  }

  // Call 2: Full script generation
  const scriptPrompt = `You are writing a podcast script on: "${topic}"
${dateContext}${biasContext}

${config.voiceStyle}

Use this argument structure:
${JSON.stringify(argumentStructure, null, 2)}

Source reference (cite by index number):
${sources.map(s => `[${s.index}] ${s.title} — ${s.domain}`).join('\n')}

${config.scriptStyle}

Rules for human-sounding podcast speech:

DISFLUENCY — sound like real humans thinking out loud:
- Use filler words before complex explanations: "I mean," "you know," "uh," "like"
- Include mid-thought corrections: "it was — no, actually it was..."
- Use verbal thinking: "So what that means is..." / "Let me put it this way..."
- Add brief affirmations reacting to the previous speaker: "Right." / "Exactly." / "Mmhmm."
- Don't overdo it — 2-3 disfluencies per cue maximum. Place them where a human would genuinely pause to think.

AUDIO PERFORMANCE TAGS — embed these directly in the text to direct how lines are spoken:
- Use [laughs], [sighs], [hesitates], [scoffs], [gasps] for natural non-verbal moments
- Use [serious tone], [lighthearted], [excited], [matter-of-fact] to set emotional register
- Use [pause] or [long pause] for dramatic beats
- Use [interrupting] or [cuts in] when a speaker jumps in before another finishes
- Use [whispers] or [speaking softly] for intimate or tense moments
- Place tags BEFORE the text they affect: "[hesitates] I'm not sure that's the whole story."
- Use sparingly — 1-3 tags per cue. Let the words do most of the work.

CROSS-TALK AND REACTIONS:
- Challenger should occasionally start with [interrupting] or [cuts in]
- Short reactive interjections are powerful: "Wait—", "Hold on—", "That's huge.", "Okay, wow."
- Reference what the previous speaker said: "Building on what you just said..." or "I hear you, but—"

RHYTHM AND PACING:
- Write in bursts, not perfect paragraphs. Humans speak in fragments.
- Vary sentence length: short punches + longer builds. Land key points on short sentences.
- Use em-dashes for mid-sentence pivots — "The data is clear — and it contradicts everything."
- Use ellipses for trailing thoughts: "And that's where it gets interesting..."
- Start cues mid-thought, not with formal openers. No "Welcome to the show" energy.
- Each cue is 1-3 short paragraphs of continuous speech. No bullet points, no headers.
- Include real citation references naturally: "According to [source 3]..."

Respond with ONLY a JSON array of transcript cues:
[{"speaker": "synthesizer", "text": "...", "segment": "${config.segments[0]}", "citations": [1, 2]}, ...]`

  console.log(`[Stage 3b] Calling Claude for full script (${argumentStructure.length} segments, target ~${config.targetWords} words)`)
  const t2 = Date.now()
  const scriptRes = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'x-api-key': anthropicKey, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
    body: JSON.stringify({ model: 'claude-sonnet-4-6', max_tokens: 16384, messages: [{ role: 'user', content: scriptPrompt }] }),
  })
  console.log(`[Stage 3b] Claude response: ${scriptRes.status} (${Date.now() - t2}ms)`)

  if (!scriptRes.ok) {
    console.error('[Stage 3b] Claude error:', await scriptRes.text())
    throw new Error(`Claude script call failed: ${scriptRes.status}`)
  }

  const scriptData = await scriptRes.json()
  const scriptText: string = scriptData.content?.[0]?.text ?? '[]'
  const stopReason = scriptData.stop_reason ?? 'unknown'
  const outputTokens = scriptData.usage?.output_tokens ?? 0
  console.log(`[Stage 3b] Script: ${scriptText.length} chars, stop: ${stopReason}, tokens: ${outputTokens}`)
  console.log(`[Stage 3b] Preview: ${scriptText.substring(0, 200)}...`)

  try {
    const jsonMatch = scriptText.match(/\[[\s\S]*\]/)
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]) as TranscriptCue[]
      console.log(`[Stage 3b] Parsed ${parsed.length} transcript cues`)
      return parsed
    } else {
      console.error('[Stage 3b] No JSON array found in response')
      console.error('[Stage 3b] Full response:', scriptText.substring(0, 500))
    }
  } catch (parseErr) {
    console.error('[Stage 3b] JSON parse failed:', (parseErr as Error).message)
    console.error('[Stage 3b] Raw (first 500):', scriptText.substring(0, 500))
  }

  return []
}

// ============================================================
// Stage 4: TTS Synthesis via ElevenLabs
// ============================================================

const VOICE_MAP: Record<string, { voiceId: string; stability: number; similarity: number; style: number }> = {
  synthesizer: {
    voiceId: '29vD33N1CtxCmqQRPOHJ',  // Drew — warm, well-rounded American male
    stability: 0.45,       // v3: slightly higher, expressiveness comes from audio tags
    similarity: 0.80,
    style: 0.10,           // v3: near-zero, model handles expression natively
  },
  challenger: {
    voiceId: 'EXAVITQu4vr4xnSDxMaL',  // Sarah — soft, clear American female
    stability: 0.35,       // v3: slightly more animated
    similarity: 0.75,
    style: 0.15,           // v3: slight style for challenger energy
  },
  expert: {
    voiceId: 'onwK4e9ZLuTAKqWW03F9',  // Daniel — deep, measured British male
    stability: 0.55,       // v3: most stable for authoritative delivery
    similarity: 0.85,
    style: 0.05,           // v3: minimal style for measured authority
  },
}

// Preprocess transcript text for ElevenLabs v3 TTS delivery.
// v3 uses [audio tags] instead of SSML <break> tags.
// Em-dashes and ellipses are left as-is — v3 interprets them natively.
function preprocessForTTS(text: string): string {
  let processed = text
  // Paragraph breaks → breath pause via v3 tag
  processed = processed.replace(/\n\n+/g, ' [long pause] ')
  // Line breaks → beat pause
  processed = processed.replace(/\n/g, ' [pause] ')
  // Strip any leftover SSML tags from old content or edge cases
  processed = processed.replace(/<[^>]+\/>/g, '')
  // Clean up double spaces
  processed = processed.replace(/  +/g, ' ').trim()
  return processed
}

async function synthesizeCue(
  cue: TranscriptCue,
  index: number,
  episodeId: string,
  supabase: ReturnType<typeof createClient>
): Promise<string | null> {
  const elevenLabsKey = Deno.env.get('ELEVENLABS_API_KEY')
  if (!elevenLabsKey) return null

  const voiceConfig = VOICE_MAP[cue.speaker] ?? VOICE_MAP.synthesizer
  const { voiceId, stability, similarity, style } = voiceConfig

  try {
    const wordCount = cue.text.split(/\s+/).length
    console.log(`[Stage 4] TTS cue ${index}: speaker=${cue.speaker}, words=${wordCount}`)
    const t0 = Date.now()
    const res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`, {
      method: 'POST',
      headers: { 'xi-api-key': elevenLabsKey, 'Content-Type': 'application/json', 'Accept': 'audio/mpeg' },
      body: JSON.stringify({
        text: preprocessForTTS(cue.text),
        model_id: 'eleven_v3',
        voice_settings: { stability, similarity_boost: similarity, style, use_speaker_boost: true },
      }),
    })
    console.log(`[Stage 4] ElevenLabs cue ${index}: ${res.status} (${Date.now() - t0}ms)`)

    if (!res.ok) { console.error(`[Stage 4] ElevenLabs error cue ${index}:`, await res.text()); return null }

    const audioBuffer = await res.arrayBuffer()
    console.log(`[Stage 4] Audio cue ${index}: ${(audioBuffer.byteLength / 1024).toFixed(1)}KB`)
    const filePath = `${episodeId}/chunk_${index}.mp3`

    const { error: uploadError } = await supabase.storage.from('echo-audio').upload(filePath, audioBuffer, { contentType: 'audio/mpeg', upsert: true })
    if (uploadError) { console.error(`[Stage 4] Upload failed cue ${index}:`, JSON.stringify(uploadError)); return null }

    const { data: urlData } = supabase.storage.from('echo-audio').getPublicUrl(filePath)
    console.log(`[Stage 4] Uploaded cue ${index}: ${filePath}`)
    return urlData.publicUrl
  } catch (err) {
    console.error(`[Stage 4] TTS error cue ${index}:`, (err as Error).message)
    return null
  }
}

async function synthesizeAll(
  transcript: TranscriptCue[],
  episodeId: string,
  supabase: ReturnType<typeof createClient>
): Promise<string[]> {
  const BATCH_SIZE = 3
  const audioUrls: (string | null)[] = new Array(transcript.length).fill(null)
  for (let i = 0; i < transcript.length; i += BATCH_SIZE) {
    const batch = transcript.slice(i, i + BATCH_SIZE)
    const results = await Promise.all(batch.map((cue, batchIdx) => synthesizeCue(cue, i + batchIdx, episodeId, supabase)))
    for (let j = 0; j < results.length; j++) { audioUrls[i + j] = results[j] }
  }
  return audioUrls.filter((url): url is string => url !== null)
}

// ============================================================
// Estimate duration from word count (~150 wpm spoken)
// ============================================================

function estimateDuration(transcript: TranscriptCue[]): number {
  const totalWords = transcript.reduce((sum, cue) => sum + cue.text.split(/\s+/).length, 0)
  return Math.round((totalWords / 150) * 60)
}

// ============================================================
// Generate headline-style episode title from transcript
// ============================================================

async function generateTitle(topic: string, mode: string, transcript: TranscriptCue[]): Promise<string> {
  const anthropicKey = Deno.env.get('ANTHROPIC_API_KEY')
  if (!anthropicKey) return topic

  const preview = transcript.slice(0, 3).map(c => c.text).join(' ').substring(0, 500)

  const modeHint: Record<string, string> = {
    news: 'a concise news headline',
    'deep-dive': 'a compelling feature episode title',
    investigative: 'an investigative journalism headline that hints at what was uncovered',
    opinion: 'a thought-provoking title that captures the central tension',
    wormhole: 'a surprising, curiosity-driven title that makes you go "wait, what?"',
  }

  try {
    console.log(`[Title] Generating headline for: "${topic}" (mode: ${mode})`)
    const t0 = Date.now()
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'x-api-key': anthropicKey, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 100,
        messages: [{ role: 'user', content: `Generate ${modeHint[mode] ?? 'a compelling podcast episode headline'} (5-10 words) for a topic about "${topic}". The episode discusses: ${preview}

Rules:
- Write like a podcast episode title
- Be specific and intriguing, not generic
- Do NOT include quotes or punctuation wrapping
- Respond with ONLY the title, nothing else` }],
      }),
    })
    console.log(`[Title] Claude response: ${res.status} (${Date.now() - t0}ms)`)
    if (!res.ok) return topic
    const data = await res.json()
    const title = data.content?.[0]?.text?.trim() ?? topic
    console.log(`[Title] Generated: "${title}"`)
    return title
  } catch { return topic }
}

// ============================================================
// Generate a 2-3 sentence episode description for the player
// ============================================================

async function generateDescription(topic: string, mode: string, transcript: TranscriptCue[], sources: Source[]): Promise<string> {
  const anthropicKey = Deno.env.get('ANTHROPIC_API_KEY')
  if (!anthropicKey) return ''

  const preview = transcript.slice(0, 5).map(c => c.text).join(' ').substring(0, 800)
  const sourceList = sources.slice(0, 5).map(s => s.title).join(', ')

  const modeHint: Record<string, string> = {
    news: 'a concise news briefing',
    'deep-dive': 'a deep-dive analysis',
    investigative: 'an investigative report',
    opinion: 'an opinion roundtable',
    wormhole: 'an unexpected exploration',
  }

  try {
    console.log(`[Description] Generating for: "${topic}" (mode: ${mode})`)
    const t0 = Date.now()
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'x-api-key': anthropicKey, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 200,
        messages: [{ role: 'user', content: `Write a 2-3 sentence episode description for ${modeHint[mode] ?? 'a podcast episode'} about "${topic}".

The episode covers: ${preview}

Sources referenced: ${sourceList}

Rules:
- Write in present tense, like a podcast show notes description
- Be specific about what the listener will learn
- Keep it engaging but informative
- 2-3 sentences only, no more
- Respond with ONLY the description, nothing else` }],
      }),
    })
    console.log(`[Description] Claude response: ${res.status} (${Date.now() - t0}ms)`)
    if (!res.ok) return ''
    const data = await res.json()
    const desc = data.content?.[0]?.text?.trim() ?? ''
    console.log(`[Description] Generated: "${desc.substring(0, 80)}..."`)
    return desc
  } catch { return '' }
}

// ============================================================
// Main handler
// ============================================================

const VALID_MODES = new Set(['news', 'deep-dive', 'investigative', 'opinion', 'wormhole'])

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const { topic, mode = 'news', userId, biasPreference = 'balanced' } = await req.json()

    if (!topic || typeof topic !== 'string' || topic.trim().length === 0) {
      return new Response(
        JSON.stringify({ error: 'topic is required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    const normalizedTopic = topic.trim()
    const normalizedMode = VALID_MODES.has(mode) ? mode : 'news'
    const normalizedBias = ['left', 'center', 'right', 'balanced'].includes(biasPreference) ? biasPreference : 'balanced'
    const cacheKey = `${normalizedTopic}:${normalizedMode}:${normalizedBias}`

    console.log('[generate-podcast] Request:', { topic: normalizedTopic, mode: normalizedMode, userId, biasPreference: normalizedBias })

    const cached = getCached(cacheKey)
    if (cached) {
      console.log('[generate-podcast] Cache hit:', cacheKey)
      return new Response(JSON.stringify({ episode: cached }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
    }

    const episodeId = crypto.randomUUID()
    const supabaseUrl = Deno.env.get('SUPABASE_URL')
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
    if (!supabaseUrl || !supabaseServiceKey) throw new Error('Supabase env vars not configured')
    const supabase = createClient(supabaseUrl, supabaseServiceKey)

    // Stage 1: Source aggregation
    console.log('[generate-podcast] Stage 1: Fetching sources')
    let sources: Source[]
    try {
      sources = await fetchSources(normalizedTopic, normalizedMode)
      if (sources.length === 0) throw new Error('No sources found')
    } catch (err) {
      console.error('[generate-podcast] Stage 1 failed:', err)
      return new Response(
        JSON.stringify({ error: `Source aggregation failed: ${(err as Error).message}` }),
        { status: 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }
    console.log(`[generate-podcast] Stage 1 complete: ${sources.length} sources`)

    // Stage 2: Bias classification
    console.log('[generate-podcast] Stage 2: Classifying sources')
    try { sources = await classifySources(sources) } catch (err) { console.error('[generate-podcast] Stage 2 failed (non-fatal):', err) }
    const biasDistribution = computeBiasDistribution(sources)
    console.log('[generate-podcast] Stage 2 complete. Bias:', biasDistribution)

    // Stage 3: Script generation
    console.log('[generate-podcast] Stage 3: Generating script')
    let transcript: TranscriptCue[]
    try {
      transcript = await generateScript(normalizedTopic, sources, normalizedMode, normalizedBias)
      if (transcript.length === 0) throw new Error('Script generation returned empty transcript')
    } catch (err) {
      console.error('[generate-podcast] Stage 3 failed:', err)
      return new Response(
        JSON.stringify({ error: `Script generation failed: ${(err as Error).message}` }),
        { status: 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }
    console.log(`[generate-podcast] Stage 3 complete: ${transcript.length} cues`)

    const durationSeconds = estimateDuration(transcript)

    // Stage 4: TTS + title + description (parallel)
    console.log('[generate-podcast] Stage 4: TTS + title + description')
    let audioUrls: string[] = []
    let status: Episode['status'] = 'ready'
    let title = normalizedTopic
    let description = ''

    try {
      const [ttsResult, titleResult, descResult] = await Promise.allSettled([
        synthesizeAll(transcript, episodeId, supabase),
        generateTitle(normalizedTopic, normalizedMode, transcript),
        generateDescription(normalizedTopic, normalizedMode, transcript, sources),
      ])

      if (ttsResult.status === 'fulfilled') {
        audioUrls = ttsResult.value
        if (audioUrls.length === 0) status = 'no-audio'
        else if (audioUrls.length < transcript.length) status = 'partial'
      } else {
        console.error('[generate-podcast] TTS failed:', ttsResult.reason)
        status = 'no-audio'
      }

      if (titleResult.status === 'fulfilled') title = titleResult.value
      if (descResult.status === 'fulfilled') description = descResult.value
    } catch (err) {
      console.error('[generate-podcast] Stage 4 failed:', err)
      status = 'no-audio'
    }
    console.log(`[generate-podcast] Stage 4 complete: ${audioUrls.length}/${transcript.length} audio, title: "${title}"`)

    const finalSources = sources.map(({ snippet: _snippet, ...s }) => s)
    const episode: Episode = { id: episodeId, topic: normalizedTopic, title, description, mode: normalizedMode, transcript, sources: finalSources, biasDistribution, audioUrls, durationSeconds, status }

    setCached(cacheKey, episode)
    console.log('[generate-podcast] Done. ID:', episodeId, 'Status:', status, 'Duration:', durationSeconds)

    return new Response(JSON.stringify({ episode }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
  } catch (err) {
    console.error('[generate-podcast] Unhandled error:', err)
    return new Response(
      JSON.stringify({ error: (err as Error).message ?? 'Internal server error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})
