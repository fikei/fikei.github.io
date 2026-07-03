// Supabase Edge Function: gcal-sync
// Mirrors a user's bookmarked ("interested") events and Agape-recommended events
// into a dedicated "ctrl.events" Google Calendar.
//
// Ported from the trainingplans repo Google Calendar integration:
// - OAuth code exchange + refresh-token flow (offline access, prompt=consent)
// - Dedicated calendar created idempotently (verify stored id, recreate on 404)
// - Dedupe via extendedProperties.private.eventKey (linear scan of the calendar)
// - Color coding: bookmarked = Peacock (7), Agape = Grape (3)
//
// POST /functions/v1/gcal-sync   (Authorization: Bearer <user JWT>)
// Body: { action: 'connect-url' | 'exchange' | 'status' | 'settings' | 'sync' | 'disconnect', ... }

const VERSION = '1.0.1'
console.log(`[gcal-sync] v${VERSION} — ctrl.events Google Calendar sync (bookmarked + agape)`)

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}
const jsonHeaders = { ...corsHeaders, 'Content-Type': 'application/json' }

const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth'
const TOKEN_URL = 'https://oauth2.googleapis.com/token'
const CALENDAR_API = 'https://www.googleapis.com/calendar/v3'
// Broad scope required to create a dedicated calendar (calendars.insert)
const SCOPES = 'https://www.googleapis.com/auth/calendar'

const CALENDAR_NAME = 'ctrl.events'
const COLOR_BOOKMARKED = '7' // Peacock blue
const COLOR_AGAPE = '3'      // Grape purple
const DEFAULT_DURATION_MIN = 180

function getSupabase() {
  const url = Deno.env.get('SUPABASE_URL')!
  const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  return createClient(url, key)
}

// Reuses the OAuth client already configured for the /calendar app
// (same Google Cloud project; ctrl.rodeo/events/ must be an authorized redirect URI)
function googleClientId(): string {
  return Deno.env.get('GOOGLE_CALENDAR_CLIENT_ID') || ''
}
function googleClientSecret(): string {
  return Deno.env.get('GOOGLE_CALENDAR_CLIENT_SECRET') || ''
}

// --- Auth: resolve the calling user from their JWT ---
async function getUser(req: Request) {
  const authHeader = req.headers.get('Authorization') || ''
  const token = authHeader.replace(/^Bearer\s+/i, '')
  if (!token) return null
  const db = getSupabase()
  const { data, error } = await db.auth.getUser(token)
  if (error || !data?.user) return null
  return data.user
}

// --- Token management (per trainingplans /lib/google.ts) ---

interface SyncRow {
  user_id: string
  google_access_token: string | null
  google_refresh_token: string | null
  google_expires_at: string | null
  google_calendar_id: string | null
  sync_enabled: boolean
  sync_bookmarked: boolean
  sync_agape: boolean
  timezone: string | null
  last_synced_at: string | null
}

async function getSyncRow(userId: string): Promise<SyncRow | null> {
  const db = getSupabase()
  const { data } = await db.from('user_calendar_sync').select('*').eq('user_id', userId).maybeSingle()
  return data as SyncRow | null
}

async function exchangeCode(code: string, redirectUri: string) {
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: googleClientId(),
      client_secret: googleClientSecret(),
      code,
      grant_type: 'authorization_code',
      redirect_uri: redirectUri,
    }),
  })
  if (!res.ok) throw new Error(`Google token exchange failed: ${res.status} ${await res.text()}`)
  const d = await res.json()
  return {
    access_token: d.access_token as string,
    refresh_token: (d.refresh_token as string) || null,
    expires_at: new Date(Date.now() + (d.expires_in || 3600) * 1000).toISOString(),
  }
}

