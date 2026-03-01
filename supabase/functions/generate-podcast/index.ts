// Supabase Edge Function: generate-podcast
// 4-stage AI pipeline: source aggregation → bias classification → script generation → ElevenLabs TTS
//
// POST /functions/v1/generate-podcast
// Body: { topic: string, mode: "news" | "deep-dive" | "debate", userId?: string }
// Returns: { episode: { id, topic, mode, transcript, sources, biasDistribution, audioUrls, durationSeconds, status } }

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

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
  mode: string
  transcript: TranscriptCue[]
  sources: Source[]
  biasDistribution: BiasDistribution
  audioUrls: string[]
  durationSeconds: number
  status: 'ready' | 'partial' | 'no-audio'
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

async function fetchSources(topic: string): Promise<Source[]> {
  const serpApiKey = Deno.env.get('SERP_API_KEY')
  if (!serpApiKey) throw new Error('SERP_API_KEY not configured')

  const queries = [
    `"${topic}" debate perspectives`,
    `"${topic}" analysis opinion`,
  ]

  const allResults: Source[] = []
  let index = 1

  for (const query of queries) {
    const params = new URLSearchParams({
      api_key: serpApiKey,
      engine: 'google',
      q: query,
      num: '8',
      hl: 'en',
    })

    const res = await fetch(`https://serpapi.com/search.json?${params}`)
    if (!res.ok) {
      console.error('[generate-podcast] SerpAPI error:', res.status, await res.text())
      continue
    }

    const data = await res.json()
    const results = data.organic_results ?? []

    for (const result of results.slice(0, 6)) {
      if (!result.link || !result.title) continue
      let domain = ''
      try {
        domain = new URL(result.link).hostname.replace('www.', '')
      } catch {
        continue
      }
      allResults.push({
        index: index++,
        title: result.title,
        url: result.link,
        domain,
        snippet: result.snippet ?? '',
      })
    }
  }

  // Deduplicate by domain (keep first occurrence per domain)
  const seen = new Set<string>()
  const deduped: Source[] = []
  for (const source of allResults) {
    if (!seen.has(source.domain)) {
      seen.add(source.domain)
      deduped.push(source)
    }
  }

  // Return 8–12 sources
  return deduped.slice(0, 12)
}

// ============================================================
// Stage 2: Bias Classification via Claude Haiku
// ============================================================

async function classifySources(sources: Source[]): Promise<Source[]> {
  const anthropicKey = Deno.env.get('ANTHROPIC_API_KEY')
  if (!anthropicKey) throw new Error('ANTHROPIC_API_KEY not configured')

  const sourceList = sources
    .map(s => `${s.index}. [${s.domain}] ${s.title}\n   ${s.snippet}`)
    .join('\n\n')

  const prompt = `Classify each source's political/ideological bias and content type.

Sources:
${sourceList}

For each source number, respond with JSON in this exact format (one object per line):
{"index": 1, "bias": "center-left", "type": "news"}

Bias categories: left, center-left, center, center-right, right, international
Type categories: news, opinion, analysis, research, government

Respond ONLY with the JSON objects, one per line, no other text.`

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': anthropicKey,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: 'claude-3-5-haiku-20241022',
      max_tokens: 1024,
      messages: [{ role: 'user', content: prompt }],
    }),
  })

  if (!res.ok) {
    console.error('[generate-podcast] Claude bias classification error:', res.status)
    return sources
  }

  const data = await res.json()
  const text: string = data.content?.[0]?.text ?? ''

  // Parse line-by-line JSON
  const classificationMap = new Map<number, { bias: string; type: string }>()
  for (const line of text.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed.startsWith('{')) continue
    try {
      const parsed = JSON.parse(trimmed)
      if (parsed.index && parsed.bias && parsed.type) {
        classificationMap.set(parsed.index, { bias: parsed.bias, type: parsed.type })
      }
    } catch {
      // skip malformed lines
    }
  }

  return sources.map(s => ({
    ...s,
    bias: classificationMap.get(s.index)?.bias ?? 'center',
    type: classificationMap.get(s.index)?.type ?? 'news',
  }))
}

