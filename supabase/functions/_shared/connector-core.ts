// Shared connector core — platform-agnostic tool handlers, auth, and privacy.
// Used by both the MCP server (JSON-RPC) and the REST connector API (OpenAPI).
//
// This module contains zero protocol-specific logic. All JSON-RPC and REST
// wrapping happens in the calling edge function.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { PRODUCT_CONFIG, BUILTIN_BOARDS, PRIVACY_TIERS, type PrivacyTier } from '../mcp-server/config.ts'

// Re-export types the callers need
export type { PrivacyTier } from '../mcp-server/config.ts'
export { PRODUCT_CONFIG, BUILTIN_BOARDS, PRIVACY_TIERS } from '../mcp-server/config.ts'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ConnectorSettings {
  privacy_tier: PrivacyTier
  board_visibility: Record<string, boolean>
  field_visibility: Record<string, boolean>
}

export interface ResolvedUser {
  userId: string
  privacyTier: PrivacyTier
}

// ---------------------------------------------------------------------------
// Supabase client
// ---------------------------------------------------------------------------

export function getServiceClient() {
  return createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  )
}

// ---------------------------------------------------------------------------
// Auth: resolve Bearer token → user
// ---------------------------------------------------------------------------

export async function resolveUser(authHeader: string | null): Promise<ResolvedUser | null> {
  if (!authHeader?.startsWith('Bearer ')) return null

  const token = authHeader.slice(7)
  const db = getServiceClient()

  const { data, error } = await db
    .from('connector_tokens')
    .select('user_id, access_token_expires_at')
    .eq('access_token', token)
    .single()

  if (error || !data) return null
  if (new Date(data.access_token_expires_at) < new Date()) return null

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

export async function getSettings(userId: string): Promise<ConnectorSettings> {
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

export function filterPin(pin: Record<string, unknown>, settings: ConnectorSettings): Record<string, unknown> {
  const tier = PRIVACY_TIERS[settings.privacy_tier]
  const allowedFields = new Set(tier.allowed_fields)
  const fieldVis = settings.field_visibility

  const filtered: Record<string, unknown> = { id: pin.id, created_at: pin.created_at }

  for (const field of allowedFields) {
    if (fieldVis[field] === false) continue
    if (pin[field] !== undefined && pin[field] !== null) {
      filtered[field] = pin[field]
    }
  }

  return filtered
}

export function isBoardVisible(category: string, settings: ConnectorSettings): boolean {
  return settings.board_visibility[category] !== false
}

// ---------------------------------------------------------------------------
// Usage logging
// ---------------------------------------------------------------------------

export async function logUsage(
  userId: string,
  toolName: string,
  inputParams: unknown,
  resultCount: number,
  privacyTier: string,
  sessionId: string | null,
  startTime: number,
  platform: string,
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
    platform,
    error,
  }).then(() => {}, (e: Error) => console.error('[connector] Usage log failed:', e))
}

// ---------------------------------------------------------------------------
// Write guard
// ---------------------------------------------------------------------------

export function canWrite(settings: ConnectorSettings): void {
  if (settings.privacy_tier === 'taste_only') {
    throw new Error(
      'Write operations require at least "library" privacy tier. ' +
      'Update your settings at ctrl.rodeo/boards (gear icon) to enable writes.'
    )
  }
}

// ---------------------------------------------------------------------------
// Board metadata helpers
// ---------------------------------------------------------------------------

export async function getBoardMetadata(userId: string): Promise<Record<string, Record<string, unknown>>> {
  const db = getServiceClient()
  const { data } = await db
    .from('board_metadata')
    .select('metadata')
    .eq('user_id', userId)
    .single()
  return (data?.metadata as Record<string, Record<string, unknown>>) || {}
}

export async function saveBoardMetadata(userId: string, metadata: Record<string, Record<string, unknown>>): Promise<void> {
  const db = getServiceClient()
  const { error } = await db
    .from('board_metadata')
    .upsert({ user_id: userId, metadata, updated_at: new Date().toISOString() })
  if (error) throw new Error(`Board metadata save failed: ${error.message}`)
}

export function slugify(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
}

// ---------------------------------------------------------------------------
// Batch pin ID resolver
// ---------------------------------------------------------------------------

