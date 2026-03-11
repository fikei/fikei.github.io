// Supabase Edge Function: taste-engine
// Multi-level preference derivation pipeline
// Levels 1→2 (affinities), 2→3 (domains), 3→4 (axes), 4→5 (sensibility)
// Plus intent inference (parallel dimension)
//
// POST /functions/v1/taste-engine
// Body: { action, userId, pins?, forceRefresh? }
// Actions:
//   'compute-affinities' — Level 1→2: extract affinities from pins (algorithmic, no LLM)
//   'compute-domains'    — Level 2→3: cluster affinities into domains (LLM labels)
//   'compute-axes'       — Level 3→4: position on aesthetic axes (seed + LLM discovery)
//   'compute-sensibility'— Level 4→5: synthesize overall taste narrative (LLM)
//   'compute-intent'     — Infer intent for pins (algorithmic, no LLM)
//   'full-pipeline'      — Run all levels in sequence
//   'get-profile'        — Return current taste profile (read-only)

const VERSION = '1.2.2'
console.log(`[taste-engine] v${VERSION} — multi-level preference pipeline + secondary signals`)

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient, SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}
const jsonHeaders = { ...corsHeaders, 'Content-Type': 'application/json' }

// --- Supabase client (service role for DB writes) ---

function getSupabase(): SupabaseClient {
  const url = Deno.env.get('SUPABASE_URL')!
  const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  return createClient(url, key)
}

// --- Types ---

interface Pin {
  id: string
  user_id: string
  title: string | null
  category: string
  taste_tags: string[] | null
  practical_tags: string[] | null
  tags: string[] | null           // generic tags (fallback when taste_tags empty)
  entities: { type: string; name: string; confidence: number }[] | null
  content_type: string | null
  content_structure: string | null
  created_at: string
  watched?: boolean
  read?: boolean
  source_weight?: number  // 1.0 for pins, < 1.0 for secondary signals
}

interface Affinity {
  dimension: string
  strength: number
  signal_count: number
  source_tags: string[]
  source_categories: string[]
  signal_type: string
  first_seen: string
  last_reinforced: string
}

interface DomainCluster {
  id?: string
  members: string[]
  categories: Set<string> | string[]
  totalStrength: number
  sampleTitles: string[]
  pinIds: string[]
}

// --- Synonym map for merging near-duplicate dimensions ---

const SYNONYM_MAP: Record<string, string> = {
  'minimalist': 'minimal', 'minimalism': 'minimal',
  'retro': 'vintage', 'nostalgic': 'vintage',
  'handmade': 'artisanal', 'handcrafted': 'artisanal',
  'lo-fi': 'lo_fi', 'lofi': 'lo_fi',
  'cosy': 'cozy',
  'mid-century': 'mid_century', 'midcentury': 'mid_century',
  'hi-fi': 'hi_fi', 'hifi': 'hi_fi',
  'streetwear': 'street', 'street_style': 'street',
  'modernist': 'modern', 'modernism': 'modern',
  'brutalism': 'brutalist',
  'organic': 'natural',
  'luxe': 'luxury', 'luxurious': 'luxury',
  'handbuilt': 'artisanal', 'hand_built': 'artisanal',
  'eco': 'sustainable', 'eco_friendly': 'sustainable',
  'grunge': 'gritty',
}

// --- Seed axes for Level 4 ---

const SEED_AXES: Record<string, { low: { label: string; tags: string[] }; high: { label: string; tags: string[] } }> = {
  density: {
    low: { label: 'minimal', tags: ['minimal', 'sparse', 'clean', 'simple', 'restrained', 'pared_back'] },
    high: { label: 'maximalist', tags: ['maximalist', 'layered', 'dense', 'ornate', 'elaborate', 'busy'] }
  },
  temperature: {
    low: { label: 'cool', tags: ['cool', 'stark', 'clinical', 'austere', 'sterile'] },
    high: { label: 'warm', tags: ['warm', 'cozy', 'natural', 'inviting', 'soft', 'earthy'] }
  },
  era: {
    low: { label: 'vintage', tags: ['vintage', 'retro', 'classic', 'heritage', 'antique', 'nostalgic'] },
    high: { label: 'contemporary', tags: ['modern', 'contemporary', 'futuristic', 'cutting_edge', 'forward'] }
  },
  formality: {
    low: { label: 'raw', tags: ['raw', 'lo_fi', 'rough', 'unfinished', 'diy', 'punk', 'gritty'] },
    high: { label: 'polished', tags: ['refined', 'polished', 'precise', 'luxury', 'elegant', 'curated'] }
  },
  complexity: {
    low: { label: 'simple', tags: ['simple', 'straightforward', 'utilitarian', 'functional'] },
    high: { label: 'intricate', tags: ['complex', 'detailed', 'layered', 'nuanced', 'rich'] }
  },
  production: {
    low: { label: 'artisanal', tags: ['artisanal', 'handmade', 'craft', 'bespoke', 'small_batch'] },
    high: { label: 'industrial', tags: ['mass_produced', 'industrial', 'commercial', 'scalable'] }
  }
}

// --- Intent inference map ---

const TYPE_INTENT_MAP: Record<string, string> = {
  product: 'acquire',
  place: 'acquire',
  event: 'acquire',
  recipe: 'reference',
  article: 'reference',
  tool: 'reference',
  book: 'reference',
  video: 'appreciate',
  music: 'appreciate',
}

// =====================================================================
// LEVEL 1→2: AFFINITY EXTRACTION (purely algorithmic, no LLM)
// =====================================================================

function daysSince(dateStr: string): number {
  return Math.max(0, (Date.now() - new Date(dateStr).getTime()) / (1000 * 60 * 60 * 24))
}

function normalizeDimension(dim: string): string {
  const lower = dim.toLowerCase().replace(/\s+/g, '_').replace(/-/g, '_')
  return SYNONYM_MAP[lower] || lower
}

