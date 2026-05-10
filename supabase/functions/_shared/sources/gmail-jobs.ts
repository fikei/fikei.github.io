// gmail-jobs source — pulls job postings from the user's inbox.
//
// Responsibility split:
//   - This plugin decides which messages to look at, asks Haiku to
//     extract { company, title, location, alert_url } per message,
//     calls enrich-job-source to get the canonical JD + URL, and
//     returns RecommendedRoleInput[] back to pull-recommendations.
//   - pull-recommendations does the scoring, dedup, insert.
//   - enrich-job-source owns the cache + ATS resolution.
//
// Config (per user_sources row):
//   {
//     allowSenders?: string[]     // extra sender domains beyond the defaults
//     blockSenders?: string[]     // domains to ignore even if allowlisted
//     query?: string              // override the Gmail search query
//     maxMessagesPerRun?: number  // safety cap; default 50
//   }
//
// State: gmail-scan persists historyId in job.gmail_scan_state so this
// plugin only sees new messages each tick.

import type { Source, RecommendedRoleInput } from './types.ts';
import {
  getServiceClient,
  GMAIL_READONLY_SCOPE,
  getAccessToken,
  userIdForEmail,
} from '../google-tokens.ts';
import { db } from '../job-db.ts';
import {
  type GmailMessage,
  extractBody,
  getHeader,
  getMessage,
  getMessageIdHeader,
  getProfileHistoryId,
  listSinceCursor,
} from '../gmail.ts';

interface GmailJobsCfg {
  allowSenders?: string[];
  blockSenders?: string[];
  query?: string;
  maxMessagesPerRun?: number;
}

// Default sender allowlist — major aggregator domains. Single-role
// alerts from these flow through; recruiter-blast digests get skipped
// by the multi-role detector below. Users can extend via config.
const DEFAULT_ALLOW_SENDERS = [
  'jobs-noreply@linkedin.com',
  'jobalerts-noreply@linkedin.com',
  '@linkedin.com',
  '@wellfound.com',
  '@otta.com',
  '@hellootta.com',
  '@hnhiring.com',
  '@hackernewsletter.com',
  '@builtin.com',
  '@yc.startup.jobs',
  '@workatastartup.com',
];

// Subjects/senders that are almost always multi-role digests. We log
// these to gmail_skipped with reason='multi_role_digest' for review.
const DIGEST_HINTS = [
  'hn hiring',
  'who is hiring',
  'who\'s hiring',
  'jobs for you',                  // LinkedIn weekly recap
  'top jobs of the week',
  'this week\'s top',
  'roundup',
  'job digest',
  'jobs digest',
];

const ANTHROPIC_URL   = 'https://api.anthropic.com/v1/messages';
const ANTHROPIC_MODEL = 'claude-haiku-4-5';

interface ExtractedJob {
  company: string;
  title: string;
  location?: string;
  alertUrl?: string;
  // Haiku confidence 0–1; below 0.5 we drop / log as no_company.
  confidence?: number;
}

