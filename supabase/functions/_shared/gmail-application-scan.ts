// gmail-application-scan — second-pass scan over the inbox that looks
// for progress signals on pipeline applications (not new role recs).
//
// Called by:
//   - gmail-jobs.ts as a side-effect at the end of pull() (live scan,
//     rolling 7-day window with Message-ID dedup).
//   - application-events function with action='backfill' (30-day window,
//     batches of 5 messages, processed across ScheduleWakeup intervals).
//
// Privacy contract is identical to gmail-jobs.ts: raw bodies never
// persist. Only Haiku-extracted summary + structured fields land in
// job.application_events.

import { db } from './job-db.ts';
import {
  type GmailMessage,
  ensureAndApplyLabel,
  extractBody,
  getHeader,
  getMessage,
  getMessageIdHeader,
} from './gmail.ts';

// Every Gmail message we classify into an application event gets
// stamped with this label so the user can audit what we've touched.
// Mirrors the labeling in the gmail-jobs source plugin.
const LADDER_LABEL = 'Ladder';
import {
  classifyApplicationMessage,
  extractUnmatchedApplication,
  extractUnmatchedOpportunity,
  type ApplicationEventType,
  type ClassifiedApplicationEvent,
  ATS_PLATFORM_DOMAINS,
  AUTO_CREATE_CONFIDENCE_FLOOR,
  AUTO_RESOLVE,
  FORWARD_AUTO_ADVANCE,
  PERSIST_CONFIDENCE_FLOOR,
  THREAD_ASSOCIATION_FLOOR,
  shouldNeedReview,
  stageForEventType,
} from './gmail-application-classifier.ts';
import { roleSlug as buildRoleSlug } from './job-auth.ts';
import { fetchJdText } from './job-fit-haiku.ts';

const GMAIL_BASE = 'https://gmail.googleapis.com/gmail/v1/users/me';

// Top-level stage ordering. Used to enforce forward-only auto-advance.
// drafting / null < applied < interviewing < offer
const STAGE_RANK: Record<string, number> = {
  '':            0,
  'drafting':    0,
  'applied':     1,
  'interviewing': 2,
  'offer':       3,
};

interface PipelineRoleRow {
  slug:               string;
  company_name:       string;
  company_norm:       string;
  title:              string;
  stage:              string | null;
  status:             string;
  exit_reason:        string | null;
  exit_context:       string | null;
  applied_at:         string | null;
  gmail_thread_ids:   string[];
  process_outline:    Record<string, unknown> | null;
  hiring_domain:      string | null;
}

export interface ApplicationScanResult {
  classified:    number;        // messages handed to Haiku
  inserted:      number;        // event rows actually inserted
  autoAdvanced:  number;        // roles whose stage moved forward
  autoResolved:  number;        // offers/rejections the scan acted on (undo-able)
  needsReview:   number;        // events flagged for user attention
  skippedNoMatch:number;        // messages where no role could be matched
  rolesCreated:  number;        // pipeline roles auto-created (receipts + engaged threads)
}

// Pass 3 (engaged-thread discovery) caps: threads.get calls are the
// expensive part, and each engaged thread costs at most one Haiku call.
const MAX_DISCOVERY_THREADS = 8;
// Senders that never open an opportunity thread — job boards, calendar
// robots, no-reply automation. The engaged-thread gate already implies
// the user replied in the thread; this just skips obvious machinery.
const DISCOVERY_NOISE_SENDER_RE = /\b(no-?reply|notifications?|newsletter|calendar-notification|mailer-daemon|do-?not-?reply)\b|@(linkedin\.com|wellfound\.com|otta\.com|builtin\.com|hnhiring\.com|substack\.com)\b/i;

