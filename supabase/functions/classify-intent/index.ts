// Supabase Edge Function: classify-intent
// Intent classification for pins — two-pass system:
//   Pass 1 (classify): Fast signal-based → LLM fallback classification
//   Pass 2 (hypothesize): Async pattern-level hypothesis generation
//
// POST /functions/v1/classify-intent
// Body: { action: 'classify' | 'hypothesize', ...params }

const VERSION = '1.0.0'
console.log(`[classify-intent] v${VERSION} — intent classification pipeline`)

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}
const jsonHeaders = { ...corsHeaders, 'Content-Type': 'application/json' }

// --- Configuration ---

const INTENT_CONFIDENCE_THRESHOLD = 0.75
const LLM_TIMEOUT_MS = 5000
const CLASSIFY_MODEL = 'claude-sonnet-4-20250514'
const HYPOTHESIZE_MODEL = 'claude-sonnet-4-20250514'

// Known commerce domains (partial match on domain)
const COMMERCE_DOMAINS = new Set([
  'amazon.com', 'amazon.co.uk', 'amazon.de', 'amazon.ca',
  'etsy.com', 'ebay.com', 'walmart.com', 'target.com',
  'bestbuy.com', 'nordstrom.com', 'nike.com', 'adidas.com',
  'zara.com', 'hm.com', 'uniqlo.com', 'asos.com',
  'net-a-porter.com', 'mrporter.com', 'ssense.com', 'farfetch.com',
  'shopbop.com', 'revolve.com', 'aesop.com', 'glossier.com',
  'sephora.com', 'ulta.com', 'wayfair.com', 'ikea.com',
  'anthropologie.com', 'freepeople.com', 'urbanoutfitters.com',
  'endclothing.com', 'matchesfashion.com', 'mytheresa.com',
])

// AI/dev tool signals in practical_tags
const AI_TOOL_TAGS = new Set([
  'ai', 'machine-learning', 'llm', 'api', 'developer-tool',
  'devtool', 'saas', 'automation', 'no-code', 'low-code',
  'coding', 'ide', 'framework', 'sdk', 'cli',
])

// --- Types ---

interface ClassifyRequest {
  action: 'classify'
  url: string
  title: string
  description: string
  domain: string
  content_type: string
  practical_tags: string[]
  taste_tags: string[]
  entities: Array<{ name: string; type: string }>
  og_type?: string
  og_price_amount?: string
  og_price_currency?: string
  structured_data_types?: string[]
  source?: string
  userId: string
  linkId: string
}

interface HypothesizeRequest {
  action: 'hypothesize'
  userId: string
  linkId: string
  current_pin: {
    url: string
    title: string
    domain: string
    content_type: string
    practical_tags: string[]
    intent_type?: string
  }
  recent_pins: Array<{
    id: string
    title: string
    domain: string
    content_type: string
    intent_type?: string
    action_state?: string
  }>
}

interface IntentResult {
  intent_type: string
  confidence: number
  extracted_metadata: Record<string, unknown>
  reasoning: string
}

// --- Tier 1: Rules-based classification ---

