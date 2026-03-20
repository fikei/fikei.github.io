// Supabase Edge Function: suggest-actions
// Generates 3-5 contextual next-best-actions for a pin based on AI analysis data.
// Called after intent classification completes in the enrichment pipeline.
//
// POST /functions/v1/suggest-actions
// Body: { url, title, description, domain, category, content_type, intent_type,
//         intent_metadata, practical_tags, taste_tags, entities, content_structure,
//         video, music, book, recipe, userId, linkId }

const VERSION = '1.0.0'
console.log(`[suggest-actions] v${VERSION} — next-best-action generation`)

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}
const jsonHeaders = { ...corsHeaders, 'Content-Type': 'application/json' }

const MODEL = 'claude-haiku-4-5-20251001'
const LLM_TIMEOUT_MS = 8000

interface SuggestRequest {
  url: string
  title: string
  description?: string
  domain: string
  category: string
  content_type?: string
  intent_type?: string
  intent_metadata?: Record<string, unknown>
  practical_tags?: string[]
  taste_tags?: string[]
  entities?: Array<{ name: string; type: string; confidence?: number }>
  content_structure?: string
  video?: Record<string, unknown>
  music?: Record<string, unknown>
  book?: Record<string, unknown>
  recipe?: Record<string, unknown>
  userId: string
  linkId: string
}

interface SuggestedAction {
  label: string
  icon: string
  reason: string
  action_type: string
  action_data?: Record<string, unknown>
}

// --- Main handler ---