function extractAffinities(pins: Pin[]): Affinity[] {
  const dimensionSignals = new Map<string, {
    weightedCount: number
    count: number
    tags: string[]
    categories: string[]
    firstSeen: string
    lastSeen: string
  }>()

  function upsertSignal(dimension: string, weight: number, category: string, tag: string, pinDate: string) {
    const normalized = normalizeDimension(dimension)
    if (!normalized || normalized.length < 2) return

    const existing = dimensionSignals.get(normalized)
    if (existing) {
      existing.weightedCount += weight
      existing.count++
      if (!existing.tags.includes(tag)) existing.tags.push(tag)
      if (!existing.categories.includes(category)) existing.categories.push(category)
      if (pinDate < existing.firstSeen) existing.firstSeen = pinDate
      if (pinDate > existing.lastSeen) existing.lastSeen = pinDate
    } else {
      dimensionSignals.set(normalized, {
        weightedCount: weight,
        count: 1,
        tags: [tag],
        categories: [category],
        firstSeen: pinDate,
        lastSeen: pinDate,
      })
    }
  }

  // Stopwords for title keyword extraction
  const TITLE_STOPWORDS = new Set([
    'the', 'and', 'for', 'with', 'from', 'this', 'that', 'have', 'has',
    'are', 'was', 'were', 'been', 'will', 'would', 'could', 'not', 'but',
    'its', 'our', 'your', 'his', 'her', 'their', 'which', 'what', 'when',
    'how', 'who', 'all', 'any', 'more', 'some', 'than', 'too', 'very',
    'just', 'about', 'also', 'into', 'over', 'only', 'then', 'them',
    'new', 'one', 'two', 'first', 'last', 'free', 'full',
    'http', 'https', 'www', 'com', 'org', 'net',
  ])

  for (const pin of pins) {
    const tasteTags = (pin.taste_tags || []).filter(t => t.length > 0)
    const practicalTags = (pin.practical_tags || []).filter(t => t.length > 0)
    const genericTags = (pin.tags || []).filter(t => t.length > 0)
    const age = daysSince(pin.created_at)
    const recencyWeight = Math.exp(-0.005 * age) // half-life ~139 days
    const pinWeight = pin.source_weight ?? 1.0    // 1.0 for pins, < 1.0 for secondary signals
    const hasTasteTags = tasteTags.length > 0

    if (hasTasteTags) {
      // PRIMARY PATH: rich analyze-content data
      // Compound dimensions: taste_tag × practical_tag
      for (const taste of tasteTags) {
        for (const practical of practicalTags) {
          const compound = `${normalizeDimension(taste)}_${normalizeDimension(practical)}`
          upsertSignal(compound, recencyWeight * pinWeight, pin.category, taste, pin.created_at)
        }
      }

      // Solo taste tags (lower weight — less specific)
      for (const taste of tasteTags) {
        upsertSignal(taste, recencyWeight * 0.5 * pinWeight, pin.category, taste, pin.created_at)
      }
    } else {
      // FALLBACK PATH: use generic tags + category + title keywords
      // Lower weight (0.3x) — these are less semantically rich than taste_tags
      const fallbackWeight = recencyWeight * 0.3 * pinWeight

      // Generic tags (e.g. "product", "accessories", "video")
      for (const tag of genericTags) {
        // Compound with category for specificity: "wear_product", "home_accessories"
        if (tag !== pin.category) {
          upsertSignal(`${pin.category}_${normalizeDimension(tag)}`, fallbackWeight, pin.category, tag, pin.created_at)
        }
        upsertSignal(tag, fallbackWeight * 0.5, pin.category, tag, pin.created_at)
      }

      // Title keywords — extract meaningful words as weak signals
      if (pin.title && pin.title.length > 3) {
        const words = pin.title.toLowerCase()
          .replace(/[^a-z0-9\s-]/g, '')
          .split(/\s+/)
          .filter(w => w.length > 3 && !TITLE_STOPWORDS.has(w))
          .slice(0, 5) // max 5 keywords per title
        for (const word of words) {
          upsertSignal(word, fallbackWeight * 0.3, pin.category, `title:${word}`, pin.created_at)
        }
      }

      // Category itself as a weak signal
      upsertSignal(pin.category, fallbackWeight * 0.3, pin.category, `category:${pin.category}`, pin.created_at)
    }

    // Content type as a signal (both paths)
    if (pin.content_type && pin.content_type !== 'unknown') {
      upsertSignal(`type:${pin.content_type}`, recencyWeight * 0.2 * pinWeight, pin.category, `content_type:${pin.content_type}`, pin.created_at)
    }

    // Entity-based dimensions (both paths)
    if (pin.entities) {
      for (const entity of pin.entities) {
        if (entity.confidence > 0.7) {
          const dim = `${entity.type}:${entity.name}`
          upsertSignal(dim, recencyWeight * 0.8 * pinWeight, pin.category, `${entity.type}:${entity.name}`, pin.created_at)
        }
      }
    }
  }

  // Normalize and threshold
  const maxCount = Math.max(1, Math.max(...[...dimensionSignals.values()].map(s => s.weightedCount)))

  const affinities: Affinity[] = []
  for (const [dimension, signal] of dimensionSignals) {
    const strength = signal.weightedCount / maxCount
    if (strength < 0.05 || signal.count < 2) continue // prune noise

    affinities.push({
      dimension,
      strength: Math.round(strength * 1000) / 1000,
      signal_count: signal.count,
      source_tags: signal.tags.slice(0, 20),
      source_categories: [...new Set(signal.categories)],
      signal_type: 'derived',
      first_seen: signal.firstSeen,
      last_reinforced: signal.lastSeen,
    })
  }

  // Sort by strength descending
  affinities.sort((a, b) => b.strength - a.strength)

  return affinities
}

async function saveAffinities(supabase: SupabaseClient, userId: string, affinities: Affinity[]) {
  // Upsert affinities (on conflict: update strength, signal_count, etc.)
  const rows = affinities.map(a => ({
    user_id: userId,
    dimension: a.dimension,
    strength: a.strength,
    signal_count: a.signal_count,
    source_tags: a.source_tags,
    source_categories: a.source_categories,
    signal_type: a.signal_type,
    first_seen: a.first_seen,
    last_reinforced: a.last_reinforced,
    updated_at: new Date().toISOString(),
  }))

  // Batch upsert in chunks of 50
  for (let i = 0; i < rows.length; i += 50) {
    const chunk = rows.slice(i, i + 50)
    const { error } = await supabase
      .from('taste_affinities')
      .upsert(chunk, { onConflict: 'user_id,dimension' })
    if (error) {
      console.error(`[taste-engine] Error upserting affinities chunk ${i}:`, error)
    }
  }

  // Clean up stale affinities (dimensions that no longer appear)
  const currentDimensions = affinities.map(a => a.dimension)
  if (currentDimensions.length > 0) {
    const { error } = await supabase
      .from('taste_affinities')
      .delete()
      .eq('user_id', userId)
      .not('dimension', 'in', `(${currentDimensions.map(d => `"${d}"`).join(',')})`)
    if (error) {
      console.error('[taste-engine] Error cleaning stale affinities:', error)
    }
  }

  // Verify: count what actually persisted
  const { count } = await supabase
    .from('taste_affinities')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', userId)
  console.log(`[taste-engine] Saved ${rows.length} affinities, verified ${count} in DB for user ${userId.slice(0, 8)}`)
}

// =====================================================================
// LEVEL 2→3: DOMAIN CLUSTERING (algorithmic + LLM labeling)
// =====================================================================

