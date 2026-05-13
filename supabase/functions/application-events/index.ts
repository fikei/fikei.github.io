// application-events — read + maintenance endpoint for the
// job.application_events table. Phase 2.0 of the Gmail jobs pipe.
//
// Actions:
//   POST { action: 'list', roleSlug, withReplyStatus? }
//     Returns events for a role, reverse-chronological, with optional
//     needs_user_reply derivation (walks Gmail thread for outbound
//     messages from fike101@gmail.com after the latest inbound event).
//
//   POST { action: 'needs-attention' }
//     Returns a flattened list of actionables across all Active /
//     Saved-engaged roles: offers, rejections, low-confidence, stale,
//     reply-pending. Powers the /job/jobs/ Needs-Attention widget.
//
//   POST { action: 'ack', eventId }
//     User saw the event. Clears needs_review + stamps reviewed_at.
//
//   POST { action: 'backfill', roleSlug?, batchSize?, windowDays? }
//     Runs the application-scan in backfill mode for one role (or all
//     active roles if no slug), in batches of `batchSize` (default 5).
//     Self-paced — caller re-fires across ScheduleWakeup intervals.

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { db } from '../_shared/job-db.ts';
import { verifyJobUser, jsonResp, err, corsHeaders } from '../_shared/job-auth.ts';
import {
  getServiceClient,
  GMAIL_READONLY_SCOPE,
  GMAIL_MODIFY_SCOPE,
  getAccessToken,
  userIdForEmail,
} from '../_shared/google-tokens.ts';
import { scanApplicationResponses } from '../_shared/gmail-application-scan.ts';
import { ensureAndApplyLabel } from '../_shared/gmail.ts';

const LADDER_LABEL = 'Ladder';

const VERSION = '1.5.0';
console.log(`[application-events] v${VERSION} - Gmail 'Ladder' label backfill action (needs gmail.modify scope)`);

const GMAIL_BASE = 'https://gmail.googleapis.com/gmail/v1/users/me';
const USER_EMAIL_LC = 'fike101@gmail.com';
const STALE_DAYS = 14;

interface EventRow {
  id:               string;
  role_slug:        string;
  gmail_message_id: string;
  gmail_thread_id:  string;
  gmail_api_id:     string | null;
  sender:           string | null;
  subject:          string | null;
  event_type:       string;
  detected_stage:   string | null;
  summary:          string | null;
  confidence:       number | null;
  round_label:      string | null;
  round_n:          number | null;
  auto_applied:     boolean;
  needs_review:     boolean;
  reviewed_at:      string | null;
  received_at:      string;
  source:           string;
  created_at:       string;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return err('POST only', 405);

  const userEmail = await verifyJobUser(req);
  if (!userEmail) return err('Unauthorized', 401);

  let body: { action?: string; [k: string]: unknown };
  try { body = await req.json(); } catch { return err('invalid JSON'); }
  const action = String(body.action || 'list');

  try {
    if (action === 'list') {
      return await listEvents(body, userEmail);
    }
    if (action === 'needs-attention') {
      return await needsAttention(userEmail);
    }
    if (action === 'ack') {
      return await ackEvent(body);
    }
    if (action === 'backfill') {
      return await runBackfill(body, userEmail);
    }
    if (action === 'backfill-labels') {
      return await runBackfillLabels(body, userEmail);
    }
    return err(`unknown action: ${action}`);
  } catch (e) {
    console.error(`[application-events] ${action} failed:`, (e as Error).message);
    return err((e as Error).message, 500);
  }
});

// ---------- list ----------

