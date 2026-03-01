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

        const labelPrompt = `You are labeling clusters of content a user has saved. Each cluster represents a group of related saved links.

For each cluster:
1. Create a short label (1-3 words, title case)
2. Assign a domain from: music, fashion, film, food, design, tech, travel, books, art, lifestyle, fitness, other
3. Write a "description" object with three fields:
   - "whatItIs": one lowercase sentence (under 20 words) describing what this interest cluster contains
   - "whyYou": one lowercase sentence (under 20 words, 2nd person) about why the user gravitates to this
   - "howItChanged": one lowercase sentence (under 20 words) about how this interest evolved over time

Be poetic, brutally specific, and avoid generic platitudes. Write like Co-Star horoscopes.

Example description:
{"whatItIs": "a relentless archive of sounds that refuse to stay in one genre", "whyYou": "you treat every algorithm recommendation as a challenge to prove it wrong", "howItChanged": "what started as weekend crate-digging became a full identity"}

Clusters:
${clusterDesc}

Respond with ONLY a JSON object:
{"clusters": [{"id": "c0", "label": "Short Label", "domain": "music", "description": {"whatItIs": "...", "whyYou": "...", "howItChanged": "..."}}, ...]}`

        const labelText = await callAnthropic(labelPrompt, 1200)
        const parsed = parseJSON(labelText) as { clusters: LabeledCluster[] }
        labeledClusters = parsed.clusters || []
      } catch (e) {
        console.error('Label call failed:', e)
        // Fallback: auto-labels from top token
        labeledClusters = clusters.map(c => ({
          id: c.id,
          label: c.topTokens[0]
            ? c.topTokens[0].charAt(0).toUpperCase() + c.topTokens[0].slice(1)
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