function buildCoOccurrenceMatrix(affinities: Affinity[], pins: Pin[]): Map<string, Map<string, number>> {
  // For each pin, compute which affinities it would contribute to
  const pinAffinityMap = new Map<string, Set<string>>()

  for (const pin of pins) {
    const tasteTags = (pin.taste_tags || []).filter(t => t.length > 0).map(t => normalizeDimension(t))
    const practicalTags = (pin.practical_tags || []).filter(t => t.length > 0).map(t => normalizeDimension(t))
    const genericTags = (pin.tags || []).filter(t => t.length > 0)
    const pinDimensions = new Set<string>()

    if (tasteTags.length > 0) {
      // Primary path: taste_tags × practical_tags
      for (const taste of tasteTags) {
        for (const practical of practicalTags) {
          pinDimensions.add(`${taste}_${practical}`)
        }
        pinDimensions.add(taste)
      }
    } else {
      // Fallback path: mirror extractAffinities logic
      for (const tag of genericTags) {
        if (tag !== pin.category) {
          pinDimensions.add(`${pin.category}_${normalizeDimension(tag)}`)
        }
        pinDimensions.add(normalizeDimension(tag))
      }
      pinDimensions.add(pin.category)
    }

    // Content type (both paths)
    if (pin.content_type && pin.content_type !== 'unknown') {
      pinDimensions.add(`type:${pin.content_type}`)
    }

    // Entities (both paths)
    if (pin.entities) {
      for (const e of pin.entities) {
        if (e.confidence > 0.7) pinDimensions.add(normalizeDimension(`${e.type}:${e.name}`))
      }
    }
    pinAffinityMap.set(pin.id, pinDimensions)
  }

  // Build co-occurrence counts
  const affinityDims = new Set(affinities.map(a => a.dimension))
  const coMatrix = new Map<string, Map<string, number>>()

  for (const dim of affinityDims) {
    coMatrix.set(dim, new Map())
  }

  for (const [, dims] of pinAffinityMap) {
    const relevant = [...dims].filter(d => affinityDims.has(d))
    for (let i = 0; i < relevant.length; i++) {
      for (let j = i + 1; j < relevant.length; j++) {
        const a = relevant[i], b = relevant[j]
        const mapA = coMatrix.get(a)!
        const mapB = coMatrix.get(b)!
        mapA.set(b, (mapA.get(b) || 0) + 1)
        mapB.set(a, (mapB.get(a) || 0) + 1)
      }
    }
  }

  return coMatrix
}

function cosineSimilarity(
  a: Map<string, number>,
  b: Map<string, number>,
  allKeys: Set<string>
): number {
  let dot = 0, magA = 0, magB = 0
  for (const key of allKeys) {
    const va = a.get(key) || 0
    const vb = b.get(key) || 0
    dot += va * vb
    magA += va * va
    magB += vb * vb
  }
  if (magA === 0 || magB === 0) return 0
  return dot / (Math.sqrt(magA) * Math.sqrt(magB))
}

function clusterAffinities(affinities: Affinity[], pins: Pin[]): DomainCluster[] {
  if (affinities.length < 2) {
    return affinities.map(a => ({
      members: [a.dimension],
      categories: new Set(a.source_categories),
      totalStrength: a.strength,
      sampleTitles: [],
      pinIds: [],
    }))
  }

  const coMatrix = buildCoOccurrenceMatrix(affinities, pins)
  const allDims = new Set(affinities.map(a => a.dimension))

  // Start: each affinity is its own cluster
  let clusters: DomainCluster[] = affinities.map(a => ({
    members: [a.dimension],
    categories: new Set(a.source_categories),
    totalStrength: a.strength,
    sampleTitles: [],
    pinIds: [],
  }))

  const minClusters = Math.max(2, Math.floor(affinities.length / 5))

  // Agglomerative clustering
  while (clusters.length > minClusters) {
    let bestI = -1, bestJ = -1, bestSim = -1

    for (let i = 0; i < clusters.length; i++) {
      for (let j = i + 1; j < clusters.length; j++) {
        // Average co-occurrence between cluster members
        let totalSim = 0, count = 0
        for (const mA of clusters[i].members) {
          for (const mB of clusters[j].members) {
            const vecA = coMatrix.get(mA) || new Map()
            const vecB = coMatrix.get(mB) || new Map()
            totalSim += cosineSimilarity(vecA, vecB, allDims)
            count++
          }
        }
        const avgSim = count > 0 ? totalSim / count : 0
        if (avgSim > bestSim) {
          bestSim = avgSim
          bestI = i
          bestJ = j
        }
      }
    }

    if (bestSim < 0.08 || bestI < 0) break   // Lower threshold for generic signals

    // Merge clusters
    const merged: DomainCluster = {
      members: [...clusters[bestI].members, ...clusters[bestJ].members],
      categories: new Set([
        ...(clusters[bestI].categories instanceof Set ? clusters[bestI].categories : clusters[bestI].categories),
        ...(clusters[bestJ].categories instanceof Set ? clusters[bestJ].categories : clusters[bestJ].categories),
      ]),
      totalStrength: clusters[bestI].totalStrength + clusters[bestJ].totalStrength,
      sampleTitles: [...clusters[bestI].sampleTitles, ...clusters[bestJ].sampleTitles],
      pinIds: [...clusters[bestI].pinIds, ...clusters[bestJ].pinIds],
    }

    clusters = clusters.filter((_, idx) => idx !== bestI && idx !== bestJ)
    clusters.push(merged)
  }

  // Assign representative pin IDs to each cluster
  // Reuse the pinAffinityMap from co-occurrence (same dimension logic)
  const pinDimMap = new Map<string, Set<string>>()
  for (const pin of pins) {
    const tasteTags = (pin.taste_tags || []).filter(t => t.length > 0).map(t => normalizeDimension(t))
    const genericTags = (pin.tags || []).filter(t => t.length > 0)
    const dims = new Set<string>()

    if (tasteTags.length > 0) {
      for (const tag of tasteTags) dims.add(tag)
    } else {
      for (const tag of genericTags) {
        if (tag !== pin.category) dims.add(`${pin.category}_${normalizeDimension(tag)}`)
        dims.add(normalizeDimension(tag))
      }
      dims.add(pin.category)
    }
    if (pin.content_type && pin.content_type !== 'unknown') {
      dims.add(`type:${pin.content_type}`)
    }
    pinDimMap.set(pin.id, dims)
  }

  for (const cluster of clusters) {
    const clusterDims = new Set(cluster.members)
    const pinScores = new Map<string, number>()

    for (const [pinId, dims] of pinDimMap) {
      let score = 0
      for (const dim of dims) {
        if (clusterDims.has(dim)) score++
      }
      if (score > 0) {
        pinScores.set(pinId, score)
      }
    }

    cluster.pinIds = [...pinScores.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([id]) => id)
  }

  // Filter weak singletons — keep only if they have enough signal
  const multiMemberCount = clusters.filter(c => c.members.length >= 2).length
  return clusters.filter(c => {
    if (c.members.length >= 2) return true
    // Keep singletons only if: strong signal AND pins assigned AND few multi-member clusters
    return c.totalStrength >= 0.4 && c.pinIds.length >= 3 && multiMemberCount < 3
  })
}