export async function scanApplicationResponses(args: {
  userEmail: string;
  accessToken: string;
  mode?: 'live' | 'backfill';
  // backfill caps the number of getMessage / Haiku calls per invocation;
  // the caller paginates by re-firing across ScheduleWakeup intervals.
  maxMessages?: number;
  // backfill window override (live defaults to 7d, backfill to 30d)
  windowDays?: number;
  // backfill optional role-slug filter (process one role at a time)
  roleSlug?: string;
  // wall-clock budget in ms (default 40s) — caps the per-role Gmail
  // searches + message processing so this side-effect can't time out the
  // host run.
  budgetMs?: number;
}): Promise<ApplicationScanResult> {
  const sql = db();
  const mode = args.mode ?? 'live';
  const maxMessages = Math.max(1, Math.min(50, args.maxMessages ?? (mode === 'backfill' ? 5 : 30)));
  const windowDays = Math.max(1, args.windowDays ?? (mode === 'backfill' ? 30 : 7));
  // Wall-clock budget. This scan runs inside gmail-jobs.pull() BEFORE the
  // recs cursor write + insert, so if it overruns the 150s function limit
  // the whole run 504s and NOTHING commits — no recs, no cursor advance.
  // With a large pipeline (50+ roles × sequential Gmail searches) that was
  // exactly the failure. Time-box it: when the budget is spent, stop and
  // let the rest of the run finish. Side-effect, not critical path.
  const deadline = Date.now() + Math.max(5_000, args.budgetMs ?? 40_000);

  const out: ApplicationScanResult = {
    classified: 0, inserted: 0, autoAdvanced: 0, autoResolved: 0, needsReview: 0, skippedNoMatch: 0,
    rolesCreated: 0,
  };
  // Gmail API ids of every message that produced at least one event row,
  // collected so we can stamp the Ladder label in one batchModify call
  // at end-of-scan.
  const labelTargets: string[] = [];

  // Load active pipeline roles + best-known domain via hiring_companies cache.
  // company_name is the join key (case-insensitive). hiring_companies.name_norm
  // is a generated column.
  const roles = await sql<PipelineRoleRow[]>`
    select r.slug,
           r.company_name,
           lower(trim(r.company_name))         as company_norm,
           r.title,
           r.stage,
           r.status,
           r.exit_reason,
           r.exit_context,
           r.applied_at::text                  as applied_at,
           coalesce(r.gmail_thread_ids, '{}')  as gmail_thread_ids,
           r.process_outline,
           hc.domain                           as hiring_domain
      from job.pipeline_roles r
      left join job.hiring_companies hc
        on hc.name_norm = lower(trim(r.company_name))
     where r.status in ('Active', 'Saved')
       and (${args.roleSlug ?? null}::text is null or r.slug = ${args.roleSlug ?? null})
       and r.deleted_at is null
     order by
       case when r.status = 'Active' then 0 else 1 end,
       coalesce(r.engaged_at, r.applied_at) desc nulls last,
       r.created_at desc
  `;
  // An empty pipeline only short-circuits role-scoped backfills. The
  // general scan still runs pass 1 (ATS-platform senders) so unmatched
  // application receipts can auto-create the first pipeline rows.
  if (!roles.length && args.roleSlug) return out;

  // Build domain → role lookup. Multiple roles may share a domain
  // (same company, multiple openings) — keep all candidates so the
  // classifier-time match can disambiguate via title-token overlap.
  const domainToRoles = new Map<string, PipelineRoleRow[]>();
  for (const r of roles) {
    if (r.hiring_domain) {
      const k = r.hiring_domain.toLowerCase();
      const arr = domainToRoles.get(k) ?? [];
      arr.push(r);
      domainToRoles.set(k, arr);
    }
  }

  // Thread → role association (poison-resistant: thread_ids only land
  // after confidence ≥ 0.8 events).
  const threadToRole = new Map<string, PipelineRoleRow>();
  for (const r of roles) {
    for (const t of r.gmail_thread_ids) threadToRole.set(t, r);
  }

  // Build the Gmail query set. Three passes — each contributes message
  // IDs that we then dedup, fetch, and try to classify:
  //
  //   0. Engaged-thread discovery — threads the user replied to, for
  //      opportunities Ladder has never seen. Runs FIRST: it's cheap
  //      (one threads.list + ≤8 threads.get) and must not be starved by
  //      the expensive per-role name search, which can eat the whole
  //      wall-clock budget on a large pipeline.
  //   1. Sender-domain pass — companies with a known domain in
  //      hiring_companies, plus the ATS-platform allowlist. Cheap, broad.
  //   2. Per-role name pass — for each active role, search the inbox
  //      for the literal company name. Catches direct human emails from
  //      a recruiter's personal gmail / hiring-manager's @yahoo / any
  //      sender whose domain we don't have cached. Capped at 20 IDs per
  //      role and we exclude the obvious noise senders.
  //
  // All three streams hit the same matching gauntlet below; Message-ID
  // dedup against application_events ensures we never re-classify.

  // Pass 0: engaged-thread discovery. Threads the USER has replied to
  // recently are the strongest signal for an in-progress conversation —
  // a hiring-manager back-and-forth at a company Ladder has never seen
  // won't surface via passes 1/2 (unknown domain, unknown company name).
  // For each replied thread not already pinned to a role, queue its
  // latest inbound message; the no-match branch below runs the
  // opportunity extractor on it. Rejected messages land in gmail_skipped
  // (reason 'not_opportunity') so we never re-classify them.
  const engagedThreads = new Set<string>();
  const discoveryIds: string[] = [];
  try {
    const skippedRows = await sql<{ gmail_id: string }[]>`
      select gmail_id from job.gmail_skipped
       where user_email = ${args.userEmail} and reason = 'not_opportunity'`;
    const alreadyRejected = new Set(skippedRows.map(r => r.gmail_id));

    // Wider window than the live scan's 7d: an active conversation can
    // lull for a week+ between replies and still be very much alive.
    const sentWindowDays = Math.max(windowDays, 14);
    const sentThreadIds = await listThreadsByQuery(
      args.accessToken, `in:sent newer_than:${sentWindowDays}d -in:trash`, 50);
    // Cap counts QUEUED messages (the Haiku spend), not thread fetches —
    // otherwise already-rejected threads eat the budget every run and can
    // permanently starve newer conversations. Metadata fetches are cheap
    // and bounded by the 50-thread list + the deadline.
    for (const threadId of sentThreadIds) {
      if (discoveryIds.length >= MAX_DISCOVERY_THREADS || Date.now() > deadline) break;
      if (threadToRole.has(threadId)) continue;
      try {
        const r = await fetch(`${GMAIL_BASE}/threads/${threadId}?format=metadata&metadataHeaders=From`, {
          headers: { Authorization: `Bearer ${args.accessToken}` } });
        if (!r.ok) continue;
        const thread = await r.json() as { messages?: GmailMessage[] };
        // Latest inbound message = the other party's most recent word.
        const inbound = (thread.messages || []).filter(m => {
          const from = (getHeader(m, 'From') || '').toLowerCase();
          return from && !from.includes(args.userEmail.toLowerCase())
            && !DISCOVERY_NOISE_SENDER_RE.test(from);
        });
        const latest = inbound[inbound.length - 1];
        if (!latest || alreadyRejected.has(latest.id)) continue;
        engagedThreads.add(threadId);
        discoveryIds.push(latest.id);
      } catch (e) {
        console.warn(`[gmail-app-scan] thread fetch ${threadId} failed: ${(e as Error).message}`);
      }
    }
    console.log(`[gmail-app-scan] discovery: ${discoveryIds.length} engaged thread(s) queued of ${sentThreadIds.length} sent`);
  } catch (e) {
    console.warn(`[gmail-app-scan] discovery pass failed: ${(e as Error).message}`);
  }

  const senderDomains = new Set<string>();
  for (const d of domainToRoles.keys()) senderDomains.add(d);
  for (const d of ATS_PLATFORM_DOMAINS) senderDomains.add(d);

  const idSet = new Set<string>();

  if (senderDomains.size > 0) {
    const fromClause = [...senderDomains].map(d => `from:${d}`).join(' OR ');
    const domainQuery = `(${fromClause}) -in:spam -in:trash newer_than:${windowDays}d`;
    for (const id of await listMessagesByQuery(args.accessToken, domainQuery, maxMessages * 3)) {
      idSet.add(id);
    }
  }

  // Pass 2: per-role name search. The filter strips aggregator newsletter
  // senders + the role's own canonical URL — those messages are either
  // already on the recs path (linkedin alerts) or noisy (job board
  // newsletters mentioning the company in passing).
  //
  // NOTE: we do NOT restrict to `in:inbox`. Many recruiter threads get
  // filed into labels (e.g. Career/Networking) which removes them from
  // the inbox view. `-in:spam -in:trash` keeps the obvious junk out
  // without losing labeled-but-archived recruiter conversations.
  const NEWSLETTER_NEGATIVES = '-from:linkedin.com -from:wellfound.com -from:otta.com -from:builtin.com -from:hnhiring.com';
  // Cap covers the whole current pipeline; roles are pre-sorted Active
  // first, then by most-recent engagement. If the pipeline ever grows
  // past this, the tail is silently skipped — bump or paginate.
  for (const role of roles.slice(0, 60)) {
    if (Date.now() > deadline) {
      console.warn(`[gmail-app-scan] name-search budget spent; scanned subset of ${roles.length} roles`);
      break;
    }
    // Build a candidate-name set per role. Start with company_name when
    // it looks real; add the title-derived company token when it
    // doesn't (rows added via /add-role sometimes land as
    // "(unknown company)" with the actual company sitting in the title
    // — e.g. "Product Manager, Meridian").
    const candidates = candidateNamesForSearch(role);
    for (const candidate of candidates) {
      const quoted = `"${candidate.replace(/"/g, '\\"')}"`;
      const nameQuery = `${quoted} -in:spam -in:trash newer_than:${windowDays}d ${NEWSLETTER_NEGATIVES}`;
      try {
        for (const id of await listMessagesByQuery(args.accessToken, nameQuery, 20)) {
          idSet.add(id);
        }
      } catch (e) {
        console.warn(`[gmail-app-scan] name-search '${candidate}' failed: ${(e as Error).message}`);
      }
    }
  }

  // Discovery ids process FIRST — they're few (≤8), high-value, and the
  // maxMessages cap would otherwise starve them behind hundreds of
  // pass-1/2 ids.
  const ids = [...new Set([...discoveryIds, ...idSet])];

  let processed = 0;
  for (const id of ids) {
    if (processed >= maxMessages) break;
    if (Date.now() > deadline) {
      console.warn(`[gmail-app-scan] processing budget spent after ${processed} msgs`);
      break;
    }

    let msg: GmailMessage;
    try {
      msg = await getMessage(args.accessToken, id, 'full');
    } catch (e) {
      console.warn(`[gmail-app-scan] fetch ${id} failed: ${(e as Error).message}`);
      continue;
    }
    const messageId = getMessageIdHeader(msg);

    // Dedup against events already persisted.
    const dup = await sql<{ id: string }[]>`
      select id from job.application_events
       where gmail_message_id = ${messageId} limit 1`;
    if (dup.length) continue;

    processed++;

    const sender = (getHeader(msg, 'From') || '').toLowerCase();
    const subject = getHeader(msg, 'Subject') || '';
    const body = extractBody(msg);
    if (!body) continue;

    // Skip user's own outbound messages — those are replies *from* the
    // candidate, not status updates *about* the application. The thread-
    // walk in application-events handles outbound detection separately
    // (for needs_user_reply); here we only want inbound classifications.
    if (sender.includes(args.userEmail.toLowerCase())) continue;

    const senderDomain = extractDomain(sender);

    // Step 1 — thread continuity wins. If the thread is already
    // associated with a role, classify in that role's context.
    let matchedRole: PipelineRoleRow | null = threadToRole.get(msg.threadId) ?? null;

    // Step 2 — sender-domain match against a pipeline company.
    if (!matchedRole && senderDomain && domainToRoles.has(senderDomain)) {
      const candidates = domainToRoles.get(senderDomain)!;
      matchedRole = candidates.length === 1
        ? candidates[0]
        : pickByTitleOverlap(candidates, subject, body);
    }

    // Step 3 — company-name-in-body match. Applies to ANY sender we
    // couldn't match by domain. Catches direct human emails from
    // recruiter @gmail addresses, hiring-manager @yahoo addresses, and
    // any sender whose company domain we don't have cached. The
    // confidence floor in classifyApplicationMessage still gates poison.
    //
    // For sentinel "(unknown company)" rows we also try title-derived
    // company tokens so the gauntlet matches roles whose real company
    // sits in the title field.
    if (!matchedRole) {
      const haystack = `${subject}\n${body}`.toLowerCase();
      const hits = roles.filter(r => {
        for (const cand of candidateNamesForSearch(r)) {
          if (cand.length >= 3 && haystack.includes(cand.toLowerCase())) return true;
        }
        return false;
      });
      if (hits.length === 1) matchedRole = hits[0];
      else if (hits.length > 1) matchedRole = pickByTitleOverlap(hits, subject, body);
    }

    const engaged = engagedThreads.has(msg.threadId);
    // Engaged messages that come up empty in role context fall through
    // here. The step-3 substring match is easily fooled on discovery
    // messages — "Google Meet" boilerplate in a scheduling email matches
    // a saved Google role, the classifier correctly calls it
    // 'informational' for THAT role, and a genuinely new opportunity
    // vanishes without a trace. Rejections persist to gmail_skipped, so
    // this costs at most one extra Haiku call per engaged thread.
    const tryEngagedCreate = async (): Promise<void> => {
      const created = await maybeCreateRoleFromUnmatched(sql, {
        userEmail: args.userEmail,
        msg, messageId, sender, senderDomain, subject, body,
        engaged: true,
        eventSource: mode === 'backfill' ? 'gmail-backfill' : 'gmail-scan',
      });
      if (created) {
        out.inserted++;
        out.rolesCreated++;
        labelTargets.push(msg.id);
      }
    };

    // Step 3.5 — no pipeline role matched. Two auto-create paths:
    // application receipts (the user applied outside Ladder, directly on
    // an ATS careers page), and engaged threads (an in-progress
    // conversation the user is replying to — hiring manager, recruiter —
    // with no saved posting behind it). Everything else is a true no-match.
    if (!matchedRole) {
      const created = await maybeCreateRoleFromUnmatched(sql, {
        userEmail: args.userEmail,
        msg, messageId, sender, senderDomain, subject, body,
        engaged,
        eventSource: mode === 'backfill' ? 'gmail-backfill' : 'gmail-scan',
      });
      if (created) {
        out.classified++;
        out.inserted++;
        out.rolesCreated++;
        labelTargets.push(msg.id);
      } else {
        out.skippedNoMatch++;
      }
      continue;
    }

    // Step 4 — classify with Haiku.
    out.classified++;
    let classified: ClassifiedApplicationEvent | null = null;
    try {
      classified = await classifyApplicationMessage({
        subject,
        sender,
        body,
        companyName:  matchedRole.company_name,
        roleTitle:    matchedRole.title,
        appliedAt:    matchedRole.applied_at ?? undefined,
        currentStage: matchedRole.stage,
      });
    } catch (e) {
      console.warn(`[gmail-app-scan] classify failed: ${(e as Error).message}`);
      continue;
    }
    if (!classified) {
      if (engaged) await tryEngagedCreate();
      continue;
    }

    // Below the persist floor → drop entirely. Don't poison the timeline
    // with low-confidence guesses. Engaged messages get the opportunity
    // extractor before we give up on them.
    if (classified.confidence < PERSIST_CONFIDENCE_FLOOR) {
      if (engaged) await tryEngagedCreate();
      continue;
    }

    // 'informational' events are signal-free by definition — newsletters,
    // LinkedIn job-alert digests that mention the company in passing,
    // newsletter pieces about industry news. The per-role name search
    // surfaces these because the company appears somewhere in the body,
    // but they don't represent application progress. Skip them entirely
    // rather than polluting the Activity timeline with newsletter noise.
    // Engaged messages fall through to the opportunity extractor: an
    // in-progress conversation that is 'informational' for the (often
    // substring-mis)matched role may be a new opportunity elsewhere.
    if (classified.event_type === 'informational') {
      if (engaged) await tryEngagedCreate();
      continue;
    }

    // Decide auto-advance + needs_review per the locked policy.
    const adv = FORWARD_AUTO_ADVANCE[classified.event_type];
    const currentRank = STAGE_RANK[matchedRole.stage ?? ''] ?? 0;
    const wouldRank   = adv ? STAGE_RANK[adv.stage] : 0;
    const autoApply   = !!adv
                      && classified.confidence >= adv.floor
                      && wouldRank > currentRank;
    const needsReview = shouldNeedReview(classified.event_type, classified.confidence);

    // Proactive resolution — offers/rejections at or above the floor are
    // acted on now and surface as undo-able rows in the Updates feed.
    // stage_offer stays forward-only; archive never re-archives.
    const auto = AUTO_RESOLVE[classified.event_type];
    const autoResolve = !!auto
      && classified.confidence >= auto.floor
      && (auto.action !== 'stage_offer' || STAGE_RANK['offer'] > currentRank)
      && (auto.action !== 'archived'    || matchedRole.status !== 'Archive');

    const autoAction = autoResolve && auto
      ? auto.action
      : (autoApply ? 'stage_advance' : null);
    // prev_state powers Undo — captured for every mutation the scan makes.
    const prevState = autoAction ? {
      status:       matchedRole.status,
      stage:        matchedRole.stage,
      exit_reason:  matchedRole.exit_reason,
      exit_context: matchedRole.exit_context,
    } : null;

    const detectedStage = stageForEventType(classified.event_type);
    const receivedAt    = msg.internalDate
                            ? new Date(Number(msg.internalDate)).toISOString()
                            : new Date().toISOString();
    const eventSource   = mode === 'backfill' ? 'gmail-backfill' : 'gmail-scan';

    // Insert event row. ON CONFLICT no-op on Message-ID; if some other
    // process already inserted this event, skip silently.
    const inserted = await sql<{ id: string }[]>`
      insert into job.application_events (
        role_slug, gmail_message_id, gmail_thread_id, gmail_api_id,
        sender, subject, event_type, detected_stage,
        summary, confidence, round_label, round_n,
        auto_applied, needs_review, received_at, source,
        auto_action, prev_state
      ) values (
        ${matchedRole.slug}, ${messageId}, ${msg.threadId}, ${msg.id},
        ${sender}, ${subject}, ${classified.event_type}, ${detectedStage},
        ${classified.summary}, ${classified.confidence},
        ${classified.round_label ?? null}, ${classified.round_n ?? null},
        ${autoApply || autoResolve}, ${needsReview}, ${receivedAt}, ${eventSource},
        ${autoAction}, ${prevState ? sql.json(prevState) : null}
      )
      on conflict (gmail_message_id) do nothing
      returning id`;
    if (!inserted.length) continue;
    out.inserted++;
    if (needsReview) out.needsReview++;
    labelTargets.push(msg.id);

    // Update role: last_activity_at always; gmail_thread_ids only at
    // THREAD_ASSOCIATION_FLOOR (poison-resistance); stage/status when the
    // policy fired.
    const associateThread = classified.confidence >= THREAD_ASSOCIATION_FLOOR;
    if (autoResolve && auto?.action === 'archived') {
      const exitReason = await mapRejectionExitReason(sql, matchedRole);
      await sql`
        update job.pipeline_roles
           set status            = 'Archive',
               stage             = null,
               exit_reason       = ${exitReason},
               status_changed_at = now(),
               last_activity_at  = ${receivedAt},
               gmail_thread_ids  = case
                 when ${associateThread} and not (${msg.threadId} = any(gmail_thread_ids))
                   then gmail_thread_ids || ${msg.threadId}::text
                 else gmail_thread_ids
               end,
               updated_at        = now()
         where slug = ${matchedRole.slug}`;
      out.autoResolved++;
    } else if (autoResolve && auto?.action === 'stage_offer') {
      await sql`
        update job.pipeline_roles
           set status            = 'Active',
               stage             = 'offer',
               status_changed_at = now(),
               last_activity_at  = ${receivedAt},
               gmail_thread_ids  = case
                 when ${associateThread} and not (${msg.threadId} = any(gmail_thread_ids))
                   then gmail_thread_ids || ${msg.threadId}::text
                 else gmail_thread_ids
               end,
               updated_at        = now()
         where slug = ${matchedRole.slug}`;
      out.autoResolved++;
    } else if (autoApply && adv) {
      await sql`
        update job.pipeline_roles
           set stage             = ${adv.stage},
               status_changed_at = now(),
               last_activity_at  = ${receivedAt},
               gmail_thread_ids  = case
                 when ${associateThread} and not (${msg.threadId} = any(gmail_thread_ids))
                   then gmail_thread_ids || ${msg.threadId}::text
                 else gmail_thread_ids
               end,
               updated_at        = now()
         where slug = ${matchedRole.slug}`;
      out.autoAdvanced++;
    } else {
      await sql`
        update job.pipeline_roles
           set last_activity_at  = ${receivedAt},
               gmail_thread_ids  = case
                 when ${associateThread} and not (${msg.threadId} = any(gmail_thread_ids))
                   then gmail_thread_ids || ${msg.threadId}::text
                 else gmail_thread_ids
               end,
               updated_at        = now()
         where slug = ${matchedRole.slug}`;
    }

    // Update process_outline when classifier emitted explicit round
    // signal. Source ranking: recruiter_email > jd_extract > inferred.
    // Backfill never writes inferred_from_events (per locked decision).
    await maybeUpdateProcessOutline(sql, matchedRole, classified, mode);
  }

  // Apply Ladder label to every message we classified into an event.
  // Best-effort — failures (missing modify scope, transient errors) log
  // but don't throw, since labeling is a side-effect of the scan.
  if (labelTargets.length) {
    try {
      const res = await ensureAndApplyLabel(args.accessToken, labelTargets, LADDER_LABEL);
      if (res.errors.length) console.warn(`[gmail-app-scan] label errors: ${res.errors.slice(0, 3).join(' | ')}`);
      else console.log(`[gmail-app-scan] labeled ${res.labeled} message(s) with '${LADDER_LABEL}'`);
    } catch (e) {
      console.warn(`[gmail-app-scan] label apply failed: ${(e as Error).message}`);
    }
  }

  return out;
}

