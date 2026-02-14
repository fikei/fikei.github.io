// Supabase Edge Function: fetch-source
// Server-side proxy for fetching event source pages that block CORS/bot requests.
// Returns raw HTML/RSS/XML content with proper browser-like headers.
//
// POST /functions/v1/fetch-source
// Body: { url: string, method?: string, body?: string, headers?: Record<string,string> }
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
  // Music & Nightlife
  '19hz.info',
  'ra.co',
  'www.ra.co',
  // Comedy
  'punchlinecomedyclub.com',
  'www.punchlinecomedyclub.com',
  'cobbscomedy.com',
  'www.cobbscomedy.com',
  // Film
  'roxie.com',
  'www.roxie.com',
  'screenslate.com',
  'www.screenslate.com',
  'alamodrafthouse.com',
  'drafthouse.com',
  'www.drafthouse.com',
  'eventbrite.com',
  'www.eventbrite.com',
  // Tech
  'garysguide.com',
  'www.garysguide.com',
  // Social
  'bonobonetwork.com',
  'www.bonobonetwork.com',
  // Art
  'hyperallergic.com',
  'www.hyperallergic.com',
  'sfmoma.org',
  'www.sfmoma.org',
  'famsf.org',
  'www.famsf.org',
  // Design
  'sfdesignweek.org',
  'www.sfdesignweek.org',
  // Literary
  'citylights.com',
  'www.citylights.com',
  'sfpl.org',
  'www.sfpl.org',
  'commonwealthclub.org',
  'www.commonwealthclub.org',
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
    const { url, method: reqMethod, body: reqBody, headers: customHeaders } = await req.json()

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

    const upstreamMethod = (reqMethod || 'GET').toUpperCase()
    console.log(`[fetch-source] ${upstreamMethod} ${url}`)

    const fetchHeaders: Record<string, string> = {
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,application/json,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.9',
      'Accept-Encoding': 'identity',
      'Cache-Control': 'no-cache',
      ...(customHeaders || {}),
    }

    const fetchOptions: RequestInit = {
      method: upstreamMethod,
      headers: fetchHeaders,
      redirect: 'follow',
    }
    if (reqBody && upstreamMethod !== 'GET') {
      fetchOptions.body = reqBody
    }

    const resp = await fetch(url, fetchOptions)

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
