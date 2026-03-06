import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'

const VERSION = '0.6.0'
console.log(`[taste-graph] v${VERSION} - story-length descriptions, parallel calls`)

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
  topDomains?: string[]
  tags?: string[]
  categoryBreakdown?: string
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

async function callAnthropic(prompt: string, maxTokens: number, model = 'claude-sonnet-4-20250514'): Promise<string> {
  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': ANTHROPIC_API_KEY!,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model,
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

    // Build cluster description string (shared by both prompts)
    const clusterDesc = clusters
      .map(c => {
        const lines = [
          `id: "${c.id}"`,
          `tokens: [${c.topTokens.join(', ')}]`,
          `representative: "${c.representativeTitle || c.sampleTitles[0] || ''}"`,
          `samples: [${c.sampleTitles.slice(0, 10).join(' | ')}]`,
          `category: ${c.categoryBreakdown || c.dominantCategory}`,
          `pins: ${c.pinCount}`,
        ]
        if (c.topDomains?.length) lines.push(`sources: [${c.topDomains.join(', ')}]`)
        if (c.tags?.length) lines.push(`tags: [${c.tags.slice(0, 8).join(', ')}]`)
        return lines.join(', ')
      })
      .join('\n')

    // --- Run BOTH calls in parallel ---
    let labeledClusters: LabeledCluster[]
    let insights: Insights = { motifs: [], bridges: [] }

    if (ANTHROPIC_API_KEY) {
      const labelPrompt = `You are a taste profiler. A user saved hundreds of links over time. We clustered them by embedding similarity. Your job: name the CULTURAL SENSIBILITY behind each cluster.

HOW TO READ THE DATA:
- tokens: TF-IDF terms from pin titles/tags. Proper nouns (brand names, artist names, domain names like "bandcamp", "pitchfork", "nike") are OBJECT ANCHORS — ignore them when choosing a label. Focus on descriptive tokens (adjectives, genres, aesthetic words) for the underlying sensibility.
- representative: The single pin closest to the cluster center — highest-signal example.
- samples: Literal pin titles. Use them to understand WHAT is saved, then ask: what sensibility connects ALL of these?
- sources: Website domains where content was saved from. Useful context but NEVER reference these in labels.
- tags: User-applied or AI-generated tags. Strong signal for the aesthetic/genre.
- category: May show breakdown like "wear(5), home(3)" for cross-category clusters. These are especially interesting — find the sensibility that bridges the categories.
- NOTE: Pins can appear in multiple clusters. Some clusters overlap intentionally. Each cluster should still have a distinct label.

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
Write like a knowledgeable friend telling a short story about this corner of someone's taste. Specific, concrete, grounded — not poetic or vague.
Each field should be 2-3 sentences, roughly 30-50 words. Write in flowing lowercase prose.
Speak with specificity — name materials, subgenres, eras, techniques, moods, textures. The reader should feel recognized.
- "whatItIs": lowercase. Describe the shared aesthetic as a scene or sensibility. Name the materials, moods, references, and eras that tie these saves together.
- "whyYou": lowercase, 2nd person "you". Tell the story of the instinct behind this taste — what drives the collecting, what need it fills, what it says about how you move through the world.
- "howItChanged": lowercase. Describe how this taste deepens or evolves over time — what started as casual interest becomes something more specific, more refined, more personal.
Do NOT start with "you are drawn to" or "you gravitate toward". Be direct and varied in your openings.
Do NOT mention any brand, artist, creator, or platform by name. Use concepts instead.

PROCESS: For each cluster, first write a brief "reasoning" field where you identify the core sensibility. Then derive the label and descriptions from that reasoning.

ANTI-COPY RULE: Do not reuse any label, phrase, or wording from these instructions. Generate entirely original output.

Clusters:
${clusterDesc}

Respond with ONLY valid JSON:
{"clusters": [{"id": "c0", "reasoning": "brief note about the sensibility", "label": "Actionable Label", "domain": "music", "description": {"whatItIs": "...", "whyYou": "...", "howItChanged": "..."}}, ...]}`

      // Insights prompt uses raw cluster data (doesn't need labels)
      const insightDesc = clusters
        .map(c => `- "${c.topTokens.slice(0, 3).join(' ')}" (${c.dominantCategory}, ${c.pinCount} pins, tokens: ${c.topTokens.slice(0, 5).join(', ')})`)
        .join('\n')

      const insightPrompt = `Given these clusters of a user's saved content, identify patterns:

Clusters:
${insightDesc}

Identify:
1. motifs: Top 3 themes that appear across 3+ clusters (single words or short phrases)
2. bridges: Top 2 unexpected connections between clusters from different domains, with a short reason
3. fastestGrowing: Which cluster seems most active (guess from pin count)
4. mostDistinctive: Which cluster is most unique (fewest shared tokens with others)

Respond with ONLY a JSON object:
{"motifs": ["theme1", "theme2", "theme3"], "bridges": [{"clusterA": "cluster desc", "clusterB": "cluster desc", "reason": "short reason"}], "fastestGrowing": "cluster desc", "mostDistinctive": "cluster desc"}`

      // Fire both in parallel — insights uses Haiku for speed
      const [labelResult, insightResult] = await Promise.allSettled([
        callAnthropic(labelPrompt, 3000),
        callAnthropic(insightPrompt, 500, 'claude-3-5-haiku-20241022'),
      ])

      // Process labels
      if (labelResult.status === 'fulfilled') {
        try {
          const parsed = parseJSON(labelResult.value) as { clusters: Array<LabeledCluster & { reasoning?: string }> }
          labeledClusters = (parsed.clusters || []).map(({ reasoning, ...rest }) => rest)
        } catch (e) {
          console.error('Label parse failed:', e)
          labeledClusters = clusters.map(c => ({
            id: c.id,
            label: c.topTokens.length > 0
              ? c.topTokens.slice(0, 2).map(t => t.charAt(0).toUpperCase() + t.slice(1)).join(' ')
              : `Cluster`,
            domain: 'other',
          }))
        }
      } else {
        console.error('Label call failed:', labelResult.reason)
        labeledClusters = clusters.map(c => ({
          id: c.id,
          label: c.topTokens.length > 0
            ? c.topTokens.slice(0, 2).map(t => t.charAt(0).toUpperCase() + t.slice(1)).join(' ')
            : `Cluster`,
          domain: 'other',
        }))
      }

      // Process insights
      if (insightResult.status === 'fulfilled') {
        try {
          insights = parseJSON(insightResult.value) as Insights
          insights.motifs = insights.motifs || []
          insights.bridges = insights.bridges || []
        } catch (e) {
          console.error('Insight parse failed (non-fatal):', e)
        }
      } else {
        console.error('Insight call failed (non-fatal):', insightResult.reason)
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