async function labelDomainsWithLLM(
  clusters: DomainCluster[],
  pins: Pin[]
): Promise<{ label: string; summary: string; confidence: number; groupIndex: number }[]> {
  const apiKey = Deno.env.get('ANTHROPIC_API_KEY')
  if (!apiKey) {
    console.warn('[taste-engine] No ANTHROPIC_API_KEY, using fallback labels')
    const maxMembers = Math.max(...clusters.map(c => c.members.length), 1)
    const maxStrength = Math.max(...clusters.map(c => c.totalStrength), 1)
    return clusters.map((c, i) => {
      const clusterScore = Math.max(0.2, Math.min(0.95,
        ((c.members.length / maxMembers) + Math.min(1, c.pinIds.length / 10) + (c.totalStrength / maxStrength)) / 3
      ))
      return {
        label: c.members.slice(0, 3).join(' + '),
        summary: `Cluster of ${c.members.length} related interests`,
        confidence: Math.round(clusterScore * 1000) / 1000,
        groupIndex: i,
      }
    })
  }

  // Get sample titles for each cluster
  const pinMap = new Map(pins.map(p => [p.id, p]))
  const clusterContext = clusters.map((c, i) => {
    const titles = c.pinIds
      .map(id => pinMap.get(id))
      .filter(Boolean)
      .slice(0, 5)
      .map((p: any) => p.title || p.url || 'untitled')

    const cats = c.categories instanceof Set ? [...c.categories] : c.categories

    return `Group ${i + 1}:
  Affinities: ${c.members.join(', ')}
  Spans categories: ${cats.join(', ')}
  Combined strength: ${c.totalStrength.toFixed(2)}
  Representative pin titles: ${titles.join(' | ')}`
  }).join('\n\n')

  const prompt = `You are a taste profiler. A user's collection of saved links has been analyzed.
Their interests cluster into the groups below. Each group is defined by the
affinities (interest dimensions) that co-occur — things the user saves together.

Your job: name each cluster as a TASTE DOMAIN — a coherent concept that
explains why these interests belong together.

Groups:
${clusterContext}

For each group, return:
{
  "domains": [
    {
      "group": 1,
      "label": "2-5 word taste domain name (e.g., 'Quiet Japanese Craft', 'Dark Industrial Techno')",
      "summary": "1-2 sentence description of this taste domain — what it is and what connects the parts",
      "confidence": 0.0-1.0
    }
  ]
}

RULES:
- Labels should be SENSIBILITIES, not object categories. "Quiet Japanese Craft" not "Japanese Things."
- Labels should be specific enough to search for and find more of.
- If a group spans multiple board categories, the label should name what BRIDGES them, not list them.
- A group that's just one strong affinity can have a simple label (e.g., "Natural Wine Culture").
- Do not use brand names, artist names, or platform names in labels.

Respond with valid JSON only.`

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 1024,
        messages: [{ role: 'user', content: prompt }],
      }),
    })

    if (!response.ok) {
      console.error('[taste-engine] LLM domain labeling failed:', response.status)
      return clusters.map((c, i) => ({
        label: c.members.slice(0, 3).join(' + '),
        summary: `Cluster of ${c.members.length} related interests`,
        confidence: 0.3,
        groupIndex: i,
      }))
    }

    const data = await response.json()
    const text = data.content?.[0]?.text || ''
    const cleaned = text.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim()

    let parsed: any
    try {
      parsed = JSON.parse(cleaned)
    } catch {
      const first = cleaned.indexOf('{')
      const last = cleaned.lastIndexOf('}')
      if (first >= 0 && last > first) {
        parsed = JSON.parse(cleaned.substring(first, last + 1))
      } else {
        throw new Error('Failed to parse LLM response')
      }
    }

    // Compute hybrid confidence from cluster metrics + LLM confidence
    const maxMembers = Math.max(...clusters.map(c => c.members.length), 1)
    const maxStrength = Math.max(...clusters.map(c => c.totalStrength), 1)

    return (parsed.domains || []).map((d: any) => {
      const idx = (d.group || 1) - 1
      const cluster = clusters[idx]
      const llmConf = d.confidence || 0.5

      if (!cluster) {
        return { label: d.label || 'Unnamed Domain', summary: d.summary || '', confidence: llmConf, groupIndex: idx }
      }

      const memberScore = cluster.members.length / maxMembers
      const pinScore = Math.min(1, cluster.pinIds.length / 10)
      const strengthScore = cluster.totalStrength / maxStrength
      const clusterScore = Math.max(0.2, Math.min(0.95, (memberScore + pinScore + strengthScore) / 3))
      const hybridConf = Math.min(1.0, Math.round((0.4 * llmConf + 0.6 * clusterScore) * 1000) / 1000)

      return {
        label: d.label || 'Unnamed Domain',
        summary: d.summary || '',
        confidence: hybridConf,
        groupIndex: idx,
      }
    })
  } catch (err) {
    console.error('[taste-engine] LLM labeling error:', err)
    const maxMembers = Math.max(...clusters.map(c => c.members.length), 1)
    const maxStrength = Math.max(...clusters.map(c => c.totalStrength), 1)
    return clusters.map((c, i) => {
      const clusterScore = Math.max(0.2, Math.min(0.95,
        ((c.members.length / maxMembers) + Math.min(1, c.pinIds.length / 10) + (c.totalStrength / maxStrength)) / 3
      ))
      return {
        label: c.members.slice(0, 3).join(' + '),
        summary: `Cluster of ${c.members.length} related interests`,
        confidence: Math.min(1.0, Math.round(clusterScore * 1000) / 1000),
        groupIndex: i,
      }
    })
  }
}

async function saveDomains(
  supabase: SupabaseClient,
  userId: string,
  clusters: DomainCluster[],
  labels: { label: string; summary: string; confidence: number; groupIndex: number }[],
  log?: string[]
) {
  // Load existing domains for stability check
  const { data: existing } = await supabase
    .from('taste_domains')
    .select('id, label, constituent_affinities')
    .eq('user_id', userId)

  const existingDomains = existing || []

  const rows = labels.map(l => {
    const cluster = clusters[l.groupIndex]
    if (!cluster) return null

    const cats = cluster.categories instanceof Set ? [...cluster.categories] : cluster.categories

    // Check for domain stability: does an existing domain overlap 60%+?
    let existingId: string | null = null
    for (const ed of existingDomains) {
      const overlap = (ed.constituent_affinities || []).filter((a: string) => cluster.members.includes(a))
      const overlapRatio = overlap.length / Math.max(cluster.members.length, (ed.constituent_affinities || []).length, 1)
      if (overlapRatio >= 0.6) {
        existingId = ed.id
        break
      }
    }

    const row: any = {
      user_id: userId,
      label: l.label,
      summary: l.summary,
      confidence: l.confidence,
      constituent_affinities: cluster.members,
      spanning_categories: cats,
      pin_ids: cluster.pinIds,
      signal_count: cluster.members.length,
      last_reinforced: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }

    if (existingId) {
      row.id = existingId // Preserve ID for stable domain
    }

    return row
  }).filter(Boolean)

  log?.push(`saveDomains: ${rows.length} rows to save, ${existingDomains.length} existing`)

  // Delete old domains, insert new ones
  const { error: delErr } = await supabase.from('taste_domains').delete().eq('user_id', userId)
  if (delErr) {
    console.error('[taste-engine] Error deleting old domains:', delErr)
    log?.push(`domain_delete_err: ${delErr.message}`)
  }

  if (rows.length > 0) {
    const { error, data: inserted } = await supabase.from('taste_domains').insert(rows).select('id')
    if (error) {
      console.error('[taste-engine] Error inserting domains:', error)
      log?.push(`domain_insert_err: ${JSON.stringify(error)}`)
    } else {
      log?.push(`domain_insert_ok: ${(inserted || []).length}`)
    }
  }

  // Clean up stale domain summaries (keep 'global' scope for sensibility)
  await supabase
    .from('taste_summaries')
    .delete()
    .eq('user_id', userId)
    .neq('scope', 'global')

  // Generate per-domain summaries
  for (const row of rows) {
    if (row.summary) {
      await supabase
        .from('taste_summaries')
        .upsert({
          user_id: userId,
          scope: row.id || row.label, // Use domain ID if available, label as fallback
          summary: row.summary,
          confidence: row.confidence,
          pin_count_at_generation: row.pin_ids?.length || 0,
          generated_at: new Date().toISOString(),
          expires_at: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
          model_version: 'claude-haiku-4-5-20251001',
        }, { onConflict: 'user_id,scope' })
    }
  }

  // Verify: count what actually persisted
  const { count: domCount } = await supabase
    .from('taste_domains')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', userId)
  console.log(`[taste-engine] Saved ${rows.length} domains, verified ${domCount} in DB for user ${userId.slice(0, 8)}`)
}

