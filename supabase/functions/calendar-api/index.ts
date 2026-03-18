// Supabase Edge Function: calendar-api
// Google Calendar integration for the scheduling page.
// Handles OAuth connect, free/busy lookup, and event creation.
//
// POST /functions/v1/calendar-api
// Body: { action, ... }
// Actions: auth-url, connect, free-busy, book

const VERSION = '1.0.0'
console.log(`[calendar-api] v${VERSION} - google calendar integration`)

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const GOOGLE_CLIENT_ID = Deno.env.get('GOOGLE_CALENDAR_CLIENT_ID')!
const GOOGLE_CLIENT_SECRET = Deno.env.get('GOOGLE_CALENDAR_CLIENT_SECRET')!
const GOOGLE_REDIRECT_URI = Deno.env.get('GOOGLE_CALENDAR_REDIRECT_URI') || 'https://ctrl.rodeo/calendar/'

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

function getServiceClient() {
  return createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  )
}

async function getUserId(req: Request): Promise<string | null> {
  const authHeader = req.headers.get('authorization')
  if (!authHeader) return null

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_ANON_KEY')!,
    { global: { headers: { Authorization: authHeader } } }
  )

  const { data: { user } } = await supabase.auth.getUser()
  return user?.id ?? null
}

// Exchange refresh token for a fresh access token
async function getAccessToken(db: ReturnType<typeof createClient>, userId: string): Promise<string | null> {
  const { data: token } = await db.from('calendar_tokens')
    .select('google_refresh_token, google_access_token, token_expires_at')
    .eq('user_id', userId)
    .single()

  if (!token) return null

  // If access token is still valid (with 5 min buffer)
  if (token.google_access_token && token.token_expires_at) {
    const expires = new Date(token.token_expires_at)
    if (expires.getTime() > Date.now() + 5 * 60 * 1000) {
      return token.google_access_token
    }
  }

  // Refresh the token
  const resp = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: GOOGLE_CLIENT_ID,
      client_secret: GOOGLE_CLIENT_SECRET,
      refresh_token: token.google_refresh_token,
      grant_type: 'refresh_token',
    }),
  })

  if (!resp.ok) {
    console.error('[calendar-api] Token refresh failed:', await resp.text())
    return null
  }

  const data = await resp.json()
  const expiresAt = new Date(Date.now() + data.expires_in * 1000).toISOString()

  await db.from('calendar_tokens')
    .update({
      google_access_token: data.access_token,
      token_expires_at: expiresAt,
      updated_at: new Date().toISOString(),
    })
    .eq('user_id', userId)

  return data.access_token
}

