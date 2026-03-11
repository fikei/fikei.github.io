// Supabase Edge Function: connector-api
// REST API for the ctrl.rodeo connector — OpenAPI-compatible endpoints
// consumed by OpenAI GPT Actions, Google Gemini Extensions, and any HTTP client.
//
// All business logic lives in _shared/connector-core.ts (shared with MCP server).
// This file is a thin REST routing layer.
//
// Routes:
//   GET  /v1/pins/search      → search_pins
//   GET  /v1/boards            → get_boards_list
//   GET  /v1/boards/:slug      → get_board
//   GET  /v1/taste-profile     → get_taste_profile
//   GET  /v1/pins/recent       → get_recent_saves
//   POST /v1/pins              → save_pin
//   GET  /v1/pins/:id          → get_pin
//   PUT  /v1/pins/:id          → update_pin
//   DELETE /v1/pins/:id        → delete_pin
//   POST /v1/boards            → create_board
//   PUT  /v1/boards/:slug      → update_board
//   DELETE /v1/boards/:slug    → delete_board
//   POST /v1/pins/:id/enrich   → re_enrich_pin
//   POST /v1/pins/batch/enrich → batch_re_enrich
//   POST /v1/pins/batch/move   → batch_move_pins
//   POST /v1/pins/batch/tag    → batch_tag_pins
//   POST /v1/pins/batch/update → batch_update_pins
//   GET  /v1/context           → get_connector_context

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import {
  resolveUser,
  getSettings,
  dispatchTool,
  logUsage,
} from '../_shared/connector-core.ts'

const VERSION = '0.1.0'
console.log(`[connector-api] v${VERSION} - REST API for multi-platform connectors`)

const RATE_LIMIT_MAX = 60  // requests per minute per token
const rateLimitMap = new Map<string, { count: number, resetAt: number }>()

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, content-type, accept',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

function errorResponse(message: string, status = 400) {
  return json({ error: message }, status)
}

function parseQuery(url: URL): Record<string, unknown> {
  const args: Record<string, unknown> = {}
  for (const [key, value] of url.searchParams) {
    // Parse integers for known numeric params
    if (['limit', 'offset', 'days'].includes(key)) {
      args[key] = parseInt(value, 10)
    } else if (value === 'true') {
      args[key] = true
    } else if (value === 'false') {
      args[key] = false
    } else {
      args[key] = value
    }
  }
  return args
}

// Simple per-token rate limiting (60 req/min)
function checkRateLimit(token: string): boolean {
  const now = Date.now()
  const entry = rateLimitMap.get(token)
  if (!entry || now > entry.resetAt) {
    rateLimitMap.set(token, { count: 1, resetAt: now + 60_000 })
    return true
  }
  entry.count++
  return entry.count <= RATE_LIMIT_MAX
}

// Detect platform from User-Agent or referer
function detectPlatform(req: Request): string {
  const ua = (req.headers.get('user-agent') || '').toLowerCase()
  const referer = (req.headers.get('referer') || '').toLowerCase()
  if (ua.includes('openai') || ua.includes('chatgpt') || referer.includes('openai') || referer.includes('chatgpt')) return 'openai'
  if (ua.includes('gemini') || ua.includes('google') || referer.includes('gemini')) return 'gemini'
  return 'rest'
}

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders })
  }

  const url = new URL(req.url)
  const path = url.pathname.replace(/^\/?(?:functions\/v1\/)?connector-api/, '')

  // Authenticate
  const authHeader = req.headers.get('authorization')
  const user = await resolveUser(authHeader)
  if (!user) {
    return errorResponse('Unauthorized — provide a valid Bearer token.', 401)
  }

  // Rate limit
  const token = authHeader!.slice(7)
  if (!checkRateLimit(token)) {
    return json({ error: 'Rate limit exceeded. Max 60 requests per minute.' }, 429)
  }

  const settings = await getSettings(user.userId)
  const platform = detectPlatform(req)
  const startTime = Date.now()

  try {
    // Route → tool name + args
    const { toolName, args } = await matchRoute(req.method, path, url, req)

    const { result, resultCount } = await dispatchTool(toolName, args, user.userId, settings)

    logUsage(user.userId, toolName, args, resultCount, settings.privacy_tier, null, startTime, platform)

    return json(result)
  } catch (e) {
    const message = (e as Error).message

    // 404 for unknown routes
    if (message.startsWith('Not found:')) {
      return errorResponse(message, 404)
    }

    // Tool errors
    logUsage(user.userId, 'unknown', {}, 0, settings.privacy_tier, null, startTime, platform, message)
    return errorResponse(message, 400)
  }
})

