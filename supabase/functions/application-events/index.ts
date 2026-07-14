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
//   POST { action: 'updates' }
//     The Updates-queue feed: recent auto-actions (undo-able records),
//     below-floor offer/rejection prompts, reply-pending threads, and
//     stale roles. Runs the 30-day no-response sweep as a side effect.
//
//   POST { action: 'resolve', eventId, resolution, exit_reason?, exit_context? }
//     One-click prompt action — applies the role mutation (stage_offer |
//     archive) AND acks the event atomically; stores prev_state for undo.
//
//   POST { action: 'undo', eventId }
//     Reverts an auto/prompted action from the event's prev_state.
//
//   POST { action: 'dismiss', eventId }
//     Acknowledge (×) a feed row — server-persisted so it survives reloads.
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
import { scanApplicationResponses, mapRejectionExitReason } from '../_shared/gmail-application-scan.ts';
import { AUTO_RESOLVE } from '../_shared/gmail-application-classifier.ts';
import { ensureAndApplyLabel } from '../_shared/gmail.ts';

const LADDER_LABEL = 'Ladder';

const VERSION = '1.7.0';
console.log(`[application-events] v${VERSION} - role_closed events in the updates feed (server-backed closure notifications)`);

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
    if (action === 'updates') {
      return await listUpdates(userEmail);
    }
    if (action === 'resolve') {
      return await resolveEvent(body);
    }
    if (action === 'undo') {
      return await undoEvent(body);
    }
    if (action === 'dismiss') {
      return await dismissEvent(body);
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

// ---------- updates feed (proactive queue) ----------

const EXIT_REASONS = new Set([
  'changed_mind', 'wrong_comp', 'wrong_sector_or_stage', 'wrong_location',
  'applied_no_response', 'rejected_after_screen', 'rejected_after_interview',
  'rejected_no_interview', 'role_closed', 'withdrew', 'other',
]);

const EXIT_REASON_LABELS: Record<string, string> = {
  changed_mind:             'changed my mind',
  wrong_comp:               'comp mismatch',
  wrong_sector_or_stage:    'sector or stage felt off',
  wrong_location:           'location didn\'t work',
  applied_no_response:      'no response',
  rejected_after_screen:    'didn\'t move forward after a screen',
  rejected_after_interview: 'didn\'t move forward after interviews',
  rejected_no_interview:    'rejected without an interview',
  role_closed:              'role closed',
  withdrew:                 'stepped away',
  other:                    'other',
};

interface UpdateItem {
  kind:      'auto_offer' | 'auto_archive' | 'auto_advance' | 'no_response_archive'
           | 'prompt_offer' | 'prompt_rejection' | 'prompt_other'
           | 'reply_pending' | 'stale';
  action:    'undo' | 'open_role' | 'stage_offer' | 'archive' | 'open_gmail' | 'follow_up';
  priority:  number;
  event_id?: string;
  role_slug: string;
  company:   string;
  title:     string;
  text:      string;
  detail?:   string;
  suggested_exit_reason?: string;
  gmail_thread_id?: string;
  gmail_api_id?:    string | null;
  received_at?:     string;
}

async function listUpdates(userEmail: string): Promise<Response> {
  const sql = db();

  // Side effect: the 30-day no-response sweep. Idempotent (synthetic
  // Message-ID per role) and undo-sticky — an undone sweep-archive is
  // never re-applied.
  await sweepNoResponse(sql);

  const byRole = new Map<string, UpdateItem>();
  const upsert = (item: UpdateItem) => {
    const cur = byRole.get(item.role_slug);
    if (!cur || item.priority < cur.priority) byRole.set(item.role_slug, item);
  };

  // 1. Prompts — offers/rejections awaiting the one click: below-floor
  //    classifications, events that predate the proactive policy, and
  //    decisions re-opened by an undo (prompts ignore undone_at — undo
  //    clears auto_action and restores needs_review, see undoEvent).
  const prompts = await sql<Array<{
    event_id: string; role_slug: string; company_name: string; title: string;
    event_type: string; summary: string | null; confidence: number | null; stage: string | null;
    gmail_thread_id: string; gmail_api_id: string | null; received_at: string;
  }>>`
    select ae.id as event_id, ae.role_slug, r.company_name, r.title,
           ae.event_type, ae.summary, ae.confidence, r.stage,
           ae.gmail_thread_id, ae.gmail_api_id, ae.received_at::text as received_at
      from job.application_events ae
      join job.pipeline_roles r on r.slug = ae.role_slug
     where ae.needs_review = true and ae.reviewed_at is null
       and ae.dismissed_at is null
       and r.deleted_at is null
     order by ae.received_at desc`;
  // "low confidence" is only true below the auto-resolve floor — events
  // that predate the policy (or were re-opened by undo) can be high-
  // confidence and must not claim otherwise.
  const promptDetail = (p: { summary: string | null; confidence: number | null; event_type: string }) => {
    const floor = AUTO_RESOLVE[p.event_type as keyof typeof AUTO_RESOLVE]?.floor ?? 0;
    const belowFloor = (p.confidence ?? 0) < floor;
    const parts = [p.summary || ''];
    if (belowFloor) parts.push('low confidence, so nothing was changed');
    return parts.filter(Boolean).join(' · ');
  };
  for (const p of prompts) {
    if (p.event_type === 'offer_received') {
      upsert({
        kind: 'prompt_offer', action: 'stage_offer', priority: 1,
        event_id: p.event_id, role_slug: p.role_slug, company: p.company_name, title: p.title,
        text: `${p.company_name} looks like an offer`,
        detail: promptDetail(p),
        gmail_thread_id: p.gmail_thread_id, gmail_api_id: p.gmail_api_id, received_at: p.received_at,
      });
    } else if (p.event_type === 'rejection_any_stage') {
      const suggested = await mapRejectionExitReason(sql, { slug: p.role_slug, stage: p.stage });
      upsert({
        kind: 'prompt_rejection', action: 'archive', priority: 1,
        event_id: p.event_id, role_slug: p.role_slug, company: p.company_name, title: p.title,
        text: `${p.company_name} looks like a rejection`,
        detail: promptDetail(p),
        suggested_exit_reason: suggested,
        gmail_thread_id: p.gmail_thread_id, gmail_api_id: p.gmail_api_id, received_at: p.received_at,
      });
    } else {
      upsert({
        kind: 'prompt_other', action: 'open_role', priority: 3,
        event_id: p.event_id, role_slug: p.role_slug, company: p.company_name, title: p.title,
        text: p.summary || labelForEvent(p.event_type),
        gmail_thread_id: p.gmail_thread_id, gmail_api_id: p.gmail_api_id, received_at: p.received_at,
      });
    }
  }

  // 2. Records — actions taken in the last 7 days, undo-able. The window
  // is on the ACTION time (reviewed_at for one-click resolves, received_at
  // for scan-time auto-actions) — resolving a weeks-old email must still
  // produce a visible record.
  const records = await sql<Array<{
    event_id: string; role_slug: string; company_name: string; title: string;
    auto_action: string; event_type: string; summary: string | null;
    stage: string | null; exit_reason: string | null; received_at: string;
  }>>`
    select ae.id as event_id, ae.role_slug, r.company_name, r.title,
           ae.auto_action, ae.event_type, ae.summary,
           r.stage, r.exit_reason,
           coalesce(ae.reviewed_at, ae.received_at)::text as received_at
      from job.application_events ae
      join job.pipeline_roles r on r.slug = ae.role_slug
     where ae.auto_action is not null
       and ae.dismissed_at is null and ae.undone_at is null
       and coalesce(ae.reviewed_at, ae.received_at) > now() - interval '7 days'
       and r.deleted_at is null
     order by coalesce(ae.reviewed_at, ae.received_at) desc`;
  for (const rec of records) {
    if (rec.auto_action === 'stage_offer') {
      upsert({
        kind: 'auto_offer', action: 'undo', priority: 2,
        event_id: rec.event_id, role_slug: rec.role_slug, company: rec.company_name, title: rec.title,
        text: `Moved ${rec.company_name} to Offer`, detail: rec.summary || undefined,
        received_at: rec.received_at,
      });
    } else if (rec.auto_action === 'archived') {
      const reason = EXIT_REASON_LABELS[rec.exit_reason || ''] || 'rejected';
      upsert({
        kind: 'auto_archive', action: 'undo', priority: 2,
        event_id: rec.event_id, role_slug: rec.role_slug, company: rec.company_name, title: rec.title,
        text: `Archived ${rec.company_name} — ${reason}`, detail: rec.summary || undefined,
        received_at: rec.received_at,
      });
    } else if (rec.auto_action === 'archived_stale') {
      upsert({
        kind: 'no_response_archive', action: 'undo', priority: 4,
        event_id: rec.event_id, role_slug: rec.role_slug, company: rec.company_name, title: rec.title,
        text: `Archived ${rec.company_name} — no response in 30 days`,
        received_at: rec.received_at,
      });
    } else if (rec.auto_action === 'archived_closed') {
      upsert({
        kind: 'role_closed', action: 'open_role', priority: 4,
        event_id: rec.event_id, role_slug: rec.role_slug, company: rec.company_name, title: rec.title,
        text: `${rec.company_name} closed the posting`,
        detail: 'Archived automatically — the role is no longer listed',
        received_at: rec.received_at,
      });
    } else if (rec.auto_action === 'stage_advance') {
      const stageLabel = rec.stage === 'interviewing' ? 'Interviewing' : rec.stage === 'applied' ? 'Applied' : (rec.stage || '');
      upsert({
        kind: 'auto_advance', action: 'open_role', priority: 5,
        event_id: rec.event_id, role_slug: rec.role_slug, company: rec.company_name, title: rec.title,
        text: `Moved ${rec.company_name} to ${stageLabel}`, detail: rec.summary || undefined,
        received_at: rec.received_at,
      });
    }
  }

  // 3. Reply-pending — recent inbound threads with no outbound after them.
  const recent = await sql<EventRow[]>`
    select ae.* from job.application_events ae
      join job.pipeline_roles r on r.slug = ae.role_slug
     where ae.received_at > now() - interval '14 days'
       and ae.dismissed_at is null
       and ae.event_type in ('follow_up_needed', 'screen_scheduled', 'next_round_invited', 'take_home_assigned', 'interview_rescheduled')
       and r.status = 'Active' and r.deleted_at is null
     order by ae.received_at desc
     limit 30`;
  if (recent.length) {
    try {
      const replyStatus = await deriveReplyStatus(userEmail, recent);
      const roleMeta = await sql<Array<{ slug: string; company_name: string; title: string }>>`
        select slug, company_name, title from job.pipeline_roles
         where slug = any(${[...new Set(recent.map(e => e.role_slug))]})`;
      const metaBySlug = new Map(roleMeta.map(m => [m.slug, m]));
      const seenThread = new Set<string>();
      for (const e of recent) {
        if (seenThread.has(e.gmail_thread_id)) continue;
        seenThread.add(e.gmail_thread_id);
        if (!replyStatus[e.gmail_thread_id] || !isOldEnoughToWarrantReply(e.received_at)) continue;
        const m = metaBySlug.get(e.role_slug);
        if (!m) continue;
        upsert({
          kind: 'reply_pending', action: 'open_gmail', priority: 2,
          event_id: e.id, role_slug: e.role_slug, company: m.company_name, title: m.title,
          text: `${m.company_name} is waiting on you`,
          detail: e.summary || labelForEvent(e.event_type),
          gmail_thread_id: e.gmail_thread_id, gmail_api_id: e.gmail_api_id, received_at: e.received_at,
        });
      }
    } catch (e) {
      console.warn('[application-events] reply-pending derivation failed:', (e as Error).message);
    }
  }

  // 4. Stale — Active roles quiet 14–30 days (30+ is the sweep's job).
  const stale = await sql<Array<{ role_slug: string; company_name: string; title: string; quiet_since: string | null }>>`
    select r.slug as role_slug, r.company_name, r.title,
           coalesce(r.last_activity_at, r.applied_at, r.engaged_at)::text as quiet_since
      from job.pipeline_roles r
     where r.status = 'Active' and r.deleted_at is null
       and coalesce(r.last_activity_at, r.applied_at, r.engaged_at) < now() - make_interval(days => ${STALE_DAYS})
       and coalesce(r.last_activity_at, r.applied_at, r.engaged_at) > now() - interval '30 days'
     order by quiet_since asc`;
  for (const s of stale) {
    const days = s.quiet_since ? Math.floor((Date.now() - new Date(s.quiet_since).getTime()) / 86_400_000) : STALE_DAYS;
    upsert({
      kind: 'stale', action: 'follow_up', priority: 6,
      role_slug: s.role_slug, company: s.company_name, title: s.title,
      text: `${s.company_name} quiet for ${days} days`,
      received_at: s.quiet_since ?? undefined,
    });
  }

  const items = [...byRole.values()].sort((a, b) =>
    a.priority - b.priority
    || new Date(b.received_at || 0).getTime() - new Date(a.received_at || 0).getTime());
  return jsonResp({ version: VERSION, items });
}

// 30-day no-response sweep. Active roles sitting at stage=applied with no
// signal for 30+ days are auto-archived as applied_no_response, recorded
// as a synthetic undo-able event. The synthetic Message-ID doubles as the
// idempotency key: once undone, the row blocks any future re-sweep.
async function sweepNoResponse(sql: ReturnType<typeof db>): Promise<void> {
  const candidates = await sql<Array<{ slug: string; status: string; stage: string | null; exit_reason: string | null; exit_context: string | null }>>`
    select slug, status, stage, exit_reason, exit_context
      from job.pipeline_roles
     where status = 'Active' and stage = 'applied' and deleted_at is null
       and coalesce(last_activity_at, applied_at, engaged_at, created_at) < now() - interval '30 days'
     limit 20`;
  for (const r of candidates) {
    const prev = { status: r.status, stage: r.stage, exit_reason: r.exit_reason, exit_context: r.exit_context };
    const key = `synthetic:no-response:${r.slug}`;
    const ins = await sql<{ id: string }[]>`
      insert into job.application_events (
        role_slug, gmail_message_id, gmail_thread_id, event_type,
        summary, auto_applied, needs_review, received_at, source,
        auto_action, prev_state
      ) values (
        ${r.slug}, ${key}, ${key}, 'no_response_timeout',
        'No response in 30 days since applying — auto-archived',
        true, false, now(), 'stale-sweep', 'archived_stale', ${sql.json(prev)}
      ) on conflict (gmail_message_id) do nothing
      returning id`;
    if (!ins.length) continue;
    await sql`
      update job.pipeline_roles
         set status = 'Archive', stage = null,
             exit_reason = 'applied_no_response',
             status_changed_at = now(), updated_at = now()
       where slug = ${r.slug}`;
    console.log(`[application-events] no-response sweep archived ${r.slug}`);
  }
}

// ---------- resolve (one-click prompt action) ----------

async function resolveEvent(body: Record<string, unknown>): Promise<Response> {
  const eventId    = String(body.eventId || '');
  const resolution = String(body.resolution || '');
  if (!eventId) return err('eventId required');
  if (!['stage_offer', 'archive'].includes(resolution)) return err(`invalid resolution: ${resolution}`);

  const sql = db();
  const rows = await sql<Array<{ id: string; role_slug: string; event_type: string; status: string; stage: string | null; exit_reason: string | null; exit_context: string | null }>>`
    select ae.id, ae.role_slug, ae.event_type,
           r.status, r.stage, r.exit_reason, r.exit_context
      from job.application_events ae
      join job.pipeline_roles r on r.slug = ae.role_slug
     where ae.id = ${eventId} limit 1`;
  if (!rows.length) return err('event not found', 404);
  const ev = rows[0];
  const prev = { status: ev.status, stage: ev.stage, exit_reason: ev.exit_reason, exit_context: ev.exit_context };

  if (resolution === 'stage_offer') {
    await sql`
      update job.pipeline_roles
         set status = 'Active', stage = 'offer',
             status_changed_at = now(), updated_at = now()
       where slug = ${ev.role_slug}`;
  } else {
    let exitReason = body.exit_reason ? String(body.exit_reason) : '';
    if (exitReason && !EXIT_REASONS.has(exitReason)) return err(`invalid exit_reason: ${exitReason}`);
    if (!exitReason) exitReason = await mapRejectionExitReason(sql, { slug: ev.role_slug, stage: ev.stage });
    const exitContext = body.exit_context ? String(body.exit_context).slice(0, 200) : null;
    await sql`
      update job.pipeline_roles
         set status = 'Archive', stage = null,
             exit_reason = ${exitReason},
             exit_context = coalesce(${exitContext}, exit_context),
             status_changed_at = now(), updated_at = now()
       where slug = ${ev.role_slug}`;
  }

  await sql`
    update job.application_events
       set auto_action  = ${resolution === 'archive' ? 'archived' : 'stage_offer'},
           prev_state   = ${sql.json(prev)},
           needs_review = false,
           reviewed_at  = now()
     where id = ${eventId}`;

  const role = await sql<Array<{ slug: string; status: string; stage: string | null; exit_reason: string | null }>>`
    select slug, status, stage, exit_reason from job.pipeline_roles where slug = ${ev.role_slug}`;
  return jsonResp({ ok: true, version: VERSION, role: role[0] ?? null, event_id: eventId });
}

// ---------- undo ----------

async function undoEvent(body: Record<string, unknown>): Promise<Response> {
  const eventId = String(body.eventId || '');
  if (!eventId) return err('eventId required');

  const sql = db();
  const rows = await sql<Array<{ id: string; role_slug: string; event_type: string; auto_action: string | null; prev_state: Record<string, unknown> | null; undone_at: string | null }>>`
    select id, role_slug, event_type, auto_action, prev_state, undone_at::text as undone_at
      from job.application_events where id = ${eventId} limit 1`;
  if (!rows.length) return err('event not found', 404);
  const ev = rows[0];
  if (!ev.auto_action || !ev.prev_state) return err('nothing to undo for this event');
  if (ev.undone_at) return jsonResp({ ok: true, version: VERSION, already_undone: true });

  const p = ev.prev_state as { status?: string; stage?: string | null; exit_reason?: string | null; exit_context?: string | null };
  await sql`
    update job.pipeline_roles
       set status       = ${p.status ?? 'Active'},
           stage        = ${p.stage ?? null},
           exit_reason  = ${p.exit_reason ?? null},
           exit_context = ${p.exit_context ?? null},
           status_changed_at = now(), updated_at = now()
     where slug = ${ev.role_slug}`;
  // Undo restores the role AND re-opens the decision: offer/rejection
  // events go back to being a one-click prompt in the feed (dismissible
  // with ×) instead of vanishing forever. Synthetic sweep events don't
  // re-prompt — their idempotency key already blocks a re-sweep.
  const reopenAsPrompt = ev.event_type === 'offer_received' || ev.event_type === 'rejection_any_stage';
  if (reopenAsPrompt) {
    await sql`
      update job.application_events
         set undone_at    = now(),
             auto_action  = null,
             prev_state   = null,
             needs_review = true,
             reviewed_at  = null
       where id = ${eventId}`;
  } else {
    await sql`
      update job.application_events
         set undone_at    = now(),
             auto_action  = null,
             prev_state   = null,
             needs_review = false,
             reviewed_at  = coalesce(reviewed_at, now())
       where id = ${eventId}`;
  }

  const role = await sql<Array<{ slug: string; status: string; stage: string | null; exit_reason: string | null }>>`
    select slug, status, stage, exit_reason from job.pipeline_roles where slug = ${ev.role_slug}`;
  return jsonResp({ ok: true, version: VERSION, role: role[0] ?? null });
}

// ---------- dismiss (feed acknowledge) ----------

async function dismissEvent(body: Record<string, unknown>): Promise<Response> {
  const eventId = String(body.eventId || '');
  if (!eventId) return err('eventId required');
  const sql = db();
  await sql`
    update job.application_events
       set dismissed_at = now(),
           needs_review = false,
           reviewed_at  = coalesce(reviewed_at, now())
     where id = ${eventId}`;
  return jsonResp({ ok: true, version: VERSION });
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