function computeBiasDistribution(sources: Source[]): BiasDistribution {
  const counts: Record<string, number> = {
    left: 0,
    'center-left': 0,
    center: 0,
    'center-right': 0,
    right: 0,
    international: 0,
  }
  for (const s of sources) {
    const bias = s.bias ?? 'center'
    if (bias in counts) counts[bias]++
  }
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
// Stage 3: Script Generation via Claude Haiku (two calls)
// ============================================================

const SEGMENTS = [
  'cold_open',
  'context',
  'argument_a',
  'argument_b',
  'expert_insight',
  'cross_examination',
  'consensus',
  'synthesis',
]

async function generateScript(topic: string, sources: Source[]): Promise<TranscriptCue[]> {
  const anthropicKey = Deno.env.get('ANTHROPIC_API_KEY')
  if (!anthropicKey) throw new Error('ANTHROPIC_API_KEY not configured')

  const sourcesSummary = sources
    .map(s => `[${s.index}] ${s.title} (${s.domain}, bias: ${s.bias ?? 'unknown'}, type: ${s.type ?? 'unknown'})\n    Snippet: ${s.snippet}`)
    .join('\n\n')

  // Call 1: Argument structuring
  const structurePrompt = `You are structuring a balanced podcast episode on: "${topic}"

Available sources (with bias labels):
${sourcesSummary}

Create a balanced argument structure for an 18-minute podcast episode with these segments:
${SEGMENTS.join(', ')}

Three voices:
- synthesizer: balanced moderator, presents multiple views
- challenger: devil's advocate, pushes back on assumptions
- expert: domain specialist, provides depth

For each segment, specify:
1. Which speaker leads
2. Key points to cover
3. Which source indices to cite (use [1], [2], etc.)
4. Target word count (total ~2700 words across all segments)

Respond with a JSON array:
[{"segment": "cold_open", "speaker": "synthesizer", "keyPoints": ["..."], "citations": [1, 2], "targetWords": 120}, ...]`

  const structureRes = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': anthropicKey,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: 'claude-3-5-haiku-20241022',
      max_tokens: 2048,
      messages: [{ role: 'user', content: structurePrompt }],
    }),
  })

  if (!structureRes.ok) {
    throw new Error(`Claude structure call failed: ${structureRes.status}`)
  }

  const structureData = await structureRes.json()
  const structureText: string = structureData.content?.[0]?.text ?? '[]'

  let argumentStructure: Array<{
    segment: string
    speaker: string
    keyPoints: string[]
    citations: number[]
    targetWords: number
  }> = []

  try {
    const jsonMatch = structureText.match(/\[[\s\S]*\]/)
    if (jsonMatch) {
      argumentStructure = JSON.parse(jsonMatch[0])
    }
  } catch {
    console.error('[generate-podcast] Failed to parse argument structure')
  }

  if (argumentStructure.length === 0) {
    // Fallback: create a basic structure
    argumentStructure = SEGMENTS.map((seg, i) => ({
      segment: seg,
      speaker: i % 3 === 0 ? 'synthesizer' : i % 3 === 1 ? 'challenger' : 'expert',
      keyPoints: [`Discuss ${topic} from the ${seg} perspective`],
      citations: sources.slice(0, 2).map(s => s.index),
      targetWords: 340,
    }))
  }

  // Call 2: Full script generation
  const scriptPrompt = `You are writing a podcast script on: "${topic}"

Use this argument structure:
${JSON.stringify(argumentStructure, null, 2)}

Source reference (cite by index number):
${sources.map(s => `[${s.index}] ${s.title} — ${s.domain}`).join('\n')}

Write the complete conversational script. Each speaker should sound distinct:
- synthesizer: measured, fair, connects ideas across perspectives
- challenger: skeptical, probing, surfaces uncomfortable questions
- expert: precise, evidence-based, contextualizes complexity

Rules:
- Total ~2700 words across all cues
- Natural spoken language (no bullet points, no headers in speech)
- Each cue is 1-3 paragraphs of continuous speech
- Include real citation references naturally in speech (e.g., "According to [source 3]...")

Respond with ONLY a JSON array of transcript cues:
[{"speaker": "synthesizer", "text": "...", "segment": "cold_open", "citations": [1, 2]}, ...]`

  const scriptRes = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': anthropicKey,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: 'claude-3-5-haiku-20241022',
      max_tokens: 8192,
      messages: [{ role: 'user', content: scriptPrompt }],
    }),
  })

  if (!scriptRes.ok) {
    throw new Error(`Claude script call failed: ${scriptRes.status}`)
  }

  const scriptData = await scriptRes.json()
  const scriptText: string = scriptData.content?.[0]?.text ?? '[]'

  try {
    const jsonMatch = scriptText.match(/\[[\s\S]*\]/)
    if (jsonMatch) {
      return JSON.parse(jsonMatch[0]) as TranscriptCue[]
    }
  } catch {
    console.error('[generate-podcast] Failed to parse script JSON')
  }

  return []
}

