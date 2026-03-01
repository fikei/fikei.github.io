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

        const labelPrompt = `You are a taste profiler. A user saved hundreds of links over time. We clustered them by embedding similarity. Your job: identify the CULTURAL SENSIBILITY behind each cluster — the taste instinct, not the object type.

CRITICAL RULES:
- Labels name a TASTE IDENTITY or AESTHETIC MOVEMENT — never the object.
- Descriptions speak to the PERSON'S INSTINCT — never summarize the content.
- Think: "what kind of person saves all of these?" — that instinct IS the label.

BAD labels (describe objects):
"Black Pants", "Ambient Music", "Japanese Food", "Modern Chairs", "Techno Tracks", "Interior Design"

GOOD labels (describe taste):
"Utilitarian Uniform", "Slow Frequencies", "Omakase Discipline", "Scandinavian Minimalism", "Grimy New Wave", "Archive Fever"

BAD descriptions (summarize pins):
"a collection of black clothing items and minimal wardrobe pieces"
"links about ambient music and lo-fi producers"

GOOD descriptions (profile the person):
"a wardrobe built on the belief that reduction is the only honest form of style"
"sound that insists on being felt in the body before it reaches the brain"

For each cluster, provide:
1. label (1-3 words, title case): The TASTE IDENTITY. Name the aesthetic instinct, cultural posture, or design philosophy — as if naming a subculture or movement, not a product category.
2. domain: music, fashion, film, food, design, tech, travel, books, art, lifestyle, fitness, other
3. description with three fields. Write like Co-Star — poetic, uncomfortably specific, zero platitudes:
   - "whatItIs": one lowercase sentence (max 20 words). The shared aesthetic POSTURE — not what the saves contain, but the sensibility that connects them.
   - "whyYou": one lowercase sentence (max 20 words, 2nd person). The psychological need this taste satisfies. Why does this person gravitate here?
   - "howItChanged": one lowercase sentence (max 20 words). The trajectory of this taste — how it deepens, mutates, or takes over.

WORKED EXAMPLES:

Tokens: [pants, black, minimal, cut, slim], Samples: [Veilance System_A, Rick Owens DRKSHDW, COS essentials]
→ Label: "Utilitarian Uniform"
  whatItIs: "a wardrobe built on the belief that reduction is the only honest form of style"
  whyYou: "you decided long ago that getting dressed should feel like loading ammunition"
  howItChanged: "it stopped being about clothes and became a daily practice of disappearing into intention"

Tokens: [techno, dark, warehouse, bass, berlin], Samples: [Berghain sets, DVS1 podcast, Blawan live]
→ Label: "Grimy New Wave"
  whatItIs: "sound designed for rooms where the architecture does half the work"
  whyYou: "you need music that treats subtlety and violence as the same gesture"
  howItChanged: "the BPM kept climbing but the spaces you listened in kept getting smaller"

Tokens: [wood, light, clean, form, nordic], Samples: [Muuto pendant, HAY sofa, Kinfolk interiors]
→ Label: "Scandinavian Silence"
  whatItIs: "objects that treat emptiness as a material and restraint as luxury"
  whyYou: "you believe a room should feel like a held breath"
  howItChanged: "it became less about furniture and more about editing out everything that doesn't earn its place"

Tokens: [film, slow, arthouse, frame, mood], Samples: [Wong Kar-wai stills, Tarkovsky mirror, A24 catalog]
→ Label: "Patient Frame"
  whatItIs: "cinema where the camera refuses to look away until you feel something shift"
  whyYou: "you distrust any story that resolves faster than it takes to sit with the question"
  howItChanged: "you stopped watching for plot and started watching for the moment the light changes"

Clusters:
${clusterDesc}

Respond with ONLY valid JSON:
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
