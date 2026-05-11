// applicationEvents.js — thin client for the application-events Edge Function.
// Auth: forwards the current Supabase access token from CtrlAuth.

const APP_EVENTS_URL = 'https://yfhudwakpgzswiylhfbh.supabase.co/functions/v1/application-events';
const CAL_API_URL    = 'https://yfhudwakpgzswiylhfbh.supabase.co/functions/v1/calendar-api';

async function authHeaders() {
  const supabase = window.CtrlAuth?.getSupabaseClient?.();
  if (!supabase) throw new Error('CtrlAuth not ready');
  const { data } = await supabase.auth.getSession();
  const token = data?.session?.access_token;
  if (!token) throw new Error('not signed in');
  return {
    'Authorization': `Bearer ${token}`,
    'Content-Type':  'application/json',
  };
}

async function post(url, body) {
  const headers = await authHeaders();
  const res = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body) });
  if (!res.ok) throw new Error(`${url} ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return res.json();
}

export async function listEvents(roleSlug, { withReplyStatus = false } = {}) {
  return post(APP_EVENTS_URL, { action: 'list', roleSlug, withReplyStatus });
}

export async function needsAttention() {
  return post(APP_EVENTS_URL, { action: 'needs-attention' });
}

export async function ackEvent(eventId) {
  return post(APP_EVENTS_URL, { action: 'ack', eventId });
}

export async function runBackfill({ roleSlug, batchSize = 5, windowDays = 30 } = {}) {
  return post(APP_EVENTS_URL, { action: 'backfill', roleSlug, batchSize, windowDays });
}

export async function roleMatchedEvents({ windowHours = 48 } = {}) {
  return post(CAL_API_URL, { action: 'role-matched-events', windowHours });
}

// Aggregator: returns a Map<roleSlug, { signal, priority, detail, ... }>
// representing the SINGLE highest-priority signal for each role. Used
// by the pipeline table row chip + the Needs-Attention widget.
//
// Priority (lowest number wins):
//   1 action_needed   — needs_review event, not yet acked
//   2 calendar_today  — calendar event in next 48h matched to role
//   3 reply_pending   — server returns this on `needs-attention` but
//                       only when needs_user_reply is true (not in MVP)
//   4 new_update      — non-auto-advanced event in last 72h
//   5 stale_14d       — last_activity_at + applied_at < now - 14d
export async function loadRoleSignals() {
  const out = new Map();
  let attention = { items: [] };
  let calMatches = { matches: [] };

  try { attention = await needsAttention(); } catch (e) { console.warn('[applicationEvents] needs-attention failed:', e.message); }
  try { calMatches = await roleMatchedEvents({ windowHours: 48 }); } catch (e) { console.warn('[applicationEvents] role-matched-events failed:', e.message); }

  // Calendar matches at priority 2.
  for (const m of (calMatches.matches || [])) {
    const startMs = new Date(m.start).getTime();
    const hoursOut = (startMs - Date.now()) / (60 * 60 * 1000);
    let detail;
    if (hoursOut < 0) continue;
    else if (hoursOut < 2)  detail = `📅 In ${Math.max(1, Math.round(hoursOut * 60))}m: ${m.summary}`;
    else if (hoursOut < 24) detail = `📅 Today ${formatLocalTime(m.start)}: ${m.summary}`;
    else                    detail = `📅 ${formatLocalDay(m.start)} ${formatLocalTime(m.start)}: ${m.summary}`;
    upsert(out, m.role_slug, {
      role_slug:  m.role_slug,
      company:    m.company,
      title:      m.title,
      signal:     'calendar_today',
      priority:   2,
      detail,
      eventId:    m.event_id,
      receivedAt: m.start,
      isLive:     hoursOut < 2,         // <2h → banner-eligible
    });
  }

  for (const a of (attention.items || [])) {
    const isLive = (a.signal === 'action_needed' || a.signal === 'new_update')
                && a.received_at
                && (Date.now() - new Date(a.received_at).getTime()) < 30 * 60 * 1000;  // last 30 min
    upsert(out, a.role_slug, {
      role_slug:  a.role_slug,
      signal:     a.signal,
      priority:   a.priority,
      detail:     a.detail,
      eventId:    a.event_id,
      receivedAt: a.received_at,
      company:    a.company,
      title:      a.title,
      isLive,
    });
  }

  return { byRole: out, calMatches: calMatches.matches || [], attention: attention.items || [] };
}

function upsert(map, slug, item) {
  const cur = map.get(slug);
  if (!cur || item.priority < cur.priority) map.set(slug, item);
}

function formatLocalTime(iso) {
  try {
    const d = new Date(iso);
    return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  } catch { return iso; }
}

function formatLocalDay(iso) {
  try {
    const d = new Date(iso);
    const now = new Date();
    const diff = Math.round((d.getTime() - now.getTime()) / (24 * 60 * 60 * 1000));
    if (diff === 0) return 'Today';
    if (diff === 1) return 'Tomorrow';
    return d.toLocaleDateString([], { weekday: 'short' });
  } catch { return ''; }
}

// Render-helper: returns the CSS class for a row/widget chip given a signal.
export function chipClassForSignal(signal) {
  switch (signal) {
    case 'action_needed':  return 'signal-chip signal-chip--red';
    case 'calendar_today': return 'signal-chip signal-chip--blue';
    case 'reply_pending':  return 'signal-chip signal-chip--amber';
    case 'new_update':     return 'signal-chip signal-chip--green';
    case 'stale_14d':      return 'signal-chip signal-chip--yellow';
    default:               return 'signal-chip';
  }
}

export function eventTypeLabel(eventType) {
  switch (eventType) {
    case 'applied_confirmation':   return 'Applied';
    case 'screen_scheduled':       return 'Screen scheduled';
    case 'next_round_invited':     return 'Next round';
    case 'take_home_assigned':     return 'Take-home';
    case 'offer_received':         return 'Offer';
    case 'rejection_any_stage':    return 'Rejection';
    case 'follow_up_needed':       return 'Follow-up';
    case 'interview_rescheduled':  return 'Rescheduled';
    case 'informational':          return 'Update';
    default:                       return eventType;
  }
}

window.JobApplicationEvents = {
  listEvents, needsAttention, ackEvent, runBackfill, roleMatchedEvents,
  loadRoleSignals, chipClassForSignal, eventTypeLabel,
};
