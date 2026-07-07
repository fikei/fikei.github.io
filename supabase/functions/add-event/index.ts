// Supabase Edge Function: add-event
// Lets a signed-in user add a one-off event by pasting a web link.
// Fetches the page, extracts structured event data (JSON-LD Event schema ->
// OpenGraph tags -> Claude Haiku fallback), and forwards it into the
// canonical store via cache-events under the 'user-submitted' source.
//
// Visibility follows the PRD source-architecture rules per URL, not per
// source: links on private-invite platforms (Partiful, secretparty, forms)
// stay private; public ticketing/venue pages are public. The URL-first dedup
// ladder in cache-events auto-merges submissions that already exist.
//
// POST /functions/v1/add-event   (requires an authenticated user JWT)
// Body: { url: string }
// Returns: { event, visibility, merged: boolean }

const VERSION = '1.0.1'
console.log(`[add-event] v${VERSION} - PT-local date anchor + Z-timestamp handling`)

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

function json(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

const SOURCE_ID = 'user-submitted'

// Private-invite platforms: submissions from these stay private (PRD §2.2)
const PRIVATE_HOSTS = ['partiful.com', 'secretparty.io', 'docs.google.com', 'forms.gle']

interface Extracted {
  date: string
  time: string
  name: string
  venue: string
  address: string
  city: string
  price: string
  description: string
  imageUrl: string
}

// --- JSON-LD extraction (schema.org Event) ---

// deno-lint-ignore no-explicit-any
function findEventNode(node: any): any | null {
  if (!node || typeof node !== 'object') return null
  if (Array.isArray(node)) {
    for (const n of node) { const f = findEventNode(n); if (f) return f }
    return null
  }
  const type = node['@type']
  const types = Array.isArray(type) ? type : [type]
  if (types.some(t => typeof t === 'string' && /Event$/i.test(t))) return node
  if (node['@graph']) return findEventNode(node['@graph'])
  return null
}

function extractJsonLd(html: string): Extracted | null {
  const scripts = html.matchAll(/<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)
  for (const m of scripts) {
    try {
      const ev = findEventNode(JSON.parse(m[1]))
      if (!ev || !ev.name || !ev.startDate) continue
      const start = String(ev.startDate)
      let date = start.split('T')[0]
      let time = (start.split('T')[1] || '').slice(0, 5)
      if (/Z$/.test(start)) {
        // Z-normalized publishers need UTC->PT; offset-formatted are already local
        const local = new Intl.DateTimeFormat('sv-SE', {
          timeZone: 'America/Los_Angeles', year: 'numeric', month: '2-digit', day: '2-digit',
          hour: '2-digit', minute: '2-digit', hour12: false,
        }).format(new Date(start))
        ;[date, time] = local.split(' ')
      }
      const loc = ev.location && !Array.isArray(ev.location) ? ev.location : (ev.location?.[0] || {})
      const addr = loc.address || {}
      const offers = Array.isArray(ev.offers) ? ev.offers[0] : ev.offers
      return {
        date,
        time,
        name: String(ev.name).slice(0, 200),
        venue: String(loc.name || '').slice(0, 120),
        address: String(typeof addr === 'string' ? addr : addr.streetAddress || '').slice(0, 200),
        city: String(typeof addr === 'object' ? addr.addressLocality || '' : '').slice(0, 80),
        price: offers?.price ? `$${offers.price}` : '',
        description: String(ev.description || '').slice(0, 500),
        imageUrl: String(Array.isArray(ev.image) ? ev.image[0] : ev.image || ''),
      }
    } catch { /* malformed JSON-LD block — try the next one */ }
  }
  return null
}

// --- AI fallback (page text -> structured event) ---

async function extractWithAI(html: string, url: string, apiKey: string): Promise<Extracted | null> {
  const title = html.match(/<title[^>]*>([^<]*)<\/title>/i)?.[1] || ''
  const ogTitle = html.match(/property=["']og:title["'][^>]*content=["']([^"']*)/i)?.[1] || ''
  const ogDesc = html.match(/property=["']og:description["'][^>]*content=["']([^"']*)/i)?.[1] || ''
  const text = html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .slice(0, 4000)

  const today = new Intl.DateTimeFormat('sv-SE', { timeZone: 'America/Los_Angeles' }).format(new Date())
  const resp = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 512,
      messages: [{
        role: 'user',
        content: `Extract the single event described on this web page. Today is ${today}. URL: ${url}\nTitle: ${title}\nOG title: ${ogTitle}\nOG description: ${ogDesc}\nPage text: ${text}\n\nReturn ONLY a JSON object (no markdown): {"date":"YYYY-MM-DD","time":"HH:MM" or "","name":"...","venue":"..." or "","address":"" ,"city":"" ,"price":"" ,"description":"one sentence"} — or null if no event is identifiable.`,
      }],
    }),
  })
  if (!resp.ok) throw new Error(`Claude API ${resp.status}`)
  const data = await resp.json()
  const raw = (data.content?.[0]?.text || '').replace(/^```(?:json)?\s*/m, '').replace(/\s*```$/m, '').trim()
  try {
    const parsed = JSON.parse(raw)
    if (!parsed || !parsed.date || !parsed.name) return null
    return { imageUrl: '', ...parsed }
  } catch { return null }
}

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return json({ error: 'POST required' }, 405)

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

    // Require a signed-in user (or the service role, for testing/automation)
    const authHeader = req.headers.get('Authorization') || ''
    let submittedBy = ''
    try {
      const payload = JSON.parse(atob(authHeader.replace(/^Bearer\s+/i, '').split('.')[1].replace(/-/g, '+').replace(/_/g, '/')))
      if (payload.role === 'service_role') {
        submittedBy = 'service'
      } else {
        const authed = createClient(supabaseUrl, anonKey, { global: { headers: { Authorization: authHeader } } })
        const { data: { user } } = await authed.auth.getUser()
        if (!user) return json({ error: 'Sign in to add events' }, 401)
        submittedBy = user.email?.split('@')[0] || user.id.slice(0, 8)
      }
    } catch {
      return json({ error: 'Sign in to add events' }, 401)
    }

    const { url } = await req.json() as { url?: string }
    if (!url || !/^https?:\/\//i.test(url)) return json({ error: 'A valid http(s) URL is required' }, 400)
    const host = new URL(url).hostname.toLowerCase().replace(/^www\./, '')
    // SSRF guard: public hostnames only
    if (/^(localhost|127\.|10\.|172\.(1[6-9]|2\d|3[01])\.|192\.168\.|\[)/.test(host) || !host.includes('.')) {
      return json({ error: 'URL host not allowed' }, 400)
    }

    // Fetch the page
    const page = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)' },
      redirect: 'follow',
      signal: AbortSignal.timeout(12000),
    })
    if (!page.ok) return json({ error: `Could not fetch page (${page.status})` }, 422)
    const html = (await page.text()).slice(0, 800_000)

    // Extract: JSON-LD first, AI fallback
    let extracted = extractJsonLd(html)
    let method = 'json-ld'
    if (!extracted) {
      const apiKey = Deno.env.get('ANTHROPIC_API_KEY')
      if (!apiKey) return json({ error: 'No structured event data found on page' }, 422)
      extracted = await extractWithAI(html, url, apiKey)
      method = 'ai'
    }
    if (!extracted || !extracted.date || !/^\d{4}-\d{2}-\d{2}$/.test(extracted.date)) {
      return json({ error: 'No event could be extracted from that page' }, 422)
    }

    const visibility = PRIVATE_HOSTS.some(h => host === h || host.endsWith('.' + h)) ? 'private' : 'public'

    // Forward into the canonical store (dedup ladder merges if it already exists)
    const cacheResp = await fetch(`${supabaseUrl}/functions/v1/cache-events`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${serviceKey}` },
      body: JSON.stringify({
        events: [{
          source: SOURCE_ID,
          date: extracted.date,
          time: extracted.time || '',
          name: extracted.name,
          venue: extracted.venue || 'TBA',
          address: extracted.address || '',
          city: extracted.city || '',
          price: extracted.price || '',
          url,
          description: extracted.description || '',
          postedBy: submittedBy,
          visibility,
        }],
      }),
    })
    const cacheResult = await cacheResp.json()
    if (!cacheResp.ok) return json({ error: `Store write failed: ${JSON.stringify(cacheResult).slice(0, 200)}` }, 502)

    console.log(`[add-event] ${submittedBy} added "${extracted.name}" (${extracted.date}) via ${method}, visibility=${visibility}, cached=${cacheResult.cached} updated=${cacheResult.updated}`)
    return json({
      event: extracted,
      visibility,
      merged: (cacheResult.cached === 0 && cacheResult.updated > 0),
      extraction: method,
    })
  } catch (err) {
    console.error('[add-event] Error:', err)
    return json({ error: (err as Error).message }, 500)
  }
})