function classifyByRules(req: ClassifyRequest): IntentResult | null {
  // Commerce signals
  const isProductOG = req.og_type === 'product'
  const hasPrice = !!(req.og_price_amount && parseFloat(req.og_price_amount) > 0)
  const hasProductSchema = req.structured_data_types?.includes('Product') || false
  const isCommerceDomain = COMMERCE_DOMAINS.has(req.domain) ||
    // Shopify stores: check for myshopify.com or common Shopify patterns
    req.domain.endsWith('.myshopify.com')

  if (isProductOG || hasProductSchema) {
    const metadata: Record<string, unknown> = {
      product_name: req.title,
      retailer: req.domain,
    }
    if (hasPrice) {
      metadata.price = req.og_price_amount
      metadata.currency = req.og_price_currency || 'USD'
    }
    return {
      intent_type: 'commerce',
      confidence: 0.95,
      extracted_metadata: metadata,
      reasoning: `OG type=${req.og_type}, schema types=${req.structured_data_types?.join(',')}, price=${hasPrice}`,
    }
  }

  if (isCommerceDomain && hasPrice) {
    return {
      intent_type: 'commerce',
      confidence: 0.90,
      extracted_metadata: {
        product_name: req.title,
        price: req.og_price_amount,
        currency: req.og_price_currency || 'USD',
        retailer: req.domain,
      },
      reasoning: `Known commerce domain ${req.domain} with price signal`,
    }
  }

  if (isCommerceDomain) {
    return {
      intent_type: 'commerce',
      confidence: 0.80,
      extracted_metadata: {
        product_name: req.title,
        retailer: req.domain,
      },
      reasoning: `Known commerce domain ${req.domain} (no price found)`,
    }
  }

  // AI Tool signals
  const isToolType = req.content_type === 'tool' || req.content_type === 'repository'
  const hasAITags = req.practical_tags?.some(t => AI_TOOL_TAGS.has(t.toLowerCase())) || false
  const hasDocsSubdomain = req.url.includes('/docs') || req.url.includes('docs.')
  const hasAIEntity = req.entities?.some(e =>
    e.type === 'tool' || e.name.toLowerCase().includes('ai')
  ) || false

  if (isToolType && hasAITags) {
    // Extract docs URL heuristic
    const urlObj = new URL(req.url)
    const docsUrl = hasDocsSubdomain ? req.url :
      `https://docs.${urlObj.hostname}` // best guess

    return {
      intent_type: 'ai_tool',
      confidence: 0.85,
      extracted_metadata: {
        tool_name: req.entities?.find(e => e.type === 'tool')?.name || req.title,
        tagline: req.description?.slice(0, 120) || '',
        docs_url: hasDocsSubdomain ? req.url : null,
        github_url: req.url.includes('github.com') ? req.url : null,
        category: req.practical_tags?.find(t => AI_TOOL_TAGS.has(t.toLowerCase())) || 'ai',
      },
      reasoning: `Content type=${req.content_type}, AI tags=${req.practical_tags?.filter(t => AI_TOOL_TAGS.has(t.toLowerCase())).join(',')}`,
    }
  }

  if (isToolType && hasAIEntity) {
    return {
      intent_type: 'ai_tool',
      confidence: 0.78,
      extracted_metadata: {
        tool_name: req.entities?.find(e => e.type === 'tool')?.name || req.title,
        tagline: req.description?.slice(0, 120) || '',
        docs_url: null,
        github_url: req.url.includes('github.com') ? req.url : null,
        category: 'tool',
      },
      reasoning: `Content type=${req.content_type} with AI entity detected`,
    }
  }

  // V2 stubs — return with confidence so they're logged but below threshold
  if (req.content_type === 'recipe') {
    return {
      intent_type: 'recipe',
      confidence: 0.60, // Below threshold — V2
      extracted_metadata: { recipe_name: req.title },
      reasoning: 'Recipe content type detected (V2 stub)',
    }
  }

  if (req.content_type === 'event') {
    return {
      intent_type: 'event',
      confidence: 0.60, // Below threshold — V2
      extracted_metadata: { event_name: req.title },
      reasoning: 'Event content type detected (V2 stub)',
    }
  }

  return null
}

// --- Tier 2: LLM classification ---

