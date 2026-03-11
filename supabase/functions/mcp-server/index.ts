// Supabase Edge Function: mcp-server
// MCP Streamable HTTP server for the ctrl.rodeo connector.
// Thin JSON-RPC protocol layer — all business logic lives in _shared/connector-core.ts.
//
// POST /functions/v1/mcp-server → JSON-RPC request
// Authorization: Bearer <connector_access_token>

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { VERSION, PRODUCT_CONFIG, TOOL_DEFINITIONS } from './config.ts'
import type { PrivacyTier } from './config.ts'
import {
  resolveUser,
  getSettings,
  dispatchTool,
  logUsage,
  toolGetConnectorContext,
  type ConnectorSettings,
} from '../_shared/connector-core.ts'

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

function generateSessionId(): string {
  const array = new Uint8Array(16)
  crypto.getRandomValues(array)
  return Array.from(array, b => b.toString(16).padStart(2, '0')).join('')
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
      return null

    case 'tools/list':
      return jsonRpcResponse(id, { tools: TOOL_DEFINITIONS })

    case 'tools/call': {
      const toolName = params.name as string
      const toolArgs = (params.arguments || {}) as Record<string, unknown>
      const startTime = Date.now()

      try {
        const { result, resultCount } = await dispatchTool(toolName, toolArgs, userId, settings)

        logUsage(userId, toolName, toolArgs, resultCount, settings.privacy_tier, sessionId, startTime, 'mcp')

        return jsonRpcResponse(id, {
          content: [{ type: 'text', text: JSON.stringify(result) }],
        })
      } catch (e) {
        const error = (e as Error).message
        logUsage(userId, toolName, toolArgs, 0, settings.privacy_tier, sessionId, startTime, 'mcp', error)

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
    const user = await resolveUser(req.headers.get('authorization'))
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
