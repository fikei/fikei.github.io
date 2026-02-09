// Supabase Edge Function: validate-image
// Tier 3 AI Vision validation — scores images across accuracy, aesthetics,
// distinctiveness, and safety using a multimodal AI model.
//
// POST /functions/v1/validate-image
// Body: { image_url, title?, category?, content_type?, link_id? }
// Returns: { scores, safety_tier, cached, tokens_used }
//
// Runs async — caller displays image immediately from Tier 2 pass,
// then calls this to get full AI scores. Can downgrade if needed.

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

// Known-good sources skip AI evaluation entirely
const KNOWN_GOOD_SOURCES = [
  /img\.youtube\.com\/vi\//,
  /i\.vimeocdn\.com\//,
  /opengraph\.githubassets\.com\//,
  /i\.scdn\.co\//,
  /mosaic\.scdn\.co\//,
  /image\.tmdb\.org\//,
  /m\.media-amazon\.com\//,
  /images-na\.ssl-images-amazon\.com\//
]

// Default high scores for known-good sources
const KNOWN_GOOD_SCORES = {
  accuracy: 0.9,
  visual_quality: 0.9,
  aesthetic_fit: 0.8,
  distinctiveness: 1.0,
  safety: 1.0,
  safety_tier: 'safe' as const
}

// Budget tracking key in Supabase
const DAILY_BUDGET_KEY = 'validate_image_daily_budget'
const DAILY_BUDGET_LIMIT_CENTS = 50 // $0.50/day default

// Composite score weights
const WEIGHTS = {
  accuracy: 0.35,
  visual_quality: 0.25,
  aesthetic_fit: 0.20,
  distinctiveness: 0.15,
  safety: 0.05
}

function computeComposite(scores: Record<string, number>): number {
  if (scores.safety === 0) return 0
  return (
    (scores.accuracy || 0) * WEIGHTS.accuracy +
    (scores.visual_quality || 0) * WEIGHTS.visual_quality +
    (scores.aesthetic_fit || 0) * WEIGHTS.aesthetic_fit +
    (scores.distinctiveness || 0) * WEIGHTS.distinctiveness +
    (scores.safety || 1) * WEIGHTS.safety
  )
}