async function classifyByLLM(req: ClassifyRequest): Promise<IntentResult | null> {
  const apiKey = Deno.env.get('ANTHROPIC_API_KEY')
  if (!apiKey) {
    console.error('[classify-intent] ANTHROPIC_API_KEY not configured')
    return null
  }

  const prompt = `Analyze this pinned URL and determine the user's likely intent.

URL: ${req.url}
Title: ${req.title}
Description: ${req.description?.slice(0, 500) || 'none'}
Domain: ${req.domain}
Content type: ${req.content_type}
Tags: ${req.practical_tags?.join(', ') || 'none'}
Entities: ${req.entities?.map(e => `${e.name} (${e.type})`).join(', ') || 'none'}
OG type: ${req.og_type || 'none'}
Price: ${req.og_price_amount ? `${req.og_price_amount} ${req.og_price_currency || ''}` : 'none'}
Structured data types: ${req.structured_data_types?.join(', ') || 'none'}
Source: ${req.source || 'direct'}

Classify the intent. Be confident or return "none" — a wrong classification is worse than no classification.`

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), LLM_TIMEOUT_MS)

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: CLASSIFY_MODEL,
        max_tokens: 256,
        tools: [
          {
            name: 'classify_intent',
            description: 'Classify the intent behind a pinned URL',
            input_schema: {
              type: 'object',
              properties: {
                intent_type: {
                  type: 'string',
                  enum: ['commerce', 'ai_tool', 'recipe', 'design_inspiration', 'article', 'person', 'event', 'none'],
                  description: 'The detected intent type, or "none" if uncertain',
                },
                confidence: {
                  type: 'number',
                  description: 'Confidence score 0.0-1.0. Must be above 0.75 to surface actions.',
                },
                extracted_metadata: {
                  type: 'object',
                  description: 'Intent-specific metadata extracted from the URL context',
                  properties: {
                    product_name: { type: 'string' },
                    price: { type: 'string' },
                    currency: { type: 'string' },
                    retailer: { type: 'string' },
                    tool_name: { type: 'string' },
                    tagline: { type: 'string' },
                    pricing_model: { type: 'string' },
                    docs_url: { type: 'string' },
                    github_url: { type: 'string' },
                    category: { type: 'string' },
                  },
                },
                reasoning: {
                  type: 'string',
                  description: 'Brief explanation of why this intent was chosen',
                },
              },
              required: ['intent_type', 'confidence', 'extracted_metadata', 'reasoning'],
            },
          },
        ],
        tool_choice: { type: 'tool', name: 'classify_intent' },
        messages: [{ role: 'user', content: prompt }],
      }),
      signal: controller.signal,
    })

    clearTimeout(timeout)

    if (!response.ok) {
      const errText = await response.text()
      console.error('[classify-intent] Claude API error:', response.status, errText)
      return null
    }

    const aiResponse = await response.json()
    const toolUse = aiResponse.content?.find(
      (block: { type: string }) => block.type === 'tool_use'
    )

    if (!toolUse?.input) {
      console.error('[classify-intent] No tool_use in response')
      return null
    }

    return toolUse.input as IntentResult
  } catch (err) {
    clearTimeout(timeout)
    if (err instanceof DOMException && err.name === 'AbortError') {
      console.warn('[classify-intent] LLM classification timed out')
    } else {
      console.error('[classify-intent] LLM error:', err)
    }
    return null
  }
}

// --- Pass 1: Classify ---