async function getValidAccessToken(row: SyncRow): Promise<string> {
  if (!row.google_refresh_token) throw new Error('GOOGLE_NOT_CONNECTED')
  const expiresAt = row.google_expires_at ? new Date(row.google_expires_at).getTime() : 0
  // Refresh preemptively if the token expires within 5 minutes
  if (row.google_access_token && expiresAt - Date.now() > 5 * 60 * 1000) {
    return row.google_access_token
  }
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: googleClientId(),
      client_secret: googleClientSecret(),
      refresh_token: row.google_refresh_token,
      grant_type: 'refresh_token',
    }),
  })
  if (!res.ok) throw new Error(`Google token refresh failed: ${res.status} ${await res.text()}`)
  const d = await res.json()
  const db = getSupabase()
  await db.from('user_calendar_sync').update({
    google_access_token: d.access_token,
    google_expires_at: new Date(Date.now() + (d.expires_in || 3600) * 1000).toISOString(),
  }).eq('user_id', row.user_id)
  return d.access_token
}

// --- Calendar creation (idempotent, per trainingplans ensureTrainingCalendar) ---

async function ensureCalendar(row: SyncRow, token: string): Promise<string> {
  const db = getSupabase()
  const tz = row.timezone || 'America/Los_Angeles'

  if (row.google_calendar_id) {
    const check = await fetch(`${CALENDAR_API}/calendars/${encodeURIComponent(row.google_calendar_id)}`, {
      headers: { Authorization: `Bearer ${token}` },
    })
    if (check.ok) return row.google_calendar_id
    // 404/410 → calendar was deleted; fall through and recreate
  }

  const res = await fetch(`${CALENDAR_API}/calendars`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ summary: CALENDAR_NAME, timeZone: tz }),
  })
  if (res.status === 401 || res.status === 403) {
    const body = await res.text()
    if (/accessNotConfigured|has not been used|is disabled/i.test(body)) throw new Error('GOOGLE_API_DISABLED')
    throw new Error('GOOGLE_SCOPE_INSUFFICIENT')
  }
  if (!res.ok) throw new Error(`Calendar create failed: ${res.status} ${await res.text()}`)
  const data = await res.json()
  await db.from('user_calendar_sync').update({ google_calendar_id: data.id }).eq('user_id', row.user_id)
  return data.id as string
}

// --- Desired items: bookmarked + agape events ---

interface DesiredItem {
  eventKey: string
  kind: 'bookmarked' | 'agape'
  name: string
  date: string          // YYYY-MM-DD
  endDate: string | null
  time: string | null   // raw scraped time string, e.g. "8pm", "7:30PM - 2AM"
  venue: string
  address: string
  city: string
  url: string
  description: string
}

function todayISO(): string {
  return new Date().toISOString().split('T')[0]
}

async function getDesiredItems(row: SyncRow): Promise<DesiredItem[]> {
  const db = getSupabase()
  const today = todayISO()
  const byKey = new Map<string, DesiredItem>()

  if (row.sync_agape) {
    // Agape-recommended events: tagged rows + the Agape Discord feed
    const { data: agapeRows } = await db
      .from('events')
      .select('event_key, canonical_key, source_id, url, name, date, time, venue, address, city, description, recommended_by')
      .gte('date', today)
      .or('recommended_by.cs.{agape},source_id.eq.discord-agape-events')
      .limit(500)
    for (const r of agapeRows || []) {
      const key = r.canonical_key || r.event_key || `${r.source_id}|${r.url}`
      if (byKey.has(key)) continue
      byKey.set(key, {
        eventKey: key, kind: 'agape',
        name: r.name, date: r.date, endDate: null, time: r.time || null,
        venue: r.venue || '', address: r.address || '', city: r.city || '',
        url: r.url || '', description: r.description || '',
      })
    }
  }

  if (row.sync_bookmarked) {
    const { data: bms } = await db
      .from('user_event_bookmarks')
      .select('event_key, event')
      .eq('user_id', row.user_id)
    for (const b of bms || []) {
      const ev = (b.event || {}) as Record<string, string>
      if (!ev.date || ev.date < today) continue
      // Bookmarked wins when an event is both bookmarked and Agape-recommended:
      // an explicit user flag is a stronger signal than a community recommendation
      byKey.set(b.event_key, {
        eventKey: b.event_key, kind: 'bookmarked',
        name: ev.name || 'Event', date: ev.date, endDate: ev.endDate || null, time: ev.time || null,
        venue: ev.venue || '', address: ev.address || '', city: ev.city || '',
        url: ev.url || '', description: ev.description || '',
      })
    }
  }

  return [...byKey.values()]
}