export async function resolvePinIds(
  userId: string,
  args: Record<string, unknown>,
  maxLimit: number,
): Promise<string[]> {
  if (args.pin_ids && Array.isArray(args.pin_ids) && (args.pin_ids as string[]).length > 0) {
    return (args.pin_ids as string[]).slice(0, maxLimit)
  }

  const db = getServiceClient()
  const limit = Math.min((args.limit as number) || 100, maxLimit)
  // deno-lint-ignore no-explicit-any
  let query: any = db.from('links').select('id').eq('user_id', userId)
  if (args.board) query = query.eq('category', args.board as string)
  if (args.missing_tags) query = query.or('taste_tags.is.null,taste_tags.eq.{}')
  if (args.missing_image) query = query.is('image', null)
  query = query.limit(limit)

  const { data, error } = await query
  if (error) throw new Error(`Failed to resolve pins: ${error.message}`)
  return (data || []).map((p: Record<string, unknown>) => p.id as string)
}

// ---------------------------------------------------------------------------
// Pin ID generation (deterministic SHA-256 → UUID)
// ---------------------------------------------------------------------------

export async function generatePinId(url: string): Promise<string> {
  const encoded = new TextEncoder().encode(url)
  const hashBuffer = await crypto.subtle.digest('SHA-256', encoded)
  const hashArray = new Uint8Array(hashBuffer)
  const hex = Array.from(hashArray.slice(0, 16), b => b.toString(16).padStart(2, '0')).join('')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`
}

// ---------------------------------------------------------------------------
// Tool implementations
// ---------------------------------------------------------------------------

export async function toolSearchPins(
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

export async function toolGetBoard(
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

export async function toolGetBoardsList(
  userId: string, settings: ConnectorSettings
): Promise<unknown> {
  const db = getServiceClient()

  const { data: pins, error } = await db
    .from('links')
    .select('category')
    .eq('user_id', userId)

  if (error) throw new Error(`Get boards failed: ${error.message}`)

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

export async function toolGetTasteProfile(
  userId: string, settings: ConnectorSettings
): Promise<unknown> {
  const db = getServiceClient()

  const { data: pins, error } = await db
    .from('links')
    .select('category, taste_tags, practical_tags, entities, content_type')
    .eq('user_id', userId)

  if (error) throw new Error(`Taste profile failed: ${error.message}`)

  const visiblePins = (pins || []).filter((p: Record<string, unknown>) =>
    isBoardVisible(p.category as string, settings)
  )

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

export async function toolGetIntentProfile(
  userId: string, _settings: ConnectorSettings
): Promise<unknown> {
  const db = getServiceClient()

  const [journeysRes, sessionsRes] = await Promise.all([
    db.from('intent_journeys')
      .select('id, topic_tags, state, hypothesis, confidence, first_pin_at, last_pin_at, pin_ids')
      .eq('user_id', userId)
      .not('state', 'in', '("done","abandoned")')
      .order('last_pin_at', { ascending: false })
      .limit(5),
    db.from('intent_sessions')
      .select('id, started_at, ended_at, category_mix, topic_tags, intent_mix, session_length_minutes, pin_ids')
      .eq('user_id', userId)
      .order('started_at', { ascending: false })
      .limit(5),
  ])

  if (journeysRes.error) throw new Error(`Intent journeys failed: ${journeysRes.error.message}`)
  if (sessionsRes.error) throw new Error(`Intent sessions failed: ${sessionsRes.error.message}`)

  const journeys = (journeysRes.data || []).map((j: Record<string, unknown>) => ({
    id: j.id,
    topic_tags: j.topic_tags,
    state: j.state,
    hypothesis: j.hypothesis,
    confidence: j.confidence,
    first_pin_at: j.first_pin_at,
    last_pin_at: j.last_pin_at,
    pin_count: (j.pin_ids as string[])?.length || 0,
  }))

  const sessions = (sessionsRes.data || []).map((s: Record<string, unknown>) => ({
    id: s.id,
    started_at: s.started_at,
    ended_at: s.ended_at,
    category_mix: s.category_mix,
    topic_tags: s.topic_tags,
    intent_mix: s.intent_mix,
    duration_minutes: s.session_length_minutes,
    pin_count: (s.pin_ids as string[])?.length || 0,
  }))

  return {
    active_journeys: journeys,
    recent_sessions: sessions,
    total_active: journeys.length,
  }
}

export async function toolGetRecentSaves(
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

export async function toolSavePin(
  userId: string, args: Record<string, unknown>, settings: ConnectorSettings
): Promise<unknown> {
  canWrite(settings)
  const url = args.url as string
  if (!url) throw new Error('url is required')

  const createPinUrl = `${Deno.env.get('SUPABASE_URL')}/functions/v1/create-pin`
  const categorizeUrl = `${Deno.env.get('SUPABASE_URL')}/functions/v1/categorize`
  const analyzeUrl = `${Deno.env.get('SUPABASE_URL')}/functions/v1/analyze-content`

  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

  const urlHash = await generatePinId(url)

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

  const pinData: Record<string, unknown> = {
    id: urlHash,
    user_id: userId,
    url,
    source: (args.source as string) || 'connector',
    notes: (args.notes as string) || null,
  }

  if (args.category) {
    pinData.category = args.category
  }

  const { error: insertErr } = await db.from('links').insert(pinData)
  if (insertErr) throw new Error(`Failed to save pin: ${insertErr.message}`)

  const enrichPromises = [
    fetch(createPinUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${serviceKey}` },
      body: JSON.stringify({ url, linkId: urlHash }),
    }).catch(e => console.error('[connector] create-pin call failed:', e)),

    fetch(analyzeUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${serviceKey}` },
      body: JSON.stringify({ url, linkId: urlHash }),
    }).catch(e => console.error('[connector] analyze-content call failed:', e)),
  ]

  if (!args.category) {
    enrichPromises.push(
      fetch(categorizeUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${serviceKey}` },
        body: JSON.stringify({ url, linkId: urlHash }),
      }).catch(e => console.error('[connector] categorize call failed:', e))
    )
  }

  Promise.allSettled(enrichPromises)

  return {
    action: 'created',
    pin: { id: urlHash, url, category: args.category || 'pending', notes: args.notes || null },
    message: 'Pin saved. It will be enriched with images, tags, and categorization shortly.',
  }
}

