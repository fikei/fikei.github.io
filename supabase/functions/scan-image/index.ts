// Supabase Edge Function: scan-image
// Analyzes uploaded images using Claude Vision to extract products, URLs, and content
//
// POST /functions/v1/scan-image
// Body: { image: base64string, mimeType: "image/jpeg"|"image/png" }
// Returns: { items: [{ title, description, url?, category?, confidence }] }

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'

const VERSION = '1.0.1'
console.log(`[scan-image] v${VERSION} - migrate to claude-sonnet-4-6 (Sonnet 4 retired)`)

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const { image, mimeType } = await req.json()

    if (!image) {
      return new Response(
        JSON.stringify({ error: 'Image data is required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    const validTypes = ['image/jpeg', 'image/png', 'image/webp', 'image/gif']
    const imageMediaType = mimeType && validTypes.includes(mimeType) ? mimeType : 'image/jpeg'

    console.log('[scan-image] Analyzing image, type:', imageMediaType)

    const anthropicKey = Deno.env.get('ANTHROPIC_API_KEY')
    if (!anthropicKey) {
      return new Response(
        JSON.stringify({ error: 'AI service not configured' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Call Claude Vision API
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': anthropicKey,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 1024,
        messages: [{
          role: 'user',
          content: [
            {
              type: 'image',
              source: {
                type: 'base64',
                media_type: imageMediaType,
                data: image
              }
            },
            {
              type: 'text',
              text: `Analyze this image and identify any products, brands, content, or items visible. For each item found, provide:
- title: A short descriptive name
- description: Brief description (1 sentence)
- url: If you can identify the exact product or content, suggest a likely URL (brand website, store page). If unsure, omit this field.
- category: One of: home, wear, watch, listen, use, eat, go, follow, read
- confidence: 0.0-1.0 how confident you are in the identification

If this is a screenshot of a website or app, extract the main URL visible and any product/content information.
If this is a photo of physical products, identify brands and items.
If this is artwork or creative content, describe what it is.

Return ONLY valid JSON in this format:
{"items": [{"title": "...", "description": "...", "url": "...", "category": "...", "confidence": 0.9}]}

If nothing identifiable is found, return: {"items": []}`
            }
          ]
        }]
      })
    })

    if (!response.ok) {
      const error = await response.text()
      console.error('[scan-image] Claude API error:', error)
      return new Response(
        JSON.stringify({ error: 'Image analysis failed' }),
        { status: 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    const aiResult = await response.json()
    const aiText = aiResult.content?.[0]?.text || '{}'

    console.log('[scan-image] Raw AI response:', aiText.substring(0, 200))

    // Parse the JSON from Claude's response
    let parsed
    try {
      // Handle case where Claude wraps in markdown code block
      const jsonMatch = aiText.match(/\{[\s\S]*\}/)
      parsed = JSON.parse(jsonMatch ? jsonMatch[0] : aiText)
    } catch (e) {
      console.error('[scan-image] JSON parse error:', e)
      parsed = { items: [] }
    }

    // Validate and sanitize items
    const items = (parsed.items || []).map((item: any) => ({
      title: String(item.title || '').substring(0, 200),
      description: String(item.description || '').substring(0, 500),
      url: item.url ? String(item.url).substring(0, 2000) : null,
      category: ['home', 'wear', 'watch', 'listen', 'use', 'eat', 'go', 'follow', 'read'].includes(item.category)
        ? item.category
        : 'uncategorized',
      confidence: Math.min(1, Math.max(0, Number(item.confidence) || 0.5))
    }))

    console.log('[scan-image] Found', items.length, 'items')

    return new Response(
      JSON.stringify({ items }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )

  } catch (err) {
    console.error('[scan-image] Error:', err)
    return new Response(
      JSON.stringify({ error: 'Internal error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})
