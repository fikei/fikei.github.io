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

// ---- Updates queue (proactive model) ----

// Feed of system actions (undo-able records) + one-click prompts +
// reply-pending + stale rows. One item per role, priority-ordered.
export async function loadUpdates() {
  return post(APP_EVENTS_URL, { action: 'updates' });
}

// One-click prompt action: resolution 'stage_offer' | 'archive'.
export async function resolveEvent(eventId, resolution, { exit_reason, exit_context } = {}) {
  return post(APP_EVENTS_URL, { action: 'resolve', eventId, resolution, exit_reason, exit_context });
}

// Revert an auto/prompted action from the event's stored prev_state.
export async function undoEvent(eventId) {
  return post(APP_EVENTS_URL, { action: 'undo', eventId });
}

// Acknowledge (×) a feed row — server-persisted.
export async function dismissUpdate(eventId) {
  return post(APP_EVENTS_URL, { action: 'dismiss', eventId });
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

// ---- Updates-queue presentation map ----
// One taxonomy for the queue rows AND the table Signal chips: per feed
// `kind` — tint class, inline SVG line icon (no emoji, per DESIGN.md),
// short chip label, and the single action's button label.

const SVG_ATTRS = 'viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"';
const ICONS = {
  award:    `<svg ${SVG_ATTRS}><circle cx="12" cy="8" r="6"/><path d="M15.5 13 17 22l-5-3-5 3 1.5-9"/></svg>`,
  archive:  `<svg ${SVG_ATTRS}><rect x="2" y="3" width="20" height="5" rx="1"/><path d="M4 8v11a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8"/><path d="M10 12h4"/></svg>`,
  xcircle:  `<svg ${SVG_ATTRS}><circle cx="12" cy="12" r="10"/><path d="m15 9-6 6"/><path d="m9 9 6 6"/></svg>`,
  stairs:   `<svg ${SVG_ATTRS}><path d="M4 20h4v-4h4v-4h4V8h4"/></svg>`,
  mail:     `<svg ${SVG_ATTRS}><rect x="2" y="4" width="20" height="16" rx="2"/><path d="m22 7-10 6L2 7"/></svg>`,
  clock:    `<svg ${SVG_ATTRS}><circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/></svg>`,
  calendar: `<svg ${SVG_ATTRS}><rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/></svg>`,
  bolt:     `<svg ${SVG_ATTRS}><path d="M13 2 3 14h7l-1 8 10-12h-7l1-8z"/></svg>`,
};

export const UPDATE_KIND_META = {
  auto_offer:          { tint: 'green', icon: ICONS.award,    chip: 'Offer',           actionLabel: 'Undo' },
  auto_archive:        { tint: 'red',   icon: ICONS.archive,  chip: 'Archived',        actionLabel: 'Undo archive' },
  no_response_archive: { tint: 'gray',  icon: ICONS.archive,  chip: 'No response',     actionLabel: 'Undo archive' },
  auto_advance:        { tint: 'blue',  icon: ICONS.stairs,   chip: 'Moved forward',   actionLabel: 'Open role' },
  prompt_offer:        { tint: 'green', icon: ICONS.award,    chip: 'Offer — confirm', actionLabel: 'Move to offer' },
  prompt_rejection:    { tint: 'red',   icon: ICONS.xcircle,  chip: 'Rejection',       actionLabel: 'Archive role' },
  prompt_other:        { tint: 'amber', icon: ICONS.mail,     chip: 'New update',      actionLabel: 'Open role' },
  reply_pending:       { tint: 'amber', icon: ICONS.mail,     chip: 'Reply pending',   actionLabel: 'Open in Gmail' },
  stale:               { tint: 'gray',  icon: ICONS.clock,    chip: 'Quiet',           actionLabel: 'Follow up' },
  calendar_today:      { tint: 'blue',  icon: ICONS.calendar, chip: 'Interview',       actionLabel: 'Open role' },
  // Synthetic digest row built client-side from apply_ease tiers (16.1) —
  // no application_events row behind it.
  easy_apply:          { tint: 'green', icon: ICONS.bolt,     chip: 'Easy apply',      actionLabel: 'Show them' },
  role_closed:         { tint: 'gray',  icon: ICONS.archive,  chip: 'Closed',          actionLabel: 'Open role' },
};

export function updateKindMeta(kind) {
  return UPDATE_KIND_META[kind] || UPDATE_KIND_META.prompt_other;
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
  loadUpdates, resolveEvent, undoEvent, dismissUpdate, updateKindMeta,
};
