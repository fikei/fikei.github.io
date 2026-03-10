// Supabase Edge Function: mcp-oauth
// OAuth 2.1 Authorization Server for the MCP Connector.
// Handles: metadata discovery, dynamic client registration,
// authorization, token exchange, and token refresh.
//
// Endpoints:
//   GET  /.well-known/oauth-authorization-server → metadata
//   POST /register                               → dynamic client registration
//   GET  /authorize                              → redirect to consent page
//   POST /token                                  → code exchange / refresh

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const VERSION = '0.1.1'
console.log(`[mcp-oauth] v${VERSION} - MCP OAuth 2.1 authorization server`)

const BASE_URL = 'https://yfhudwakpgzswiylhfbh.supabase.co/functions/v1/mcp-oauth'
const CONSENT_URL = 'https://ctrl.rodeo/connect/'

const ALLOWED_REDIRECT_URIS = [
  'http://localhost:6274/oauth/callback',
  'http://localhost:6274/oauth/callback/debug',
  'https://claude.ai/api/mcp/auth_callback',
  'https://claude.com/api/mcp/auth_callback',
]

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function json(data: unknown, status = 200, extraHeaders: Record<string, string> = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...extraHeaders },
  })
}

function err(error: string, description: string, status = 400) {
  return json({ error, error_description: description }, status)
}

function getServiceClient() {
  return createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  )
}

function generateToken(bytes = 32): string {
  const array = new Uint8Array(bytes)
  crypto.getRandomValues(array)
  return Array.from(array, b => b.toString(16).padStart(2, '0')).join('')
}

async function sha256(plain: string): Promise<string> {
  const encoded = new TextEncoder().encode(plain)
  const hash = await crypto.subtle.digest('SHA-256', encoded)
  return btoa(String.fromCharCode(...new Uint8Array(hash)))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

// ---------------------------------------------------------------------------
// Metadata discovery (RFC 8414)
// ---------------------------------------------------------------------------

function handleMetadata(): Response {
  return json({
    issuer: BASE_URL,
    authorization_endpoint: `${BASE_URL}/authorize`,
    token_endpoint: `${BASE_URL}/token`,
    registration_endpoint: `${BASE_URL}/register`,
    response_types_supported: ['code'],
    grant_types_supported: ['authorization_code', 'refresh_token'],
    code_challenge_methods_supported: ['S256'],
    token_endpoint_auth_methods_supported: ['none'],
    scopes_supported: ['read', 'write'],
  })
}

// ---------------------------------------------------------------------------
// Dynamic Client Registration (RFC 7591)
// ---------------------------------------------------------------------------

async function handleRegister(req: Request): Promise<Response> {
  let body: Record<string, unknown>
  try {
    body = await req.json()
  } catch {
    return err('invalid_request', 'Invalid JSON body')
  }

  const clientName = (body.client_name as string) || 'Unknown Client'
  const redirectUris = (body.redirect_uris as string[]) || []

  // Validate redirect URIs
  for (const uri of redirectUris) {
    if (!uri.startsWith('http://localhost:') && !uri.startsWith('https://')) {
      return err('invalid_redirect_uri', `Redirect URI must be localhost or HTTPS: ${uri}`)
    }
  }

  const clientId = `mcp_${generateToken(16)}`

  const db = getServiceClient()
  const { error: insertErr } = await db.from('mcp_clients').insert({
    client_id: clientId,
    client_name: clientName,
    redirect_uris: redirectUris,
    grant_types: ['authorization_code', 'refresh_token'],
    response_types: ['code'],
    token_endpoint_auth_method: 'none',
  })

  if (insertErr) {
    console.error('[mcp-oauth] DCR insert failed:', insertErr)
    return err('server_error', 'Failed to register client', 500)
  }

  return json({
    client_id: clientId,
    client_name: clientName,
    redirect_uris: redirectUris,
    grant_types: ['authorization_code', 'refresh_token'],
    response_types: ['code'],
    token_endpoint_auth_method: 'none',
  }, 201)
}

// ---------------------------------------------------------------------------
// Authorization endpoint
// ---------------------------------------------------------------------------

function handleAuthorize(url: URL): Response {
  const clientId = url.searchParams.get('client_id')
  const redirectUri = url.searchParams.get('redirect_uri')
  const responseType = url.searchParams.get('response_type')
  const codeChallenge = url.searchParams.get('code_challenge')
  const codeChallengeMethod = url.searchParams.get('code_challenge_method') || 'S256'
  const state = url.searchParams.get('state')
  const scope = url.searchParams.get('scope') || 'read'

  if (!clientId) return err('invalid_request', 'Missing client_id')
  if (responseType !== 'code') return err('unsupported_response_type', 'Only code is supported')
  if (!redirectUri) return err('invalid_request', 'Missing redirect_uri')
  if (!codeChallenge) return err('invalid_request', 'PKCE code_challenge is required')
  if (codeChallengeMethod !== 'S256') return err('invalid_request', 'Only S256 code_challenge_method is supported')

  // Redirect to consent page with all params
  const consentParams = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    code_challenge: codeChallenge,
    code_challenge_method: codeChallengeMethod,
    scope,
    ...(state ? { state } : {}),
  })

  return new Response(null, {
    status: 302,
    headers: {
      ...corsHeaders,
      Location: `${CONSENT_URL}?${consentParams.toString()}`,
    },
  })
}

