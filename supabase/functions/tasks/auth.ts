import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2'
import type { TasksRequest, TasksResponse, GoogleTokens } from './types.ts'

const GOOGLE_AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth'
const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token'
const SCOPES = [
  'https://www.googleapis.com/auth/gmail.readonly',
  'https://www.googleapis.com/auth/tasks',
  'https://www.googleapis.com/auth/userinfo.email',
].join(' ')

function getGoogleCredentials() {
  const clientId = Deno.env.get('GOOGLE_CLIENT_ID')
  const clientSecret = Deno.env.get('GOOGLE_CLIENT_SECRET')
  const redirectUri = Deno.env.get('GOOGLE_REDIRECT_URI')
  if (!clientId || !clientSecret || !redirectUri) {
    throw new Error('Google OAuth credentials not configured')
  }
  return { clientId, clientSecret, redirectUri }
}

export async function handleAuth(
  supabase: SupabaseClient,
  request: TasksRequest
): Promise<TasksResponse> {
  switch (request.action) {
    case 'auth:connect':
      return authConnect()
    case 'auth:callback':
      return authCallback(supabase, request)
    case 'auth:refresh':
      return authRefresh(supabase, request)
    case 'auth:disconnect':
      return authDisconnect(supabase, request)
    default:
      return { success: false, error: `Unknown auth action: ${request.action}` }
  }
}

// Generate Google OAuth consent URL
function authConnect(): TasksResponse {
  const { clientId, redirectUri } = getGoogleCredentials()
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: SCOPES,
    access_type: 'offline',
    prompt: 'consent',
  })
  return {
    success: true,
    data: { authUrl: `${GOOGLE_AUTH_URL}?${params.toString()}` },
  }
}

// Exchange auth code for tokens, create/update user
async function authCallback(
  supabase: SupabaseClient,
  request: TasksRequest
): Promise<TasksResponse> {
  const code = request.data?.code as string
  if (!code) {
    return { success: false, error: 'Missing authorization code' }
  }

  const { clientId, clientSecret, redirectUri } = getGoogleCredentials()

  // Exchange code for tokens
  const tokenResponse = await fetch(GOOGLE_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: redirectUri,
      grant_type: 'authorization_code',
    }),
  })

  if (!tokenResponse.ok) {
    const err = await tokenResponse.text()
    console.error('[tasks:auth] Token exchange failed:', err)
    return { success: false, error: 'Token exchange failed' }
  }

  const tokens: GoogleTokens = await tokenResponse.json()

  // Get user email from Google
  const userInfoResponse = await fetch(
    'https://www.googleapis.com/oauth2/v2/userinfo',
    { headers: { Authorization: `Bearer ${tokens.access_token}` } }
  )
  const userInfo = await userInfoResponse.json()
  const email = userInfo.email as string

  if (!email) {
    return { success: false, error: 'Could not retrieve email from Google' }
  }

  // Upsert user record
  const expiresAt = new Date(Date.now() + tokens.expires_in * 1000).toISOString()
  const { data: user, error } = await supabase
    .from('tasks_users')
    .upsert(
      {
        email,
        google_access_token: tokens.access_token,
        google_refresh_token: tokens.refresh_token || null,
        google_token_expires_at: expiresAt,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'email' }
    )
    .select()
    .single()

  if (error) {
    console.error('[tasks:auth] Upsert failed:', error)
    return { success: false, error: 'Failed to save user', details: error.message }
  }

  // Create default "Tasks" task list in Google Tasks
  const taskListId = await ensureTaskList(tokens.access_token)
  if (taskListId) {
    await supabase
      .from('tasks_users')
      .update({ task_list_id: taskListId })
      .eq('id', user.id)
  }

  console.log(`[tasks:auth] User connected: ${email}`)
  return {
    success: true,
    data: { userId: user.id, email, taskListId },
  }
}

// Refresh expired Google access token
export async function authRefresh(
  supabase: SupabaseClient,
  request: TasksRequest
): Promise<TasksResponse> {
  const userId = request.userId
  if (!userId) {
    return { success: false, error: 'Missing userId' }
  }

  const { data: user, error } = await supabase
    .from('tasks_users')
    .select('google_refresh_token')
    .eq('id', userId)
    .single()

  if (error || !user?.google_refresh_token) {
    return { success: false, error: 'No refresh token available' }
  }

  const { clientId, clientSecret } = getGoogleCredentials()
  const tokenResponse = await fetch(GOOGLE_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      refresh_token: user.google_refresh_token,
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: 'refresh_token',
    }),
  })

  if (!tokenResponse.ok) {
    return { success: false, error: 'Token refresh failed' }
  }

  const tokens: GoogleTokens = await tokenResponse.json()
  const expiresAt = new Date(Date.now() + tokens.expires_in * 1000).toISOString()

  await supabase
    .from('tasks_users')
    .update({
      google_access_token: tokens.access_token,
      google_token_expires_at: expiresAt,
      updated_at: new Date().toISOString(),
    })
    .eq('id', userId)

  return { success: true, data: { accessToken: tokens.access_token } }
}

// Disconnect Google account
async function authDisconnect(
  supabase: SupabaseClient,
  request: TasksRequest
): Promise<TasksResponse> {
  const userId = request.userId
  if (!userId) {
    return { success: false, error: 'Missing userId' }
  }

  await supabase
    .from('tasks_users')
    .update({
      google_access_token: null,
      google_refresh_token: null,
      google_token_expires_at: null,
      task_list_id: null,
      updated_at: new Date().toISOString(),
    })
    .eq('id', userId)

  return { success: true }
}

// Ensure a "Tasks by ctrl.rodeo" task list exists, return its ID
async function ensureTaskList(accessToken: string): Promise<string | null> {
  try {
    // List existing task lists
    const listResponse = await fetch(
      'https://tasks.googleapis.com/tasks/v1/users/@me/lists',
      { headers: { Authorization: `Bearer ${accessToken}` } }
    )
    const lists = await listResponse.json()
    const existing = lists.items?.find(
      (l: { title: string }) => l.title === 'Tasks by ctrl.rodeo'
    )
    if (existing) return existing.id

    // Create new list
    const createResponse = await fetch(
      'https://tasks.googleapis.com/tasks/v1/users/@me/lists',
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ title: 'Tasks by ctrl.rodeo' }),
      }
    )
    const newList = await createResponse.json()
    return newList.id || null
  } catch (err) {
    console.error('[tasks:auth] Failed to create task list:', err)
    return null
  }
}

// Helper: get valid access token for a user (refresh if expired)
export async function getValidAccessToken(
  supabase: SupabaseClient,
  userId: string
): Promise<string | null> {
  const { data: user } = await supabase
    .from('tasks_users')
    .select('google_access_token, google_token_expires_at, google_refresh_token')
    .eq('id', userId)
    .single()

  if (!user) return null

  // Check if token is still valid (with 5 min buffer)
  const expiresAt = new Date(user.google_token_expires_at).getTime()
  if (Date.now() < expiresAt - 5 * 60 * 1000) {
    return user.google_access_token
  }

  // Refresh token
  const result = await authRefresh(supabase, { action: 'auth:refresh', userId })
  if (result.success && result.data) {
    return (result.data as { accessToken: string }).accessToken
  }

  return null
}
