import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'

const ANTHROPIC_API_KEY = Deno.env.get('ANTHROPIC_API_KEY')

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const MAX_PINS = 200

interface Pin {
  id: string
  title: string
  description?: string
  domain?: string
  url: string
}

interface Request {
  prompt: string
  category: string
  pins: Pin[]
  existingTags?: string[]
}

serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    if (!ANTHROPIC_API_KEY) {
      throw new Error('ANTHROPIC_API_KEY not configured')
    }

    const { prompt, category, pins, existingTags } = await req.json() as Request

    if (!prompt) {
      return new Response(
        JSON.stringify({ error: 'A prompt is required (e.g., "organize by brand tier")' }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    if (!pins || pins.length === 0) {
      return new Response(
        JSON.stringify({ error: 'No pins to analyze' }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    if (pins.length < 3 && !existingTags) {
      return new Response(
        JSON.stringify({ error: 'Add more pins to enable filtering (minimum 3)' }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Sample pins if too many (most recent first — array order preserved from client)
    const sampledPins = pins.slice(0, MAX_PINS)

    // Build the pin list for the prompt
    const pinList = sampledPins
      .map((p, i) => `${i + 1}. [${p.id}] ${p.title || p.domain || p.url}${p.description ? ` — ${p.description}` : ''}`)
      .join('\n')

    // Build the Claude prompt based on whether we're creating or assigning
    let claudePrompt: string

    if (existingTags && existingTags.length > 0) {
      // Auto-assign mode: classify into existing tags only
      claudePrompt = `You are classifying saved links into existing subcategories.

The user's board category is "${category || 'custom'}".
The existing subcategory dimension has these tags: ${JSON.stringify(existingTags)}

Classify each item into exactly one of the existing tags. Do not create new tags.

Items to classify:
${pinList}

Respond with valid JSON only, no other text:
{
  "dimensionLabel": "${existingTags.length > 0 ? 'existing' : prompt}",
  "tags": ${JSON.stringify(existingTags)},
  "assignments": {
    "item-id-1": "tag-value",
    "item-id-2": "tag-value"
  }
}

Rules:
- Every item id must appear in assignments
- Only use tags from the provided list: ${JSON.stringify(existingTags)}
- If an item doesn't clearly fit any tag, assign it to the most generic/closest tag`
    } else {
      // Create mode: generate new dimension with tags
      claudePrompt = `You are organizing a collection of saved links into subcategories.

The user wants to organize their "${category || 'custom'}" collection by: "${prompt}"

Here are the items (${sampledPins.length} total):
${pinList}

Respond with valid JSON only, no other text:
{
  "dimensionLabel": "Short Label",
  "tags": ["tag-1", "tag-2", "tag-3"],
  "assignments": {
    "item-id-1": "tag-1",
    "item-id-2": "tag-2"
  }
}

Rules:
1. dimensionLabel: a clear 1-3 word name for this grouping (e.g., "Brand Tier", "Price Range", "Mood")
2. tags: 2-8 distinct values covering this dimension. Short (1-3 words), lowercase, use hyphens for multi-word tags
3. assignments: map every item id to exactly one tag from your tags array
4. Generate tags from the actual content — adapt to what's there
5. If an item doesn't clearly fit any tag, assign it to the most generic tag
6. Tags should be mutually exclusive and collectively exhaustive for the items`
    }

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-3-haiku-20240307',
        max_tokens: 1024,
        messages: [
          { role: 'user', content: claudePrompt }
        ]
      })
    })

    if (!response.ok) {
      const error = await response.text()
      console.error('[generate-subcategories] Anthropic API error:', error)
      throw new Error(`Anthropic API error: ${response.status}`)
    }

    const data = await response.json()
    const content = data.content?.[0]?.text || '{}'

    // Parse JSON response — handle markdown code fences
    let result
    try {
      // Try direct parse first
      result = JSON.parse(content)
    } catch {
      // Strip markdown code fences if present
      let cleaned = content
        .replace(/^```(?:json)?\s*\n?/m, '')
        .replace(/\n?```\s*$/m, '')
        .trim()

      // Extract from first { to last }
      const firstBrace = cleaned.indexOf('{')
      const lastBrace = cleaned.lastIndexOf('}')
      if (firstBrace !== -1 && lastBrace !== -1) {
        cleaned = cleaned.slice(firstBrace, lastBrace + 1)
      }

      try {
        result = JSON.parse(cleaned)
      } catch {
        return new Response(
          JSON.stringify({ error: "Couldn't create subcategories from that prompt. Try something like 'organize by type' or 'split by decade'." }),
          { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )
      }
    }

    // Validate response structure
    if (!result.tags || !Array.isArray(result.tags) || result.tags.length === 0) {
      return new Response(
        JSON.stringify({ error: "Couldn't generate meaningful subcategories. Try a different prompt." }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Ensure assignments only use valid tags
    const validTags = new Set(result.tags)
    const cleanAssignments: Record<string, string | null> = {}
    if (result.assignments && typeof result.assignments === 'object') {
      for (const [pinId, tag] of Object.entries(result.assignments)) {
        if (typeof tag === 'string' && validTags.has(tag)) {
          cleanAssignments[pinId] = tag
        } else {
          cleanAssignments[pinId] = null
        }
      }
    }

    return new Response(
      JSON.stringify({
        dimensionLabel: result.dimensionLabel || prompt,
        tags: result.tags,
        assignments: cleanAssignments,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )

  } catch (error) {
    console.error('[generate-subcategories] Error:', error.message)
    return new Response(
      JSON.stringify({ error: error.message }),
      {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      }
    )
  }
})