async function listEvents(body: Record<string, unknown>, userEmail: string): Promise<Response> {
  const roleSlug = String(body.roleSlug || '');
  if (!roleSlug) return err('roleSlug required');
  const withReplyStatus = body.withReplyStatus === true || body.withReplyStatus === 1;

  const sql = db();
  const events = await sql<EventRow[]>`
    select * from job.application_events
     where role_slug = ${roleSlug}
     order by received_at desc, created_at desc
     limit 200`;
  const role = await sql<{ process_outline: Record<string, unknown> | null; last_activity_at: string | null }[]>`
    select process_outline, last_activity_at::text as last_activity_at
      from job.pipeline_roles where slug = ${roleSlug} limit 1`;

  let replyStatus: Record<string, boolean> = {};
  if (withReplyStatus && events.length) {
    replyStatus = await deriveReplyStatus(userEmail, events);
  }

  const annotated = events.map(e => ({
    ...e,
    needs_user_reply: withReplyStatus
      ? !!replyStatus[e.gmail_thread_id] && isOldEnoughToWarrantReply(e.received_at)
      : undefined,
  }));

  return jsonResp({
    version:          VERSION,
    events:           annotated,
    process_outline:  role[0]?.process_outline ?? null,
    last_activity_at: role[0]?.last_activity_at ?? null,
  });
}

// Map of threadId → needs_user_reply (true when latest inbound has no
// outbound from fike101@gmail.com after it). One Gmail API call per
// unique thread, capped at 10 to bound the cost.
async function deriveReplyStatus(userEmail: string, events: EventRow[]): Promise<Record<string, boolean>> {
  const out: Record<string, boolean> = {};
  const sb = getServiceClient();
  const userId = await userIdForEmail(sb, userEmail);
  if (!userId) return out;
  const tokenRes = await getAccessToken(sb, userId, [GMAIL_READONLY_SCOPE]);
  if (!tokenRes) return out;

  // Take the latest event per thread (events arrive in reverse-chron).
  const latestByThread = new Map<string, EventRow>();
  for (const e of events) {
    if (!latestByThread.has(e.gmail_thread_id)) latestByThread.set(e.gmail_thread_id, e);
  }
  let calls = 0;
  for (const [threadId, latest] of latestByThread.entries()) {
    if (calls++ >= 10) break;
    try {
      const r = await fetch(`${GMAIL_BASE}/threads/${encodeURIComponent(threadId)}?format=metadata&metadataHeaders=From&metadataHeaders=Date`,
        { headers: { Authorization: `Bearer ${tokenRes.accessToken}` } });
      if (!r.ok) { out[threadId] = false; continue; }
      const data = await r.json() as { messages?: Array<{ internalDate?: string; payload?: { headers?: Array<{ name: string; value: string }> } }> };
      const latestInboundMs = new Date(latest.received_at).getTime();
      let lastOutboundMs = 0;
      for (const m of (data.messages || [])) {
        const fromHeader = (m.payload?.headers || []).find(h => h.name.toLowerCase() === 'from')?.value || '';
        if (fromHeader.toLowerCase().includes(USER_EMAIL_LC)) {
          const ts = Number(m.internalDate || 0);
          if (ts > lastOutboundMs) lastOutboundMs = ts;
        }
      }
      out[threadId] = latestInboundMs > lastOutboundMs;
    } catch {
      out[threadId] = false;
    }
  }
  return out;
}

function isOldEnoughToWarrantReply(receivedAt: string): boolean {
  // 24h grace before flagging "you haven't replied" — gives the user
  // time to respond before we nag.
  return Date.now() - new Date(receivedAt).getTime() > 24 * 60 * 60 * 1000;
}

// ---------- needs-attention ----------

interface AttentionItem {
  role_slug:  string;
  company:    string;
  title:      string;
  signal:     'action_needed' | 'calendar_today' | 'reply_pending' | 'new_update' | 'stale_14d';
  priority:   number;
  detail:     string;
  event_id?:  string;
  received_at?: string;
}