export const gmailJobsSource: Source<GmailJobsCfg> = {
  type: 'gmail-jobs',

  async pull(cfg, ctx): Promise<RecommendedRoleInput[]> {
    const sb = getServiceClient();

    // Resolve user_id for the email so we can look up the Google token.
    const userId = await userIdForEmail(sb, ctx.userEmail);
    if (!userId) {
      console.warn(`[gmail-jobs] no user_id for ${ctx.userEmail}; not connected?`);
      return [];
    }

    const tokenRes = await getAccessToken(sb, userId, [GMAIL_READONLY_SCOPE]);
    if (!tokenRes) {
      console.warn(`[gmail-jobs] no gmail token for ${ctx.userEmail}; user has not consented`);
      return [];
    }
    const accessToken = tokenRes.accessToken;

    const sql = db();

    // Cursor: prefer historyId, fall back to last_scan_at.
    const stateRows = await sql<{ history_id: string | null; last_scan_at: string | null }[]>`
      select history_id, last_scan_at from job.gmail_scan_state
       where user_email = ${ctx.userEmail} limit 1`;
    const state = stateRows[0] || { history_id: null, last_scan_at: null };

    const allowSenders = mergeAllowlist(cfg.allowSenders);
    const blockSenders = (cfg.blockSenders || []).map(s => s.toLowerCase());
    const maxMessages = Math.max(1, Math.min(200, cfg.maxMessagesPerRun ?? 50));

    // Build a Gmail query when we don't have a historyId. Using `from:`
    // with the allowlist keeps the result set small. category:updates
    // captures most aggregator alerts.
    const fromFilter = allowSenders.map(s => `from:${s}`).join(' OR ');
    const builtQuery = cfg.query ||
      `(${fromFilter}) -in:spam -in:trash`;

    let listRes;
    try {
      listRes = await listSinceCursor(
        accessToken,
        {
          historyId: state.history_id,
          afterEpochSec: state.last_scan_at
            ? Math.floor(new Date(state.last_scan_at).getTime() / 1000)
            : null,
        },
        builtQuery,
      );
      // Fallback: history expired → re-list by timestamp.
      if (listRes.historyExpired) {
        listRes = await listSinceCursor(
          accessToken,
          { afterEpochSec: state.last_scan_at ? Math.floor(new Date(state.last_scan_at).getTime() / 1000) : null },
          builtQuery,
        );
      }
    } catch (e) {
      await markScanError(sql, ctx.userEmail, (e as Error).message);
      throw e;
    }

    const ids = listRes.messageIds.slice(0, maxMessages);
    console.log(`[gmail-jobs] ${ctx.userEmail} → ${ids.length} candidate messages (history=${!!state.history_id})`);

    const out: RecommendedRoleInput[] = [];

    for (const id of ids) {
      let msg: GmailMessage;
      try {
        msg = await getMessage(accessToken, id, 'full');
      } catch (e) {
        console.warn(`[gmail-jobs] fetch ${id} failed: ${(e as Error).message}`);
        continue;
      }
      const messageId = getMessageIdHeader(msg);

      // Already seen (skipped or ingested)? The unique (source, source_id)
      // constraint on recommended_roles handles dedup at insert time, but
      // we also want to avoid re-processing skipped messages every tick.
      const already = await sql<{ message_id: string }[]>`
        select message_id from job.gmail_skipped
         where user_email = ${ctx.userEmail} and message_id = ${messageId} limit 1`;
      if (already.length) continue;

      const sender = (getHeader(msg, 'From') || '').toLowerCase();
      if (blockSenders.some(b => sender.includes(b))) {
        await logSkipped(sql, ctx.userEmail, msg, messageId, 'blocked_sender');
        continue;
      }
      if (!allowSenders.some(a => sender.includes(a.toLowerCase()))) {
        // Out of allowlist — silently skip. Don't fill gmail_skipped
        // with every newsletter the user gets; only log when we tried
        // and failed.
        continue;
      }

      const subject = getHeader(msg, 'Subject') || '';
      if (looksLikeDigest(subject, sender)) {
        await logSkipped(sql, ctx.userEmail, msg, messageId, 'multi_role_digest', { subject });
        continue;
      }

      const body = extractBody(msg);
      if (!body) {
        await logSkipped(sql, ctx.userEmail, msg, messageId, 'parse_error', { reason: 'empty_body' });
        continue;
      }

      let job: ExtractedJob | null;
      try {
        job = await extractJob({ subject, sender, body });
      } catch (e) {
        await logSkipped(sql, ctx.userEmail, msg, messageId, 'parse_error', { reason: (e as Error).message });
        continue;
      }

      if (!job || !job.company || (job.confidence !== undefined && job.confidence < 0.5)) {
        await logSkipped(sql, ctx.userEmail, msg, messageId, 'no_company', { extracted: job });
        continue;
      }
      if (!job.title) {
        await logSkipped(sql, ctx.userEmail, msg, messageId, 'no_title', { extracted: job });
        continue;
      }

      // Multi-role guard #2: if Haiku confessed multiple roles in one
      // message, we treat it as a digest. Haiku is instructed to set
      // confidence < 0.4 in that case.
      if ((job.confidence ?? 1) < 0.4) {
        await logSkipped(sql, ctx.userEmail, msg, messageId, 'multi_role_digest', { extracted: job });
        continue;
      }

      // Phase 1: emit with the aggregator URL directly. Canonical-URL
      // resolution (resolve LinkedIn alert → Greenhouse posting) is
      // deferred — it adds API surface, schema, and failure modes that
      // aren't load-bearing for "show me job recs in the widget."
      // Click-through to the aggregator is one extra step, acceptable.
      // The enrich-job-source function is still on disk for when this
      // becomes worth re-enabling.
      const url = job.alertUrl;
      if (!url) {
        await logSkipped(sql, ctx.userEmail, msg, messageId, 'no_url', { extracted: job });
        continue;
      }

      out.push({
        source:      'gmail-jobs',
        sourceId:    `gmail:${messageId}`,
        sourceLabel: `Gmail · ${job.company}`,
        url,
        company:     job.company,
        title:       job.title,
        location:    job.location,
        postedAt:    msg.internalDate ? new Date(Number(msg.internalDate)).toISOString() : undefined,
        payload: {
          gmailMessageId: messageId,
          gmailApiId:     msg.id,
          alertUrl:       job.alertUrl ?? null,
          sender,
        },
      });
    }

    // Persist new cursor. Prefer the historyId Gmail returned;
    // otherwise stamp last_scan_at = now (we just consumed everything
    // up to "now" via the timestamp query). On first run with no
    // history_id, ask Gmail what its current historyId is so the next
    // tick goes through the cheap path.
    let nextHistory: string | null = listRes.nextHistoryId;
    if (!nextHistory && !state.history_id) {
      nextHistory = await getProfileHistoryId(accessToken);
    }
    await sql`
      insert into job.gmail_scan_state (user_email, history_id, last_scan_at, last_error, updated_at)
        values (${ctx.userEmail}, ${nextHistory}, now(), null, now())
      on conflict (user_email) do update
        set history_id = coalesce(excluded.history_id, job.gmail_scan_state.history_id),
            last_scan_at = excluded.last_scan_at,
            last_error = null,
            updated_at = now()
    `;

    return out;
  },
};