// --- Event payload (per trainingplans buildGoogleEvent) ---

// Parse a scraped time string ("8pm", "7:30PM - 2AM", "20:00") → { h, m } or null
function parseStartTime(raw: string | null): { h: number; m: number } | null {
  if (!raw) return null
  const start = raw.split(/[-–]/)[0].trim()
  const ampm = start.match(/(\d{1,2})(?::(\d{2}))?\s*(am|pm)/i)
  if (ampm) {
    let h = parseInt(ampm[1], 10) % 12
    if (/pm/i.test(ampm[3])) h += 12
    return { h, m: ampm[2] ? parseInt(ampm[2], 10) : 0 }
  }
  const h24 = start.match(/^(\d{1,2}):(\d{2})$/)
  if (h24) {
    const h = parseInt(h24[1], 10)
    if (h >= 0 && h <= 23) return { h, m: parseInt(h24[2], 10) }
  }
  return null
}

function pad(n: number): string { return String(n).padStart(2, '0') }

function nextDay(dateStr: string): string {
  const d = new Date(`${dateStr}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + 1)
  return d.toISOString().slice(0, 10)
}

function buildGoogleEvent(item: DesiredItem, tz: string): Record<string, unknown> {
  const location = [item.venue, item.address, item.city].filter(Boolean).join(', ')
  const descParts = []
  if (item.url) descParts.push(item.url)
  if (item.description) descParts.push(item.description)
  descParts.push(item.kind === 'agape' ? 'Recommended by Agape — via ctrl.rodeo/events' : 'Interested — via ctrl.rodeo/events')

  const event: Record<string, unknown> = {
    summary: item.name,
    location,
    description: descParts.join('\n\n'),
    colorId: item.kind === 'agape' ? COLOR_AGAPE : COLOR_BOOKMARKED,
    extendedProperties: { private: { eventKey: item.eventKey, kind: item.kind, app: 'ctrl-events' } },
  }

  const start = parseStartTime(item.time)
  if (!start) {
    // All-day (end date is exclusive)
    event.start = { date: item.date }
    event.end = { date: nextDay(item.endDate || item.date) }
    return event
  }

  // Timed event: local wall-clock in the user's timezone; Google resolves the offset
  const startLocal = `${item.date}T${pad(start.h)}:${pad(start.m)}:00`
  const endMinutes = start.h * 60 + start.m + DEFAULT_DURATION_MIN
  const endH = Math.floor(endMinutes / 60), endM = endMinutes % 60
  const endDate = endH >= 24 ? nextDay(item.date) : item.date
  const endLocal = `${endDate}T${pad(endH % 24)}:${pad(endM)}:00`
  event.start = { dateTime: startLocal, timeZone: tz }
  event.end = { dateTime: endLocal, timeZone: tz }
  event.reminders = { useDefault: false, overrides: [{ method: 'popup', minutes: 120 }] }
  return event
}

// --- Sync (push-only reconcile, per trainingplans syncAllForAthlete) ---

async function runSync(row: SyncRow): Promise<Record<string, number>> {
  const token = await getValidAccessToken(row)
  const calendarId = await ensureCalendar(row, token)
  const tz = row.timezone || 'America/Los_Angeles'
  const db = getSupabase()

  const desired = await getDesiredItems(row)
  const desiredByKey = new Map(desired.map(d => [d.eventKey, d]))

  // Scan the calendar for events we own (extendedProperties.private.app = ctrl-events)
  const existingByKey = new Map<string, { id: string; kind: string; summary: string; startRaw: string }>()
  let pageToken: string | null = null
  do {
    const params = new URLSearchParams({
      singleEvents: 'true', showDeleted: 'false', maxResults: '2500',
      timeMin: new Date(Date.now() - 7 * 86400000).toISOString(),
      privateExtendedProperty: 'app=ctrl-events',
    })
    if (pageToken) params.set('pageToken', pageToken)
    const res = await fetch(`${CALENDAR_API}/calendars/${encodeURIComponent(calendarId)}/events?${params}`, {
      headers: { Authorization: `Bearer ${token}` },
    })
    if (!res.ok) throw new Error(`Calendar list failed: ${res.status} ${await res.text()}`)
    const data = await res.json()
    for (const ev of data.items || []) {
      const key = ev?.extendedProperties?.private?.eventKey
      if (key && ev.status !== 'cancelled') {
        existingByKey.set(key, {
          id: ev.id,
          kind: ev.extendedProperties.private.kind || '',
          summary: ev.summary || '',
          startRaw: JSON.stringify(ev.start || {}),
        })
      }
    }
    pageToken = data.nextPageToken || null
  } while (pageToken)

  let pushed = 0, updated = 0, deleted = 0, unchanged = 0, errors = 0

  // Insert / update
  for (const item of desired) {
    const payload = buildGoogleEvent(item, tz)
    const existing = existingByKey.get(item.eventKey)
    try {
      if (!existing) {
        const res = await fetch(`${CALENDAR_API}/calendars/${encodeURIComponent(calendarId)}/events`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        })
        if (!res.ok) throw new Error(`insert ${res.status}`)
        pushed++
      } else {
        // Cheap change check: kind (color), name, start
        const startNow = JSON.stringify((payload as { start: unknown }).start)
        if (existing.kind === item.kind && existing.summary === payload.summary && existing.startRaw === startNow) {
          unchanged++
        } else {
          const res = await fetch(`${CALENDAR_API}/calendars/${encodeURIComponent(calendarId)}/events/${existing.id}`, {
            method: 'PATCH',
            headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
          })
          if (!res.ok) throw new Error(`patch ${res.status}`)
          updated++
        }
      }
    } catch (e) {
      errors++
      console.log(`[gcal-sync] ${item.eventKey}: ${(e as Error).message}`)
    }
  }

  // Delete events we own that are no longer desired (unbookmarked / toggled off)
  for (const [key, existing] of existingByKey) {
    if (desiredByKey.has(key)) continue
    try {
      const res = await fetch(`${CALENDAR_API}/calendars/${encodeURIComponent(calendarId)}/events/${existing.id}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      })
      if (!res.ok && res.status !== 404 && res.status !== 410) throw new Error(`delete ${res.status}`)
      deleted++
    } catch (e) {
      errors++
      console.log(`[gcal-sync] delete ${key}: ${(e as Error).message}`)
    }
  }

  const result = { pushed, updated, deleted, unchanged, errors }
  await db.from('user_calendar_sync').update({
    last_synced_at: new Date().toISOString(),
    last_sync_result: result,
  }).eq('user_id', row.user_id)
  console.log(`[gcal-sync] ${row.user_id}: ${JSON.stringify(result)}`)
  return result
}