// =====================================================================
// LEVEL 3→4: AXIS POSITIONING (seed axes + LLM discovery)
// =====================================================================

function computeSeedAxes(affinities: Affinity[]): {
  axis: string; position: number; confidence: number;
  low_label: string; high_label: string;
  contributing_tags: string[]; is_seed: boolean;
}[] {
  const axes = []

  for (const [axisName, axisConfig] of Object.entries(SEED_AXES)) {
    let lowScore = 0, highScore = 0, totalWeight = 0
    const contributing: string[] = []

    for (const affinity of affinities) {
      for (const tag of affinity.source_tags) {
        const normalized = normalizeDimension(tag)
        if (axisConfig.low.tags.includes(normalized)) {
          lowScore += affinity.strength
          totalWeight += affinity.strength
          if (!contributing.includes(tag)) contributing.push(tag)
        }
        if (axisConfig.high.tags.includes(normalized)) {
          highScore += affinity.strength
          totalWeight += affinity.strength
          if (!contributing.includes(tag)) contributing.push(tag)
        }
      }
    }

    if (totalWeight < 0.3) continue // Not enough signal

    const position = (lowScore + highScore) > 0 ? highScore / (lowScore + highScore) : 0.5
    const confidence = Math.min(1.0, totalWeight / 2.0)

    axes.push({
      axis: axisName,
      position: Math.round(position * 1000) / 1000,
      confidence: Math.round(confidence * 1000) / 1000,
      low_label: axisConfig.low.label,
      high_label: axisConfig.high.label,
      contributing_tags: contributing.slice(0, 20),
      is_seed: true,
    })
  }

  return axes
}

async function discoverAxes(affinities: Affinity[]): Promise<{
  axis: string; position: number; confidence: number;
  low_label: string; high_label: string;
  contributing_tags: string[]; is_seed: boolean;
}[]> {
  // Find frequent cross-category taste_tags not captured by any seed axis
  const allSeedTags = new Set<string>()
  for (const axis of Object.values(SEED_AXES)) {
    axis.low.tags.forEach(t => allSeedTags.add(t))
    axis.high.tags.forEach(t => allSeedTags.add(t))
  }

  const unmapped = affinities.filter(a =>
    a.strength > 0.3 &&
    a.source_categories.length >= 2 &&
    !a.source_tags.some(t => allSeedTags.has(normalizeDimension(t))) &&
    !a.dimension.includes(':') // exclude entity-type dimensions
  )

  if (unmapped.length < 4) return []

  const apiKey = Deno.env.get('ANTHROPIC_API_KEY')
  if (!apiKey) return []

  const prompt = `These taste signals appear across multiple categories in a user's collection
but don't map to standard aesthetic dimensions (density, temperature, era, etc.):

${unmapped.map(a => `- "${a.dimension}" (strength: ${a.strength}, categories: ${a.source_categories.join(', ')})`).join('\n')}

Do these signals suggest a coherent aesthetic dimension — a spectrum the user's
taste sits on? If yes, name both ends of the spectrum.

Return JSON:
{ "is_axis": true/false,
  "axis_name": "short_snake_case_name",
  "low_label": "one end",
  "high_label": "other end",
  "reasoning": "why these form a coherent dimension" }

If they don't form a coherent axis (they're just miscellaneous tags), return
{ "is_axis": false }.

Respond with valid JSON only.`

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 256,
        messages: [{ role: 'user', content: prompt }],
      }),
    })

    if (!response.ok) return []

    const data = await response.json()
    const text = data.content?.[0]?.text || ''
    const cleaned = text.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim()
    const parsed = JSON.parse(cleaned.includes('{') ? cleaned.substring(cleaned.indexOf('{'), cleaned.lastIndexOf('}') + 1) : cleaned)

    if (!parsed.is_axis) return []

    // Compute position: average strength of unmapped tags (0.5 = center)
    const avgStrength = unmapped.reduce((sum, a) => sum + a.strength, 0) / unmapped.length

    return [{
      axis: parsed.axis_name || 'discovered',
      position: 0.5, // Centered for discovered axes until more signal
      confidence: Math.min(0.7, avgStrength),
      low_label: parsed.low_label || 'low',
      high_label: parsed.high_label || 'high',
      contributing_tags: unmapped.map(a => a.dimension).slice(0, 20),
      is_seed: false,
    }]
  } catch (err) {
    console.error('[taste-engine] Axis discovery error:', err)
    return []
  }
}

async function inferAxesFromDomains(
  supabase: SupabaseClient,
  userId: string,
  affinities: Affinity[]
): Promise<{
  axis: string; position: number; confidence: number;
  low_label: string; high_label: string;
  contributing_tags: string[]; is_seed: boolean;
}[]> {
  const apiKey = Deno.env.get('ANTHROPIC_API_KEY')
  if (!apiKey) return []

  // Load saved domains (just written by compute-domains step)
  const { data: domains } = await supabase
    .from('taste_domains')
    .select('label, summary, constituent_affinities, spanning_categories')
    .eq('user_id', userId)
    .order('confidence', { ascending: false })
    .limit(10)

  if (!domains || domains.length === 0) return []

  const topAffinities = affinities
    .filter(a => !a.dimension.startsWith('type:') && !a.dimension.startsWith('category:'))
    .slice(0, 15)

  const prompt = `You are a taste profiler. A user's saved collection has been analyzed into these taste domains and top interest signals.

TASTE DOMAINS:
${domains.map((d: any) => `- "${d.label}": ${d.summary || 'no description'} (categories: ${(d.spanning_categories || []).join(', ')})`).join('\n')}

TOP INTEREST SIGNALS:
${topAffinities.map(a => `- "${a.dimension}" (strength: ${a.strength}, across: ${a.source_categories.join(', ')})`).join('\n')}

Based on what this person collects, position them on these aesthetic spectra. Only include axes where you have enough signal to make a reasonable inference.

Axes:
- density: minimal (sparse, clean, restrained) ↔ maximalist (layered, dense, ornate)
- temperature: cool (stark, clinical, austere) ↔ warm (cozy, natural, inviting)
- era: vintage (retro, classic, heritage) ↔ contemporary (modern, futuristic, cutting-edge)
- formality: raw (lo-fi, rough, DIY, punk) ↔ polished (refined, precise, luxury, elegant)
- complexity: simple (straightforward, utilitarian) ↔ intricate (complex, detailed, nuanced)
- production: artisanal (handmade, craft, bespoke) ↔ industrial (mass-produced, commercial)

Return JSON:
{ "axes": [
  { "axis": "era", "position": 0.7, "confidence": 0.4, "reasoning": "brief explanation" }
]}

position: 0.0 = fully low-end, 1.0 = fully high-end, 0.5 = balanced/no lean
confidence: 0.0-1.0, only include axes with confidence > 0.3
Skip axes where the collection gives no aesthetic signal.
Respond with valid JSON only.`

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 512,
        messages: [{ role: 'user', content: prompt }],
      }),
    })

    if (!response.ok) return []

    const data = await response.json()
    const text = data.content?.[0]?.text || ''
    const cleaned = text.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim()
    const parsed = JSON.parse(cleaned.includes('{') ? cleaned.substring(cleaned.indexOf('{'), cleaned.lastIndexOf('}') + 1) : cleaned)

    const axisConfig = SEED_AXES
    return (parsed.axes || [])
      .filter((a: any) => a.confidence > 0.3 && axisConfig[a.axis])
      .map((a: any) => ({
        axis: a.axis,
        position: Math.round(Math.max(0, Math.min(1, a.position)) * 1000) / 1000,
        confidence: Math.round(Math.max(0, Math.min(1, a.confidence)) * 1000) / 1000,
        low_label: axisConfig[a.axis].low.label,
        high_label: axisConfig[a.axis].high.label,
        contributing_tags: topAffinities.slice(0, 10).map(af => af.dimension),
        is_seed: false,
      }))
  } catch (err) {
    console.error('[taste-engine] Axis inference error:', err)
    return []
  }
}

