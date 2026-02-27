import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'

const ANTHROPIC_API_KEY = Deno.env.get('ANTHROPIC_API_KEY')

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const BUILTIN_DESCRIPTIONS: Record<string, string> = {
  home: 'Furniture, home decor, interior design, lighting, rugs, ceramics',
  wear: 'Clothing, shoes, accessories, jewelry, fashion',
  watch: 'Videos, films, shows, documentaries, streaming video content',
  listen: 'Music, podcasts, audio content, songs, albums, playlists, DJ mixes, radio',
  use: 'Apps, software, tools, code, developer resources, products',
  eat: 'Restaurants, cafes, recipes, food, cooking, dining',
  go: 'Travel, hotels, destinations, maps, places to visit',
  follow: 'People, profiles, portfolios, social media accounts, creators',
  read: 'Articles, essays, blogs, news, books, tutorials, guides',
}

serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    if (!ANTHROPIC_API_KEY) {
      throw new Error('ANTHROPIC_API_KEY not configured')
    }

    const { url, title, description, domain, categories, userBoards } = await req.json()

    if (!url) {
      throw new Error('URL is required')
    }

    const categoryList = categories || ['home', 'wear', 'watch', 'listen', 'use', 'eat', 'go', 'follow', 'read']

    // Build category descriptions block
    const builtinBlock = categoryList
      .map((c: string) => `- ${c}: ${BUILTIN_DESCRIPTIONS[c] || c}`)
      .join('\n')

    // Build user boards block (cap at 15 to keep prompt reasonable)
    const boards: Array<{ slug: string; name: string; prompt?: string }> = Array.isArray(userBoards)
      ? userBoards.slice(0, 15)
      : []
    const userBoardSlugs = boards.map(b => b.slug)
    const allValidSlugs = [...categoryList, ...userBoardSlugs]

    const userBoardBlock = boards.length > 0
      ? '\n\nUser-created boards (prefer these when they clearly match):\n' +
        boards.map(b => `- ${b.slug}: ${b.name}${b.prompt ? ` — ${b.prompt}` : ''}`).join('\n')
      : ''

    const suggestBoardInstruction = '\n\nIf uncategorized, also suggest a short board name (2-3 words max) in a "suggestedBoard" field. If the link fits an existing category, set "suggestedBoard" to null.'

    const prompt = `You are a link categorizer. Given information about a webpage, categorize it into exactly ONE of these categories:

Categories:
${builtinBlock}${userBoardBlock}

IMPORTANT: Music platforms (Spotify, SoundCloud, Bandcamp, Apple Music, Tidal, etc.) should ALWAYS be "listen", never "watch".

If the link doesn't clearly fit any category, respond with "uncategorized".${suggestBoardInstruction}

Webpage information:
- URL: ${url}
- Domain: ${domain || 'unknown'}
- Title: ${title || 'No title'}
- Description: ${description || 'No description'}

Respond with ONLY a JSON object in this exact format, no other text:
{"category": "category_name", "confidence": 0.95, "reason": "brief reason", "suggestedBoard": null}`

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-3-haiku-20240307',
        max_tokens: 200,
        messages: [
          { role: 'user', content: prompt }
        ]
      })
    })

    if (!response.ok) {
      const error = await response.text()
      console.error('Anthropic API error:', error)
      throw new Error(`Anthropic API error: ${response.status}`)
    }

    const data = await response.json()
    const content = data.content[0]?.text || '{}'

    // Parse the JSON response
    let result
    try {
      result = JSON.parse(content)
    } catch {
      // If JSON parsing fails, try to extract category from text
      const match = content.match(/"category":\s*"([^"]+)"/)
      result = {
        category: match ? match[1] : 'uncategorized',
        confidence: 0.5,
        reason: 'Parsed from text',
        suggestedBoard: null
      }
    }

    // Validate category against all valid slugs (built-in + user boards)
    if (!allValidSlugs.includes(result.category) && result.category !== 'uncategorized') {
      result.category = 'uncategorized'
      result.confidence = 0.3
    }

    // Ensure suggestedBoard is only set when uncategorized
    if (result.category !== 'uncategorized') {
      result.suggestedBoard = null
    }

    return new Response(JSON.stringify(result), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })

  } catch (error) {
    console.error('Error:', error.message)
    return new Response(
      JSON.stringify({
        category: 'uncategorized',
        confidence: 0,
        error: error.message,
        suggestedBoard: null
      }),
      {
        status: 200, // Return 200 so client can fall back gracefully
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      }
    )
  }
})
