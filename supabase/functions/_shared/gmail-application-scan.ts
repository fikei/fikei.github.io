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
  rolesCreated:  number;        // pipeline roles auto-created from unmatched receipts
}

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

  const ids = [...idSet];

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

    // Step 3.5 — no pipeline role matched. If the message looks like an
    // application receipt (the user applied outside Ladder, directly on
    // an ATS careers page), auto-create the pipeline role from it.
    // Everything else is a true no-match.
    if (!matchedRole) {
      const created = await maybeCreateRoleFromReceipt(sql, {
        userEmail: args.userEmail,
        msg, messageId, sender, senderDomain, subject, body,
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
    if (!classified) continue;

    // Below the persist floor → drop entirely. Don't poison the timeline
    // with low-confidence guesses.
    if (classified.confidence < PERSIST_CONFIDENCE_FLOOR) continue;

    // 'informational' events are signal-free by definition — newsletters,
    // LinkedIn job-alert digests that mention the company in passing,
    // newsletter pieces about industry news. The per-role name search
    // surfaces these because the company appears somewhere in the body,
    // but they don't represent application progress. Skip them entirely
    // rather than polluting the Activity timeline with newsletter noise.
    if (classified.event_type === 'informational') continue;

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

// Auto-create a pipeline role from an application receipt that matched
// no existing role. Gate → Haiku extraction → blocked-company check →
// insert role (stage 'applied') + applied_confirmation event with
// auto_action='role_created' so it surfaces in the Updates feed.
// Returns true when a role + event landed.
async function maybeCreateRoleFromReceipt(
  sql: ReturnType<typeof db>,
  args: {
    userEmail: string;
    msg: GmailMessage;
    messageId: string;
    sender: string;
    senderDomain: string | null;
    subject: string;
    body: string;
    eventSource: string;
  },
): Promise<boolean> {
  const atsSender = !!args.senderDomain && isAtsPlatformDomain(args.senderDomain);
  if (!atsSender && !RECEIPT_SUBJECT_RE.test(args.subject)) return false;

  let extracted;
  try {
    extracted = await extractUnmatchedApplication({
      subject: args.subject, sender: args.sender, body: args.body,
    });
  } catch (e) {
    console.warn(`[gmail-app-scan] unmatched-extract failed: ${(e as Error).message}`);
    return false;
  }
  if (!extracted || !extracted.is_application_receipt) return false;
  if (extracted.confidence < AUTO_CREATE_CONFIDENCE_FLOOR) return false;
  if (!extracted.company || isUnknownCompanyName(extracted.company)) return false;

  // Respect the user's block list.
  const blocked = await sql<{ ok: number }[]>`
    select 1 as ok from job.blocked_companies
     where user_email = ${args.userEmail}
       and company_norm = ${extracted.company.trim().toLowerCase()}
     limit 1`;
  if (blocked.length) return false;

  const slug = buildRoleSlug(extracted.company, extracted.title || 'application');
  const receivedAt = args.msg.internalDate
    ? new Date(Number(args.msg.internalDate)).toISOString()
    : new Date().toISOString();

  // Create the role. If the slug already exists (e.g. an Archived row the
  // scan's Active/Saved load didn't see), leave it untouched — the event
  // below still attaches, and the user can resurrect from the role page.
  const createdRows = await sql<{ slug: string }[]>`
    insert into job.pipeline_roles (
      slug, company_slug, company_name, title, url, source, status, stage,
      applied_at, last_activity_at, status_changed_at, gmail_thread_ids
    ) values (
      ${slug}, null, ${extracted.company}, ${extracted.title || '(unknown title)'},
      null, 'Gmail Auto-detected', 'Active', 'applied',
      ${receivedAt}, ${receivedAt}, now(), ${[args.msg.threadId]}
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
      ${args.sender}, ${args.subject}, 'applied_confirmation', 'applied',
      ${extracted.summary || `Application received at ${extracted.company}`},
      ${extracted.confidence}, true, false, ${receivedAt}, ${args.eventSource},
      'role_created', null
    )
    on conflict (gmail_message_id) do nothing
    returning id`;
  if (!inserted.length) return false;

  console.log(`[gmail-app-scan] auto-created role ${slug} from receipt (${args.sender})${createdRows.length ? '' : ' — slug existed, event attached only'}`);
  return true;
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