// ---------------------------------------------------------------------------
// Authorization code creation (called by consent page after user approves)
// ---------------------------------------------------------------------------

async function handleCreateCode(req: Request): Promise<Response> {
  let body: Record<string, unknown>
  try {
    body = await req.json()
  } catch {
    return err('invalid_request', 'Invalid JSON body')
  }

  const userAccessToken = req.headers.get('authorization')
  if (!userAccessToken) return err('unauthorized', 'Missing authorization header', 401)

  // Validate user via Supabase JWT
  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_ANON_KEY')!,
    { global: { headers: { Authorization: userAccessToken } } },
  )
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return err('unauthorized', 'Invalid user token', 401)

  const clientId = body.client_id as string
  const redirectUri = body.redirect_uri as string
  const codeChallenge = body.code_challenge as string
  const codeChallengeMethod = (body.code_challenge_method as string) || 'S256'
  const scope = (body.scope as string) || 'read'
  const state = body.state as string | undefined
  const privacyTier = (body.privacy_tier as string) || 'library'

  if (!clientId || !redirectUri || !codeChallenge) {
    return err('invalid_request', 'Missing required fields')
  }

  // Generate authorization code
  const code = generateToken(32)
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString() // 10 min

  const db = getServiceClient()

  // Store the code
  const { error: insertErr } = await db.from('mcp_auth_codes').insert({
    code,
    user_id: user.id,
    client_id: clientId,
    redirect_uri: redirectUri,
    code_challenge: codeChallenge,
    code_challenge_method: codeChallengeMethod,
    scopes: scope.split(' '),
    privacy_tier: privacyTier,
    expires_at: expiresAt,
  })

  if (insertErr) {
    console.error('[mcp-oauth] Code insert failed:', insertErr)
    return err('server_error', 'Failed to create authorization code', 500)
  }

  // Upsert connector settings with chosen privacy tier
  await db.from('connector_settings').upsert({
    user_id: user.id,
    privacy_tier: privacyTier,
  }, { onConflict: 'user_id' })

  // Build redirect URL
  const redirectParams = new URLSearchParams({ code })
  if (state) redirectParams.set('state', state)

  console.log(`[mcp-oauth] Auth code created for user ${user.id}, tier: ${privacyTier}`)
  return json({
    redirect_url: `${redirectUri}?${redirectParams.toString()}`,
  })
}

// ---------------------------------------------------------------------------
// Token endpoint
// ---------------------------------------------------------------------------

async function handleToken(req: Request): Promise<Response> {
  let body: URLSearchParams
  const contentType = req.headers.get('content-type') || ''

  if (contentType.includes('application/x-www-form-urlencoded')) {
    body = new URLSearchParams(await req.text())
  } else if (contentType.includes('application/json')) {
    const jsonBody = await req.json()
    body = new URLSearchParams(jsonBody as Record<string, string>)
  } else {
    return err('invalid_request', 'Content-Type must be application/x-www-form-urlencoded or application/json')
  }

  const grantType = body.get('grant_type')

  if (grantType === 'authorization_code') {
    return handleCodeExchange(body)
  } else if (grantType === 'refresh_token') {
    return handleRefresh(body)
  } else {
    return err('unsupported_grant_type', `Unsupported grant_type: ${grantType}`)
  }
}

