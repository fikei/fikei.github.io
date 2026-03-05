// Supabase Edge Function: ask-episode
// Interactive Q&A for Echo podcasts — answers listener questions in the narrator's voice
//
// POST /functions/v1/ask-episode
// Body: { episodeId, question, context: { currentCueIndex, currentSegment, surroundingCues, topic, mode, sources } }
// Returns: { answer: { text, audioUrl, citations, speaker } }

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

// ============================================================
// Types
// ============================================================

interface SurroundingCue {
  speaker: string
  text: string
  segment: string
}

interface SourceContext {
  index: number
  title: string
  domain: string
  bias: string
}

interface QAContext {
  currentCueIndex: number
  currentSegment: string
  surroundingCues: SurroundingCue[]
  topic: string
  mode: string
  sources: SourceContext[]
}

interface QAAnswer {
  text: string
  citations: number[]
}

// ============================================================
// Voice config — synthesizer only (Drew, warm American male anchor)
// Matches generate-podcast VOICE_MAP.synthesizer exactly
// ============================================================

const SYNTHESIZER_VOICE = {
  voiceId: '29vD33N1CtxCmqQRPOHJ',
  stability: 0.45,
  similarity: 0.78,
  style: 0.45,
}

// ============================================================
// Stage 1: Generate answer via Claude Sonnet
// ============================================================

async function generateAnswer(question: string, context: QAContext): Promise<QAAnswer> {
  const anthropicKey = Deno.env.get('ANTHROPIC_API_KEY')
  if (!anthropicKey) throw new Error('ANTHROPIC_API_KEY not configured')

  const cueContext = context.surroundingCues
    .map(c => `[${c.speaker.toUpperCase()}]: ${c.text}`)
    .join('\n\n')

  const sourceList = context.sources
    .map(s => `[${s.index}] ${s.title} — ${s.domain} (${s.bias})`)
    .join('\n')

  const systemPrompt = `You are the synthesizer host of an Echo podcast episode about "${context.topic}" (${context.mode} format).

The listener has paused the episode during the "${context.currentSegment}" segment and asked a question. Answer as the warm, knowledgeable host — conversational but substantive. Be direct and concise.

Rules:
- Keep your answer to 2-4 sentences
- Cite sources naturally using [index] notation when referencing specific facts
- Stay grounded in the episode's sources — don't make up information
- If the question is outside the scope of the episode's sources, say so briefly
- Respond with valid JSON only: {"text": "your answer", "citations": [1, 2]}`

  const userPrompt = `CURRENT PODCAST CONTEXT (segment: ${context.currentSegment}):
${cueContext}

AVAILABLE SOURCES:
${sourceList}

LISTENER QUESTION: "${question}"`

  console.log(`[ask-episode] Generating answer for: "${question.substring(0, 80)}"`)
  const t0 = Date.now()

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': anthropicKey,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 1024,
      system: systemPrompt,
      messages: [{ role: 'user', content: userPrompt }],
    }),
  })

  console.log(`[ask-episode] Claude response: ${res.status} (${Date.now() - t0}ms)`)

  if (!res.ok) {
    const errText = await res.text()
    console.error(`[ask-episode] Claude error:`, errText)
    throw new Error(`Claude API error: ${res.status}`)
  }

  const data = await res.json()
  const rawText = data.content?.[0]?.text?.trim() ?? ''

  // Parse JSON response — handle potential markdown wrapping
  let answerText = rawText
  let citations: number[] = []

  try {
    const jsonStr = rawText.replace(/^```json\s*/, '').replace(/```\s*$/, '')
    const parsed = JSON.parse(jsonStr)
    answerText = parsed.text ?? rawText
    citations = Array.isArray(parsed.citations) ? parsed.citations : []
  } catch {
    // If JSON parsing fails, use raw text and extract citations with regex
    console.log('[ask-episode] JSON parse failed, using raw text')
    const citationMatches = rawText.match(/\[(\d+)\]/g)
    if (citationMatches) {
      citations = citationMatches.map((m: string) => parseInt(m.replace(/[\[\]]/g, '')))
    }
  }

  console.log(`[ask-episode] Answer: ${answerText.substring(0, 100)}... Citations: [${citations}]`)
  return { text: answerText, citations }
}