async function handleClassify(req: ClassifyRequest): Promise<Response> {
  const startTime = Date.now()

  // Tier 1: Rules
  const rulesResult = classifyByRules(req)

  let result: IntentResult
  if (rulesResult && rulesResult.confidence >= INTENT_CONFIDENCE_THRESHOLD) {
    result = rulesResult
    console.log(`[classify-intent] Tier 1 hit: ${result.intent_type} @ ${result.confidence} (${Date.now() - startTime}ms)`)
  } else {
    // Tier 2: LLM (only if rules didn't confidently match)
    console.log(`[classify-intent] Tier 1 ${rulesResult ? `low confidence (${rulesResult.confidence})` : 'no match'}, falling back to LLM`)
    const llmResult = await classifyByLLM(req)

    if (llmResult && llmResult.confidence >= INTENT_CONFIDENCE_THRESHOLD) {
      result = llmResult
      console.log(`[classify-intent] Tier 2 hit: ${result.intent_type} @ ${result.confidence} (${Date.now() - startTime}ms)`)
    } else {
      // Below threshold — return none
      result = {
        intent_type: 'none',
        confidence: llmResult?.confidence || rulesResult?.confidence || 0,
        extracted_metadata: {},
        reasoning: llmResult?.reasoning || rulesResult?.reasoning || 'No confident match',
      }
      console.log(`[classify-intent] Below threshold: ${llmResult?.intent_type || rulesResult?.intent_type || 'none'} @ ${result.confidence} (${Date.now() - startTime}ms)`)
    }
  }

  // Write to DB if we have a positive classification
  if (result.intent_type !== 'none' && req.userId && req.linkId) {
    try {
      const supabase = createClient(
        Deno.env.get('SUPABASE_URL')!,
        Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
      )

      await supabase
        .from('links')
        .update({
          intent_type: result.intent_type,
          intent_confidence: result.confidence,
          intent_metadata: result.extracted_metadata,
          intent_classified_at: new Date().toISOString(),
        })
        .eq('id', req.linkId)
        .eq('user_id', req.userId)

      console.log(`[classify-intent] Saved ${result.intent_type} to link ${req.linkId}`)
    } catch (err) {
      console.error('[classify-intent] DB write error:', err)
      // Non-fatal — return result anyway
    }
  }

  return new Response(
    JSON.stringify({
      ...result,
      meta: { elapsed: Date.now() - startTime, version: VERSION, tier: rulesResult && rulesResult.confidence >= INTENT_CONFIDENCE_THRESHOLD ? 1 : 2 },
    }),
    { headers: jsonHeaders }
  )
}

// --- Pass 2: Hypothesize ---

