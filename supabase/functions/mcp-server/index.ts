// Supabase Edge Function: mcp-server
// MCP Streamable HTTP server for the Taste Connector.
// Implements the MCP 2025-03-26 spec: JSON-RPC over HTTP POST,
// session management, tool dispatch, and privacy filtering.
//
// POST /functions/v1/mcp-server → JSON-RPC request
// Authorization: Bearer <mcp_access_token>

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { VERSION, PRODUCT_CONFIG, TOOL_DEFINITIONS, BUILTIN_BOARDS, PRIVACY_TIERS, type PrivacyTier } from './config.ts'

console.log(`[mcp-server] v${VERSION} - MCP Streamable HTTP server`)

const MCP_PROTOCOL_VERSION = '2025-03-26'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, accept, mcp-session-id',
  'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
  'Access-Control-Expose-Headers': 'mcp-session-id',
}

// In-memory session store (edge functions are short-lived, so sessions are ephemeral per instance)
const sessions = new Map<string, { userId: string, privacyTier: PrivacyTier, createdAt: number }>()

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function json(data: unknown, status = 200, extraHeaders: Record<string, string> = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json', ...extraHeaders },
  })
}

function jsonRpcResponse(id: unknown, result: unknown) {
  return { jsonrpc: '2.0', id, result }
}

function jsonRpcError(id: unknown, code: number, message: string, data?: unknown) {
  return { jsonrpc: '2.0', id, error: { code, message, ...(data ? { data } : {}) } }
}

function getServiceClient() {
  return createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  )
}

function generateSessionId(): string {
  const array = new Uint8Array(16)
  crypto.getRandomValues(array)
  return Array.from(array, b => b.toString(16).padStart(2, '0')).join('')
}

// ---------------------------------------------------------------------------
// Auth: resolve MCP token → user_id
// ---------------------------------------------------------------------------

async function resolveUser(req: Request): Promise<{ userId: string, privacyTier: PrivacyTier } | null> {
  const authHeader = req.headers.get('authorization')
  if (!authHeader?.startsWith('Bearer ')) return null

  const token = authHeader.slice(7)
  const db = getServiceClient()

  const { data, error } = await db
    .from('mcp_tokens')
    .select('user_id, access_token_expires_at')
    .eq('access_token', token)
    .single()

  if (error || !data) return null
  if (new Date(data.access_token_expires_at) < new Date()) return null

  // Get privacy settings
  const { data: settings } = await db
    .from('connector_settings')
    .select('privacy_tier, board_visibility, field_visibility')
    .eq('user_id', data.user_id)
    .single()

  return {
    userId: data.user_id,
    privacyTier: (settings?.privacy_tier || 'library') as PrivacyTier,
  }
}

// ---------------------------------------------------------------------------
// Privacy filtering
// ---------------------------------------------------------------------------

interface ConnectorSettings {
  privacy_tier: PrivacyTier
  board_visibility: Record<string, boolean>
  field_visibility: Record<string, boolean>
}

async function getSettings(userId: string): Promise<ConnectorSettings> {
  const db = getServiceClient()
  const { data } = await db
    .from('connector_settings')
    .select('privacy_tier, board_visibility, field_visibility')
    .eq('user_id', userId)
    .single()

  return {
    privacy_tier: (data?.privacy_tier || 'library') as PrivacyTier,
    board_visibility: data?.board_visibility || {},
    field_visibility: data?.field_visibility || {},
  }
}

function filterPin(pin: Record<string, unknown>, settings: ConnectorSettings): Record<string, unknown> {
  const tier = PRIVACY_TIERS[settings.privacy_tier]
  const allowedFields = new Set(tier.allowed_fields)
  const fieldVis = settings.field_visibility

  const filtered: Record<string, unknown> = { id: pin.id, created_at: pin.created_at }

  for (const field of allowedFields) {
    // Check field-level override (default: visible)
    if (fieldVis[field] === false) continue
    if (pin[field] !== undefined && pin[field] !== null) {
      filtered[field] = pin[field]
    }
  }

  return filtered
}

function isBoardVisible(category: string, settings: ConnectorSettings): boolean {
  // Default: all boards visible. Only hide if explicitly set to false.
  return settings.board_visibility[category] !== false
}

// ---------------------------------------------------------------------------
// Usage logging
// ---------------------------------------------------------------------------