async function saveAxes(supabase: SupabaseClient, userId: string, axes: any[]) {
  const rows = axes.map(a => ({
    user_id: userId,
    axis: a.axis,
    position: a.position,
    low_label: a.low_label,
    high_label: a.high_label,
    confidence: a.confidence,
    contributing_tags: a.contributing_tags,
    is_seed: a.is_seed,
    updated_at: new Date().toISOString(),
  }))

  for (const row of rows) {
    await supabase
      .from('taste_axes')
      .upsert(row, { onConflict: 'user_id,axis' })
  }

  // Remove axes that no longer have signal (discovered/inferred only — true seeds persist)
  const currentAxisNames = axes.map(a => a.axis)
  if (currentAxisNames.length > 0) {
    // Keep ALL axes in current computation (seed-named inferred axes included)
    const { error: cleanErr } = await supabase
      .from('taste_axes')
      .delete()
      .eq('user_id', userId)
      .eq('is_seed', false)
      .not('axis', 'in', `(${currentAxisNames.map(a => `"${a}"`).join(',')})`)
    if (cleanErr) console.error('[taste-engine] Error cleaning stale axes:', cleanErr)
  }

  // Verify: count what actually persisted
  const { count: axCount } = await supabase
    .from('taste_axes')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', userId)
  console.log(`[taste-engine] Saved ${rows.length} axes, verified ${axCount} in DB for user ${userId.slice(0, 8)}`)
}

// =====================================================================
// LEVEL 4→5: SENSIBILITY SYNTHESIS (LLM only)
// =====================================================================

async function synthesizeSensibility(
  supabase: SupabaseClient,
  userId: string
): Promise<{ summary: string; valueTags: string[]; confidence: number } | null> {
  const apiKey = Deno.env.get('ANTHROPIC_API_KEY')
  if (!apiKey) return null

  // Load current taste state
  const [axesRes, domainsRes, affinitiesRes] = await Promise.all([
    supabase.from('taste_axes').select('*').eq('user_id', userId).gt('confidence', 0.3),
    supabase.from('taste_domains').select('*').eq('user_id', userId).order('confidence', { ascending: false }).limit(10),
    supabase.from('taste_affinities').select('*').eq('user_id', userId).order('strength', { ascending: false }).limit(20),
  ])

  const axes = axesRes.data || []
  const domains = domainsRes.data || []
  const topAffinities = affinitiesRes.data || []

  if (axes.length === 0 && domains.length === 0) return null

  const crossCategory = topAffinities.filter((a: any) => (a.source_categories || []).length >= 3)

  // Count total pins for stats
  const { count } = await supabase
    .from('links')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', userId)

  const pinCount = count || 0

  const prompt = `A user's complete taste profile:

AESTHETIC AXES (where they sit on continuous scales):
${axes.map((a: any) => `${a.axis}: ${a.position.toFixed(1)} (${a.low_label} ↔ ${a.high_label})`).join('\n')}

TASTE DOMAINS (the coherent clusters in their collection):
${domains.map((d: any) => `"${d.label}" — ${d.summary || 'no description'}`).join('\n')}

BRIDGING INTERESTS (themes that cross 3+ categories):
${crossCategory.map((a: any) => `${a.dimension} (across ${(a.source_categories || []).join(', ')})`).join('\n') || 'none identified yet'}

COLLECTION: ${pinCount} items, ${domains.length} taste domains

Write a 2-3 sentence SENSIBILITY — the deep thread connecting all of this.
What kind of person collects these things? What underlying values or aesthetic
instincts unite their diverse interests?

Also extract 3-5 VALUE TAGS — single words or short phrases that capture
the core principles (e.g., "restraint", "craft over convenience", "depth over breadth").

Do not list domains or categories. Identify the current beneath them.

Return JSON:
{ "sensibility": "2-3 sentence narrative",
  "valueTags": ["tag1", "tag2", ...],
  "confidence": 0.0-1.0 }

Respond with valid JSON only.`

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 512,
        messages: [{ role: 'user', content: prompt }],
      }),
    })

    if (!response.ok) return null

    const data = await response.json()
    const text = data.content?.[0]?.text || ''
    const cleaned = text.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim()
    const parsed = JSON.parse(cleaned.includes('{') ? cleaned.substring(cleaned.indexOf('{'), cleaned.lastIndexOf('}') + 1) : cleaned)

    // Save global summary
    await supabase
      .from('taste_summaries')
      .upsert({
        user_id: userId,
        scope: 'global',
        summary: parsed.sensibility || '',
        confidence: parsed.confidence || 0.5,
        pin_count_at_generation: pinCount,
        source_snapshot: {
          axes: Object.fromEntries(axes.map((a: any) => [a.axis, a.position])),
          domains: domains.map((d: any) => d.label),
          valueTags: parsed.valueTags || [],
        },
        generated_at: new Date().toISOString(),
        expires_at: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
        model_version: 'claude-haiku-4-5-20251001',
      }, { onConflict: 'user_id,scope' })

    // Save snapshot
    await supabase
      .from('taste_snapshots')
      .upsert({
        user_id: userId,
        snapshot_date: new Date().toISOString().split('T')[0],
        affinities: Object.fromEntries(topAffinities.map((a: any) => [a.dimension, a.strength])),
        domains: Object.fromEntries(domains.map((d: any) => [d.label, { confidence: d.confidence, spanning_categories: d.spanning_categories }])),
        axes: Object.fromEntries(axes.map((a: any) => [a.axis, a.position])),
        pin_count: pinCount,
      }, { onConflict: 'user_id,snapshot_date' })

    console.log(`[taste-engine] Saved sensibility for user ${userId.slice(0, 8)}`)

    return {
      summary: parsed.sensibility,
      valueTags: parsed.valueTags || [],
      confidence: parsed.confidence || 0.5,
    }
  } catch (err) {
    console.error('[taste-engine] Sensibility synthesis error:', err)
    return null
  }
}

