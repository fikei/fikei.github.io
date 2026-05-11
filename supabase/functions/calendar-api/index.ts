// Supabase Edge Function: calendar-api
// Google Calendar integration for the scheduling page.
// Handles OAuth connect, free/busy lookup, event creation,
// config management, blocking, and visitor calendar support.
//
// POST /functions/v1/calendar-api
// Body: { action, ... }

const VERSION = '1.5.0'
console.log(`[calendar-api] v${VERSION} - Phase 2.0 role-matched-events action`)

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { db as jobDb } from '../_shared/job-db.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const GOOGLE_CLIENT_ID = Deno.env.get('GOOGLE_CALENDAR_CLIENT_ID')!
const GOOGLE_CLIENT_SECRET = Deno.env.get('GOOGLE_CALENDAR_CLIENT_SECRET')!
const GOOGLE_REDIRECT_URI = Deno.env.get('GOOGLE_CALENDAR_REDIRECT_URI') || 'https://ctrl.rodeo/calendar/'

// Default profiles — used when no DB config exists yet
const DEFAULT_PROFILES = [
  {
    profile_id: 'work',
    label: 'Work',
    meeting_title: 'Intro Call',
    durations: [15, 30, 60],
    schedule: {
      1: [{ start: '09:00', end: '17:00' }],
      2: [{ start: '09:00', end: '17:00' }],
      3: [{ start: '09:00', end: '17:00' }],
      4: [{ start: '09:00', end: '17:00' }],
      5: [{ start: '09:00', end: '17:00' }],
    },
    sort_order: 0,
    is_active: true,
  },
  {
    profile_id: 'social',
    label: 'Social',
    meeting_title: 'Hangout',
    durations: [30, 60],
    schedule: {
      5: [{ start: '18:00', end: '21:00' }],
      6: [{ start: '10:00', end: '20:00' }],
      0: [{ start: '10:00', end: '18:00' }],
    },
    sort_order: 1,
    is_active: true,
  },
]

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