// ============================================================
// Stage 2: TTS via ElevenLabs (synthesizer voice only)
// ============================================================

async function synthesizeAnswer(
  text: string,
  episodeId: string,
  supabase: ReturnType<typeof createClient>
): Promise<string | null> {
  const elevenLabsKey = Deno.env.get('ELEVENLABS_API_KEY')
  if (!elevenLabsKey) {
    console.log('[ask-episode] No ELEVENLABS_API_KEY, skipping TTS')
    return null
  }

  const { voiceId, stability, similarity, style } = SYNTHESIZER_VOICE

  try {
    const wordCount = text.split(/\s+/).length
    console.log(`[ask-episode] TTS: words=${wordCount}`)
    const t0 = Date.now()

    const res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`, {
      method: 'POST',
      headers: {
        'xi-api-key': elevenLabsKey,
        'Content-Type': 'application/json',
        'Accept': 'audio/mpeg',
      },
      body: JSON.stringify({
        text,
        model_id: 'eleven_turbo_v2_5',
        voice_settings: { stability, similarity_boost: similarity, style, use_speaker_boost: true },
      }),
    })

    console.log(`[ask-episode] ElevenLabs: ${res.status} (${Date.now() - t0}ms)`)

    if (!res.ok) {
      console.error(`[ask-episode] ElevenLabs error:`, await res.text())
      return null
    }

    const audioBuffer = await res.arrayBuffer()
    console.log(`[ask-episode] Audio: ${(audioBuffer.byteLength / 1024).toFixed(1)}KB`)

    const filePath = `${episodeId}/qa_${Date.now()}.mp3`
    const { error: uploadError } = await supabase.storage
      .from('echo-audio')
      .upload(filePath, audioBuffer, { contentType: 'audio/mpeg', upsert: true })

    if (uploadError) {
      console.error(`[ask-episode] Upload failed:`, JSON.stringify(uploadError))
      return null
    }

    const { data: urlData } = supabase.storage.from('echo-audio').getPublicUrl(filePath)
    console.log(`[ask-episode] Uploaded: ${filePath}`)
    return urlData.publicUrl
  } catch (err) {
    console.error(`[ask-episode] TTS error:`, (err as Error).message)
    return null
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
    const { episodeId, question, context } = await req.json()

    // Validate inputs
    if (!question || typeof question !== 'string' || question.trim().length === 0) {
      return new Response(
        JSON.stringify({ error: 'question is required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    if (!context || !context.topic || !Array.isArray(context.surroundingCues)) {
      return new Response(
        JSON.stringify({ error: 'context with topic and surroundingCues is required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    const normalizedQuestion = question.trim()
    const normalizedEpisodeId = episodeId ?? crypto.randomUUID()

    console.log('[ask-episode] Request:', {
      episodeId: normalizedEpisodeId,
      question: normalizedQuestion.substring(0, 80),
      segment: context.currentSegment,
      cues: context.surroundingCues?.length,
      sources: context.sources?.length,
    })

    // Stage 1: Generate answer
    let answer: QAAnswer
    try {
      answer = await generateAnswer(normalizedQuestion, context)
    } catch (err) {
      console.error('[ask-episode] Answer generation failed:', err)
      return new Response(
        JSON.stringify({ error: `Answer generation failed: ${(err as Error).message}` }),
        { status: 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Stage 2: TTS synthesis
    let audioUrl: string | null = null
    const supabaseUrl = Deno.env.get('SUPABASE_URL')
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')

    if (supabaseUrl && supabaseServiceKey) {
      const supabase = createClient(supabaseUrl, supabaseServiceKey)
      audioUrl = await synthesizeAnswer(answer.text, normalizedEpisodeId, supabase)
    } else {
      console.log('[ask-episode] Supabase not configured, skipping TTS')
    }

    console.log('[ask-episode] Done. Audio:', audioUrl ? 'yes' : 'no')

    return new Response(
      JSON.stringify({
        answer: {
          text: answer.text,
          audioUrl,
          citations: answer.citations,
          speaker: 'synthesizer',
        },
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  } catch (err) {
    console.error('[ask-episode] Unhandled error:', err)
    return new Response(
      JSON.stringify({ error: (err as Error).message ?? 'Internal server error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})