// =====================================================================
// INTENT INFERENCE (algorithmic, no LLM)
// =====================================================================

function inferIntent(pin: Pin): {
  intent: string; action_state: string; horizon: string;
  confidence: number; inferred_from: string;
} {
  let intent = 'appreciate'
  let confidence = 0.3
  let inferred_from = 'default'

  // Content structure overrides
  if (pin.content_structure === 'reference') {
    intent = 'reference'
    confidence = 0.5
    inferred_from = 'content_structure'
  } else if (pin.content_structure === 'review') {
    intent = 'acquire'
    confidence = 0.5
    inferred_from = 'content_structure'
  } else if (pin.content_type && TYPE_INTENT_MAP[pin.content_type]) {
    intent = TYPE_INTENT_MAP[pin.content_type]
    confidence = 0.3
    inferred_from = 'content_type'
  }

  // Action state from consumption markers
  let action_state = 'unprocessed'
  if (pin.watched === true || pin.read === true) {
    action_state = 'done'
  } else if (pin.watched === false || pin.read === false) {
    action_state = 'unprocessed'
  }

  return {
    intent,
    action_state,
    horizon: 'someday',
    confidence,
    inferred_from,
  }
}

async function saveIntents(supabase: SupabaseClient, userId: string, pins: Pin[]) {
  const rows = pins.map(pin => {
    const inferred = inferIntent(pin)
    return {
      user_id: userId,
      link_id: pin.id,
      intent: inferred.intent,
      action_state: inferred.action_state,
      horizon: inferred.horizon,
      confidence: inferred.confidence,
      inferred_from: inferred.inferred_from,
      updated_at: new Date().toISOString(),
    }
  })

  // Batch upsert, but only for pins that don't have explicit intent already
  // (respect user overrides by checking confidence >= 0.7)
  for (let i = 0; i < rows.length; i += 50) {
    const chunk = rows.slice(i, i + 50)

    // First, check which already have high-confidence (user-set) intent
    const linkIds = chunk.map(r => r.link_id)
    const { data: existing } = await supabase
      .from('pin_intent')
      .select('link_id, confidence')
      .eq('user_id', userId)
      .in('link_id', linkIds)
      .gte('confidence', 0.7)

    const userSetIds = new Set((existing || []).map((e: any) => e.link_id))

    // Only upsert pins without user-set intent
    const toUpsert = chunk.filter(r => !userSetIds.has(r.link_id))

    if (toUpsert.length > 0) {
      const { error } = await supabase
        .from('pin_intent')
        .upsert(toUpsert, { onConflict: 'user_id,link_id' })
      if (error) {
        console.error(`[taste-engine] Error upserting intents chunk ${i}:`, error)
      }
    }
  }

  console.log(`[taste-engine] Inferred intent for ${rows.length} pins, user ${userId.slice(0, 8)}`)
}

// =====================================================================
// GET PROFILE (read-only, returns current taste state)
// =====================================================================

async function getProfile(supabase: SupabaseClient, userId: string) {
  const [affinities, domains, axes, summaries, snapshots] = await Promise.all([
    supabase.from('taste_affinities').select('*').eq('user_id', userId).order('strength', { ascending: false }).limit(50),
    supabase.from('taste_domains').select('*').eq('user_id', userId).order('confidence', { ascending: false }),
    supabase.from('taste_axes').select('*').eq('user_id', userId),
    supabase.from('taste_summaries').select('*').eq('user_id', userId),
    supabase.from('taste_snapshots').select('*').eq('user_id', userId).order('snapshot_date', { ascending: false }).limit(3),
  ])

  // Debug: log errors and counts
  const errors: string[] = []
  if (affinities.error) errors.push(`affinities: ${affinities.error.message}`)
  if (domains.error) errors.push(`domains: ${domains.error.message}`)
  if (axes.error) errors.push(`axes: ${axes.error.message}`)
  if (summaries.error) errors.push(`summaries: ${summaries.error.message}`)
  if (snapshots.error) errors.push(`snapshots: ${snapshots.error.message}`)
  if (errors.length > 0) {
    console.error(`[taste-engine] getProfile errors: ${errors.join('; ')}`)
  }
  console.log(`[taste-engine] getProfile: aff=${(affinities.data || []).length} dom=${(domains.data || []).length} ax=${(axes.data || []).length} sum=${(summaries.data || []).length} snap=${(snapshots.data || []).length}`)

  return {
    affinities: affinities.data || [],
    domains: domains.data || [],
    axes: axes.data || [],
    summaries: summaries.data || [],
    snapshots: snapshots.data || [],
  }
}