// Get visitor access token from visitor_calendar_tokens
async function getVisitorAccessToken(db: ReturnType<typeof createClient>, sessionToken: string): Promise<string | null> {
  const { data: token } = await db.from('visitor_calendar_tokens')
    .select('google_refresh_token, google_access_token, token_expires_at, expires_at')
    .eq('session_token', sessionToken)
    .single()

  if (!token) return null

  // Check if visitor session has expired
  if (token.expires_at && new Date(token.expires_at) < new Date()) {
    await db.from('visitor_calendar_tokens').delete().eq('session_token', sessionToken)
    return null
  }

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
    console.error('[calendar-api] Visitor token refresh failed:', await resp.text())
    return null
  }

  const data = await resp.json()
  const expiresAt = new Date(Date.now() + data.expires_in * 1000).toISOString()

  await db.from('visitor_calendar_tokens')
    .update({
      google_access_token: data.access_token,
      token_expires_at: expiresAt,
      updated_at: new Date().toISOString(),
    })
    .eq('session_token', sessionToken)

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

    // ── auth-url: generate Google OAuth URL (admin) ──
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
        state: `admin:${userId}`,
      })

      return json({ url: `https://accounts.google.com/o/oauth2/v2/auth?${params}` })
    }

    // ── connect: exchange OAuth code for tokens (admin) ──
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
        .select('calendar_ids, updated_at, singleton_profile_id')
        .eq('user_id', userId)
        .single()

      return json({
        connected: !!token,
        calendarIds: token?.calendar_ids || [],
        singletonProfileId: token?.singleton_profile_id || null,
      })
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

    // ── update-singleton: set singleton profile mode ──
    if (action === 'update-singleton') {
      const userId = await getUserId(req)
      if (!userId) return json({ error: 'Unauthorized' }, 401)

      const { singletonProfileId } = body // null to show all

      await db.from('calendar_tokens')
        .update({ singleton_profile_id: singletonProfileId || null, updated_at: new Date().toISOString() })
        .eq('user_id', userId)

      return json({ updated: true })
    }

    // ── get-config: fetch meeting type profiles ──
    if (action === 'get-config') {
      const { ownerUserId } = body
      if (!ownerUserId) return json({ error: 'ownerUserId is required' }, 400)

      const { data: rows } = await db.from('calendar_config')
        .select('profile_id, label, meeting_title, durations, schedule, sort_order, is_active')
        .eq('owner_user_id', ownerUserId)
        .eq('is_active', true)
        .order('sort_order', { ascending: true })

      // Fall back to defaults if no config exists yet
      if (!rows || rows.length === 0) {
        return json({ profiles: DEFAULT_PROFILES, isDefault: true })
      }

      return json({ profiles: rows, isDefault: false })
    }

    // ── save-config: upsert meeting type profiles (admin) ──
    if (action === 'save-config') {
      const userId = await getUserId(req)
      if (!userId) return json({ error: 'Unauthorized' }, 401)

      const { profiles } = body
      if (!profiles || !Array.isArray(profiles)) return json({ error: 'profiles array is required' }, 400)

      for (const p of profiles) {
        if (!p.profile_id || !p.label || !p.meeting_title) {
          return json({ error: 'Each profile needs profile_id, label, and meeting_title' }, 400)
        }
        if (p.label.length > 40) return json({ error: 'label max 40 chars' }, 400)
        if (p.meeting_title.length > 60) return json({ error: 'meeting_title max 60 chars' }, 400)
        if (!Array.isArray(p.durations) || p.durations.length === 0 || p.durations.length > 4) {
          return json({ error: 'durations must be 1-4 items' }, 400)
        }
        for (const d of p.durations) {
          if (d < 5 || d > 180) return json({ error: 'duration must be 5-180 min' }, 400)
        }
      }

      // Upsert each profile
      for (let i = 0; i < profiles.length; i++) {
        const p = profiles[i]
        await db.from('calendar_config').upsert({
          owner_user_id: userId,
          profile_id: p.profile_id,
          label: p.label,
          meeting_title: p.meeting_title,
          durations: p.durations,
          schedule: p.schedule || {},
          sort_order: i,
          is_active: p.is_active !== false,
          updated_at: new Date().toISOString(),
        }, { onConflict: 'owner_user_id,profile_id' })
      }

      return json({ saved: true })
    }

    // ── get-blocks: fetch manual blocks for date range ──
    if (action === 'get-blocks') {
      const { ownerUserId, dateMin, dateMax } = body
      if (!ownerUserId || !dateMin || !dateMax) {
        return json({ error: 'ownerUserId, dateMin, dateMax are required' }, 400)
      }

      const { data: blocks } = await db.from('calendar_blocks')
        .select('id, block_type, profile_id, block_date, start_time, end_time, note')
        .eq('owner_user_id', ownerUserId)
        .gte('block_date', dateMin)
        .lte('block_date', dateMax)
        .order('block_date', { ascending: true })

      return json({ blocks: blocks || [] })
    }

    // ── save-block: add a manual block (admin) ──
    if (action === 'save-block') {
      const userId = await getUserId(req)
      if (!userId) return json({ error: 'Unauthorized' }, 401)

      const { blockType, profileId, blockDate, startTime, endTime, note } = body
      if (!blockType || !blockDate) return json({ error: 'blockType and blockDate are required' }, 400)
      if (blockType !== 'time-range' && blockType !== 'full-day') {
        return json({ error: 'blockType must be time-range or full-day' }, 400)
      }
      if (blockType === 'time-range' && (!startTime || !endTime)) {
        return json({ error: 'startTime and endTime are required for time-range blocks' }, 400)
      }

      const { data: block } = await db.from('calendar_blocks').insert({
        owner_user_id: userId,
        block_type: blockType,
        profile_id: profileId || null,
        block_date: blockDate,
        start_time: blockType === 'time-range' ? startTime : null,
        end_time: blockType === 'time-range' ? endTime : null,
        note: note || null,
      }).select('id').single()

      return json({ saved: true, blockId: block?.id })
    }

    // ── delete-block: remove a manual block (admin) ──
    if (action === 'delete-block') {
      const userId = await getUserId(req)
      if (!userId) return json({ error: 'Unauthorized' }, 401)

      const { blockId } = body
      if (!blockId) return json({ error: 'blockId is required' }, 400)

      await db.from('calendar_blocks')
        .delete()
        .eq('id', blockId)
        .eq('owner_user_id', userId)

      return json({ deleted: true })
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

    // ── visitor-auth-url: generate Google OAuth URL for visitor ──
    if (action === 'visitor-auth-url') {
      const { sessionToken } = body
      if (!sessionToken) return json({ error: 'sessionToken is required' }, 400)

      const params = new URLSearchParams({
        client_id: GOOGLE_CLIENT_ID,
        redirect_uri: GOOGLE_REDIRECT_URI,
        response_type: 'code',
        scope: 'https://www.googleapis.com/auth/calendar.readonly',
        access_type: 'offline',
        prompt: 'consent',
        state: `visitor:${sessionToken}`,
      })

      return json({ url: `https://accounts.google.com/o/oauth2/v2/auth?${params}` })
    }

    // ── visitor-connect: exchange visitor OAuth code for tokens ──
    if (action === 'visitor-connect') {
      const { code, sessionToken } = body
      if (!code || !sessionToken) return json({ error: 'code and sessionToken are required' }, 400)

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
        console.error('[calendar-api] Visitor OAuth exchange failed:', error)
        return json({ error: 'OAuth exchange failed' }, 400)
      }

      const tokens = await resp.json()
      const expiresAt = new Date(Date.now() + tokens.expires_in * 1000).toISOString()

      await db.from('visitor_calendar_tokens').upsert({
        session_token: sessionToken,
        google_refresh_token: tokens.refresh_token,
        google_access_token: tokens.access_token,
        token_expires_at: expiresAt,
        calendar_ids: ['primary'],
        updated_at: new Date().toISOString(),
        expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
      }, { onConflict: 'session_token' })

      return json({ connected: true })
    }

    // ── visitor-free-busy: fetch visitor's busy periods ──
    if (action === 'visitor-free-busy') {
      const { sessionToken, timeMin, timeMax } = body
      if (!sessionToken || !timeMin || !timeMax) {
        return json({ error: 'sessionToken, timeMin, timeMax are required' }, 400)
      }

      const accessToken = await getVisitorAccessToken(db, sessionToken)
      if (!accessToken) {
        return json({ error: 'Visitor Google Calendar not connected', disconnected: true }, 400)
      }

      const resp = await fetch('https://www.googleapis.com/calendar/v3/freeBusy', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          timeMin,
          timeMax,
          items: [{ id: 'primary' }],
        }),
      })

      if (!resp.ok) {
        console.error('[calendar-api] Visitor FreeBusy error:', await resp.text())
        return json({ error: 'Failed to fetch visitor availability' }, 500)
      }

      const data = await resp.json()
      const busy = data.calendars?.primary?.busy || []

      return json({ busy })
    }

    // ── visitor-events: fetch visitor's event hints ──
    if (action === 'visitor-events') {
      const { sessionToken, timeMin, timeMax } = body
      if (!sessionToken || !timeMin || !timeMax) {
        return json({ error: 'sessionToken, timeMin, timeMax are required' }, 400)
      }

      const accessToken = await getVisitorAccessToken(db, sessionToken)
      if (!accessToken) {
        return json({ error: 'Visitor Google Calendar not connected', disconnected: true }, 400)
      }

      const params = new URLSearchParams({
        timeMin,
        timeMax,
        singleEvents: 'true',
        orderBy: 'startTime',
        maxResults: '50',
      })

      const resp = await fetch(`https://www.googleapis.com/calendar/v3/calendars/primary/events?${params}`, {
        headers: { Authorization: `Bearer ${accessToken}` },
      })

      if (!resp.ok) {
        console.error('[calendar-api] Visitor events error:', await resp.text())
        return json({ error: 'Failed to fetch visitor events' }, 500)
      }

      const data = await resp.json()
      const events = (data.items || [])
        .filter((e: { start?: { dateTime?: string } }) => e.start?.dateTime)
        .map((e: { summary?: string; start: { dateTime: string }; end: { dateTime: string } }) => ({
          summary: (e.summary || 'Busy').substring(0, 20),
          start: e.start.dateTime,
          end: e.end.dateTime,
        }))

      return json({ events })
    }

    // ── admin-events: fetch admin's event hints ──
    if (action === 'admin-events') {
      const userId = await getUserId(req)
      if (!userId) return json({ error: 'Unauthorized' }, 401)

      const { timeMin, timeMax } = body
      if (!timeMin || !timeMax) return json({ error: 'timeMin, timeMax are required' }, 400)

      const accessToken = await getAccessToken(db, userId)
      if (!accessToken) return json({ error: 'Google Calendar not connected' }, 400)

      const params = new URLSearchParams({
        timeMin,
        timeMax,
        singleEvents: 'true',
        orderBy: 'startTime',
        maxResults: '50',
      })

      const resp = await fetch(`https://www.googleapis.com/calendar/v3/calendars/primary/events?${params}`, {
        headers: { Authorization: `Bearer ${accessToken}` },
      })

      if (!resp.ok) {
        console.error('[calendar-api] Admin events error:', await resp.text())
        return json({ error: 'Failed to fetch admin events' }, 500)
      }

      const data = await resp.json()
      const events = (data.items || [])
        .filter((e: { start?: { dateTime?: string } }) => e.start?.dateTime)
        .map((e: { summary?: string; start: { dateTime: string }; end: { dateTime: string } }) => ({
          summary: (e.summary || 'Busy').substring(0, 20),
          start: e.start.dateTime,
          end: e.end.dateTime,
        }))

      return json({ events })
    }

    // ── role-matched-events: 48h window matched to pipeline roles ──
    // Phase 2.0 of the application tracker. Returns events that match a
    // pipeline role by attendee email domain or title-token overlap.
    // Narrow scope: read-only, ambiguous matches → no result (silent
    // fail beats wrong chip). Caller renders a "📅 Today 10am" chip.
    if (action === 'role-matched-events') {
      const userId = await getUserId(req)
      if (!userId) return json({ error: 'Unauthorized' }, 401)

      const accessToken = await getAccessToken(db, userId)
      if (!accessToken) return json({ matches: [], disconnected: true })

      const windowHours = Math.max(1, Math.min(168, Number(body.windowHours) || 48))
      const timeMin = new Date().toISOString()
      const timeMax = new Date(Date.now() + windowHours * 60 * 60 * 1000).toISOString()

      const params = new URLSearchParams({
        timeMin,
        timeMax,
        singleEvents: 'true',
        orderBy: 'startTime',
        maxResults: '50',
      })
      const resp = await fetch(`https://www.googleapis.com/calendar/v3/calendars/primary/events?${params}`, {
        headers: { Authorization: `Bearer ${accessToken}` },
      })
      if (!resp.ok) {
        console.error('[calendar-api] role-matched-events fetch error:', await resp.text())
        return json({ matches: [] })
      }
      const data = await resp.json() as { items?: Array<{ id: string; summary?: string; start?: { dateTime?: string }; end?: { dateTime?: string }; attendees?: Array<{ email?: string }>; hangoutLink?: string; htmlLink?: string }> }

      const sql = jobDb()
      const roles = await sql<Array<{ slug: string; company_name: string; company_norm: string; title: string; hiring_domain: string | null; status: string }>>`
        select r.slug, r.company_name,
               lower(trim(r.company_name)) as company_norm,
               r.title, hc.domain as hiring_domain, r.status
          from job.pipeline_roles r
          left join job.hiring_companies hc
            on hc.name_norm = lower(trim(r.company_name))
         where r.status in ('Active', 'Saved')
           and r.deleted_at is null`

      type Match = { event_id: string; role_slug: string; company: string; title: string; summary: string; start: string; end: string; link: string | null }
      const matches: Match[] = []

      for (const ev of (data.items || [])) {
        if (!ev.start?.dateTime) continue
        const summary = (ev.summary || '').toLowerCase()
        const attendeeDomains = (ev.attendees || [])
          .map(a => (a.email || '').toLowerCase().split('@')[1])
          .filter(Boolean)

        // Step 1: attendee domain match.
        let matched = roles.find(r => r.hiring_domain && attendeeDomains.includes(r.hiring_domain.toLowerCase()))

        // Step 2: title-token / company-token in event summary.
        if (!matched) {
          const candidates = roles.filter(r => r.company_norm.length >= 3 && summary.includes(r.company_norm))
          if (candidates.length === 1) matched = candidates[0]
          else if (candidates.length > 1) {
            // Disambiguate by title-token overlap; bail if still ambiguous.
            let best: typeof candidates[number] | undefined
            let bestScore = 0
            for (const c of candidates) {
              const tokens = c.title.toLowerCase().split(/[\s\-/_]+/).filter(t => t.length >= 4)
              let hits = 0
              for (const t of tokens) if (summary.includes(t)) hits++
              if (hits > bestScore) { bestScore = hits; best = c }
            }
            if (best && bestScore >= 1) matched = best
          }
        }

        if (!matched) continue
        matches.push({
          event_id:    ev.id,
          role_slug:   matched.slug,
          company:     matched.company_name,
          title:       matched.title,
          summary:     ev.summary || '(no title)',
          start:       ev.start.dateTime,
          end:         ev.end?.dateTime || ev.start.dateTime,
          link:        ev.hangoutLink || ev.htmlLink || null,
        })
      }

      return json({ version: VERSION, matches })
    }

    return json({ error: `Unknown action: ${action}` }, 400)

  } catch (error) {
    console.error('[calendar-api] Error:', error.message)
    return json({ error: error.message }, 500)
  }
})