// ---------- helpers ----------

function mergeAllowlist(extra?: string[]): string[] {
  return [...new Set([...DEFAULT_ALLOW_SENDERS, ...(extra || [])])].map(s => s.toLowerCase());
}

function looksLikeDigest(subject: string, sender: string): boolean {
  const subj = subject.toLowerCase();
  if (DIGEST_HINTS.some(h => subj.includes(h))) return true;
  // hnhiring / yc.startup.jobs digests are always multi-role
  if (/(hnhiring\.com|hackernewsletter\.com)/.test(sender)) return true;
  return false;
}

async function logSkipped(
  sql: ReturnType<typeof db>,
  userEmail: string,
  msg: GmailMessage,
  messageId: string,
  reason: string,
  details?: Record<string, unknown>,
) {
  try {
    await sql`
      insert into job.gmail_skipped (user_email, message_id, gmail_id, sender, subject, reason, details)
        values (${userEmail}, ${messageId}, ${msg.id}, ${getHeader(msg, 'From')}, ${getHeader(msg, 'Subject')}, ${reason}, ${details ? sql.json(details) : null})
      on conflict (user_email, message_id) do nothing`;
  } catch (e) {
    console.warn(`[gmail-jobs] logSkipped failed: ${(e as Error).message}`);
  }
}

async function markScanError(sql: ReturnType<typeof db>, userEmail: string, error: string) {
  await sql`
    insert into job.gmail_scan_state (user_email, last_error, updated_at)
      values (${userEmail}, ${error}, now())
    on conflict (user_email) do update
      set last_error = excluded.last_error, updated_at = now()`;
}

// ---------- Haiku extraction ----------
//
// Single-shot prompt. Returns JSON only. Confidence < 0.5 means "I'm
// not sure this is a job alert" → skip with no_company. Confidence
// < 0.4 means "this looks like multiple roles in one email" → skip
// as digest.

const EXTRACT_SYSTEM = `You extract job postings from email alerts (LinkedIn, Wellfound, Otta, etc).

Return STRICT JSON, no prose:
{ "company": "...", "title": "...", "location": "...", "alertUrl": "...", "confidence": 0.0-1.0 }

Rules:
- Only extract a SINGLE role. If the email contains multiple distinct roles (digest format), set confidence to 0.3 and leave fields blank.
- "alertUrl" is the FIRST clickable link to the role's posting/apply page in the email body. Prefer aggregator URLs over generic homepage links.
- "company" is the hiring company, NOT the email sender. e.g. "Open Phone" not "LinkedIn".
- "location" is the role's location string (e.g. "San Francisco, CA", "Remote, US"). Empty string if absent.
- If you cannot identify a company AND title with reasonable confidence, set confidence < 0.5.
- NEVER invent fields. Empty string > guess.`;

async function extractJob(args: { subject: string; sender: string; body: string }): Promise<ExtractedJob | null> {
  const apiKey = Deno.env.get('ANTHROPIC_API_KEY');
  if (!apiKey) {
    console.warn('[gmail-jobs] ANTHROPIC_API_KEY missing; skipping extraction');
    return null;
  }
  // Truncate body — alerts are ≤ a few KB but HTML pasted ones can be
  // huge. 6k chars is plenty for a single role.
  const trimmed = args.body.slice(0, 6000);
  const userPrompt = [
    `Subject: ${args.subject}`,
    `From: ${args.sender}`,
    `---`,
    trimmed,
  ].join('\n');

  const r = await fetch(ANTHROPIC_URL, {
    method: 'POST',
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: ANTHROPIC_MODEL,
      max_tokens: 400,
      system: EXTRACT_SYSTEM,
      messages: [{ role: 'user', content: userPrompt }],
    }),
  });
  if (!r.ok) throw new Error(`anthropic ${r.status}: ${(await r.text()).slice(0, 200)}`);
  const data = await r.json() as { content: Array<{ type: string; text: string }> };
  const text = (data.content || []).filter(c => c.type === 'text').map(c => c.text).join('').trim();
  // Tolerate ```json fences in case the model adds them despite system.
  const jsonText = text.replace(/^```json\s*/i, '').replace(/^```\s*/, '').replace(/```\s*$/, '').trim();
  let parsed: { company?: string; title?: string; location?: string; alertUrl?: string; confidence?: number };
  try {
    parsed = JSON.parse(jsonText);
  } catch {
    throw new Error(`bad JSON from haiku: ${jsonText.slice(0, 120)}`);
  }
  return {
    company:    (parsed.company || '').trim(),
    title:      (parsed.title || '').trim(),
    location:   (parsed.location || '').trim() || undefined,
    alertUrl:   (parsed.alertUrl || '').trim() || undefined,
    confidence: typeof parsed.confidence === 'number' ? parsed.confidence : undefined,
  };
}