async function logUsage(
  userId: string,
  toolName: string,
  inputParams: unknown,
  resultCount: number,
  privacyTier: string,
  sessionId: string | null,
  startTime: number,
  error?: string,
) {
  const db = getServiceClient()
  await db.from('connector_usage').insert({
    user_id: userId,
    tool_name: toolName,
    input_params: inputParams,
    result_count: resultCount,
    privacy_tier: privacyTier,
    session_id: sessionId,
    duration_ms: Date.now() - startTime,
    error,
  }).then(() => {}, (e: Error) => console.error('[mcp-server] Usage log failed:', e))
}

// ---------------------------------------------------------------------------
// Tool implementations
// ---------------------------------------------------------------------------

async function toolSearchPins(
  userId: string, args: Record<string, unknown>, settings: ConnectorSettings
): Promise<unknown> {
  const db = getServiceClient()
  const limit = Math.min((args.limit as number) || 20, 50)

  let query = db.from('links').select('*').eq('user_id', userId).order('created_at', { ascending: false }).limit(limit)

  if (args.board) query = query.eq('category', args.board)
  if (args.content_type) query = query.eq('content_type', args.content_type)

  const { data: pins, error } = await query

  if (error) throw new Error(`Search failed: ${error.message}`)

  let results = (pins || [])
    .filter((p: Record<string, unknown>) => isBoardVisible(p.category as string, settings))

  // Text search filter (client-side since we're using Supabase REST)
  if (args.query) {
    const q = (args.query as string).toLowerCase()
    results = results.filter((p: Record<string, unknown>) => {
      const searchable = [
        p.title, p.description, p.domain,
        ...(Array.isArray(p.tags) ? p.tags : []),
        ...(Array.isArray(p.taste_tags) ? p.taste_tags : []),
        ...(Array.isArray(p.practical_tags) ? p.practical_tags : []),
      ].filter(Boolean).join(' ').toLowerCase()
      return searchable.includes(q)
    })
  }

  // Tag filter
  if (args.tag) {
    const tag = (args.tag as string).toLowerCase()
    results = results.filter((p: Record<string, unknown>) => {
      const allTags = [
        ...(Array.isArray(p.tags) ? p.tags : []),
        ...(Array.isArray(p.taste_tags) ? p.taste_tags : []),
        ...(Array.isArray(p.practical_tags) ? p.practical_tags : []),
      ]
      return allTags.some((t: string) => t.toLowerCase().includes(tag))
    })
  }

  return {
    pins: results.map(p => filterPin(p, settings)),
    total: results.length,
    query: args.query || null,
    board: args.board || null,
  }
}

async function toolGetBoard(
  userId: string, args: Record<string, unknown>, settings: ConnectorSettings
): Promise<unknown> {
  const board = args.board as string
  if (!isBoardVisible(board, settings)) {
    return { pins: [], total: 0, board, message: 'This board is not shared.' }
  }

  const db = getServiceClient()
  const limit = Math.min((args.limit as number) || 50, 100)
  const offset = (args.offset as number) || 0

  const { data: pins, error, count } = await db
    .from('links')
    .select('*', { count: 'exact' })
    .eq('user_id', userId)
    .eq('category', board)
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1)

  if (error) throw new Error(`Get board failed: ${error.message}`)

  return {
    pins: (pins || []).map(p => filterPin(p, settings)),
    total: count || 0,
    board,
    description: BUILTIN_BOARDS[board] || null,
  }
}

async function toolGetBoardsList(
  userId: string, settings: ConnectorSettings
): Promise<unknown> {
  const db = getServiceClient()

  const { data: pins, error } = await db
    .from('links')
    .select('category')
    .eq('user_id', userId)

  if (error) throw new Error(`Get boards failed: ${error.message}`)

  // Count pins per category
  const counts: Record<string, number> = {}
  for (const pin of (pins || [])) {
    const cat = pin.category as string
    if (!isBoardVisible(cat, settings)) continue
    counts[cat] = (counts[cat] || 0) + 1
  }

  const boards = Object.entries(counts)
    .map(([slug, count]) => ({
      slug,
      count,
      description: BUILTIN_BOARDS[slug] || null,
      is_builtin: slug in BUILTIN_BOARDS,
    }))
    .sort((a, b) => b.count - a.count)

  return { boards, total_pins: Object.values(counts).reduce((a, b) => a + b, 0) }
}