// ============================================================
// Stage 4: TTS Synthesis via ElevenLabs
// ============================================================

// ElevenLabs voice IDs — distinct characters for the podcast
// These are pre-made voices from the ElevenLabs library.
// Replace with custom/cloned voice IDs for a unique show identity.
const VOICE_MAP: Record<string, { voiceId: string; stability: number; similarity: number }> = {
  synthesizer: {
    voiceId: 'pNInz6obpgDQGcFmaJgB',  // Adam — warm, measured, authoritative
    stability: 0.6,
    similarity: 0.8,
  },
  challenger: {
    voiceId: 'ErXwobaYiN019PkySvjV',  // Antoni — direct, probing, energetic
    stability: 0.4,                      // lower stability = more expressive/skeptical
    similarity: 0.75,
  },
  expert: {
    voiceId: 'VR6AewLTigWG4xSOukaG',  // Arnold — deep, precise, gravitas
    stability: 0.7,
    similarity: 0.85,
  },
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
  const { voiceId, stability, similarity } = voiceConfig

  try {
    const res = await fetch(
      `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`,
      {
        method: 'POST',
        headers: {
          'xi-api-key': elevenLabsKey,
          'Content-Type': 'application/json',
          'Accept': 'audio/mpeg',
        },
        body: JSON.stringify({
          text: cue.text,
          model_id: 'eleven_multilingual_v2',
          voice_settings: {
            stability,
            similarity_boost: similarity,
            style: 0.3,
            use_speaker_boost: true,
          },
        }),
      }
    )

    if (!res.ok) {
      console.error(`[generate-podcast] ElevenLabs TTS failed for cue ${index}:`, res.status, await res.text())
      return null
    }

    const audioBuffer = await res.arrayBuffer()
    const filePath = `${episodeId}/chunk_${index}.mp3`

    const { error: uploadError } = await supabase.storage
      .from('echo-audio')
      .upload(filePath, audioBuffer, {
        contentType: 'audio/mpeg',
        upsert: true,
      })

    if (uploadError) {
      console.error(`[generate-podcast] Storage upload failed for cue ${index}:`, uploadError)
      return null
    }

    const { data: urlData } = supabase.storage.from('echo-audio').getPublicUrl(filePath)
    return urlData.publicUrl
  } catch (err) {
    console.error(`[generate-podcast] TTS synthesis error for cue ${index}:`, err)
    return null
  }
}

async function synthesizeAll(
  transcript: TranscriptCue[],
  episodeId: string,
  supabase: ReturnType<typeof createClient>
): Promise<string[]> {
  const BATCH_SIZE = 3  // ElevenLabs rate limits are tighter than OpenAI
  const audioUrls: (string | null)[] = new Array(transcript.length).fill(null)

  for (let i = 0; i < transcript.length; i += BATCH_SIZE) {
    const batch = transcript.slice(i, i + BATCH_SIZE)
    const results = await Promise.all(
      batch.map((cue, batchIdx) => synthesizeCue(cue, i + batchIdx, episodeId, supabase))
    )
    for (let j = 0; j < results.length; j++) {
      audioUrls[i + j] = results[j]
    }
  }

  return audioUrls.filter((url): url is string => url !== null)
}