// Get calendar IDs configured for the user
async function getCalendarIds(db: ReturnType<typeof createClient>, userId: string): Promise<string[]> {
  const { data } = await db.from('calendar_tokens')
    .select('calendar_ids')
    .eq('user_id', userId)
    .single()

  return data?.calendar_ids || ['primary']
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const body = await req.json()
    const { action } = body

    if (!action) {
      return json({ error: 'action is required' }, 400)
    }

    const db = getServiceClient()

    // ── auth-url: generate Google OAuth URL ──
    if (action === 'auth-url') {
      const userId = await getUserId(req)
      if (!userId) return json({ error: 'Unauthorized' }, 401)

      const params = new URLSearchParams({
        client_id: GOOGLE_CLIENT_ID,
        redirect_uri: GOOGLE_REDIRECT_URI,
        response_type: 'code',
        scope: 'https://www.googleapis.com/auth/calendar.readonly https://www.googleapis.com/auth/calendar.events',
        access_type: 'offline',
        prompt: 'consent',
        state: userId,
      })

      return json({ url: `https://accounts.google.com/o/oauth2/v2/auth?${params}` })
    }

    // ── connect: exchange OAuth code for tokens ──
    if (action === 'connect') {
      const userId = await getUserId(req)
      if (!userId) return json({ error: 'Unauthorized' }, 401)

      const { code } = body
      if (!code) return json({ error: 'code is required' }, 400)

      const resp = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          client_id: GOOGLE_CLIENT_ID,
          client_secret: GOOGLE_CLIENT_SECRET,
          code,
          grant_type: 'authorization_code',
          redirect_uri: GOOGLE_REDIRECT_URI,
        }),
      })

      if (!resp.ok) {
        const error = await resp.text()
        console.error('[calendar-api] OAuth exchange failed:', error)
        return json({ error: 'OAuth exchange failed' }, 400)
      }

      const tokens = await resp.json()
      const expiresAt = new Date(Date.now() + tokens.expires_in * 1000).toISOString()

      // Fetch user's calendars to show which to use
      const calendarsResp = await fetch('https://www.googleapis.com/calendar/v3/users/me/calendarList', {
        headers: { Authorization: `Bearer ${tokens.access_token}` },
      })
      const calendarsData = calendarsResp.ok ? await calendarsResp.json() : { items: [] }
      const calendars = (calendarsData.items || []).map((c: { id: string; summary: string; primary?: boolean }) => ({
        id: c.id,
        name: c.summary,
        primary: c.primary || false,
      }))

      // Upsert token
      await db.from('calendar_tokens').upsert({
        user_id: userId,
        google_refresh_token: tokens.refresh_token,
        google_access_token: tokens.access_token,
        token_expires_at: expiresAt,
        calendar_ids: ['primary'],
        updated_at: new Date().toISOString(),
      }, { onConflict: 'user_id' })

      return json({ connected: true, calendars })
    }

    // ── status: check if Google Calendar is connected ──
    if (action === 'status') {
      const userId = await getUserId(req)
      if (!userId) return json({ error: 'Unauthorized' }, 401)

      const { data: token } = await db.from('calendar_tokens')
        .select('calendar_ids, updated_at')
        .eq('user_id', userId)
        .single()

      return json({ connected: !!token, calendarIds: token?.calendar_ids || [] })
    }

    // ── update-calendars: set which calendars to check ──
    if (action === 'update-calendars') {
      const userId = await getUserId(req)
      if (!userId) return json({ error: 'Unauthorized' }, 401)

      const { calendarIds } = body
      if (!calendarIds) return json({ error: 'calendarIds is required' }, 400)

      await db.from('calendar_tokens')
        .update({ calendar_ids: calendarIds, updated_at: new Date().toISOString() })
        .eq('user_id', userId)

      return json({ updated: true })
    }

    // ── free-busy: check availability ──
    if (action === 'free-busy') {
      const { ownerUserId, timeMin, timeMax } = body

      if (!ownerUserId || !timeMin || !timeMax) {
        return json({ error: 'ownerUserId, timeMin, timeMax are required' }, 400)
      }

      const accessToken = await getAccessToken(db, ownerUserId)
      if (!accessToken) {
        return json({ error: 'Google Calendar not connected' }, 400)
      }

      const calendarIds = await getCalendarIds(db, ownerUserId)

      const resp = await fetch('https://www.googleapis.com/calendar/v3/freeBusy', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          timeMin,
          timeMax,
          items: calendarIds.map(id => ({ id })),
        }),
      })

      if (!resp.ok) {
        console.error('[calendar-api] FreeBusy error:', await resp.text())
        return json({ error: 'Failed to fetch availability' }, 500)
      }

      const data = await resp.json()

      // Flatten all busy periods across calendars
      const busyPeriods: Array<{ start: string; end: string }> = []
      for (const calId of calendarIds) {
        const cal = data.calendars?.[calId]
        if (cal?.busy) {
          busyPeriods.push(...cal.busy)
        }
      }

      return json({ busy: busyPeriods })
    }

    // ── book: create a calendar event ──
    if (action === 'book') {
      const { ownerUserId, summary, description, startTime, endTime, timezone, attendeeEmail, attendeeName } = body

      if (!ownerUserId || !summary || !startTime || !endTime || !timezone) {
        return json({ error: 'ownerUserId, summary, startTime, endTime, timezone are required' }, 400)
      }

      const accessToken = await getAccessToken(db, ownerUserId)
      if (!accessToken) {
        return json({ error: 'Google Calendar not connected' }, 400)
      }

      const event: Record<string, unknown> = {
        summary,
        description: description || '',
        start: { dateTime: startTime, timeZone: timezone },
        end: { dateTime: endTime, timeZone: timezone },
      }

      if (attendeeEmail) {
        event.attendees = [
          { email: attendeeEmail, displayName: attendeeName || attendeeEmail },
        ]
      }

      const resp = await fetch('https://www.googleapis.com/calendar/v3/calendars/primary/events', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(event),
      })

      if (!resp.ok) {
        const error = await resp.text()
        console.error('[calendar-api] Create event error:', error)
        return json({ error: 'Failed to create event' }, 500)
      }

      const created = await resp.json()
      return json({
        booked: true,
        eventId: created.id,
        htmlLink: created.htmlLink,
      })
    }

    return json({ error: `Unknown action: ${action}` }, 400)

  } catch (error) {
    console.error('[calendar-api] Error:', error.message)
    return json({ error: error.message }, 500)
  }
})