async function toolGetTasteProfile(
  userId: string, settings: ConnectorSettings
): Promise<unknown> {
  const db = getServiceClient()

  // Get taste_tags and practical_tags aggregation
  const { data: pins, error } = await db
    .from('links')
    .select('category, taste_tags, practical_tags, entities, content_type')
    .eq('user_id', userId)

  if (error) throw new Error(`Taste profile failed: ${error.message}`)

  const visiblePins = (pins || []).filter((p: Record<string, unknown>) =>
    isBoardVisible(p.category as string, settings)
  )

  // Aggregate taste_tags
  const tasteCounts: Record<string, { count: number, boards: Set<string> }> = {}
  const practicalCounts: Record<string, { count: number, boards: Set<string> }> = {}
  const entityCounts: Record<string, { count: number, boards: Set<string>, type: string }> = {}
  const contentTypeCounts: Record<string, number> = {}

  for (const pin of visiblePins) {
    const cat = pin.category as string
    const ct = pin.content_type as string
    if (ct) contentTypeCounts[ct] = (contentTypeCounts[ct] || 0) + 1

    for (const tag of (pin.taste_tags as string[] || [])) {
      if (!tasteCounts[tag]) tasteCounts[tag] = { count: 0, boards: new Set() }
      tasteCounts[tag].count++
      tasteCounts[tag].boards.add(cat)
    }
    for (const tag of (pin.practical_tags as string[] || [])) {
      if (!practicalCounts[tag]) practicalCounts[tag] = { count: 0, boards: new Set() }
      practicalCounts[tag].count++
      practicalCounts[tag].boards.add(cat)
    }
    for (const entity of (pin.entities as Array<{ name: string, type: string }> || [])) {
      const key = entity.name
      if (!entityCounts[key]) entityCounts[key] = { count: 0, boards: new Set(), type: entity.type }
      entityCounts[key].count++
      entityCounts[key].boards.add(cat)
    }
  }

  const toSorted = (counts: Record<string, { count: number, boards: Set<string>, type?: string }>) =>
    Object.entries(counts)
      .map(([name, { count, boards, type }]) => ({
        name, count, boards: Array.from(boards),
        ...(type ? { type } : {}),
      }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 30)

  return {
    taste_tags: toSorted(tasteCounts),
    practical_tags: toSorted(practicalCounts),
    top_entities: toSorted(entityCounts),
    content_types: contentTypeCounts,
    total_pins: visiblePins.length,
    boards_analyzed: new Set(visiblePins.map((p: Record<string, unknown>) => p.category)).size,
  }
}

async function toolGetRecentSaves(
  userId: string, args: Record<string, unknown>, settings: ConnectorSettings
): Promise<unknown> {
  const db = getServiceClient()
  const limit = Math.min((args.limit as number) || 20, 50)

  let query = db.from('links').select('*').eq('user_id', userId).order('created_at', { ascending: false }).limit(limit)

  if (args.days) {
    const since = new Date(Date.now() - (args.days as number) * 24 * 60 * 60 * 1000).toISOString()
    query = query.gte('created_at', since)
  }

  const { data: pins, error } = await query

  if (error) throw new Error(`Recent saves failed: ${error.message}`)

  const results = (pins || [])
    .filter((p: Record<string, unknown>) => isBoardVisible(p.category as string, settings))

  return {
    pins: results.map(p => filterPin(p, settings)),
    total: results.length,
  }
}

async function toolSavePin(
  userId: string, args: Record<string, unknown>
): Promise<unknown> {
  const url = args.url as string
  if (!url) throw new Error('url is required')

  // Call the existing create-pin pipeline
  const createPinUrl = `${Deno.env.get('SUPABASE_URL')}/functions/v1/create-pin`
  const categorizeUrl = `${Deno.env.get('SUPABASE_URL')}/functions/v1/categorize`
  const analyzeUrl = `${Deno.env.get('SUPABASE_URL')}/functions/v1/analyze-content`

  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

  // Generate deterministic pin ID from URL (same as client)
  const urlHash = await generatePinId(url)

  // Check if pin already exists
  const db = getServiceClient()
  const { data: existing } = await db
    .from('links')
    .select('id, title, category, content_type, short_code')
    .eq('id', urlHash)
    .eq('user_id', userId)
    .single()

  if (existing) {
    return {
      action: 'existing',
      pin: existing,
      message: 'This URL is already in your library.',
    }
  }

  // Create the pin record first
  const pinData: Record<string, unknown> = {
    id: urlHash,
    user_id: userId,
    url,
    source: (args.source as string) || 'claude_connector',
    notes: (args.notes as string) || null,
  }

  if (args.category) {
    pinData.category = args.category
  }

  const { error: insertErr } = await db.from('links').insert(pinData)
  if (insertErr) throw new Error(`Failed to save pin: ${insertErr.message}`)

  // Trigger enrichment pipeline in parallel (fire-and-forget)
  const enrichPromises = [
    fetch(createPinUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${serviceKey}`,
      },
      body: JSON.stringify({ url, linkId: urlHash }),
    }).catch(e => console.error('[mcp-server] create-pin call failed:', e)),

    fetch(analyzeUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${serviceKey}`,
      },
      body: JSON.stringify({ url, linkId: urlHash }),
    }).catch(e => console.error('[mcp-server] analyze-content call failed:', e)),
  ]

  // Categorize if no explicit category
  if (!args.category) {
    enrichPromises.push(
      fetch(categorizeUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${serviceKey}`,
        },
        body: JSON.stringify({ url, linkId: urlHash }),
      }).catch(e => console.error('[mcp-server] categorize call failed:', e))
    )
  }

  // Don't await enrichment — it runs async
  Promise.allSettled(enrichPromises)

  return {
    action: 'created',
    pin: { id: urlHash, url, category: args.category || 'pending', notes: args.notes || null },
    message: 'Pin saved. It will be enriched with images, tags, and categorization shortly.',
  }
}

async function generatePinId(url: string): Promise<string> {
  // Deterministic UUID v5-like hash from URL (matches client-side logic)
  const encoded = new TextEncoder().encode(url)
  const hashBuffer = await crypto.subtle.digest('SHA-256', encoded)
  const hashArray = new Uint8Array(hashBuffer)
  // Format as UUID
  const hex = Array.from(hashArray.slice(0, 16), b => b.toString(16).padStart(2, '0')).join('')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`
}

function toolGetConnectorContext(settings: ConnectorSettings): unknown {
  return {
    product: PRODUCT_CONFIG.name,
    description: PRODUCT_CONFIG.description,
    privacy_tier: settings.privacy_tier,
    privacy_description: PRIVACY_TIERS[settings.privacy_tier].description,
    boards: Object.entries(BUILTIN_BOARDS).map(([slug, description]) => ({
      slug,
      description,
      shared: isBoardVisible(slug, settings),
    })),
    content_types: [
      'product', 'article', 'book', 'video', 'music',
      'repository', 'social', 'document', 'tool', 'place',
      'recipe', 'event', 'newsletter', 'dataset',
    ],
    tag_system: {
      taste_tags: 'Subjective aesthetic/cultural/vibe tags (e.g., minimalist, brutalist, artisanal). These represent the FEEL of what the user saves.',
      practical_tags: 'Objective, factual, searchable tags (e.g., waterproof, noise_cancelling, hardcover). These represent what the item IS.',
      entities: 'Named entities extracted from each pin: brands, people, places, products, concepts.',
    },
    composition_guidance: {
      recommendations: 'Call get_taste_profile first for cross-board context, then search_pins or get_board for specifics.',
      research: 'Use search_pins first. Add get_taste_profile if the user wants contextual filtering.',
      self_discovery: 'get_taste_profile + get_boards_list together give the full picture.',
      saving: 'save_pin alone — the platform handles categorization and tagging automatically.',
      auto_capture: 'When the user expresses a clear choice signal ("I\'ll get that", "that\'s the one", "perfect"), proactively call save_pin with source "claude_auto" and conversation context as notes.',
    },
  }
}

// ---------------------------------------------------------------------------
// MCP JSON-RPC dispatch
// ---------------------------------------------------------------------------

async function handleJsonRpc(
  request: Record<string, unknown>,
  userId: string,
  settings: ConnectorSettings,
  sessionId: string | null,
): Promise<unknown> {
  const method = request.method as string
  const id = request.id
  const params = (request.params || {}) as Record<string, unknown>

  switch (method) {
    case 'initialize':
      return jsonRpcResponse(id, {
        protocolVersion: MCP_PROTOCOL_VERSION,
        capabilities: {
          tools: { listChanged: false },
          resources: { subscribe: false, listChanged: false },
        },
        serverInfo: {
          name: PRODUCT_CONFIG.connector_name,
          version: VERSION,
        },
      })

    case 'notifications/initialized':
      // No response needed for notifications
      return null

    case 'tools/list':
      return jsonRpcResponse(id, { tools: TOOL_DEFINITIONS })

    case 'tools/call': {
      const toolName = params.name as string
      const toolArgs = (params.arguments || {}) as Record<string, unknown>
      const startTime = Date.now()
      let resultCount = 0
      let error: string | undefined

      try {
        let result: unknown

        switch (toolName) {
          case 'search_pins':
            result = await toolSearchPins(userId, toolArgs, settings)
            resultCount = ((result as Record<string, unknown>).total as number) || 0
            break
          case 'get_board':
            result = await toolGetBoard(userId, toolArgs, settings)
            resultCount = ((result as Record<string, unknown>).total as number) || 0
            break
          case 'get_boards_list':
            result = await toolGetBoardsList(userId, settings)
            resultCount = ((result as Record<string, unknown>).boards as unknown[])?.length || 0
            break
          case 'get_taste_profile':
            result = await toolGetTasteProfile(userId, settings)
            resultCount = (result as Record<string, unknown>).total_pins as number || 0
            break
          case 'get_recent_saves':
            result = await toolGetRecentSaves(userId, toolArgs, settings)
            resultCount = ((result as Record<string, unknown>).total as number) || 0
            break
          case 'save_pin':
            result = await toolSavePin(userId, toolArgs)
            resultCount = 1
            break
          case 'get_connector_context':
            result = toolGetConnectorContext(settings)
            resultCount = 1
            break
          default:
            return jsonRpcResponse(id, {
              content: [{ type: 'text', text: JSON.stringify({ error: `Unknown tool: ${toolName}` }) }],
              isError: true,
            })
        }

        // Log usage
        logUsage(userId, toolName, toolArgs, resultCount, settings.privacy_tier, sessionId, startTime)

        return jsonRpcResponse(id, {
          content: [{ type: 'text', text: JSON.stringify(result) }],
        })
      } catch (e) {
        error = (e as Error).message
        logUsage(userId, toolName, toolArgs, 0, settings.privacy_tier, sessionId, startTime, error)

        return jsonRpcResponse(id, {
          content: [{ type: 'text', text: JSON.stringify({ error }) }],
          isError: true,
        })
      }
    }

    case 'resources/list':
      return jsonRpcResponse(id, {
        resources: [{
          uri: `connector://${PRODUCT_CONFIG.name}/context`,
          name: `${PRODUCT_CONFIG.name} Connector Context`,
          description: 'Board taxonomy, content types, taste model, and tool composition guidance.',
          mimeType: 'application/json',
        }],
      })

    case 'resources/read': {
      const uri = params.uri as string
      if (uri === `connector://${PRODUCT_CONFIG.name}/context`) {
        const context = toolGetConnectorContext(settings)
        return jsonRpcResponse(id, {
          contents: [{
            uri,
            mimeType: 'application/json',
            text: JSON.stringify(context),
          }],
        })
      }
      return jsonRpcError(id, -32602, `Unknown resource: ${uri}`)
    }

    case 'ping':
      return jsonRpcResponse(id, {})

    default:
      return jsonRpcError(id, -32601, `Method not found: ${method}`)
  }
}

// ---------------------------------------------------------------------------
// HTTP handler
// ---------------------------------------------------------------------------

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders })
  }

  // POST: JSON-RPC requests
  if (req.method === 'POST') {
    const accept = req.headers.get('accept') || ''
    if (!accept.includes('application/json') && !accept.includes('text/event-stream') && accept !== '*/*') {
      return json(
        jsonRpcError(null, -32600, 'Accept header must include application/json or text/event-stream'),
        400,
      )
    }

    // Authenticate
    const user = await resolveUser(req)
    if (!user) {
      return new Response(null, {
        status: 401,
        headers: { ...corsHeaders, 'WWW-Authenticate': 'Bearer' },
      })
    }

    // Session management
    let sessionId = req.headers.get('mcp-session-id')
    if (!sessionId) {
      sessionId = generateSessionId()
      sessions.set(sessionId, { userId: user.userId, privacyTier: user.privacyTier, createdAt: Date.now() })
    }

    const settings = await getSettings(user.userId)

    let body: unknown
    try {
      body = await req.json()
    } catch {
      return json(jsonRpcError(null, -32700, 'Parse error'), 400)
    }

    // Handle batch requests
    if (Array.isArray(body)) {
      const results = await Promise.all(
        body.map(request => handleJsonRpc(request, user.userId, settings, sessionId))
      )
      return json(results.filter(r => r !== null), 200, { 'Mcp-Session-Id': sessionId })
    }

    const result = await handleJsonRpc(body as Record<string, unknown>, user.userId, settings, sessionId)
    if (result === null) {
      // Notification — no response body
      return new Response(null, { status: 204, headers: { ...corsHeaders, 'Mcp-Session-Id': sessionId } })
    }

    return json(result, 200, { 'Mcp-Session-Id': sessionId })
  }

  // DELETE: close session
  if (req.method === 'DELETE') {
    const sessionId = req.headers.get('mcp-session-id')
    if (sessionId) sessions.delete(sessionId)
    return new Response(null, { status: 204, headers: corsHeaders })
  }

  return json(jsonRpcError(null, -32600, 'Only POST and DELETE are supported'), 405)
})