// ---------- helpers ----------

// Cheap pre-gate before spending a Haiku call on an unmatched message.
// Receipts overwhelmingly come from ATS platform senders; the subject
// regex covers company-domain senders ("careers@acme.com").
const RECEIPT_SUBJECT_RE = /\b(applicat|thank you for (applying|your interest)|we('|’)?( ha)?ve received|application received)/i;

// Auto-create a pipeline role from an unmatched message. Two paths:
//   receipt — ATS sender / receipt subject → extractUnmatchedApplication
//             → role at stage 'applied' + applied_confirmation event.
//   engaged — the user has replied in this thread (pass-3 discovery) →
//             extractUnmatchedOpportunity → role at the extracted stage
//             + stage-mapped event. Rejections persist to gmail_skipped
//             (reason 'not_opportunity') so the thread is never re-judged.
// Both land with auto_action='role_created' so they surface in the
// Updates feed. Returns true when a role + event landed.
async function maybeCreateRoleFromUnmatched(
  sql: ReturnType<typeof db>,
  args: {
    userEmail: string;
    msg: GmailMessage;
    messageId: string;
    sender: string;
    senderDomain: string | null;
    subject: string;
    body: string;
    engaged: boolean;
    eventSource: string;
  },
): Promise<boolean> {
  const atsSender = !!args.senderDomain && isAtsPlatformDomain(args.senderDomain);
  const receiptGate = atsSender || RECEIPT_SUBJECT_RE.test(args.subject);
  if (!receiptGate && !args.engaged) return false;

  let company = '';
  let jobUrl: string | null = null;
  let title = '';
  let stage: 'applied' | 'interviewing' | 'offer' = 'applied';
  let summary = '';
  let confidence = 0;
  let via: 'receipt' | 'opportunity' | null = null;

  if (receiptGate) {
    try {
      const extracted = await extractUnmatchedApplication({
        subject: args.subject, sender: args.sender, body: args.body,
      });
      if (extracted && extracted.is_application_receipt
          && extracted.confidence >= AUTO_CREATE_CONFIDENCE_FLOOR) {
        ({ company, title, summary, confidence } = extracted);
        via = 'receipt';
      }
    } catch (e) {
      console.warn(`[gmail-app-scan] unmatched-extract failed: ${(e as Error).message}`);
    }
  }

  if (!via && args.engaged) {
    try {
      const opp = await extractUnmatchedOpportunity({
        subject: args.subject, sender: args.sender, body: args.body,
      });
      if (opp && opp.is_job_opportunity && opp.confidence >= AUTO_CREATE_CONFIDENCE_FLOOR
          && opp.company && !isUnknownCompanyName(opp.company)) {
        ({ company, title, stage, summary, confidence } = opp);
        jobUrl = opp.url;
        via = 'opportunity';
      } else {
        // Remember the verdict — engaged threads resurface every run for
        // the whole window, and each re-judge is a Haiku call.
        await sql`
          insert into job.gmail_skipped (user_email, message_id, gmail_id, sender, subject, reason, details)
          values (${args.userEmail}, ${args.messageId}, ${args.msg.id}, ${args.sender},
                  ${args.subject}, 'not_opportunity',
                  ${sql.json({ confidence: opp?.confidence ?? null, company: opp?.company ?? null })})
          on conflict (user_email, message_id) do nothing`;
        return false;
      }
    } catch (e) {
      console.warn(`[gmail-app-scan] opportunity-extract failed: ${(e as Error).message}`);
      return false;
    }
  }

  if (!via) return false;
  if (!company || isUnknownCompanyName(company)) return false;

  // Respect the user's block list.
  const blocked = await sql<{ ok: number }[]>`
    select 1 as ok from job.blocked_companies
     where user_email = ${args.userEmail}
       and company_norm = ${company.trim().toLowerCase()}
     limit 1`;
  if (blocked.length) return false;

  const slug = buildRoleSlug(company, title || 'application');
  const receivedAt = args.msg.internalDate
    ? new Date(Number(args.msg.internalDate)).toISOString()
    : new Date().toISOString();

  const eventType     = via === 'receipt' ? 'applied_confirmation'
    : stage === 'offer' ? 'offer_received'
    : stage === 'interviewing' ? 'screen_scheduled'
    : 'applied_confirmation';
  const detectedStage = via === 'receipt' ? 'applied' : stage;
  const appliedAt     = detectedStage === 'applied' ? receivedAt : null;

  // Create the role. If the slug already exists (e.g. an Archived row the
  // scan's Active/Saved load didn't see), leave it untouched — the event
  // below still attaches, and the user can resurrect from the role page.
  // The whole write is fenced: an insert failure here (a constraint drift
  // like the pre-164 auto_action CHECK) must cost this message only, not
  // abort the entire scan run.
  try {
    const createdRows = await sql<{ slug: string }[]>`
      insert into job.pipeline_roles (
        slug, company_slug, company_name, title, url, source, status, stage,
        applied_at, last_activity_at, status_changed_at, gmail_thread_ids
      ) values (
        ${slug}, null, ${company}, ${title || '(unknown title)'},
        ${jobUrl}, 'Gmail Auto-detected', 'Active', ${detectedStage},
        ${appliedAt}, ${receivedAt}, now(), ${[args.msg.threadId]}
      )
      on conflict (slug) do nothing
      returning slug`;

    const inserted = await sql<{ id: string }[]>`
      insert into job.application_events (
        role_slug, gmail_message_id, gmail_thread_id, gmail_api_id,
        sender, subject, event_type, detected_stage,
        summary, confidence, auto_applied, needs_review, received_at, source,
        auto_action, prev_state
      ) values (
        ${slug}, ${args.messageId}, ${args.msg.threadId}, ${args.msg.id},
        ${args.sender}, ${args.subject}, ${eventType}, ${detectedStage},
        ${summary || `${via === 'receipt' ? 'Application received' : 'In-progress conversation detected'} at ${company}`},
        ${confidence}, true, false, ${receivedAt}, ${args.eventSource},
        'role_created', null
      )
      on conflict (gmail_message_id) do nothing
      returning id`;
    if (!inserted.length) return false;

    console.log(`[gmail-app-scan] auto-created role ${slug} from ${via} (${args.sender})${createdRows.length ? '' : ' — slug existed, event attached only'}`);
    // Resolve the actual posting — url (when the email had none),
    // description, location — so the grade cron can score the role
    // instead of it sitting bare at a floor fit. Best-effort side quest.
    if (createdRows.length) {
      try {
        await resolveCreatedRole(sql, slug, company, title, jobUrl);
      } catch (e) {
        console.warn(`[gmail-app-scan] resolve ${slug} failed: ${(e as Error).message}`);
      }
    }
    return true;
  } catch (e) {
    console.warn(`[gmail-app-scan] auto-create ${slug} failed: ${(e as Error).message}`);
    return false;
  }
}

// ---------- posting resolution for auto-created roles ----------
// With a URL from the email: fetch the JD text (Workday-aware via
// fetchJdText). Without one: probe the public ATS boards
// (Greenhouse/Lever/Ashby) under company-derived slugs and match the
// title — same trio every other resolver in the pipeline uses.
async function resolveCreatedRole(
  sql: ReturnType<typeof db>,
  slug: string,
  company: string,
  title: string,
  jobUrl: string | null,
): Promise<void> {
  let url = jobUrl;
  let description: string | null = null;
  let location: string | null = null;

  if (url) {
    description = await fetchJdText(url).catch(() => null);
  } else if (title) {
    const found = await findOnAtsBoards(company, title).catch(() => null);
    if (found) ({ url, description, location } = found);
  }
  if (!url && !description) return;
  if (description && description.length < 200) description = null;

  await sql`
    update job.pipeline_roles
       set url         = coalesce(url, ${url}),
           description = coalesce(description, ${description}),
           location    = coalesce(location, ${location}),
           updated_at  = now()
     where slug = ${slug}`;
  console.log(`[gmail-app-scan] resolved ${slug}: url=${url ? 'yes' : 'no'} desc=${description?.length ?? 0} chars`);
}

interface BoardHit { url: string; description: string | null; location: string | null }

function boardSlugCandidates(name: string): string[] {
  const base = name.toLowerCase().trim();
  return [...new Set([
    base.replace(/[^a-z0-9]+/g, ''),
    base.replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, ''),
  ])].filter(Boolean);
}

function titleMatches(a: string, b: string): boolean {
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();
  const na = norm(a), nb = norm(b);
  return !!na && !!nb && (na === nb || na.includes(nb) || nb.includes(na));
}

function stripBoardHtml(html: string): string {
  return (html || '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&#\d+;/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 8000);
}

async function findOnAtsBoards(company: string, title: string): Promise<BoardHit | null> {
  for (const slug of boardSlugCandidates(company)) {
    // Greenhouse — list, then per-job content fetch.
    try {
      const r = await fetch(`https://boards-api.greenhouse.io/v1/boards/${slug}/jobs`);
      if (r.ok) {
        const d = await r.json() as { jobs?: Array<{ id: number; title: string; absolute_url: string; location?: { name: string } }> };
        const hit = (d.jobs || []).find(j => titleMatches(j.title, title));
        if (hit) {
          let description: string | null = null;
          try {
            const jr = await fetch(`https://boards-api.greenhouse.io/v1/boards/${slug}/jobs/${hit.id}`);
            if (jr.ok) description = stripBoardHtml(((await jr.json()) as { content?: string }).content || '');
          } catch { /* listing hit is still useful */ }
          return { url: hit.absolute_url, description, location: hit.location?.name ?? null };
        }
      }
    } catch { /* next provider */ }
    // Lever — postings include the plain description inline.
    try {
      const r = await fetch(`https://api.lever.co/v0/postings/${slug}?mode=json`);
      if (r.ok) {
        const d = await r.json() as Array<{ text: string; hostedUrl: string; descriptionPlain?: string; categories?: { location?: string } }>;
        const hit = (Array.isArray(d) ? d : []).find(j => titleMatches(j.text, title));
        if (hit) return { url: hit.hostedUrl, description: (hit.descriptionPlain || '').slice(0, 8000) || null, location: hit.categories?.location ?? null };
      }
    } catch { /* next provider */ }
    // Ashby — board payload carries descriptionPlain.
    try {
      const r = await fetch(`https://api.ashbyhq.com/posting-api/job-board/${slug}?includeCompensation=true`);
      if (r.ok) {
        const d = await r.json() as { jobs?: Array<{ title: string; jobUrl: string; descriptionPlain?: string; locationName?: string }> };
        const hit = (d.jobs || []).find(j => titleMatches(j.title, title));
        if (hit) return { url: hit.jobUrl, description: (hit.descriptionPlain || '').slice(0, 8000) || null, location: hit.locationName ?? null };
      }
    } catch { /* next candidate */ }
  }
  return null;
}

// Rejection → exit_reason mapping for the auto-archive. Where in the
// process the role died decides the funnel bucket:
//   offer stage                          → other (rare; user can refine)
//   interviewing past the screen         → rejected_after_interview
//   interviewing at the screen           → rejected_after_screen
//   applied / drafting / no stage        → rejected_no_interview
export async function mapRejectionExitReason(
  sql: ReturnType<typeof db>,
  role: { slug: string; stage: string | null },
): Promise<string> {
  const stage = role.stage ?? '';
  if (stage === 'offer') return 'other';
  if (stage === 'interviewing') {
    const past = await sql<{ ok: number }[]>`
      select 1 as ok from job.application_events
       where role_slug = ${role.slug}
         and (event_type in ('next_round_invited', 'take_home_assigned')
              or coalesce(round_n, 1) >= 2)
       limit 1`;
    return past.length ? 'rejected_after_interview' : 'rejected_after_screen';
  }
  return 'rejected_no_interview';
}

async function listMessagesByQuery(accessToken: string, query: string, maxIds: number): Promise<string[]> {
  const ids: string[] = [];
  let pageToken: string | undefined;
  for (let page = 0; page < 5; page++) {
    const url = new URL(`${GMAIL_BASE}/messages`);
    url.searchParams.set('q', query);
    url.searchParams.set('maxResults', String(Math.min(100, maxIds - ids.length)));
    if (pageToken) url.searchParams.set('pageToken', pageToken);
    const r = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
    if (!r.ok) throw new Error(`gmail messages.list ${r.status}: ${(await r.text()).slice(0, 200)}`);
    const data = await r.json() as { messages?: Array<{ id: string }>; nextPageToken?: string };
    for (const m of (data.messages || [])) ids.push(m.id);
    if (ids.length >= maxIds || !data.nextPageToken) break;
    pageToken = data.nextPageToken;
  }
  return ids;
}

async function listThreadsByQuery(accessToken: string, query: string, maxIds: number): Promise<string[]> {
  const ids: string[] = [];
  let pageToken: string | undefined;
  for (let page = 0; page < 5; page++) {
    const url = new URL(`${GMAIL_BASE}/threads`);
    url.searchParams.set('q', query);
    url.searchParams.set('maxResults', String(Math.min(100, maxIds - ids.length)));
    if (pageToken) url.searchParams.set('pageToken', pageToken);
    const r = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
    if (!r.ok) throw new Error(`gmail threads.list ${r.status}: ${(await r.text()).slice(0, 200)}`);
    const data = await r.json() as { threads?: Array<{ id: string }>; nextPageToken?: string };
    for (const t of (data.threads || [])) ids.push(t.id);
    if (ids.length >= maxIds || !data.nextPageToken) break;
    pageToken = data.nextPageToken;
  }
  return ids;
}

function extractDomain(sender: string): string | null {
  const m = sender.match(/@([a-z0-9.-]+)/i);
  return m ? m[1].toLowerCase() : null;
}

// Sentinel company names. Rows added without a known company (via
// /add-role manually or a partial Gmail parse) land with one of these
// in company_name; the real name often sits in the title instead.
const UNKNOWN_COMPANY_SENTINELS = new Set([
  '',
  '(unknown company)',
  'unknown company',
  'unknown',
  'n/a',
  '(unknown)',
]);

function isUnknownCompanyName(name: string | null | undefined): boolean {
  if (!name) return true;
  return UNKNOWN_COMPANY_SENTINELS.has(name.trim().toLowerCase());
}

// Derive candidate company names from a role's title when company_name
// is missing or sentinel-valued. We split the title on commas / "at" /
// "@" / em-dash and return non-trivial tail tokens. Example:
//   "Product Manager, Meridian" → ["Meridian"]
//   "Senior PM at Stripe"       → ["Stripe"]
//   "PM — Anthropic"            → ["Anthropic"]
function titleDerivedCompanies(title: string): string[] {
  if (!title) return [];
  const parts = title.split(/\s*(?:,|—|–|@|\bat\b)\s*/i);
  if (parts.length < 2) return [];
  const tail = parts.slice(1)
    .map(s => s.trim())
    .filter(s => s.length >= 3 && !/^(role|position|opening|opportunity)$/i.test(s));
  return [...new Set(tail)];
}

// Per-role candidate names for the Gmail search pass. Prefer the
// company_name when it looks real; fall through to title-derived
// tokens otherwise.
function candidateNamesForSearch(role: PipelineRoleRow): string[] {
  const out: string[] = [];
  if (!isUnknownCompanyName(role.company_name) && role.company_name.length >= 3) {
    out.push(role.company_name);
  }
  for (const t of titleDerivedCompanies(role.title || '')) {
    if (!out.includes(t)) out.push(t);
  }
  return out;
}

function isAtsPlatformDomain(domain: string): boolean {
  return ATS_PLATFORM_DOMAINS.some(d => domain === d || domain.endsWith(`.${d}`));
}

// Pick the most likely role among multiple candidates with the same
// sender domain. Counts shared meaningful tokens between the role title
// and the message subject/body. Falls back to "most recently active"
// when no signal differentiates.
function pickByTitleOverlap(candidates: PipelineRoleRow[], subject: string, body: string): PipelineRoleRow {
  const haystack = `${subject}\n${body.slice(0, 2000)}`.toLowerCase();
  let best = candidates[0];
  let bestScore = -1;
  for (const c of candidates) {
    const tokens = c.title.toLowerCase().split(/[\s\-/_]+/).filter(t => t.length >= 4);
    let hits = 0;
    for (const t of tokens) if (haystack.includes(t)) hits++;
    if (hits > bestScore) { bestScore = hits; best = c; }
  }
  return best;
}

// process_outline ranking: recruiter_email > jd_extract > inferred_from_events.
// Backfill never overwrites with inferred. Live scan: only update when
// explicit signal (round_n or expected_total_rounds) is present.
async function maybeUpdateProcessOutline(
  sql: ReturnType<typeof db>,
  role: PipelineRoleRow,
  c: ClassifiedApplicationEvent,
  mode: 'live' | 'backfill',
): Promise<void> {
  const hasExplicit = !!c.round_label && (c.round_n !== undefined || c.expected_total_rounds !== undefined);
  if (!hasExplicit) return;

  const SOURCE_RANK: Record<string, number> = {
    'recruiter_email':     3,
    'jd_extract':          2,
    'inferred_from_events':1,
  };

  const existing = role.process_outline as (
    | { source?: string; confidence?: number; rounds?: Array<{ label: string; order: number; completed: boolean }>; expected_total_rounds?: number }
    | null
  );

  // Per the decision: backfill only writes explicit signals (recruiter_email).
  const newSource = 'recruiter_email';
  if (existing && existing.source && (SOURCE_RANK[existing.source] ?? 0) > SOURCE_RANK[newSource]) return;

  // Merge / build rounds. Insert this round_label at round_n (1-based)
  // and mark it complete. Don't clobber other rounds.
  const rounds = (existing?.rounds ?? []).slice();
  const order = c.round_n ?? (rounds.length + 1);
  const labelExisting = rounds.find(r => r.order === order);
  if (labelExisting) {
    labelExisting.label = c.round_label || labelExisting.label;
    labelExisting.completed = true;
  } else {
    rounds.push({ label: c.round_label || `round ${order}`, order, completed: true });
  }
  rounds.sort((a, b) => a.order - b.order);

  const expectedTotal = c.expected_total_rounds ?? existing?.expected_total_rounds ?? rounds.length;

  const outline = {
    expected_total_rounds: expectedTotal,
    rounds,
    source: newSource,
    confidence: c.confidence,
    last_updated_at: new Date().toISOString(),
  };
  await sql`
    update job.pipeline_roles
       set process_outline = ${sql.json(outline)},
           updated_at      = now()
     where slug = ${role.slug}`;
  // Mode-aware logging: useful when debugging a backfill run.
  if (mode === 'backfill') {
    console.log(`[gmail-app-scan] backfill set process_outline for ${role.slug}: ${rounds.length} rounds`);
  }
}
