import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'

const ANTHROPIC_API_KEY = Deno.env.get('ANTHROPIC_API_KEY')

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
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

    const { url, title, description, domain, categories } = await req.json()

    if (!url) {
      throw new Error('URL is required')
    }

    const categoryList = categories || ['home', 'wear', 'watch', 'use', 'eat', 'go', 'follow', 'read']

    const prompt = `You are a link categorizer. Given information about a webpage, categorize it into exactly ONE of these categories:

Categories:
- home: Furniture, home decor, interior design, lighting, rugs, ceramics
- wear: Clothing, shoes, accessories, jewelry, fashion
- watch: Videos, music, podcasts, streaming content, films, shows
- use: Apps, software, tools, code, developer resources, products
- eat: Restaurants, cafes, recipes, food, cooking, dining
- go: Travel, hotels, destinations, maps, places to visit
- follow: People, profiles, portfolios, social media accounts, creators
- read: Articles, essays, blogs, news, books, tutorials, guides

If the link doesn't clearly fit any category, respond with "uncategorized".

Webpage information:
- URL: ${url}
- Domain: ${domain || 'unknown'}
- Title: ${title || 'No title'}
- Description: ${description || 'No description'}

Respond with ONLY a JSON object in this exact format, no other text:
{"category": "category_name", "confidence": 0.95, "reason": "brief reason"}`

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-3-haiku-20240307',
        max_tokens: 150,
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
        reason: 'Parsed from text'
      }
    }

    // Validate category
    if (!categoryList.includes(result.category)) {
      result.category = 'uncategorized'
      result.confidence = 0.3
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
        error: error.message
      }),
      {
        status: 200, // Return 200 so client can fall back gracefully
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      }
    )
  }
})