async function needsAttention(userEmail: string): Promise<Response> {
  const sql = db();

  // Unreviewed events (Action-needed) — top priority.
  const action = await sql<Array<{ event_id: string; role_slug: string; company_name: string; title: string; summary: string | null; event_type: string; received_at: string }>>`
    select ae.id as event_id, ae.role_slug, r.company_name, r.title,
           ae.summary, ae.event_type, ae.received_at::text as received_at
      from job.application_events ae
      join job.pipeline_roles r on r.slug = ae.role_slug
     where ae.needs_review = true
       and ae.reviewed_at is null
       and r.deleted_at is null
       and r.status in ('Active', 'Saved')
     order by ae.received_at desc`;

  // New-update events (≥72h fresh, not auto-advanced, not needs_review).
  const newUpdate = await sql<Array<{ event_id: string; role_slug: string; company_name: string; title: string; summary: string | null; event_type: string; received_at: string }>>`
    select ae.id as event_id, ae.role_slug, r.company_name, r.title,
           ae.summary, ae.event_type, ae.received_at::text as received_at
      from job.application_events ae
      join job.pipeline_roles r on r.slug = ae.role_slug
     where ae.needs_review = false
       and ae.auto_applied = false
       and ae.received_at > now() - interval '72 hours'
       and ae.event_type in ('follow_up_needed', 'interview_rescheduled', 'informational')
       and r.deleted_at is null
       and r.status in ('Active', 'Saved')
     order by ae.received_at desc`;

  // Stale roles — Active, no activity for 14+ days.
  const stale = await sql<Array<{ role_slug: string; company_name: string; title: string; last_activity_at: string | null; applied_at: string | null }>>`
    select r.slug as role_slug, r.company_name, r.title,
           r.last_activity_at::text as last_activity_at,
           r.applied_at::text as applied_at
      from job.pipeline_roles r
     where r.status = 'Active'
       and r.deleted_at is null
       and coalesce(r.last_activity_at, r.applied_at, r.engaged_at) < now() - make_interval(days => ${STALE_DAYS})
     order by r.last_activity_at desc nulls last`;

  // Build the response, deduplicated by role (one card per role —
  // highest priority signal wins).
  const byRole = new Map<string, AttentionItem>();

  const upsert = (item: AttentionItem) => {
    const cur = byRole.get(item.role_slug);
    if (!cur || item.priority < cur.priority) byRole.set(item.role_slug, item);
  };

  for (const a of action) {
    upsert({
      role_slug:    a.role_slug,
      company:      a.company_name,
      title:        a.title,
      signal:       'action_needed',
      priority:     1,
      detail:       a.summary || labelForEvent(a.event_type),
      event_id:     a.event_id,
      received_at:  a.received_at,
    });
  }
  for (const n of newUpdate) {
    upsert({
      role_slug:    n.role_slug,
      company:      n.company_name,
      title:        n.title,
      signal:       'new_update',
      priority:     4,
      detail:       n.summary || labelForEvent(n.event_type),
      event_id:     n.event_id,
      received_at:  n.received_at,
    });
  }
  for (const s of stale) {
    upsert({
      role_slug:   s.role_slug,
      company:     s.company_name,
      title:       s.title,
      signal:      'stale_14d',
      priority:    5,
      detail:      s.last_activity_at
                     ? `Quiet since ${relativeDays(s.last_activity_at)}`
                     : `No activity in 14+ days`,
      received_at: s.last_activity_at ?? undefined,
    });
  }

  const items = [...byRole.values()].sort((a, b) => a.priority - b.priority);
  return jsonResp({ version: VERSION, items });
}

function labelForEvent(eventType: string): string {
  switch (eventType) {
    case 'offer_received':         return 'Offer received — confirm to move to Offer stage';
    case 'rejection_any_stage':    return 'Rejection — set exit reason to capture context';
    case 'applied_confirmation':   return 'Application confirmed';
    case 'screen_scheduled':       return 'Screen scheduled';
    case 'next_round_invited':     return 'Next round invited';
    case 'take_home_assigned':     return 'Take-home assigned';
    case 'follow_up_needed':       return 'They\'re asking if you\'re still interested';
    case 'interview_rescheduled':  return 'Interview rescheduled';
    case 'informational':          return 'Update from the company';
    default:                       return eventType;
  }
}

