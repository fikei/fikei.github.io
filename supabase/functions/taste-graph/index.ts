import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'

const VERSION = '0.3.0'
console.log(`[taste-graph] v${VERSION} - Sonnet 4, block brands/creators, uplevel to concepts`)

const ANTHROPIC_API_KEY = Deno.env.get('ANTHROPIC_API_KEY')

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

interface ClusterInput {
  id: string
  topTokens: string[]
  sampleTitles: string[]
  representativeTitle: string
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
      model: 'claude-sonnet-4-20250514',
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
          .map(c => [
            `id: "${c.id}"`,
            `tokens: [${c.topTokens.join(', ')}]`,
            `representative: "${c.representativeTitle || c.sampleTitles[0] || ''}"`,
            `samples: [${c.sampleTitles.slice(0, 8).join(' | ')}]`,
            `category: ${c.dominantCategory}`,
            `pins: ${c.pinCount}`,
          ].join(', '))
          .join('\n')

        const labelPrompt = `You are a taste profiler. A user saved hundreds of links over time. We clustered them by embedding similarity. Your job: name the CULTURAL SENSIBILITY behind each cluster.

HOW TO READ THE DATA:
- tokens: TF-IDF terms from pin titles/tags. Proper nouns (brand names, artist names, domain names like "bandcamp", "pitchfork", "nike") are OBJECT ANCHORS — ignore them when choosing a label. Focus on descriptive tokens (adjectives, genres, aesthetic words) for the underlying sensibility.
- representative: The single pin closest to the cluster center — highest-signal example.
- samples: Literal pin titles. Use them to understand WHAT is saved, then ask: what sensibility connects ALL of these?

LABELING RULES:
Think of how niche music genres work: "dark ambient", "lo-fi hip hop", "progressive house", "midwest emo". These are specific enough to search for and find more of, but abstract enough to capture a sensibility beyond any single track. Apply that same logic to every domain.

Labels should be 2-5 words, title case. They should be ACTIONABLE — someone could use the label to find more things that match this taste. They should describe the sensibility, not the object category.

NEVER USE brand names, artist names, creator names, platform names, or proper nouns in labels or descriptions. Uplevel to the concept.
BAD: "Nike Sneaker Culture", "Brian Eno Ambient", "Patagonia Outdoors", "A24 Cinema", "Rick Owens Aesthetic"
GOOD: "Retro Hype Sneakers", "Generative Ambient Drift", "Technical Alpine Gear", "Slow Arthouse Cinema", "Monastic Drape Fashion"

BAD (object categories): "Running Shoes", "Pasta Recipes", "Techno Music", "Modern Furniture"
BAD (too abstract/poetic): "Archive Fever", "Patient Frame", "Slow Frequencies"
GOOD (actionable taste identities): "Dark Industrial Techno", "Warm Scandinavian Minimalism", "Raw Concrete Interiors", "Methodical Italian Cooking", "Functional Techwear"

DESCRIPTION RULES:
Write like a knowledgeable friend — specific, concrete, grounded. Not poetic.
CRITICAL: Each field must be ONE SHORT sentence, STRICTLY under 15 words. No exceptions. If your sentence is over 15 words, cut it shorter.
- "whatItIs": lowercase, under 15 words. The shared aesthetic — name materials, moods, references.
- "whyYou": lowercase, under 15 words, 2nd person "you". The instinct or values behind this taste.
- "howItChanged": lowercase, under 15 words. How this taste deepens or evolves.
Do NOT start with "you are drawn to" or "you gravitate toward". Be direct.
Do NOT mention any brand, artist, creator, or platform by name. Use concepts instead.

PROCESS: For each cluster, first write a brief "reasoning" field where you identify the core sensibility. Then derive the label and descriptions from that reasoning.

ANTI-COPY RULE: Do not reuse any label, phrase, or wording from these instructions. Generate entirely original output.

Clusters:
${clusterDesc}

Respond with ONLY valid JSON:
{"clusters": [{"id": "c0", "reasoning": "brief note about the sensibility", "label": "Actionable Label", "domain": "music", "description": {"whatItIs": "...", "whyYou": "...", "howItChanged": "..."}}, ...]}`

        const labelText = await callAnthropic(labelPrompt, 2000)
        const parsed = parseJSON(labelText) as { clusters: Array<LabeledCluster & { reasoning?: string }> }
        // Strip reasoning scratchpad before returning to client
        labeledClusters = (parsed.clusters || []).map(({ reasoning, ...rest }) => rest)
      } catch (e) {
        console.error('Label call failed:', e)
        // Fallback: auto-labels from top tokens
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
