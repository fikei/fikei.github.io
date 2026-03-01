import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'

const ANTHROPIC_API_KEY = Deno.env.get('ANTHROPIC_API_KEY')

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

interface ClusterInput {
  id: string
  topTokens: string[]
  sampleTitles: string[]
  dominantCategory: string
  pinCount: number
}

interface ClusterDescription {
  whatItIs: string
  whyYou: string
  howItChanged: string
}

interface LabeledCluster {
  id: string
  label: string
  domain: string
  description?: ClusterDescription
}

interface Insights {
  motifs: string[]
  bridges: Array<{ clusterA: string; clusterB: string; reason: string }>
  fastestGrowing?: string
  mostDistinctive?: string
}

function parseJSON(text: string): unknown {
  // Strip markdown code fences if present
  let cleaned = text.trim()
  if (cleaned.startsWith('```')) {
    cleaned = cleaned.replace(/^```(?:json)?\s*/, '').replace(/\s*```$/, '')
  }
  // Extract JSON between first { and last }
  const start = cleaned.indexOf('{')
  const end = cleaned.lastIndexOf('}')
  if (start !== -1 && end !== -1) {
    cleaned = cleaned.slice(start, end + 1)
  }
  return JSON.parse(cleaned)
}

async function callAnthropic(prompt: string, maxTokens: number): Promise<string> {
  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': ANTHROPIC_API_KEY!,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-3-haiku-20240307',
      max_tokens: maxTokens,
      messages: [{ role: 'user', content: prompt }],
    }),
  })

  if (!response.ok) {
    const error = await response.text()
    throw new Error(`Anthropic API error: ${response.status} — ${error}`)
  }

  const data = await response.json()
  return data.content[0]?.text || '{}'
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const { clusters } = await req.json() as { clusters: ClusterInput[] }

    if (!clusters || !Array.isArray(clusters) || clusters.length === 0) {
      throw new Error('clusters array is required')
    }

    // --- Call 1: Label clusters ---
    let labeledClusters: LabeledCluster[]

    if (ANTHROPIC_API_KEY) {
      try {
        const clusterDesc = clusters
          .map(c => `- id: "${c.id}", tokens: [${c.topTokens.join(', ')}], samples: [${c.sampleTitles.slice(0, 3).join(', ')}], category: ${c.dominantCategory}, pins: ${c.pinCount}`)
          .join('\n')

        const labelPrompt = `You are analyzing clusters of a user's saved links to identify their TASTE PATTERNS — the aesthetic sensibilities, cultural instincts, and recurring obsessions that connect saves across categories.

Your job is to name the UNDERLYING PATTERN, never the surface object. Look across the tokens and sample titles for what draws these saves together — the shared vibe, not the shared noun.

NEVER DO THIS (object-level):
- "Pants", "Restaurants", "Songs", "Tables", "Sneakers", "Movies"

DO THIS (taste-level):
- "Utilitarian Uniform", "Omakase Energy", "Melancholic Ambient", "Brutalist Living", "Archive Fever", "Quiet Maximalism"

For each cluster:
1. Label (1-3 words, title case): Name the AESTHETIC SENSIBILITY or CULTURAL PATTERN connecting these saves. Ask yourself: what is the taste instinct that makes someone save ALL of these? Never use the object category as the label.
2. Domain: music, fashion, film, food, design, tech, travel, books, art, lifestyle, fitness, other
3. Description object with three fields:
   - "whatItIs": one lowercase sentence (under 20 words). Describe the pattern that connects these saves — the shared aesthetic, not the object type. What is the throughline?
   - "whyYou": one lowercase sentence (under 20 words, 2nd person). What does this pattern reveal about how the user sees the world? What instinct does it satisfy?
   - "howItChanged": one lowercase sentence (under 20 words). How does a taste like this typically deepen or evolve? Speak to the trajectory.

Write like Co-Star horoscopes — poetic, uncomfortably specific, zero platitudes.

Examples of good labels + descriptions:
- Tokens: [pants, black, minimal, cut, slim] → Label: "Utilitarian Uniform", description: {"whatItIs": "a wardrobe built on the belief that reduction is the only honest form of style", "whyYou": "you decided long ago that getting dressed should feel like loading ammunition", "howItChanged": "it stopped being about clothes and became a daily practice of disappearing into intention"}
- Tokens: [ambient, tape, loop, drone, analog] → Label: "Slow Frequencies", description: {"whatItIs": "sound that insists on being felt in the body before it reaches the brain", "whyYou": "you need proof that stillness and intensity are the same thing", "howItChanged": "the playlists got longer and the volume got lower and somehow it hit harder"}
- Tokens: [concrete, furniture, space, raw, light] → Label: "Brutalist Living", description: {"whatItIs": "interiors where every material announces exactly what it is and dares you to look away", "whyYou": "you find comfort in spaces that refuse to perform comfort", "howItChanged": "what started as an aesthetic preference became a test you apply to everything"}

Clusters:
${clusterDesc}

Respond with ONLY a JSON object:
{"clusters": [{"id": "c0", "label": "Short Label", "domain": "music", "description": {"whatItIs": "...", "whyYou": "...", "howItChanged": "..."}}, ...]}`

        const labelText = await callAnthropic(labelPrompt, 1500)
        const parsed = parseJSON(labelText) as { clusters: LabeledCluster[] }
        labeledClusters = parsed.clusters || []
      } catch (e) {
        console.error('Label call failed:', e)
        // Fallback: auto-labels from top token
        labeledClusters = clusters.map(c => ({
          id: c.id,
          label: c.topTokens.length > 0
            ? c.topTokens.slice(0, 2).map(t => t.charAt(0).toUpperCase() + t.slice(1)).join(' ')
            : `Cluster`,
          domain: 'other',
        }))
      }
    } else {
      // No API key — auto-labels
      labeledClusters = clusters.map(c => ({
        id: c.id,
        label: c.topTokens[0]
          ? c.topTokens[0].charAt(0).toUpperCase() + c.topTokens[0].slice(1)
          : `Cluster`,
        domain: 'other',
      }))
    }

    // --- Call 2: Insights (can fail gracefully) ---
    let insights: Insights = { motifs: [], bridges: [] }

    if (ANTHROPIC_API_KEY) {
      try {
        const labeledDesc = labeledClusters
          .map(lc => {
            const orig = clusters.find(c => c.id === lc.id)
            return `- "${lc.label}" (${lc.domain}, ${orig?.pinCount || 0} pins, tokens: ${orig?.topTokens.slice(0, 5).join(', ') || 'none'})`
          })
          .join('\n')

        const insightPrompt = `Given these labeled clusters of a user's saved content, identify patterns:

Clusters:
${labeledDesc}

Identify:
1. motifs: Top 3 themes that appear across 3+ clusters (single words or short phrases)
2. bridges: Top 2 unexpected connections between clusters from different domains, with a short reason
3. fastestGrowing: Which cluster label seems most active (guess from pin count)
4. mostDistinctive: Which cluster is most unique (fewest shared tokens with others)

Respond with ONLY a JSON object:
{"motifs": ["theme1", "theme2", "theme3"], "bridges": [{"clusterA": "Label A", "clusterB": "Label B", "reason": "short reason"}], "fastestGrowing": "Label", "mostDistinctive": "Label"}`

        const insightText = await callAnthropic(insightPrompt, 500)
        insights = parseJSON(insightText) as Insights
        // Ensure arrays exist
        insights.motifs = insights.motifs || []
        insights.bridges = insights.bridges || []
      } catch (e) {
        console.error('Insight call failed (non-fatal):', e)
        insights = { motifs: [], bridges: [] }
      }
    }

    return new Response(
      JSON.stringify({ clusters: labeledClusters, insights, cached: false }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  } catch (error) {
    console.error('Error:', error.message)
    return new Response(
      JSON.stringify({ error: error.message, clusters: [], insights: { motifs: [], bridges: [] }, cached: false }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})