export async function toolGetPin(
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

export async function toolUpdatePin(
  userId: string, args: Record<string, unknown>, settings: ConnectorSettings
): Promise<unknown> {
  canWrite(settings)
  const pinId = args.pin_id as string
  if (!pinId) throw new Error('pin_id is required')

  const db = getServiceClient()

  const { data: existing, error: fetchErr } = await db
    .from('links')
    .select('id')
    .eq('id', pinId)
    .eq('user_id', userId)
    .single()

  if (fetchErr || !existing) throw new Error('Pin not found or does not belong to this user.')

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

export async function toolDeletePin(
  userId: string, args: Record<string, unknown>, settings: ConnectorSettings
): Promise<unknown> {
  canWrite(settings)
  const pinId = args.pin_id as string
  if (!pinId) throw new Error('pin_id is required')
  if (args.confirm !== true) throw new Error('Deletion requires confirm: true. Ask the user to confirm before proceeding.')

  const db = getServiceClient()

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

export async function toolCreateBoard(
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

export async function toolUpdateBoard(
  userId: string, args: Record<string, unknown>, settings: ConnectorSettings
): Promise<unknown> {
  canWrite(settings)
  const board = args.board as string
  if (!board) throw new Error('board is required')

  const isBuiltin = board in BUILTIN_BOARDS
  const metadata = await getBoardMetadata(userId)
  const existing = metadata[board]

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

export async function toolDeleteBoard(
  userId: string, args: Record<string, unknown>, settings: ConnectorSettings
): Promise<unknown> {
  canWrite(settings)
  const board = args.board as string
  if (!board) throw new Error('board is required')
  if (args.confirm !== true) throw new Error('Board deletion requires confirm: true. Ask the user to confirm.')

  if (board in BUILTIN_BOARDS) throw new Error(`Cannot delete built-in board "${board}".`)

  const metadata = await getBoardMetadata(userId)
  if (!metadata[board]?.isUserBoard) {
    const db = getServiceClient()
    const { count } = await db
      .from('links')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', userId)
      .eq('category', board)
    if (!count || count === 0) throw new Error(`Board "${board}" not found.`)
  }

  const reassignTo = (args.reassign_to as string) || 'uncategorized'

  const db = getServiceClient()
  const { data: affected, error: updateErr } = await db
    .from('links')
    .update({ category: reassignTo, updated_at: new Date().toISOString() })
    .eq('user_id', userId)
    .eq('category', board)
    .select('id')

  if (updateErr) throw new Error(`Failed to reassign pins: ${updateErr.message}`)
  const pinsReassigned = affected?.length || 0

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

export async function toolReEnrichPin(
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
    console.error('[connector] analyze-content re-enrich failed:', e)
  }

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
  }).catch(e => console.error('[connector] create-pin re-enrich failed:', e))

  return {
    action: 'enrich_triggered',
    pin_id: pin.id,
    url: pin.url,
    message: 'Re-enrichment triggered. Tags updated. Image and media metadata will refresh within ~30 seconds.',
  }
}

export async function toolBatchReEnrich(
  userId: string, args: Record<string, unknown>, settings: ConnectorSettings
): Promise<unknown> {
  canWrite(settings)

  const maxLimit = 50
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
    }).catch(e => console.error('[connector] batch re-enrich failed for', pin.id, e))
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

export async function toolBatchMovePins(
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

export async function toolBatchTagPins(
  userId: string, args: Record<string, unknown>, settings: ConnectorSettings
): Promise<unknown> {
  canWrite(settings)
  const addTags = (args.add_tags as string[]) || []
  const removeTags = (args.remove_tags as string[]) || []
  if (addTags.length === 0 && removeTags.length === 0) throw new Error('Provide at least add_tags or remove_tags.')

  const pinIds = await resolvePinIds(userId, args, 500)
  if (pinIds.length === 0) return { action: 'tagged', pins_updated: 0, message: 'No pins matched the criteria.' }

  const db = getServiceClient()

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

export async function toolBatchUpdatePins(
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

export function toolGetConnectorContext(settings: ConnectorSettings): unknown {
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
      auto_capture: 'When the user expresses a clear choice signal ("I\'ll get that", "that\'s the one", "perfect"), proactively call save_pin with source "auto" and conversation context as notes.',
      editing: 'Use get_pin to fetch full details, then update_pin to change fields. For bulk changes, use batch_update_pins with pin_ids, board filter, or no scope for entire library.',
      board_management: 'Use get_boards_list to see all boards, then create_board/update_board/delete_board. Built-in boards (home, wear, watch, listen, use, eat, go, follow, read) can be updated but not created or deleted.',
      bulk_operations: 'batch_move_pins, batch_tag_pins, and batch_update_pins all support three scoping modes: pin_ids (explicit list), board (all pins in a board), or no scope (entire library, up to limit). Always confirm with the user before large batch operations.',
      enrichment: 're_enrich_pin refreshes AI analysis (tags, entities, content type) and images for a single pin. batch_re_enrich does the same in bulk — filter by missing_tags or missing_image to target pins that need it most.',
    },
  }
}

// ---------------------------------------------------------------------------
// Tool dispatcher — maps tool name → handler, used by both MCP and REST
// ---------------------------------------------------------------------------

export async function dispatchTool(
  toolName: string,
  args: Record<string, unknown>,
  userId: string,
  settings: ConnectorSettings,
): Promise<{ result: unknown, resultCount: number }> {
  let result: unknown
  let resultCount = 0

  switch (toolName) {
    case 'search_pins':
      result = await toolSearchPins(userId, args, settings)
      resultCount = ((result as Record<string, unknown>).total as number) || 0
      break
    case 'get_board':
      result = await toolGetBoard(userId, args, settings)
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
    case 'get_intent_profile':
      result = await toolGetIntentProfile(userId, settings)
      resultCount = (result as Record<string, unknown>).total_active as number || 0
      break
    case 'get_recent_saves':
      result = await toolGetRecentSaves(userId, args, settings)
      resultCount = ((result as Record<string, unknown>).total as number) || 0
      break
    case 'save_pin':
      result = await toolSavePin(userId, args, settings)
      resultCount = 1
      break
    case 'get_pin':
      result = await toolGetPin(userId, args, settings)
      resultCount = result ? 1 : 0
      break
    case 'update_pin':
      result = await toolUpdatePin(userId, args, settings)
      resultCount = 1
      break
    case 'delete_pin':
      result = await toolDeletePin(userId, args, settings)
      resultCount = 1
      break
    case 'create_board':
      result = await toolCreateBoard(userId, args, settings)
      resultCount = 1
      break
    case 'update_board':
      result = await toolUpdateBoard(userId, args, settings)
      resultCount = 1
      break
    case 'delete_board':
      result = await toolDeleteBoard(userId, args, settings)
      resultCount = 1
      break
    case 're_enrich_pin':
      result = await toolReEnrichPin(userId, args, settings)
      resultCount = 1
      break
    case 'batch_re_enrich':
      result = await toolBatchReEnrich(userId, args, settings)
      resultCount = (result as Record<string, unknown>).pins_queued as number || 0
      break
    case 'batch_move_pins':
      result = await toolBatchMovePins(userId, args, settings)
      resultCount = (result as Record<string, unknown>).pins_moved as number || 0
      break
    case 'batch_tag_pins':
      result = await toolBatchTagPins(userId, args, settings)
      resultCount = (result as Record<string, unknown>).pins_updated as number || 0
      break
    case 'batch_update_pins':
      result = await toolBatchUpdatePins(userId, args, settings)
      resultCount = (result as Record<string, unknown>).pins_updated as number || 0
      break
    case 'get_connector_context':
      result = toolGetConnectorContext(settings)
      resultCount = 1
      break
    default:
      throw new Error(`Unknown tool: ${toolName}`)
  }

  return { result, resultCount }
}