async function handleCodeExchange(body: URLSearchParams): Promise<Response> {
  const code = body.get('code')
  const clientId = body.get('client_id')
  const redirectUri = body.get('redirect_uri')
  const codeVerifier = body.get('code_verifier')

  if (!code || !clientId || !codeVerifier) {
    return err('invalid_request', 'Missing code, client_id, or code_verifier')
  }

  const db = getServiceClient()

  // Look up the authorization code
  const { data: authCode, error: lookupErr } = await db
    .from('mcp_auth_codes')
    .select('*')
    .eq('code', code)
    .eq('used', false)
    .single()

  if (lookupErr || !authCode) {
    return err('invalid_grant', 'Invalid or expired authorization code')
  }

  // Check expiry
  if (new Date(authCode.expires_at) < new Date()) {
    await db.from('mcp_auth_codes').update({ used: true }).eq('code', code)
    return err('invalid_grant', 'Authorization code has expired')
  }

  // Verify client_id matches
  if (authCode.client_id !== clientId) {
    return err('invalid_grant', 'client_id mismatch')
  }

  // Verify redirect_uri matches
  if (redirectUri && authCode.redirect_uri !== redirectUri) {
    return err('invalid_grant', 'redirect_uri mismatch')
  }

  // Verify PKCE code_verifier → code_challenge
  const computedChallenge = await sha256(codeVerifier)
  if (computedChallenge !== authCode.code_challenge) {
    return err('invalid_grant', 'PKCE code_verifier does not match code_challenge')
  }

  // Mark code as used
  await db.from('mcp_auth_codes').update({ used: true }).eq('code', code)

  // Generate tokens
  const accessToken = generateToken(32)
  const refreshToken = generateToken(32)
  const accessExpiresAt = new Date(Date.now() + 60 * 60 * 1000).toISOString() // 1 hour
  const refreshExpiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString() // 30 days

  const { error: tokenErr } = await db.from('mcp_tokens').insert({
    user_id: authCode.user_id,
    client_id: clientId,
    access_token: accessToken,
    refresh_token: refreshToken,
    access_token_expires_at: accessExpiresAt,
    refresh_token_expires_at: refreshExpiresAt,
    scopes: authCode.scopes,
  })

  if (tokenErr) {
    console.error('[mcp-oauth] Token insert failed:', tokenErr)
    return err('server_error', 'Failed to create tokens', 500)
  }

  console.log(`[mcp-oauth] Tokens issued for user ${authCode.user_id}`)
  return json({
    access_token: accessToken,
    token_type: 'Bearer',
    expires_in: 3600,
    refresh_token: refreshToken,
    scope: authCode.scopes.join(' '),
  })
}

async function handleRefresh(body: URLSearchParams): Promise<Response> {
  const refreshToken = body.get('refresh_token')
  const clientId = body.get('client_id')

  if (!refreshToken) return err('invalid_request', 'Missing refresh_token')

  const db = getServiceClient()

  // Look up refresh token
  const { data: existing, error: lookupErr } = await db
    .from('mcp_tokens')
    .select('*')
    .eq('refresh_token', refreshToken)
    .single()

  if (lookupErr || !existing) {
    return err('invalid_grant', 'Invalid refresh token')
  }

  // Check refresh token expiry
  if (existing.refresh_token_expires_at && new Date(existing.refresh_token_expires_at) < new Date()) {
    await db.from('mcp_tokens').delete().eq('id', existing.id)
    return err('invalid_grant', 'Refresh token has expired')
  }

  // Verify client_id if provided
  if (clientId && existing.client_id !== clientId) {
    return err('invalid_grant', 'client_id mismatch')
  }

  // Rotate tokens
  const newAccessToken = generateToken(32)
  const newRefreshToken = generateToken(32)
  const accessExpiresAt = new Date(Date.now() + 60 * 60 * 1000).toISOString()
  const refreshExpiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString()

  const { error: updateErr } = await db
    .from('mcp_tokens')
    .update({
      access_token: newAccessToken,
      refresh_token: newRefreshToken,
      access_token_expires_at: accessExpiresAt,
      refresh_token_expires_at: refreshExpiresAt,
    })
    .eq('id', existing.id)

  if (updateErr) {
    console.error('[mcp-oauth] Token refresh failed:', updateErr)
    return err('server_error', 'Failed to refresh tokens', 500)
  }

  console.log(`[mcp-oauth] Tokens refreshed for user ${existing.user_id}`)
  return json({
    access_token: newAccessToken,
    token_type: 'Bearer',
    expires_in: 3600,
    refresh_token: newRefreshToken,
    scope: existing.scopes.join(' '),
  })
}

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders })
  }

  const url = new URL(req.url)
  const path = url.pathname.replace(/^\/?(?:functions\/v1\/)?mcp-oauth/, '')

  try {
    // Metadata discovery
    if (path === '/.well-known/oauth-authorization-server' || path === '/metadata') {
      return handleMetadata()
    }

    // Dynamic Client Registration
    if (path === '/register' && req.method === 'POST') {
      return await handleRegister(req)
    }

    // Authorization
    if (path === '/authorize' && req.method === 'GET') {
      return handleAuthorize(url)
    }

    // Authorization code creation (from consent page)
    if (path === '/code' && req.method === 'POST') {
      return await handleCreateCode(req)
    }

    // Token exchange / refresh
    if (path === '/token' && req.method === 'POST') {
      return await handleToken(req)
    }

    return err('not_found', `Unknown endpoint: ${req.method} ${path}`, 404)
  } catch (e) {
    console.error('[mcp-oauth] Unhandled error:', e)
    return err('server_error', 'Internal server error', 500)
  }
})
