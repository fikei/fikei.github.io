// Supabase Edge Function: fetch-source
// Server-side proxy for fetching event source pages that block CORS/bot requests.
// Returns raw HTML/RSS/XML content with proper browser-like headers.
//
// POST /functions/v1/fetch-source
// Body: { url: string }
// Returns: { content: string, status: number, contentType: string }

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

// Rate limit: simple in-memory tracker (resets on cold start)
const requestLog: Map<string, number[]> = new Map()
const RATE_LIMIT = 30 // requests per minute per IP
const RATE_WINDOW = 60_000

// Allowed URL patterns — only fetch known event source domains
const ALLOWED_DOMAINS = [
  '19hz.info',
  'roxie.com',
  'www.roxie.com',
  'punchlinecomedyclub.com',
  'www.punchlinecomedyclub.com',
  'cobbscomedy.com',
  'www.cobbscomedy.com',
  'screenslate.com',
  'www.screenslate.com',
  'eventbrite.com',
  'www.eventbrite.com',
  'alamodrafthouse.com',
  'drafthouse.com',
  'www.drafthouse.com',
  'garysguide.com',
  'www.garysguide.com',
  'bonobonetwork.com',
  'www.bonobonetwork.com',
]

function isDomainAllowed(url: string): boolean {
  try {
    const hostname = new URL(url).hostname.toLowerCase()
    return ALLOWED_DOMAINS.some(d => hostname === d || hostname.endsWith('.' + d))
  } catch {
    return false
  }
}

function checkRateLimit(ip: string): boolean {
  const now = Date.now()
  const times = requestLog.get(ip) || []
  const recent = times.filter(t => now - t < RATE_WINDOW)
  if (recent.length >= RATE_LIMIT) return false
  recent.push(now)
  requestLog.set(ip, recent)
  return true
}

serve(async (req: Request) => {
  // CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'POST required' }), {
      status: 405,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  // Rate limit by IP
  const ip = req.headers.get('x-forwarded-for') || req.headers.get('cf-connecting-ip') || 'unknown'
  if (!checkRateLimit(ip)) {
    return new Response(JSON.stringify({ error: 'Rate limited' }), {
      status: 429,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  try {
    const { url } = await req.json()

    if (!url || typeof url !== 'string') {
      return new Response(JSON.stringify({ error: 'url is required' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // Domain allowlist check
    if (!isDomainAllowed(url)) {
      return new Response(JSON.stringify({ error: 'Domain not allowed' }), {
        status: 403,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    console.log(`[fetch-source] Fetching: ${url}`)

    const resp = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
        'Accept-Encoding': 'identity',
        'Cache-Control': 'no-cache',
      },
      redirect: 'follow',
    })

    console.log(`[fetch-source] Response: ${resp.status} ${resp.statusText} (${resp.headers.get('content-type')})`)

    const content = await resp.text()

    return new Response(JSON.stringify({
      content,
      status: resp.status,
      contentType: resp.headers.get('content-type') || '',
    }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  } catch (err) {
    console.error(`[fetch-source] Error: ${err.message}`)
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})