// --- Status payload (never includes tokens) ---
function statusPayload(row: SyncRow | null) {
  return {
    connected: !!row?.google_refresh_token,
    syncEnabled: !!row?.sync_enabled,
    syncBookmarked: row?.sync_bookmarked ?? true,
    syncAgape: row?.sync_agape ?? true,
    lastSyncedAt: row?.last_synced_at || null,
  }
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return new Response(JSON.stringify({ error: 'POST only' }), { status: 405, headers: jsonHeaders })

  const user = await getUser(req)
  if (!user) return new Response(JSON.stringify({ error: 'unauthorized' }), { status: 401, headers: jsonHeaders })

  let body: Record<string, unknown> = {}
  try { body = await req.json() } catch { /* empty body ok for some actions */ }
  const action = body.action as string
  const db = getSupabase()

  try {
    switch (action) {
      case 'connect-url': {
        // Client passes its own origin-based redirect (must be registered in Google Cloud Console)
        const redirectUri = (body.redirectUri as string) || ''
        if (!/^https:\/\/(ctrl\.rodeo|fikei\.github\.io)\/|^http:\/\/localhost[:/]/.test(redirectUri)) {
          return new Response(JSON.stringify({ error: 'invalid redirectUri' }), { status: 400, headers: jsonHeaders })
        }
        const params = new URLSearchParams({
          client_id: googleClientId(),
          redirect_uri: redirectUri,
          response_type: 'code',
          scope: SCOPES,
          access_type: 'offline',   // enables refresh token
          prompt: 'consent',        // force refresh_token issuance + scope re-consent
          state: (body.state as string) || '',
        })
        return new Response(JSON.stringify({ url: `${AUTH_URL}?${params}` }), { headers: jsonHeaders })
      }

      case 'exchange': {
        const tokens = await exchangeCode(body.code as string, body.redirectUri as string)
        const existing = await getSyncRow(user.id)
        await db.from('user_calendar_sync').upsert({
          user_id: user.id,
          google_access_token: tokens.access_token,
          // Google only returns refresh_token on first consent; keep the old one otherwise
          google_refresh_token: tokens.refresh_token || existing?.google_refresh_token || null,
          google_expires_at: tokens.expires_at,
          sync_enabled: true,
          timezone: (body.timezone as string) || existing?.timezone || 'America/Los_Angeles',
        }, { onConflict: 'user_id' })
        const row = await getSyncRow(user.id)
        let result = null
        if (row?.google_refresh_token) {
          try { result = await runSync(row) } catch (e) { console.log('[gcal-sync] initial sync failed: ' + (e as Error).message) }
        }
        return new Response(JSON.stringify({ ...statusPayload(row), result }), { headers: jsonHeaders })
      }

      case 'status': {
        const row = await getSyncRow(user.id)
        return new Response(JSON.stringify(statusPayload(row)), { headers: jsonHeaders })
      }

      case 'settings': {
        const row = await getSyncRow(user.id)
        if (!row) return new Response(JSON.stringify({ error: 'not connected' }), { status: 400, headers: jsonHeaders })
        const update: Record<string, unknown> = {}
        if (typeof body.syncEnabled === 'boolean') update.sync_enabled = body.syncEnabled
        if (typeof body.syncBookmarked === 'boolean') update.sync_bookmarked = body.syncBookmarked
        if (typeof body.syncAgape === 'boolean') update.sync_agape = body.syncAgape
        if (typeof body.timezone === 'string') update.timezone = body.timezone
        if (Object.keys(update).length) await db.from('user_calendar_sync').update(update).eq('user_id', user.id)
        const fresh = await getSyncRow(user.id)
        let result = null
        if (fresh?.sync_enabled && fresh.google_refresh_token) {
          result = await runSync(fresh) // settings changes reconcile immediately (adds AND removes)
        }
        return new Response(JSON.stringify({ ...statusPayload(fresh), result }), { headers: jsonHeaders })
      }

      case 'sync': {
        const row = await getSyncRow(user.id)
        if (!row?.google_refresh_token) return new Response(JSON.stringify({ error: 'GOOGLE_NOT_CONNECTED' }), { status: 400, headers: jsonHeaders })
        if (!row.sync_enabled) return new Response(JSON.stringify({ ...statusPayload(row), result: null }), { headers: jsonHeaders })
        const result = await runSync(row)
        return new Response(JSON.stringify({ ...statusPayload(await getSyncRow(user.id)), result }), { headers: jsonHeaders })
      }

      case 'disconnect': {
        // Clear tokens + calendar pointer; the ctrl.events calendar itself is left in place
        await db.from('user_calendar_sync').update({
          google_access_token: null,
          google_refresh_token: null,
          google_expires_at: null,
          google_calendar_id: null,
          sync_enabled: false,
        }).eq('user_id', user.id)
        return new Response(JSON.stringify(statusPayload(await getSyncRow(user.id))), { headers: jsonHeaders })
      }

      default:
        return new Response(JSON.stringify({ error: `unknown action: ${action}` }), { status: 400, headers: jsonHeaders })
    }
  } catch (e) {
    const msg = (e as Error).message || 'error'
    const known = ['GOOGLE_NOT_CONNECTED', 'GOOGLE_SCOPE_INSUFFICIENT', 'GOOGLE_API_DISABLED']
    const status = known.includes(msg) ? 409 : 500
    console.log(`[gcal-sync] error (${action}): ${msg}`)
    return new Response(JSON.stringify({ error: msg }), { status, headers: jsonHeaders })
  }
})