// ============================================================
// Estimate duration from word count (~150 wpm spoken)
// ============================================================

function estimateDuration(transcript: TranscriptCue[]): number {
  const totalWords = transcript.reduce((sum, cue) => {
    return sum + cue.text.split(/\s+/).length
  }, 0)
  return Math.round((totalWords / 150) * 60)
}

// ============================================================
// Main handler
// ============================================================

serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const { topic, mode = 'news', userId } = await req.json()

    if (!topic || typeof topic !== 'string' || topic.trim().length === 0) {
      return new Response(
        JSON.stringify({ error: 'topic is required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    const normalizedTopic = topic.trim()
    const cacheKey = `${normalizedTopic}:${mode}`

    console.log('[generate-podcast] Request:', { topic: normalizedTopic, mode, userId })

    // Check cache
    const cached = getCached(cacheKey)
    if (cached) {
      console.log('[generate-podcast] Cache hit:', cacheKey)
      return new Response(
        JSON.stringify({ episode: cached }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    const episodeId = crypto.randomUUID()

    // Initialize Supabase client for storage
    const supabaseUrl = Deno.env.get('SUPABASE_URL')
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
    if (!supabaseUrl || !supabaseServiceKey) {
      throw new Error('Supabase env vars not configured')
    }
    const supabase = createClient(supabaseUrl, supabaseServiceKey)

    // Stage 1: Source aggregation
    console.log('[generate-podcast] Stage 1: Fetching sources')
    let sources: Source[]
    try {
      sources = await fetchSources(normalizedTopic)
      if (sources.length === 0) {
        throw new Error('No sources found from SerpAPI')
      }
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
    try {
      sources = await classifySources(sources)
    } catch (err) {
      console.error('[generate-podcast] Stage 2 failed (non-fatal):', err)
      // Continue with unclassified sources
    }
    const biasDistribution = computeBiasDistribution(sources)
    console.log('[generate-podcast] Stage 2 complete. Bias distribution:', biasDistribution)

    // Stage 3: Script generation
    console.log('[generate-podcast] Stage 3: Generating script')
    let transcript: TranscriptCue[]
    try {
      transcript = await generateScript(normalizedTopic, sources)
      if (transcript.length === 0) {
        throw new Error('Script generation returned empty transcript')
      }
    } catch (err) {
      console.error('[generate-podcast] Stage 3 failed:', err)
      return new Response(
        JSON.stringify({ error: `Script generation failed: ${(err as Error).message}` }),
        { status: 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }
    console.log(`[generate-podcast] Stage 3 complete: ${transcript.length} transcript cues`)

    const durationSeconds = estimateDuration(transcript)

    // Stage 4: TTS synthesis (non-fatal — return transcript even if audio fails)
    console.log('[generate-podcast] Stage 4: Synthesizing audio')
    let audioUrls: string[] = []
    let status: Episode['status'] = 'ready'

    try {
      audioUrls = await synthesizeAll(transcript, episodeId, supabase)
      if (audioUrls.length === 0) {
        status = 'no-audio'
      } else if (audioUrls.length < transcript.length) {
        status = 'partial'
      }
    } catch (err) {
      console.error('[generate-podcast] Stage 4 failed (non-fatal):', err)
      status = 'no-audio'
    }
    console.log(`[generate-podcast] Stage 4 complete: ${audioUrls.length}/${transcript.length} audio chunks`)

    // Remove snippets from final sources (not needed in response)
    const finalSources = sources.map(({ snippet: _snippet, ...s }) => s)

    const episode: Episode = {
      id: episodeId,
      topic: normalizedTopic,
      mode,
      transcript,
      sources: finalSources,
      biasDistribution,
      audioUrls,
      durationSeconds,
      status,
    }

    // Cache and return
    setCached(cacheKey, episode)

    console.log('[generate-podcast] Done. Episode ID:', episodeId, 'Status:', status)

    return new Response(
      JSON.stringify({ episode }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  } catch (err) {
    console.error('[generate-podcast] Unhandled error:', err)
    return new Response(
      JSON.stringify({ error: (err as Error).message ?? 'Internal server error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})
