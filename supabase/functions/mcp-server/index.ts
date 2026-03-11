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
const MCP_SERVER_BASE = 'https://yfhudwakpgzswiylhfbh.supabase.co/functions/v1/mcp-server'
const OAUTH_SERVER_BASE = 'https://ctrl.rodeo'

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
// Write access guard
// ---------------------------------------------------------------------------

function canWrite(settings: ConnectorSettings): void {
  if (settings.privacy_tier === 'taste_only') {
    throw new Error(
      'Write operations require at least "library" privacy tier. ' +
      'Update your settings at ctrl.rodeo/boards (gear icon) to enable writes.'
    )
  }
}

// ---------------------------------------------------------------------------
// Board metadata helpers (read-modify-write on JSONB blob)
// ---------------------------------------------------------------------------

async function getBoardMetadata(userId: string): Promise<Record<string, Record<string, unknown>>> {
  const db = getServiceClient()
  const { data } = await db
    .from('board_metadata')
    .select('metadata')
    .eq('user_id', userId)
    .single()
  return (data?.metadata as Record<string, Record<string, unknown>>) || {}
}

async function saveBoardMetadata(userId: string, metadata: Record<string, Record<string, unknown>>): Promise<void> {
  const db = getServiceClient()
  const { error } = await db
    .from('board_metadata')
    .upsert({ user_id: userId, metadata, updated_at: new Date().toISOString() })
  if (error) throw new Error(`Board metadata save failed: ${error.message}`)
}

function slugify(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
}

// ---------------------------------------------------------------------------
// Batch pin ID resolver — supports pin_ids, board, or all-library scoping
// ---------------------------------------------------------------------------