function relativeDays(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const days = Math.floor(ms / (24 * 60 * 60 * 1000));
  if (days === 0) return 'today';
  if (days === 1) return 'yesterday';
  return `${days}d ago`;
}

// ---------- ack ----------

async function ackEvent(body: Record<string, unknown>): Promise<Response> {
  const eventId = String(body.eventId || '');
  if (!eventId) return err('eventId required');
  const sql = db();
  await sql`
    update job.application_events
       set needs_review = false,
           reviewed_at  = now()
     where id = ${eventId}`;
  return jsonResp({ ok: true });
}

// ---------- backfill ----------

async function runBackfill(body: Record<string, unknown>, userEmail: string): Promise<Response> {
  const roleSlug   = body.roleSlug   ? String(body.roleSlug) : undefined;
  const batchSize  = Math.max(1, Math.min(20, Number(body.batchSize)  || 5));
  const windowDays = Math.max(1, Math.min(60, Number(body.windowDays) || 30));

  const sb = getServiceClient();
  const userId = await userIdForEmail(sb, userEmail);
  if (!userId) return err('user not found', 400);
  const tokenRes = await getAccessToken(sb, userId, [GMAIL_READONLY_SCOPE]);
  if (!tokenRes) return err('gmail not connected', 400);

  const result = await scanApplicationResponses({
    userEmail,
    accessToken: tokenRes.accessToken,
    mode:        'backfill',
    maxMessages: batchSize,
    windowDays,
    roleSlug,
  });

  return jsonResp({ version: VERSION, ...result });
}


// ---------- backfill-labels ----------
//
// One-time (re-runnable) sweep: stamp the Ladder label on every Gmail
// message the pipeline has ever sourced. Walks two surfaces:
//   - job.recommended_roles where source='gmail-jobs' (gmailApiId in payload)
//   - job.application_events (gmail_api_id column)
// Requires gmail.modify scope — if the user only has readonly, we
// return a clear error asking for re-consent.

async function runBackfillLabels(_body: Record<string, unknown>, userEmail: string): Promise<Response> {
  const sb = getServiceClient();
  const userId = await userIdForEmail(sb, userEmail);
  if (!userId) return err('user not found', 400);
  // Require the broader scope so batchModify is actually allowed.
  const tokenRes = await getAccessToken(sb, userId, [GMAIL_MODIFY_SCOPE]);
  if (!tokenRes) {
    return jsonResp({
      ok: false,
      reason: 'needs_modify_scope',
      message: 'Gmail labels require gmail.modify scope. Re-connect Gmail at /job/ to grant it.',
    }, 400);
  }

  const sql = db();
  // recommended_roles stores the Gmail API id under payload.gmailApiId
  // when the row came from the gmail-jobs source. application_events
  // stores it in its own column.
  const recIds = await sql<{ gmail_api_id: string }[]>`
    select distinct payload->>'gmailApiId' as gmail_api_id
      from job.recommended_roles
     where source = 'gmail-jobs'
       and payload->>'gmailApiId' is not null
  `;
  const eventIds = await sql<{ gmail_api_id: string }[]>`
    select distinct gmail_api_id
      from job.application_events
     where gmail_api_id is not null
  `;

  const all = [
    ...recIds.map(r => r.gmail_api_id),
    ...eventIds.map(r => r.gmail_api_id),
  ].filter(Boolean);
  const unique = [...new Set(all)];

  const res = await ensureAndApplyLabel(tokenRes.accessToken, unique, LADDER_LABEL);
  return jsonResp({
    ok: true,
    version: VERSION,
    found:   unique.length,
    fromRecs:   recIds.length,
    fromEvents: eventIds.length,
    labeled: res.labeled,
    labelId: res.labelId,
    errors:  res.errors,
  });
}