// ---------------------------------------------------------------------------
// Route matching
// ---------------------------------------------------------------------------

async function matchRoute(
  method: string,
  path: string,
  url: URL,
  req: Request,
): Promise<{ toolName: string, args: Record<string, unknown> }> {

  // GET /v1/pins/search
  if (method === 'GET' && path === '/v1/pins/search') {
    return { toolName: 'search_pins', args: parseQuery(url) }
  }

  // GET /v1/pins/recent
  if (method === 'GET' && path === '/v1/pins/recent') {
    return { toolName: 'get_recent_saves', args: parseQuery(url) }
  }

  // POST /v1/pins/batch/enrich
  if (method === 'POST' && path === '/v1/pins/batch/enrich') {
    return { toolName: 'batch_re_enrich', args: await req.json() }
  }

  // POST /v1/pins/batch/move
  if (method === 'POST' && path === '/v1/pins/batch/move') {
    return { toolName: 'batch_move_pins', args: await req.json() }
  }

  // POST /v1/pins/batch/tag
  if (method === 'POST' && path === '/v1/pins/batch/tag') {
    return { toolName: 'batch_tag_pins', args: await req.json() }
  }

  // POST /v1/pins/batch/update
  if (method === 'POST' && path === '/v1/pins/batch/update') {
    return { toolName: 'batch_update_pins', args: await req.json() }
  }

  // POST /v1/pins/:id/enrich
  const enrichMatch = path.match(/^\/v1\/pins\/([^/]+)\/enrich$/)
  if (method === 'POST' && enrichMatch) {
    const body = await safeJson(req)
    return { toolName: 're_enrich_pin', args: { pin_id: enrichMatch[1], ...body } }
  }

  // GET /v1/pins/:id
  const pinGetMatch = path.match(/^\/v1\/pins\/([^/]+)$/)
  if (method === 'GET' && pinGetMatch) {
    return { toolName: 'get_pin', args: { pin_id: pinGetMatch[1] } }
  }

  // PUT /v1/pins/:id
  if (method === 'PUT' && pinGetMatch) {
    const body = await req.json()
    return { toolName: 'update_pin', args: { pin_id: pinGetMatch[1], ...body } }
  }

  // DELETE /v1/pins/:id
  if (method === 'DELETE' && pinGetMatch) {
    return { toolName: 'delete_pin', args: { pin_id: pinGetMatch[1], confirm: true } }
  }

  // POST /v1/pins (save_pin)
  if (method === 'POST' && path === '/v1/pins') {
    return { toolName: 'save_pin', args: await req.json() }
  }

  // GET /v1/boards
  if (method === 'GET' && path === '/v1/boards') {
    return { toolName: 'get_boards_list', args: {} }
  }

  // POST /v1/boards
  if (method === 'POST' && path === '/v1/boards') {
    return { toolName: 'create_board', args: await req.json() }
  }

  // GET /v1/boards/:slug
  const boardMatch = path.match(/^\/v1\/boards\/([^/]+)$/)
  if (method === 'GET' && boardMatch) {
    return { toolName: 'get_board', args: { board: boardMatch[1], ...parseQuery(url) } }
  }

  // PUT /v1/boards/:slug
  if (method === 'PUT' && boardMatch) {
    const body = await req.json()
    return { toolName: 'update_board', args: { board: boardMatch[1], ...body } }
  }

  // DELETE /v1/boards/:slug
  if (method === 'DELETE' && boardMatch) {
    const query = parseQuery(url)
    return { toolName: 'delete_board', args: { board: boardMatch[1], confirm: true, ...query } }
  }

  // GET /v1/taste-profile
  if (method === 'GET' && path === '/v1/taste-profile') {
    return { toolName: 'get_taste_profile', args: {} }
  }

  // GET /v1/context
  if (method === 'GET' && path === '/v1/context') {
    return { toolName: 'get_connector_context', args: {} }
  }

  throw new Error(`Not found: ${method} ${path}`)
}

async function safeJson(req: Request): Promise<Record<string, unknown>> {
  try {
    return await req.json()
  } catch {
    return {}
  }
}