async function resolvePinIds(
  userId: string,
  args: Record<string, unknown>,
  maxLimit: number,
  extraFilters?: (q: ReturnType<ReturnType<typeof getServiceClient>['from']>) => ReturnType<ReturnType<typeof getServiceClient>['from']>,
): Promise<string[]> {
  if (args.pin_ids && Array.isArray(args.pin_ids) && (args.pin_ids as string[]).length > 0) {
    return (args.pin_ids as string[]).slice(0, maxLimit)
  }

  const db = getServiceClient()
  const limit = Math.min((args.limit as number) || 100, maxLimit)
  // deno-lint-ignore no-explicit-any
  let query: any = db.from('links').select('id').eq('user_id', userId)
  if (args.board) query = query.eq('category', args.board as string)
  if (extraFilters) query = extraFilters(query)
  query = query.limit(limit)

  const { data, error } = await query
  if (error) throw new Error(`Failed to resolve pins: ${error.message}`)
  return (data || []).map((p: Record<string, unknown>) => p.id as string)
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
  userId: string, args: Record<string, unknown>, settings: ConnectorSettings
): Promise<unknown> {
  canWrite(settings)
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

// ---------------------------------------------------------------------------
// Pin management tools
// ---------------------------------------------------------------------------

async function toolGetPin(
  userId: string, args: Record<string, unknown>, settings: ConnectorSettings
): Promise<unknown> {
  const pinId = args.pin_id as string
  if (!pinId) throw new Error('pin_id is required')

  const db = getServiceClient()
  const { data: pin, error } = await db
    .from('links')
    .select('*')
    .eq('id', pinId)
    .eq('user_id', userId)
    .single()

  if (error || !pin) return { action: 'not_found', message: 'Pin not found or does not belong to this user.' }
  return { pin: filterPin(pin, settings) }
}

async function toolUpdatePin(
  userId: string, args: Record<string, unknown>, settings: ConnectorSettings
): Promise<unknown> {
  canWrite(settings)
  const pinId = args.pin_id as string
  if (!pinId) throw new Error('pin_id is required')

  const db = getServiceClient()

  // Verify pin exists and belongs to user
  const { data: existing, error: fetchErr } = await db
    .from('links')
    .select('id')
    .eq('id', pinId)
    .eq('user_id', userId)
    .single()

  if (fetchErr || !existing) throw new Error('Pin not found or does not belong to this user.')

  // Build update payload from provided args
  const ALLOWED_FIELDS = ['title', 'description', 'notes', 'category', 'content_type', 'watched', 'read', 'tags']
  const updatePayload: Record<string, unknown> = { updated_at: new Date().toISOString() }
  const fieldsUpdated: string[] = []

  for (const field of ALLOWED_FIELDS) {
    if (args[field] !== undefined) {
      updatePayload[field] = args[field]
      fieldsUpdated.push(field)
    }
  }

  if (fieldsUpdated.length === 0) throw new Error('No fields to update. Provide at least one field (title, description, notes, category, content_type, watched, read, tags).')

  const { data: updated, error: updateErr } = await db
    .from('links')
    .update(updatePayload)
    .eq('id', pinId)
    .eq('user_id', userId)
    .select('*')
    .single()

  if (updateErr) throw new Error(`Update failed: ${updateErr.message}`)

  return {
    action: 'updated',
    pin_id: pinId,
    fields_updated: fieldsUpdated,
    pin: filterPin(updated, settings),
  }
}

async function toolDeletePin(
  userId: string, args: Record<string, unknown>, settings: ConnectorSettings
): Promise<unknown> {
  canWrite(settings)
  const pinId = args.pin_id as string
  if (!pinId) throw new Error('pin_id is required')
  if (args.confirm !== true) throw new Error('Deletion requires confirm: true. Ask the user to confirm before proceeding.')

  const db = getServiceClient()

  // Fetch pin to get title for confirmation message
  const { data: pin, error: fetchErr } = await db
    .from('links')
    .select('id, title, category')
    .eq('id', pinId)
    .eq('user_id', userId)
    .single()

  if (fetchErr || !pin) return { action: 'not_found', message: 'Pin not found.' }

  const { error: deleteErr } = await db
    .from('links')
    .delete()
    .eq('id', pinId)
    .eq('user_id', userId)

  if (deleteErr) throw new Error(`Delete failed: ${deleteErr.message}`)

  return {
    action: 'deleted',
    pin_id: pinId,
    title: pin.title,
    category: pin.category,
    message: 'Pin permanently deleted.',
  }
}

// ---------------------------------------------------------------------------
// Board management tools
// ---------------------------------------------------------------------------

async function toolCreateBoard(
  userId: string, args: Record<string, unknown>, settings: ConnectorSettings
): Promise<unknown> {
  canWrite(settings)
  const name = args.name as string
  if (!name) throw new Error('name is required')

  const slug = slugify(name)
  if (!slug) throw new Error('Invalid board name — must contain at least one letter or number.')
  if (slug in BUILTIN_BOARDS) throw new Error(`Cannot create a board with slug "${slug}" — this is a built-in board.`)
  if (['all', 'uncategorized', 'cleanup'].includes(slug)) throw new Error(`"${slug}" is a reserved name.`)

  const metadata = await getBoardMetadata(userId)
  if (metadata[slug]) throw new Error(`Board "${slug}" already exists.`)

  // Also check if pins already use this category
  const db = getServiceClient()
  const { count } = await db
    .from('links')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', userId)
    .eq('category', slug)

  if (count && count > 0) throw new Error(`Category "${slug}" already has ${count} pins. Use update_board instead.`)

  metadata[slug] = {
    isUserBoard: true,
    displayName: name,
    prompt: (args.prompt as string) || null,
    createdAt: new Date().toISOString(),
    pinned: (args.pinned as boolean) || false,
  }

  await saveBoardMetadata(userId, metadata)

  return {
    action: 'created',
    slug,
    display_name: name,
    prompt: (args.prompt as string) || null,
    pinned: (args.pinned as boolean) || false,
    message: `Board '${name}' created with slug '${slug}'.`,
  }
}

async function toolUpdateBoard(
  userId: string, args: Record<string, unknown>, settings: ConnectorSettings
): Promise<unknown> {
  canWrite(settings)
  const board = args.board as string
  if (!board) throw new Error('board is required')

  const isBuiltin = board in BUILTIN_BOARDS
  const metadata = await getBoardMetadata(userId)
  const existing = metadata[board]

  // Verify board exists
  if (!isBuiltin && !existing) {
    const db = getServiceClient()
    const { count } = await db
      .from('links')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', userId)
      .eq('category', board)
    if (!count || count === 0) throw new Error('Board not found.')
  }

  if (isBuiltin && args.display_name) {
    throw new Error(`Cannot rename built-in board "${board}". You can update its AI routing prompt and pinned state.`)
  }

  const fieldsUpdated: string[] = []

  if (!metadata[board]) {
    metadata[board] = isBuiltin ? {} : { isUserBoard: true, createdAt: new Date().toISOString() }
  }

  if (args.display_name !== undefined) {
    metadata[board].displayName = args.display_name
    fieldsUpdated.push('display_name')
  }
  if (args.prompt !== undefined) {
    metadata[board].prompt = args.prompt
    fieldsUpdated.push('prompt')
  }
  if (args.pinned !== undefined) {
    metadata[board].pinned = args.pinned
    fieldsUpdated.push('pinned')
  }

  if (fieldsUpdated.length === 0) throw new Error('No fields to update. Provide display_name, prompt, or pinned.')

  await saveBoardMetadata(userId, metadata)

  return {
    action: 'updated',
    slug: board,
    fields_updated: fieldsUpdated,
    board: {
      slug: board,
      display_name: metadata[board].displayName || board,
      prompt: metadata[board].prompt || null,
      pinned: metadata[board].pinned || false,
      is_user_board: !isBuiltin,
    },
  }
}

async function toolDeleteBoard(
  userId: string, args: Record<string, unknown>, settings: ConnectorSettings
): Promise<unknown> {
  canWrite(settings)
  const board = args.board as string
  if (!board) throw new Error('board is required')
  if (args.confirm !== true) throw new Error('Board deletion requires confirm: true. Ask the user to confirm.')

  if (board in BUILTIN_BOARDS) throw new Error(`Cannot delete built-in board "${board}".`)

  const metadata = await getBoardMetadata(userId)
  if (!metadata[board]?.isUserBoard) {
    // Check if it exists via pins
    const db = getServiceClient()
    const { count } = await db
      .from('links')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', userId)
      .eq('category', board)
    if (!count || count === 0) throw new Error(`Board "${board}" not found.`)
  }

  const reassignTo = (args.reassign_to as string) || 'uncategorized'

  // Count and reassign pins
  const db = getServiceClient()
  const { data: affected, error: updateErr } = await db
    .from('links')
    .update({ category: reassignTo, updated_at: new Date().toISOString() })
    .eq('user_id', userId)
    .eq('category', board)
    .select('id')

  if (updateErr) throw new Error(`Failed to reassign pins: ${updateErr.message}`)
  const pinsReassigned = affected?.length || 0

  // Remove from metadata
  delete metadata[board]
  await saveBoardMetadata(userId, metadata)

  return {
    action: 'deleted',
    slug: board,
    pins_reassigned: pinsReassigned,
    reassigned_to: reassignTo,
    message: `Board '${board}' deleted. ${pinsReassigned} pin${pinsReassigned === 1 ? '' : 's'} moved to '${reassignTo}'.`,
  }
}

// ---------------------------------------------------------------------------
// Enrichment tools
// ---------------------------------------------------------------------------

async function toolReEnrichPin(
  userId: string, args: Record<string, unknown>, settings: ConnectorSettings
): Promise<unknown> {
  canWrite(settings)
  const pinId = args.pin_id as string
  if (!pinId) throw new Error('pin_id is required')

  const db = getServiceClient()
  const { data: pin, error } = await db
    .from('links')
    .select('id, url, title, description, category, content_type')
    .eq('id', pinId)
    .eq('user_id', userId)
    .single()

  if (error || !pin) throw new Error('Pin not found or does not belong to this user.')

  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  const baseUrl = Deno.env.get('SUPABASE_URL')!
  const analyzeUrl = `${baseUrl}/functions/v1/analyze-content`
  const createPinUrl = `${baseUrl}/functions/v1/create-pin`

  // Step 1: Await analyze-content (fast, ~800ms) — writes tags/entities
  try {
    const analyzeResponse = await fetch(analyzeUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${serviceKey}` },
      body: JSON.stringify({ url: pin.url, title: pin.title, description: pin.description, linkId: pin.id }),
    })
    if (analyzeResponse.ok) {
      const analysis = await analyzeResponse.json()
      const analyticsUpdate: Record<string, unknown> = { updated_at: new Date().toISOString() }
      if (analysis.content_type) analyticsUpdate.content_type = analysis.content_type
      if (analysis.type_confidence) analyticsUpdate.type_confidence = analysis.type_confidence
      if (analysis.entities) analyticsUpdate.entities = analysis.entities
      if (Array.isArray(analysis.practical_tags)) analyticsUpdate.practical_tags = analysis.practical_tags
      if (Array.isArray(analysis.taste_tags)) analyticsUpdate.taste_tags = analysis.taste_tags
      if (analysis.content_structure) analyticsUpdate.content_structure = analysis.content_structure
      await db.from('links').update(analyticsUpdate).eq('id', pin.id).eq('user_id', userId)
    }
  } catch (e) {
    console.error('[mcp-server] analyze-content re-enrich failed:', e)
  }

  // Step 2: Fire-and-forget create-pin for image/media refresh
  const cat = pin.category as string
  fetch(createPinUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${serviceKey}` },
    body: JSON.stringify({
      url: pin.url,
      linkId: pin.id,
      forceRefresh: (args.force_image as boolean) || false,
      content_type: pin.content_type || null,
      category: cat || null,
      enrichWatch: cat === 'watch',
      enrichBook: cat === 'read',
      enrichListen: cat === 'listen',
      enrichRecipe: cat === 'eat',
    }),
  }).catch(e => console.error('[mcp-server] create-pin re-enrich failed:', e))

  return {
    action: 'enrich_triggered',
    pin_id: pin.id,
    url: pin.url,
    message: 'Re-enrichment triggered. Tags updated. Image and media metadata will refresh within ~30 seconds.',
  }
}