// =====================================================================
// MAIN HANDLER
// =====================================================================

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const body = await req.json()
    const { action, userId, forceRefresh } = body

    if (!action) {
      return new Response(
        JSON.stringify({ error: 'action is required' }),
        { status: 400, headers: jsonHeaders }
      )
    }

    if (!userId && action !== 'health') {
      return new Response(
        JSON.stringify({ error: 'userId is required' }),
        { status: 400, headers: jsonHeaders }
      )
    }

    const supabase = getSupabase()
    const startTime = Date.now()

    // =============================================
    // GET PROFILE (read-only)
    // =============================================
    if (action === 'get-profile') {
      const profile = await getProfile(supabase, userId)
      return new Response(
        JSON.stringify({ profile, meta: { elapsed: Date.now() - startTime } }),
        { headers: jsonHeaders }
      )
    }

    // =============================================
    // HEALTH CHECK
    // =============================================
    if (action === 'health') {
      return new Response(
        JSON.stringify({ status: 'ok', version: VERSION }),
        { headers: jsonHeaders }
      )
    }

    // =============================================
    // FETCH PINS (shared across actions)
    // =============================================
    let pins: Pin[] = body.pins || []

    // If no pins provided, fetch from DB
    if (pins.length === 0) {
      const { data, error } = await supabase
        .from('links')
        .select('id, user_id, title, category, taste_tags, practical_tags, tags, entities, content_type, content_structure, created_at, watched, read')
        .eq('user_id', userId)
        .order('created_at', { ascending: false })

      if (error) {
        console.error('[taste-engine] Error fetching pins:', error)
        return new Response(
          JSON.stringify({ error: 'Failed to fetch pins', detail: error.message }),
          { status: 500, headers: jsonHeaders }
        )
      }

      pins = (data || []) as Pin[]
    }

    // Fetch secondary signals and merge as Pin-shaped objects
    let secondaryCount = 0
    try {
      const { data: signalData } = await supabase
        .from('secondary_signals')
        .select('id, user_id, category, taste_tags, practical_tags, entities, content_type, created_at, source_weight')
        .eq('user_id', userId)

      if (signalData && signalData.length > 0) {
        // Only include signals that have taste tags
        const secondaryPins: Pin[] = signalData
          .filter((s: { taste_tags: string[] | null }) => s.taste_tags && s.taste_tags.length > 0)
          .map((s: { id: string; user_id: string; category: string; taste_tags: string[]; practical_tags: string[]; entities: unknown; content_type: string; created_at: string; source_weight: number }) => ({
            id: s.id,
            user_id: s.user_id,
            title: null,
            category: s.category,
            taste_tags: s.taste_tags,
            practical_tags: s.practical_tags,
            tags: null,
            entities: s.entities as Pin['entities'],
            content_type: s.content_type,
            content_structure: null,
            created_at: s.created_at,
            source_weight: s.source_weight,
          }))
        secondaryCount = secondaryPins.length
        pins = [...pins, ...secondaryPins]
      }
    } catch (e) {
      // Non-fatal: secondary signals are additive, proceed without them
      console.warn('[taste-engine] Failed to fetch secondary signals:', e)
    }

    const pipelineLog: string[] = []
    console.log(`[taste-engine] ${action} — ${pins.length - secondaryCount} pins + ${secondaryCount} secondary signals for user ${userId.slice(0, 8)}`)

    if (pins.length === 0) {
      return new Response(
        JSON.stringify({
          message: 'No pins with taste data found. Save some links first.',
          meta: { elapsed: Date.now() - startTime, pinCount: 0 }
        }),
        { headers: jsonHeaders }
      )
    }

    // =============================================
    // COMPUTE AFFINITIES (Level 1→2)
    // =============================================
    if (action === 'compute-affinities' || action === 'full-pipeline') {
      const affinities = extractAffinities(pins)
      await saveAffinities(supabase, userId, affinities)

      if (action === 'compute-affinities') {
        return new Response(
          JSON.stringify({
            affinities: affinities.slice(0, 50),
            meta: { total: affinities.length, elapsed: Date.now() - startTime }
          }),
          { headers: jsonHeaders }
        )
      }
    }

    // =============================================
    // COMPUTE DOMAINS (Level 2→3)
    // =============================================
    if (action === 'compute-domains' || action === 'full-pipeline') {
      // Load affinities (either just computed or from DB)
      let affinities: Affinity[]
      if (action === 'full-pipeline') {
        // Just computed above, re-extract
        affinities = extractAffinities(pins)
      } else {
        const { data } = await supabase
          .from('taste_affinities')
          .select('*')
          .eq('user_id', userId)
          .order('strength', { ascending: false })
        affinities = (data || []) as Affinity[]
      }

      // Filter out purely organizational dimensions (category:* signals)
      // Keep type:* — they indicate content preference (music, books, tools)
      const clusterableAffinities = affinities.filter(a =>
        !a.dimension.startsWith('category:')
      )

      pipelineLog.push(`clusterable_affinities: ${clusterableAffinities.length}`)
      if (clusterableAffinities.length >= 2) {
        const clusters = clusterAffinities(clusterableAffinities, pins)
        pipelineLog.push(`clusters: ${clusters.length}`)
        const labels = await labelDomainsWithLLM(clusters, pins)
        pipelineLog.push(`labels: ${labels.length}, confs: ${labels.map(l => l.confidence.toFixed(3)).join(',')}`)
        await saveDomains(supabase, userId, clusters, labels, pipelineLog)

        if (action === 'compute-domains') {
          return new Response(
            JSON.stringify({
              domains: labels,
              clusters: clusters.map(c => ({
                members: c.members,
                categories: c.categories instanceof Set ? [...c.categories] : c.categories,
                totalStrength: c.totalStrength,
                pinCount: c.pinIds.length,
              })),
              meta: { elapsed: Date.now() - startTime }
            }),
            { headers: jsonHeaders }
          )
        }
      } else {
        console.log('[taste-engine] Not enough affinities for domain clustering')
      }
    }

    // =============================================
    // COMPUTE AXES (Level 3→4)
    // =============================================
    if (action === 'compute-axes' || action === 'full-pipeline') {
      let affinities: Affinity[]
      if (action === 'full-pipeline') {
        affinities = extractAffinities(pins)
      } else {
        const { data } = await supabase
          .from('taste_affinities')
          .select('*')
          .eq('user_id', userId)
          .order('strength', { ascending: false })
        affinities = (data || []) as Affinity[]
      }

      const seedAxes = computeSeedAxes(affinities)
      const discoveredAxes = await discoverAxes(affinities)
      // When seed axes find nothing (no aesthetic tags), infer from domain context
      const inferredAxes = (seedAxes.length === 0)
        ? await inferAxesFromDomains(supabase, userId, affinities)
        : []
      const allAxes = [...seedAxes, ...discoveredAxes, ...inferredAxes]

      await saveAxes(supabase, userId, allAxes)

      if (action === 'compute-axes') {
        return new Response(
          JSON.stringify({
            axes: allAxes,
            meta: { seed: seedAxes.length, discovered: discoveredAxes.length, inferred: inferredAxes.length, elapsed: Date.now() - startTime }
          }),
          { headers: jsonHeaders }
        )
      }
    }

    // =============================================
    // COMPUTE SENSIBILITY (Level 4→5)
    // =============================================
    if (action === 'compute-sensibility' || action === 'full-pipeline') {
      const result = await synthesizeSensibility(supabase, userId)

      if (action === 'compute-sensibility') {
        return new Response(
          JSON.stringify({
            sensibility: result,
            meta: { elapsed: Date.now() - startTime }
          }),
          { headers: jsonHeaders }
        )
      }
    }

    // =============================================
    // COMPUTE INTENT (parallel dimension)
    // =============================================
    if (action === 'compute-intent' || action === 'full-pipeline') {
      // For intent, we need all pins (including those without taste_tags)
      let allPins = pins
      if (action === 'compute-intent') {
        const { data } = await supabase
          .from('links')
          .select('id, user_id, title, category, taste_tags, practical_tags, tags, entities, content_type, content_structure, created_at, watched, read')
          .eq('user_id', userId)
          .order('created_at', { ascending: false })
        allPins = (data || []) as Pin[]
      }

      await saveIntents(supabase, userId, allPins)

      if (action === 'compute-intent') {
        const sample = allPins.slice(0, 10).map(p => ({
          id: p.id,
          ...inferIntent(p),
        }))
        return new Response(
          JSON.stringify({
            sample,
            meta: { totalPins: allPins.length, elapsed: Date.now() - startTime }
          }),
          { headers: jsonHeaders }
        )
      }
    }

    // =============================================
    // FULL PIPELINE RESPONSE
    // =============================================
    if (action === 'full-pipeline') {
      const profile = await getProfile(supabase, userId)
      return new Response(
        JSON.stringify({
          profile,
          meta: { pinCount: pins.length, elapsed: Date.now() - startTime, version: VERSION },
          debug: pipelineLog,
        }),
        { headers: jsonHeaders }
      )
    }

    return new Response(
      JSON.stringify({ error: `Unknown action: ${action}` }),
      { status: 400, headers: jsonHeaders }
    )
  } catch (err) {
    console.error('[taste-engine] Error:', err)
    return new Response(
      JSON.stringify({ error: 'Internal error', detail: String(err) }),
      { status: 500, headers: jsonHeaders }
    )
  }
})