function getTierLabel(composite: number): string {
  if (composite >= 0.85) return 'excellent'
  if (composite >= 0.65) return 'good'
  if (composite >= 0.40) return 'marginal'
  if (composite >= 0.15) return 'poor'
  return 'rejected'
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const { image_url, title, category, content_type, link_id } = await req.json()

    if (!image_url) {
      return new Response(
        JSON.stringify({ error: 'image_url is required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    console.log('[validate-image] Processing:', image_url, '| title:', title)

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    const supabase = createClient(supabaseUrl, supabaseServiceKey)

    // ========================================
    // STEP 1: Known-good source bypass
    // ========================================
    if (KNOWN_GOOD_SOURCES.some(p => p.test(image_url))) {
      console.log('[validate-image] Known-good source, skipping AI evaluation')
      const composite = computeComposite(KNOWN_GOOD_SCORES)
      const result = {
        ...KNOWN_GOOD_SCORES,
        composite: Math.round(composite * 100) / 100,
        tier: getTierLabel(composite),
        evaluated_at: new Date().toISOString(),
        evaluation_method: 'tier3_known_good'
      }

      if (link_id) {
        await updateLinkScores(supabase, link_id, result)
      }

      return new Response(
        JSON.stringify({ scores: result, safety_tier: 'safe', cached: false, tokens_used: 0 }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // ========================================
    // STEP 2: Check validation cache
    // ========================================
    const urlHash = await hashUrl(image_url)
    const { data: cached } = await supabase
      .from('image_validation_cache')
      .select('*')
      .eq('image_url_hash', urlHash)
      .single()

    if (cached && !isExpired(cached)) {
      console.log('[validate-image] Cache hit:', urlHash)

      if (link_id) {
        await updateLinkScores(supabase, link_id, cached.scores)
      }

      return new Response(
        JSON.stringify({ scores: cached.scores, safety_tier: cached.scores.safety_tier, cached: true, tokens_used: 0 }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // ========================================
    // STEP 3: Budget check
    // ========================================
    const budgetOk = await checkBudget(supabase)
    if (!budgetOk) {
      console.log('[validate-image] Daily budget exhausted, returning Tier 2 only')
      return new Response(
        JSON.stringify({ error: 'daily_budget_exhausted', scores: null, cached: false, tokens_used: 0 }),
        { status: 429, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // ========================================
    // STEP 4: AI Vision evaluation
    // ========================================
    const aiResult = await evaluateWithVision(image_url, title, category, content_type)

    if (!aiResult) {
      console.log('[validate-image] AI evaluation failed, no scores returned')
      return new Response(
        JSON.stringify({ error: 'vision_evaluation_failed', scores: null, cached: false, tokens_used: 0 }),
        { status: 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Compute composite score
    const composite = computeComposite(aiResult.scores)
    const fullScores = {
      ...aiResult.scores,
      composite: Math.round(composite * 100) / 100,
      tier: getTierLabel(composite),
      safety_tier: aiResult.safety_tier,
      evaluated_at: new Date().toISOString(),
      evaluation_method: 'tier3_ai_vision',
      evaluation_model: aiResult.model
    }

    console.log('[validate-image] Scores:', fullScores)

    // ========================================
    // STEP 5: Cache result
    // ========================================
    const domain = extractDomain(image_url)
    await supabase
      .from('image_validation_cache')
      .upsert({
        image_url_hash: urlHash,
        image_url: image_url,
        scores: fullScores,
        evaluated_at: new Date().toISOString(),
        ttl_days: 30,
        source_domain: domain,
        content_type: content_type || null
      })

    // ========================================
    // STEP 6: Update link scores (if link_id provided)
    // ========================================
    if (link_id) {
      await updateLinkScores(supabase, link_id, fullScores)
    }

    // ========================================
    // STEP 7: Track cost
    // ========================================
    await trackCost(supabase, aiResult.tokens_used)

    return new Response(
      JSON.stringify({
        scores: fullScores,
        safety_tier: aiResult.safety_tier,
        cached: false,
        tokens_used: aiResult.tokens_used
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )

  } catch (error) {
    console.error('[validate-image] Error:', error)
    return new Response(
      JSON.stringify({ error: (error as Error).message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})

// ========================================
// AI Vision Evaluation
// ========================================
interface VisionResult {
  scores: {
    accuracy: number
    visual_quality: number
    aesthetic_fit: number
    distinctiveness: number
    safety: number
  }
  safety_tier: 'safe' | 'mature' | 'blocked'
  model: string
  tokens_used: number
}

async function evaluateWithVision(
  imageUrl: string,
  title: string,
  category: string,
  contentType: string
): Promise<VisionResult | null> {
  // Try Claude first, fall back to OpenAI
  const anthropicKey = Deno.env.get('ANTHROPIC_API_KEY')
  if (anthropicKey) {
    const result = await evaluateWithClaude(anthropicKey, imageUrl, title, category, contentType)
    if (result) return result
  }

  const openaiKey = Deno.env.get('OPENAI_API_KEY')
  if (openaiKey) {
    const result = await evaluateWithOpenAI(openaiKey, imageUrl, title, category, contentType)
    if (result) return result
  }

  console.error('[validate-image] No vision API keys configured')
  return null
}

async function evaluateWithClaude(
  apiKey: string,
  imageUrl: string,
  title: string,
  category: string,
  contentType: string
): Promise<VisionResult | null> {
  const prompt = buildPrompt(title, category, contentType)

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-5-20250929',
        max_tokens: 300,
        messages: [{
          role: 'user',
          content: [
            {
              type: 'image',
              source: { type: 'url', url: imageUrl }
            },
            {
              type: 'text',
              text: prompt
            }
          ]
        }]
      })
    })

    if (!response.ok) {
      console.error('[validate-image] Claude API error:', response.status, await response.text())
      return null
    }

    const data = await response.json()
    const text = data.content?.[0]?.text || ''
    const tokensUsed = (data.usage?.input_tokens || 0) + (data.usage?.output_tokens || 0)

    return parseVisionResponse(text, 'claude-sonnet-4-5-20250929', tokensUsed)
  } catch (e) {
    console.error('[validate-image] Claude evaluation error:', e)
    return null
  }
}

async function evaluateWithOpenAI(
  apiKey: string,
  imageUrl: string,
  title: string,
  category: string,
  contentType: string
): Promise<VisionResult | null> {
  const prompt = buildPrompt(title, category, contentType)

  try {
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        max_tokens: 300,
        messages: [{
          role: 'user',
          content: [
            {
              type: 'image_url',
              image_url: { url: imageUrl, detail: 'low' }
            },
            {
              type: 'text',
              text: prompt
            }
          ]
        }]
      })
    })

    if (!response.ok) {
      console.error('[validate-image] OpenAI API error:', response.status, await response.text())
      return null
    }

    const data = await response.json()
    const text = data.choices?.[0]?.message?.content || ''
    const tokensUsed = (data.usage?.prompt_tokens || 0) + (data.usage?.completion_tokens || 0)

    return parseVisionResponse(text, 'gpt-4o-mini', tokensUsed)
  } catch (e) {
    console.error('[validate-image] OpenAI evaluation error:', e)
    return null
  }
}

function buildPrompt(title: string, category: string, contentType: string): string {
  return `Evaluate this image for a pin titled "${title || 'Unknown'}" (category: ${category || 'unknown'}, type: ${contentType || 'unknown'}).

Score each dimension from 0.0 to 1.0:

1. accuracy: Does this image depict "${title || 'the content'}"? 1.0 = clearly shows the specific item/content. 0.0 = completely unrelated.

2. aesthetic_fit: Is the image visually clean, high-contrast, and minimal? 1.0 = editorial quality, no text overlays or watermarks. 0.0 = heavy watermarks, all-text image, extreme visual clutter.

3. distinctiveness: Is this a real, content-specific image (not a logo, favicon, stock placeholder, or generic site asset)? 1.0 = unique content image. 0.0 = logo/placeholder.

4. safety: Content safety classification. Use one of:
   - "safe": General content, no concerns
   - "mature": Contains nudity, graphic language, drug references, or mature themes (ALLOWED — do not block)
   - "blocked": Pornographic content (explicit sexual acts), child exploitation, or extreme gore (BLOCKED)
   IMPORTANT: Artistic nudity, fashion photography, swimwear, and lingerie are "mature" NOT "blocked". Only classify as "blocked" for exploitative, illegal, or explicitly pornographic content.

Respond with ONLY this JSON, no other text:
{"accuracy": 0.0, "aesthetic_fit": 0.0, "distinctiveness": 0.0, "safety": "safe"}`
}

function parseVisionResponse(text: string, model: string, tokensUsed: number): VisionResult | null {
  try {
    const match = text.match(/\{[\s\S]*\}/)
    if (!match) {
      console.error('[validate-image] No JSON found in response:', text)
      return null
    }

    const parsed = JSON.parse(match[0])

    // Validate safety tier
    const safetyTier = ['safe', 'mature', 'blocked'].includes(parsed.safety)
      ? parsed.safety as 'safe' | 'mature' | 'blocked'
      : 'safe'

    // Convert safety tier to numeric score (0 = blocked, 1 = safe/mature)
    const safetyScore = safetyTier === 'blocked' ? 0 : 1

    // Clamp all scores to 0-1
    const clamp = (v: number) => Math.max(0, Math.min(1, Number(v) || 0))

    return {
      scores: {
        accuracy: clamp(parsed.accuracy),
        visual_quality: 0.9, // Tier 2 already validated technical quality; assume good
        aesthetic_fit: clamp(parsed.aesthetic_fit),
        distinctiveness: clamp(parsed.distinctiveness),
        safety: safetyScore
      },
      safety_tier: safetyTier,
      model,
      tokens_used: tokensUsed
    }
  } catch (e) {
    console.error('[validate-image] Parse error:', e, 'text:', text)
    return null
  }
}

// ========================================
// Helpers
// ========================================

async function hashUrl(url: string): Promise<string> {
  const encoder = new TextEncoder()
  const data = encoder.encode(url.toLowerCase().trim())
  const hashBuffer = await crypto.subtle.digest('SHA-256', data)
  const hashArray = Array.from(new Uint8Array(hashBuffer))
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('')
}

function isExpired(cacheEntry: { evaluated_at: string, ttl_days: number }): boolean {
  const evaluatedAt = new Date(cacheEntry.evaluated_at)
  const expiresAt = new Date(evaluatedAt.getTime() + cacheEntry.ttl_days * 24 * 60 * 60 * 1000)
  return new Date() > expiresAt
}

function extractDomain(url: string): string {
  try {
    return new URL(url).hostname.replace('www.', '')
  } catch {
    return 'unknown'
  }
}

async function updateLinkScores(supabase: any, linkId: string, scores: Record<string, any>) {
  try {
    await supabase
      .from('links')
      .update({ image_scores: scores })
      .eq('id', linkId)
    console.log('[validate-image] Updated link scores:', linkId)
  } catch (e) {
    console.error('[validate-image] Failed to update link:', e)
  }
}

// ========================================
// Budget Management
// ========================================

async function checkBudget(supabase: any): Promise<boolean> {
  const today = new Date().toISOString().split('T')[0]
  const key = `${DAILY_BUDGET_KEY}_${today}`

  try {
    const { data } = await supabase
      .from('image_validation_cache')
      .select('scores')
      .gte('evaluated_at', `${today}T00:00:00Z`)
      .not('scores->tokens_used', 'is', null)

    // Rough cost estimate: ~$0.001 per evaluation (vision input)
    const todayCount = data?.length || 0
    const estimatedCostCents = todayCount * 0.1 // ~$0.001 per call = 0.1 cents

    if (estimatedCostCents >= DAILY_BUDGET_LIMIT_CENTS) {
      console.log('[validate-image] Budget check: exhausted.', todayCount, 'evaluations today, ~$' + (estimatedCostCents / 100).toFixed(2))
      return false
    }

    console.log('[validate-image] Budget check: OK.', todayCount, 'evaluations today, ~$' + (estimatedCostCents / 100).toFixed(2))
    return true
  } catch (e) {
    // If budget check fails, allow the evaluation (fail open)
    console.error('[validate-image] Budget check error (allowing):', e)
    return true
  }
}

async function trackCost(supabase: any, tokensUsed: number) {
  // Cost tracking is handled by caching — each cache entry represents one API call.
  // The checkBudget function counts entries for today.
  console.log('[validate-image] Tokens used:', tokensUsed,
    '| Estimated cost: ~$' + (tokensUsed * 0.000003).toFixed(6))
}