async function toolBatchReEnrich(
  userId: string, args: Record<string, unknown>, settings: ConnectorSettings
): Promise<unknown> {
  canWrite(settings)

  const maxLimit = 50
  // deno-lint-ignore no-explicit-any
  const extraFilters = (q: any) => {
    if (args.missing_tags) q = q.or('taste_tags.is.null,taste_tags.eq.{}')
    if (args.missing_image) q = q.is('image', null)
    return q
  }

  const limit = Math.min((args.limit as number) || 20, maxLimit)
  const db = getServiceClient()
  // deno-lint-ignore no-explicit-any
  let query: any = db.from('links').select('id, url, title, description, category, content_type').eq('user_id', userId)
  if (args.pin_ids && Array.isArray(args.pin_ids)) {
    query = query.in('id', (args.pin_ids as string[]).slice(0, maxLimit))
  } else {
    if (args.board) query = query.eq('category', args.board as string)
    if (args.missing_tags) query = query.or('taste_tags.is.null,taste_tags.eq.{}')
    if (args.missing_image) query = query.is('image', null)
    query = query.limit(limit)
  }

  const { data: pins, error } = await query
  if (error) throw new Error(`Failed to fetch pins for re-enrichment: ${error.message}`)
  if (!pins || pins.length === 0) return { action: 'enrich_triggered', pins_queued: 0, message: 'No pins matched the filter.' }

  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  const baseUrl = Deno.env.get('SUPABASE_URL')!
  const createPinUrl = `${baseUrl}/functions/v1/create-pin`

  // Fire-and-forget create-pin for each (handles image + media enrichment)
  for (const pin of pins) {
    const cat = pin.category as string
    fetch(createPinUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${serviceKey}` },
      body: JSON.stringify({
        url: pin.url,
        linkId: pin.id,
        forceRefresh: true,
        content_type: pin.content_type || null,
        category: cat || null,
        enrichWatch: cat === 'watch',
        enrichBook: cat === 'read',
        enrichListen: cat === 'listen',
        enrichRecipe: cat === 'eat',
      }),
    }).catch(e => console.error('[mcp-server] batch re-enrich failed for', pin.id, e))
  }

  const filterUsed: Record<string, unknown> = {}
  if (args.board) filterUsed.board = args.board
  if (args.missing_tags) filterUsed.missing_tags = true
  if (args.missing_image) filterUsed.missing_image = true

  return {
    action: 'enrich_triggered',
    pins_queued: pins.length,
    filter_used: filterUsed,
    message: `Re-enrichment triggered for ${pins.length} pin${pins.length === 1 ? '' : 's'}. Results will appear within a few minutes.`,
  }
}

// ---------------------------------------------------------------------------
// Batch operation tools
// ---------------------------------------------------------------------------

async function toolBatchMovePins(
  userId: string, args: Record<string, unknown>, settings: ConnectorSettings
): Promise<unknown> {
  canWrite(settings)
  const toBoard = args.to_board as string
  if (!toBoard) throw new Error('to_board is required')

  const pinIds = await resolvePinIds(userId, args, 500)
  if (pinIds.length === 0) return { action: 'moved', pins_moved: 0, message: 'No pins matched the criteria.' }

  const db = getServiceClient()
  const { data: updated, error } = await db
    .from('links')
    .update({ category: toBoard, updated_at: new Date().toISOString() })
    .eq('user_id', userId)
    .in('id', pinIds)
    .select('id')

  if (error) throw new Error(`Batch move failed: ${error.message}`)
  const moved = updated?.length || 0

  return {
    action: 'moved',
    pins_moved: moved,
    pins_not_found: pinIds.length - moved,
    to_board: toBoard,
    message: `${moved} pin${moved === 1 ? '' : 's'} moved to '${toBoard}'.${pinIds.length - moved > 0 ? ` ${pinIds.length - moved} not found.` : ''}`,
  }
}

async function toolBatchTagPins(
  userId: string, args: Record<string, unknown>, settings: ConnectorSettings
): Promise<unknown> {
  canWrite(settings)
  const addTags = (args.add_tags as string[]) || []
  const removeTags = (args.remove_tags as string[]) || []
  if (addTags.length === 0 && removeTags.length === 0) throw new Error('Provide at least add_tags or remove_tags.')

  const pinIds = await resolvePinIds(userId, args, 500)
  if (pinIds.length === 0) return { action: 'tagged', pins_updated: 0, message: 'No pins matched the criteria.' }

  const db = getServiceClient()

  // Try RPC first (atomic), fall back to fetch-and-update
  try {
    const { data: count, error } = await db.rpc('append_tags_to_pins', {
      p_user_id: userId,
      p_pin_ids: pinIds,
      p_add_tags: addTags.length > 0 ? addTags : null,
      p_remove_tags: removeTags.length > 0 ? removeTags : null,
    })
    if (error) throw error
    return {
      action: 'tagged',
      pins_updated: count || pinIds.length,
      tags_added: addTags,
      tags_removed: removeTags,
      message: `Updated tags on ${count || pinIds.length} pin${(count || pinIds.length) === 1 ? '' : 's'}.`,
    }
  } catch {
    // Fallback: fetch pins, compute tags in TypeScript, update individually
    const { data: pins, error: fetchErr } = await db
      .from('links')
      .select('id, tags')
      .eq('user_id', userId)
      .in('id', pinIds)

    if (fetchErr) throw new Error(`Failed to fetch pins: ${fetchErr.message}`)

    let updated = 0
    for (const pin of (pins || [])) {
      const currentTags: string[] = Array.isArray(pin.tags) ? pin.tags : []
      let newTags = [...new Set([...currentTags, ...addTags])]
      if (removeTags.length > 0) {
        const removeSet = new Set(removeTags)
        newTags = newTags.filter(t => !removeSet.has(t))
      }
      await db.from('links').update({ tags: newTags, updated_at: new Date().toISOString() }).eq('id', pin.id).eq('user_id', userId)
      updated++
    }

    return {
      action: 'tagged',
      pins_updated: updated,
      tags_added: addTags,
      tags_removed: removeTags,
      message: `Updated tags on ${updated} pin${updated === 1 ? '' : 's'}.`,
    }
  }
}

async function toolBatchUpdatePins(
  userId: string, args: Record<string, unknown>, settings: ConnectorSettings
): Promise<unknown> {
  canWrite(settings)
  const field = args.field as string
  const value = args.value

  const ALLOWED = ['watched', 'read', 'notes', 'content_type', 'category']
  if (!ALLOWED.includes(field)) throw new Error(`Field must be one of: ${ALLOWED.join(', ')}`)

  const pinIds = await resolvePinIds(userId, args, 500)
  if (pinIds.length === 0) return { action: 'updated', pins_updated: 0, message: 'No pins matched the criteria.' }

  const db = getServiceClient()
  const { data: updated, error } = await db
    .from('links')
    .update({ [field]: value, updated_at: new Date().toISOString() })
    .eq('user_id', userId)
    .in('id', pinIds)
    .select('id')

  if (error) throw new Error(`Batch update failed: ${error.message}`)
  const count = updated?.length || 0

  return {
    action: 'updated',
    pins_updated: count,
    field,
    value,
    message: `Updated '${field}' on ${count} pin${count === 1 ? '' : 's'}.`,
  }
}

// ---------------------------------------------------------------------------
// Connector context
// ---------------------------------------------------------------------------

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
      editing: 'Use get_pin to fetch full details, then update_pin to change fields. For bulk changes, use batch_update_pins with pin_ids, board filter, or no scope for entire library.',
      board_management: 'Use get_boards_list to see all boards, then create_board/update_board/delete_board. Built-in boards (home, wear, watch, listen, use, eat, go, follow, read) can be updated but not created or deleted.',
      bulk_operations: 'batch_move_pins, batch_tag_pins, and batch_update_pins all support three scoping modes: pin_ids (explicit list), board (all pins in a board), or no scope (entire library, up to limit). Always confirm with the user before large batch operations.',
      enrichment: 're_enrich_pin refreshes AI analysis (tags, entities, content type) and images for a single pin. batch_re_enrich does the same in bulk — filter by missing_tags or missing_image to target pins that need it most.',
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
            result = await toolSavePin(userId, toolArgs, settings)
            resultCount = 1
            break
          case 'get_pin':
            result = await toolGetPin(userId, toolArgs, settings)
            resultCount = result ? 1 : 0
            break
          case 'update_pin':
            result = await toolUpdatePin(userId, toolArgs, settings)
            resultCount = 1
            break
          case 'delete_pin':
            result = await toolDeletePin(userId, toolArgs, settings)
            resultCount = 1
            break
          case 'create_board':
            result = await toolCreateBoard(userId, toolArgs, settings)
            resultCount = 1
            break
          case 'update_board':
            result = await toolUpdateBoard(userId, toolArgs, settings)
            resultCount = 1
            break
          case 'delete_board':
            result = await toolDeleteBoard(userId, toolArgs, settings)
            resultCount = 1
            break
          case 're_enrich_pin':
            result = await toolReEnrichPin(userId, toolArgs, settings)
            resultCount = 1
            break
          case 'batch_re_enrich':
            result = await toolBatchReEnrich(userId, toolArgs, settings)
            resultCount = (result as Record<string, unknown>).enriched as number || 0
            break
          case 'batch_move_pins':
            result = await toolBatchMovePins(userId, toolArgs, settings)
            resultCount = (result as Record<string, unknown>).moved as number || 0
            break
          case 'batch_tag_pins':
            result = await toolBatchTagPins(userId, toolArgs, settings)
            resultCount = (result as Record<string, unknown>).updated as number || 0
            break
          case 'batch_update_pins':
            result = await toolBatchUpdatePins(userId, toolArgs, settings)
            resultCount = (result as Record<string, unknown>).updated as number || 0
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

  // GET: OAuth Protected Resource Metadata (RFC 9728)
  if (req.method === 'GET') {
    const url = new URL(req.url)
    const path = url.pathname.replace(/^\/?(?:functions\/v1\/)?mcp-server/, '')
    if (path === '/.well-known/oauth-protected-resource' || path === '') {
      return json({
        resource: MCP_SERVER_BASE,
        authorization_servers: [OAUTH_SERVER_BASE],
        bearer_methods_supported: ['header'],
        scopes_supported: ['read', 'write'],
      })
    }
    return json(jsonRpcError(null, -32600, 'Not found'), 404)
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
        headers: {
          ...corsHeaders,
          'WWW-Authenticate': `Bearer resource_metadata="${MCP_SERVER_BASE}/.well-known/oauth-protected-resource"`,
        },
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