async function handleHypothesize(req: HypothesizeRequest): Promise<Response> {
  const startTime = Date.now()
  const apiKey = Deno.env.get('ANTHROPIC_API_KEY')

  if (!apiKey) {
    return new Response(
      JSON.stringify({ error: 'ANTHROPIC_API_KEY not configured' }),
      { status: 500, headers: jsonHeaders }
    )
  }

  if (req.recent_pins.length < 10) {
    return new Response(
      JSON.stringify({ skipped: true, reason: 'Insufficient pin history (need 10+)' }),
      { headers: jsonHeaders }
    )
  }

  const pinList = req.recent_pins
    .slice(0, 50)
    .map((p, i) => `${i + 1}. ${p.title} (${p.domain}) — type: ${p.content_type}, intent: ${p.intent_type || 'none'}, action: ${p.action_state || 'none'}`)
    .join('\n')

  const actionsSummary = req.recent_pins
    .filter(p => p.action_state && p.action_state !== 'unprocessed')
    .map(p => `- ${p.title}: ${p.action_state}`)
    .join('\n') || 'No actions taken yet'

  const prompt = `You are analyzing a user's browsing and saving patterns to surface non-obvious connections and opportunities.

Current pin: ${req.current_pin.url} — ${req.current_pin.title}
Content type: ${req.current_pin.content_type}
Tags: ${req.current_pin.practical_tags?.join(', ') || 'none'}

Recent activity (last ${req.recent_pins.length} pins, newest first):
${pinList}

Actions already taken:
${actionsSummary}

Generate 1-3 hypotheses about what the user might be trying to accomplish, discover, or build — going beyond what's explicit. These are pattern-level observations, not predictions for this single pin.`

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: HYPOTHESIZE_MODEL,
        max_tokens: 512,
        tools: [
          {
            name: 'hypothesize_intent',
            description: 'Generate hypotheses about user intent patterns',
            input_schema: {
              type: 'object',
              properties: {
                hypotheses: {
                  type: 'array',
                  items: {
                    type: 'object',
                    properties: {
                      label: { type: 'string', description: 'Short hypothesis label' },
                      confidence: { type: 'number', description: '0.0-1.0' },
                      supporting_pin_ids: { type: 'array', items: { type: 'string' } },
                      suggested_action: { type: 'string', description: 'What action might help' },
                      reasoning: { type: 'string', description: 'Why this hypothesis' },
                    },
                    required: ['label', 'confidence', 'suggested_action', 'reasoning'],
                  },
                },
              },
              required: ['hypotheses'],
            },
          },
        ],
        tool_choice: { type: 'tool', name: 'hypothesize_intent' },
        messages: [{ role: 'user', content: prompt }],
      }),
    })

    if (!response.ok) {
      const errText = await response.text()
      console.error('[classify-intent:hypothesize] Claude API error:', response.status, errText)
      await logHypothesisGap(req.userId, req.linkId, req.recent_pins.length, 'api_error', req.current_pin.practical_tags)
      return new Response(
        JSON.stringify({ error: 'Hypothesis generation failed' }),
        { status: 200, headers: jsonHeaders } // 200 so client doesn't retry
      )
    }

    const aiResponse = await response.json()
    const toolUse = aiResponse.content?.find(
      (block: { type: string }) => block.type === 'tool_use'
    )

    if (!toolUse?.input?.hypotheses) {
      await logHypothesisGap(req.userId, req.linkId, req.recent_pins.length, 'no_output', req.current_pin.practical_tags)
      return new Response(
        JSON.stringify({ hypotheses: [], reason: 'No hypotheses generated' }),
        { headers: jsonHeaders }
      )
    }

    const hypotheses = toolUse.input.hypotheses
    const topConfidence = Math.max(...hypotheses.map((h: { confidence: number }) => h.confidence), 0)

    // Log gap if all hypotheses are low confidence
    if (topConfidence < 0.5) {
      await logHypothesisGap(req.userId, req.linkId, req.recent_pins.length, 'low_confidence', req.current_pin.practical_tags)
    }

    // Save to intent_hypotheses
    try {
      const supabase = createClient(
        Deno.env.get('SUPABASE_URL')!,
        Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
      )

      await supabase
        .from('intent_hypotheses')
        .insert({
          user_id: req.userId,
          trigger_pin_id: req.linkId,
          hypotheses: hypotheses,
          confidence: topConfidence,
          model_version: HYPOTHESIZE_MODEL,
          expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(), // 7 days
        })

      console.log(`[classify-intent:hypothesize] Saved ${hypotheses.length} hypotheses for user ${req.userId.slice(0, 8)}`)
    } catch (err) {
      console.error('[classify-intent:hypothesize] DB write error:', err)
    }

    return new Response(
      JSON.stringify({
        hypotheses,
        meta: { elapsed: Date.now() - startTime, version: VERSION, model: HYPOTHESIZE_MODEL },
      }),
      { headers: jsonHeaders }
    )
  } catch (err) {
    console.error('[classify-intent:hypothesize] Error:', err)
    await logHypothesisGap(req.userId, req.linkId, req.recent_pins.length, 'api_error', req.current_pin.practical_tags)
    return new Response(
      JSON.stringify({ error: 'Hypothesis generation failed' }),
      { status: 200, headers: jsonHeaders }
    )
  }
}

async function logHypothesisGap(
  userId: string,
  triggerPinId: string,
  pinCount: number,
  reason: string,
  topTags: string[]
): Promise<void> {
  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    )

    await supabase
      .from('intent_hypothesis_gaps')
      .insert({
        user_id: userId,
        trigger_pin_id: triggerPinId,
        pin_count_at_call: pinCount,
        reason,
        top_tags: topTags?.slice(0, 10) || [],
      })
  } catch (err) {
    console.error('[classify-intent] Gap log failed:', err)
  }
}

// --- Main handler ---

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const body = await req.json()
    const { action } = body

    if (action === 'health') {
      return new Response(
        JSON.stringify({ status: 'ok', version: VERSION }),
        { headers: jsonHeaders }
      )
    }

    if (action === 'classify') {
      return await handleClassify(body as ClassifyRequest)
    }

    if (action === 'hypothesize') {
      return await handleHypothesize(body as HypothesizeRequest)
    }

    return new Response(
      JSON.stringify({ error: `Unknown action: ${action}` }),
      { status: 400, headers: jsonHeaders }
    )
  } catch (err) {
    console.error('[classify-intent] Error:', err)
    return new Response(
      JSON.stringify({ error: 'Internal error', detail: String(err) }),
      { status: 500, headers: jsonHeaders }
    )
  }
})