async function handleSuggest(req: SuggestRequest): Promise<Response> {
  const startTime = Date.now()
  const apiKey = Deno.env.get('ANTHROPIC_API_KEY')

  if (!apiKey) {
    return new Response(
      JSON.stringify({ error: 'ANTHROPIC_API_KEY not configured' }),
      { status: 500, headers: jsonHeaders }
    )
  }

  // Build context from all available pin analysis
  const contextParts: string[] = []
  contextParts.push(`URL: ${req.url}`)
  contextParts.push(`Title: ${req.title}`)
  if (req.description) contextParts.push(`Description: ${req.description.slice(0, 300)}`)
  contextParts.push(`Domain: ${req.domain}`)
  contextParts.push(`Category: ${req.category}`)
  if (req.content_type) contextParts.push(`Content type: ${req.content_type}`)
  if (req.intent_type) contextParts.push(`Intent: ${req.intent_type}`)
  if (req.intent_metadata) {
    const meta = req.intent_metadata
    if (meta.price) contextParts.push(`Price: ${meta.currency || '$'}${meta.price}`)
    if (meta.product_name) contextParts.push(`Product: ${meta.product_name}`)
    if (meta.tool_name) contextParts.push(`Tool: ${meta.tool_name}`)
    if (meta.docs_url) contextParts.push(`Docs: ${meta.docs_url}`)
    if (meta.pricing_model) contextParts.push(`Pricing: ${meta.pricing_model}`)
  }
  if (req.practical_tags?.length) contextParts.push(`Tags: ${req.practical_tags.join(', ')}`)
  if (req.taste_tags?.length) contextParts.push(`Aesthetic: ${req.taste_tags.join(', ')}`)
  if (req.entities?.length) contextParts.push(`Entities: ${req.entities.map(e => `${e.name} (${e.type})`).join(', ')}`)
  if (req.content_structure) contextParts.push(`Structure: ${req.content_structure}`)
  if (req.video) {
    const v = req.video
    contextParts.push(`Video: ${v.type || 'video'} by ${v.creator || 'unknown'}${v.runtime ? `, ${v.runtime}` : ''}${v.genres ? `, genres: ${(v.genres as string[]).join(', ')}` : ''}`)
  }
  if (req.music) {
    const m = req.music
    contextParts.push(`Music: ${m.trackTitle || ''} by ${m.artist || 'unknown'}${m.genre ? `, ${m.genre}` : ''}${m.bpm ? `, ${m.bpm} BPM` : ''}`)
  }
  if (req.book) {
    const b = req.book
    contextParts.push(`Book: by ${b.author || 'unknown'}${b.genre ? `, ${b.genre}` : ''}${b.format ? `, ${b.format}` : ''}`)
  }
  if (req.recipe) {
    const r = req.recipe
    contextParts.push(`Recipe: ${r.cuisine || ''} cuisine${r.difficulty ? `, ${r.difficulty}` : ''}${r.total_time ? `, ${r.total_time}` : ''}`)
  }

  const prompt = `You are analyzing a pinned URL that a user saved to their personal curation platform. Based on the analysis data below, suggest 3-5 concrete next actions the user could take with this pin.

${contextParts.join('\n')}

Think about what a person who saved this would realistically want to do next. Actions should be specific to THIS pin's content, not generic. Consider:
- Purchase/acquire actions (buy, pre-order, add to cart, find best price, check stock)
- Integration/technical actions (integrate this tool, install, fork repo, try the API, set up locally)
- Creative actions (generate 3D print file, remix, create playlist, design mood board)
- Research actions (find alternatives, compare prices, read reviews, check compatibility)
- Social actions (share with someone, recommend, save to wishlist, gift idea)
- Content actions (watch later, add to reading list, bookmark recipe, save playlist)
- Physical actions (visit location, book tickets, make reservation, find nearby)

Be bold and specific. "Buy this" is better than "Consider purchasing". "Fork and customize" is better than "Explore the code".`

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
        model: MODEL,
        max_tokens: 512,
        tools: [
          {
            name: 'suggest_actions',
            description: 'Suggest 3-5 next-best-actions for this pinned item',
            input_schema: {
              type: 'object',
              properties: {
                actions: {
                  type: 'array',
                  minItems: 3,
                  maxItems: 5,
                  items: {
                    type: 'object',
                    properties: {
                      label: {
                        type: 'string',
                        description: 'Short action label, 2-5 words. Imperative verb. e.g. "Buy on Amazon", "Fork & customize", "Generate 3D file"',
                      },
                      icon: {
                        type: 'string',
                        description: 'Single emoji icon for the action',
                      },
                      reason: {
                        type: 'string',
                        description: 'One sentence explaining why this action is relevant for this specific pin',
                      },
                      action_type: {
                        type: 'string',
                        enum: ['purchase', 'integrate', 'create', 'research', 'social', 'content', 'physical', 'external_link'],
                        description: 'Category of action',
                      },
                      action_data: {
                        type: 'object',
                        description: 'Optional structured data: { url: string } for external links, { query: string } for searches',
                        properties: {
                          url: { type: 'string' },
                          query: { type: 'string' },
                        },
                      },
                    },
                    required: ['label', 'icon', 'reason', 'action_type'],
                  },
                },
              },
              required: ['actions'],
            },
          },
        ],
        tool_choice: { type: 'tool', name: 'suggest_actions' },
        messages: [{ role: 'user', content: prompt }],
      }),
      signal: controller.signal,
    })

    clearTimeout(timeout)

    if (!response.ok) {
      const errText = await response.text()
      console.error('[suggest-actions] Claude API error:', response.status, errText)
      return new Response(
        JSON.stringify({ error: 'Action suggestion failed', detail: errText }),
        { status: 200, headers: jsonHeaders }
      )
    }

    const aiResponse = await response.json()
    const toolUse = aiResponse.content?.find(
      (block: { type: string }) => block.type === 'tool_use'
    )

    if (!toolUse?.input?.actions?.length) {
      console.warn('[suggest-actions] No actions in response')
      return new Response(
        JSON.stringify({ actions: [], reason: 'No actions generated' }),
        { headers: jsonHeaders }
      )
    }

    const actions: SuggestedAction[] = toolUse.input.actions

    // Save to DB
    if (req.userId && req.linkId) {
      try {
        const supabase = createClient(
          Deno.env.get('SUPABASE_URL')!,
          Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
        )

        await supabase
          .from('links')
          .update({
            suggested_actions: actions,
          })
          .eq('id', req.linkId)
          .eq('user_id', req.userId)

        console.log(`[suggest-actions] Saved ${actions.length} actions for link ${req.linkId}`)
      } catch (err) {
        console.error('[suggest-actions] DB write error:', err)
      }
    }

    console.log(`[suggest-actions] Generated ${actions.length} actions in ${Date.now() - startTime}ms`)

    return new Response(
      JSON.stringify({
        actions,
        meta: { elapsed: Date.now() - startTime, version: VERSION, model: MODEL },
      }),
      { headers: jsonHeaders }
    )
  } catch (err) {
    clearTimeout(timeout)
    if (err instanceof DOMException && err.name === 'AbortError') {
      console.warn('[suggest-actions] LLM timed out')
    } else {
      console.error('[suggest-actions] Error:', err)
    }
    return new Response(
      JSON.stringify({ error: 'Action suggestion failed', detail: String(err) }),
      { status: 200, headers: jsonHeaders }
    )
  }
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const body = await req.json()

    if (body.action === 'health') {
      return new Response(
        JSON.stringify({ status: 'ok', version: VERSION }),
        { headers: jsonHeaders }
      )
    }

    return await handleSuggest(body as SuggestRequest)
  } catch (err) {
    console.error('[suggest-actions] Error:', err)
    return new Response(
      JSON.stringify({ error: 'Internal error', detail: String(err) }),
      { status: 500, headers: jsonHeaders }
    )
  }
})
