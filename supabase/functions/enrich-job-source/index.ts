// enrich-job-source — first-class enrichment step. Takes a (company,
// title?) pair (and an optional aggregator URL) and resolves it to a
// canonical posting on a known ATS. Returns the canonical_url, JD text,
// and ats_provider — or an unresolved flag with a retry timestamp.
//
// Cascade (cheapest → most expensive):
//   1. job.hiring_companies cache hit (resolved row).
//   2. ATS detection from sender domain or company-name guesses against
//      Greenhouse / Lever / Ashby.
//   3. Careers-page scrape (best-effort via direct fetch).
//   4. Mark unresolved with backoff and return.
//
// POST /functions/v1/enrich-job-source
//   body: { company: string, title?: string, hintDomain?: string,
//           hintAtsUrl?: string }
//   →     { resolved: boolean, companyId: uuid,
//           atsProvider?: string, atsSlug?: string,
//           canonicalUrl?: string, jdText?: string,
//           nextRetryAt?: ISO8601 }

const VERSION = '0.7.0';
console.log(`[enrich-job-source] v${VERSION} - enrich ALL aggregator sources + layer-3 generic liveness (non-ATS URL probe, LinkedIn guest API) + stale age-out`);

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { db } from '../_shared/job-db.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15';

interface EnrichRequest {
  company: string;
  title?: string;
  hintDomain?: string;          // 'acme.com' from sender or alert
  hintAtsUrl?: string;          // aggregator URL or any URL that might contain an ATS slug
}

interface EnrichResponse {
  resolved: boolean;
  companyId: string;
  atsProvider?: string;
  atsSlug?: string;
  canonicalUrl?: string;
  jdText?: string;
  nextRetryAt?: string;
  reason?: string;
}

interface CompanyRow {
  id: string;
  name: string;
  domain: string | null;
  ats_provider: string | null;
  ats_slug: string | null;
  careers_url: string | null;
  resolution_status: string;
  retry_count: number;
}

// Backoff schedule for unresolved companies. Capped at 7 days.
function nextRetry(retryCount: number): Date {
  const minutes = Math.min(60 * 24 * 7, [60, 4 * 60, 24 * 60, 3 * 24 * 60, 7 * 24 * 60][Math.min(retryCount, 4)]);
  return new Date(Date.now() + minutes * 60 * 1000);
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405);

  const body = await req.json().catch(() => ({})) as EnrichRequest & { action?: string; limit?: number };

  // Backfill mode — walk N pending Gmail-sourced recs (enrichment_status
  // null or 'unresolved' past retry time), enrich each, write canonical
  // URL + status back. Lets the user drain after a Phase 1.5 cold-start.
  if (body.action === 'backfill') {
    return backfillBatch(Math.max(1, Math.min(15, body.limit ?? 8)));
  }

  // Liveness mode (backlog #9, layer 2) — re-check active ATS-resolved recs
  // against the live board-API open-id set and close the ones whose posting
  // is gone. Covers the Gmail/LinkedIn/theirstack roles that resolved to a
  // Greenhouse/Lever/Ashby posting (tracked-ats is handled by layer 1 in
  // pull-recommendations). Never closes on a board-fetch error.
  if (body.action === 'liveness') {
    return livenessBatch(Math.max(1, Math.min(100, body.limit ?? 40)));
  }

  const company = (body.company || '').trim();
  if (!company) return json({ error: 'company required' }, 400);
  const title = (body.title || '').trim();

  const sql = db();

  // 1) Cache lookup or insert.
  const existing = await sql<CompanyRow[]>`
    select id, name, domain, ats_provider, ats_slug, careers_url, resolution_status, retry_count
      from job.hiring_companies
     where name_norm = lower(trim(${company}))
     limit 1
  `;
  let row = existing[0] as CompanyRow | undefined;
  if (!row) {
    const [inserted] = await sql<CompanyRow[]>`
      insert into job.hiring_companies (name, domain)
        values (${company}, ${normalizeDomain(body.hintDomain) || null})
      on conflict (name_norm) do update
        set domain = coalesce(job.hiring_companies.domain, excluded.domain),
            updated_at = now()
      returning id, name, domain, ats_provider, ats_slug, careers_url, resolution_status, retry_count
    `;
    row = inserted as CompanyRow;
  }

  // Resolved cache hit → try to canonicalize for the title.
  if (row.resolution_status === 'resolved' && row.ats_provider && row.ats_slug) {
    const canonical = await resolveCanonicalForTitle(row, title);
    return json(<EnrichResponse>{
      resolved: !!canonical,
      companyId: row.id,
      atsProvider: row.ats_provider,
      atsSlug: row.ats_slug,
      canonicalUrl: canonical?.url,
      jdText: canonical?.jd,
      reason: canonical ? undefined : 'cached_company_no_title_match',
      nextRetryAt: canonical ? undefined : new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
    });
  }

  // 2) ATS detection.
  const detected = await detectAts({ company, hintDomain: body.hintDomain, hintAtsUrl: body.hintAtsUrl });

  if (detected) {
    // Persist the resolution before we even try to fetch the title —
    // even a partial resolve (provider+slug, no canonical match) helps
    // the next user querying the same company.
    await sql`
      update job.hiring_companies
         set ats_provider = ${detected.provider},
             ats_slug = ${detected.slug},
             careers_url = ${detected.careersUrl ?? null},
             domain = coalesce(domain, ${normalizeDomain(body.hintDomain) || null}),
             resolution_status = 'resolved',
             last_resolved_at = now(),
             retry_count = 0,
             next_retry_at = null,
             updated_at = now()
       where id = ${row.id}
    `;
    const canonical = await resolveCanonicalForTitle({ ...row, ats_provider: detected.provider, ats_slug: detected.slug }, title);
    return json(<EnrichResponse>{
      resolved: !!canonical,
      companyId: row.id,
      atsProvider: detected.provider,
      atsSlug: detected.slug,
      canonicalUrl: canonical?.url,
      jdText: canonical?.jd,
      reason: canonical ? undefined : 'resolved_company_no_title_match',
      nextRetryAt: canonical ? undefined : new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
    });
  }

  // 3) Mark unresolved with backoff.
  const nextCount = (row.retry_count || 0) + 1;
  const retryAt = nextRetry(nextCount);
  await sql`
    update job.hiring_companies
       set resolution_status = 'unresolved',
           retry_count = ${nextCount},
           next_retry_at = ${retryAt.toISOString()},
           updated_at = now()
     where id = ${row.id}
  `;
  return json(<EnrichResponse>{
    resolved: false,
    companyId: row.id,
    nextRetryAt: retryAt.toISOString(),
    reason: 'ats_unresolved',
  });
});

// ---------- Backfill ----------
//
// Walks N pending recommended_roles rows that don't have a canonical
// URL yet (enrichment_status null or 'unresolved' past their retry).
// Calls the same in-process resolve logic per row, writes canonical_url
// + enrichment_status + company_id back. Capped per call so we stay
// under Supabase's 150s wall.

async function backfillBatch(limit: number): Promise<Response> {
  const sql = db();
  // Enrich EVERY aggregator source, not just gmail-jobs — theirstack, wwr,
  // remotive, hn, etc. arrive on aggregator/vanity URLs (workatastartup,
  // weworkremotely, linkedin) and otherwise never get a canonical ATS URL,
  // so they're invisible to liveness AND dedup. tracked-ats is excluded:
  // it's already ATS-native (its url IS the board posting) and liveness
  // layer 1 handles it. resolveOne() leans on company-name ATS detection
  // when the URL itself isn't an ATS link, so non-gmail sources resolve too.
  const rows = await sql<Array<{ id: string; company: string | null; title: string | null; url: string; payload: Record<string, unknown> | null }>>`
    select id, company, title, url, payload
      from job.recommended_roles
     where source <> 'tracked-ats'
       and dismissed_at is null
       and added_to_pipeline_slug is null
       and (
         enrichment_status is null
         or (enrichment_status = 'unresolved' and (enrichment_retry_at is null or enrichment_retry_at <= now()))
       )
     order by suggested_at desc
     limit ${limit}
  `;

  const results: Array<{ id: string; resolved: boolean; reason?: string }> = [];
  for (const r of rows) {
    if (!r.company || !r.title) { results.push({ id: r.id, resolved: false, reason: 'no_company_or_title' }); continue; }
    try {
      const enriched = await resolveOne(r.company, r.title, r.url, r.payload);
      await sql`
        update job.recommended_roles
           set enrichment_status   = ${enriched.resolved ? 'resolved' : 'unresolved'},
               enrichment_retry_at = ${
                 enriched.resolved
                   ? null
                   : (enriched.nextRetryAt ?? new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString())
               },
               canonical_url       = ${enriched.canonicalUrl ?? null},
               company_id          = ${enriched.companyId ?? null},
               url                 = ${enriched.canonicalUrl ?? r.url}
         where id = ${r.id}
      `;
      results.push({ id: r.id, resolved: enriched.resolved });
    } catch (e) {
      results.push({ id: r.id, resolved: false, reason: (e as Error).message.slice(0, 120) });
    }
  }

  const summary = {
    ok: true,
    version: VERSION,
    processed: results.length,
    resolved:  results.filter(x => x.resolved).length,
    results,
  };
  return new Response(JSON.stringify(summary, null, 2), {
    status: 200,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

// ---------- Liveness (layer 2) ----------
//
// Select up to `limit` active ATS-resolved recs, re-check each against its
// board's live open-id set, and close the ones whose posting is gone. We
// fetch each board's list ONCE per invocation (cached by provider:slug) so
// N roles at one company cost a single API call. A board-fetch failure
// SKIPS that slug — we only ever close on a definitive "id absent from a
// successfully-fetched board", never on an error.

interface AtsPosting { provider: 'Greenhouse' | 'Lever' | 'Ashby'; slug: string; jobId: string }

// Parse (provider, slug, jobId) out of a canonical ATS posting URL.
//   Greenhouse: (job-)boards.greenhouse.io/<slug>/jobs/<id>
//   Lever:      jobs.lever.co/<slug>/<id>
//   Ashby:      jobs.ashbyhq.com/<slug>/<id>
function parseAtsPosting(u: string): AtsPosting | null {
  try {
    const url = new URL(u);
    const host = url.hostname.toLowerCase();
    const seg = url.pathname.split('/').filter(Boolean);
    if (/(?:^|\.)(boards|job-boards)\.greenhouse\.io$/.test(host)) {
      const jobsIdx = seg.indexOf('jobs');
      if (jobsIdx >= 1 && seg[jobsIdx + 1]) return { provider: 'Greenhouse', slug: seg[0], jobId: seg[jobsIdx + 1] };
    }
    if (/(?:^|\.)jobs\.lever\.co$/.test(host) && seg.length >= 2) {
      return { provider: 'Lever', slug: seg[0], jobId: seg[seg.length - 1] };
    }
    if (/(?:^|\.)jobs\.ashbyhq\.com$/.test(host) && seg.length >= 2) {
      return { provider: 'Ashby', slug: seg[0], jobId: seg[seg.length - 1] };
    }
  } catch { /* not a URL */ }
  return null;
}

// Vanity / embedded ATS ids: a company hosts its board on its own domain
// (e.g. guild.com/open-positions?gh_jid=7944042, zoominfo.com/careers?gh_jid=…)
// but the posting actually lives on Greenhouse/Ashby. The job id rides in a
// query param; the board SLUG is NOT in the URL, so we pair it with the
// company's resolved hiring_companies.ats_slug.
function embeddedJobId(u: string): { provider: 'Greenhouse' | 'Ashby'; jobId: string } | null {
  try {
    const q = new URL(u).searchParams;
    const gh = q.get('gh_jid');
    if (gh) return { provider: 'Greenhouse', jobId: gh };
    const ash = q.get('ashby_jid');
    if (ash) return { provider: 'Ashby', jobId: ash };
  } catch { /* not a url */ }
  return null;
}

// Resolve a role to a checkable (provider, slug, jobId): a clean ATS URL
// carries all three; a vanity URL carries only the embedded job id, so we
// borrow the slug from the company we already resolved into hiring_companies.
function resolvePosting(
  url: string | null,
  canonical: string | null,
  hc: { provider: string | null; slug: string | null },
): AtsPosting | null {
  const direct = parseAtsPosting(canonical || '') || parseAtsPosting(url || '');
  if (direct) return direct;
  for (const u of [canonical, url]) {
    if (!u) continue;
    const emb = embeddedJobId(u);
    if (emb && hc.provider === emb.provider && hc.slug) {
      return { provider: emb.provider, slug: hc.slug, jobId: emb.jobId };
    }
  }
  return null;
}

// Fetch a board's open postings and return the set of open ids as strings
// (Ashby ids are UUIDs, Greenhouse numbers, Lever strings — compare as
// strings). Returns null on any fetch/parse failure so the caller skips
// rather than closing on error.
async function fetchOpenIds(provider: AtsPosting['provider'], slug: string): Promise<Set<string> | null> {
  const url =
    provider === 'Greenhouse' ? `https://boards-api.greenhouse.io/v1/boards/${slug}/jobs`
    : provider === 'Lever'    ? `https://api.lever.co/v0/postings/${slug}?mode=json`
    :                           `https://api.ashbyhq.com/posting-api/job-board/${slug}`;
  try {
    const r = await fetch(url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(10000) });
    if (!r.ok) return null;
    const data = await r.json();
    const jobs: Array<{ id: unknown }> = Array.isArray(data) ? data : ((data?.jobs as Array<{ id: unknown }>) || []);
    return new Set(jobs.map(j => String(j.id)));
  } catch { return null; }
}

// ---------- Liveness (layer 3) — generic non-ATS + stale age-out ----------
//
// Layers 1/2 only cover tracked-ats and Greenhouse/Lever/Ashby-resolved recs.
// The majority of For You (LinkedIn email alerts, weworkremotely, remotive,
// misc ATS hosts) never got a liveness check and lived forever. Layer 3:
//   * genericLivenessBatch — HEAD/GET-probe non-ATS active recs, close on a
//     definitive 404/410/451. LinkedIn blocks bots on the posting page, so we
//     query its public jobs-guest posting API by job id instead.
//   * ageOutStale — backstop: any active rec we haven't confirmed open in
//     STALE_TTL_DAYS gets closed as 'stale'. Guarantees For You can't show a
//     months-old posting even when the host lies with a 200 (LinkedIn, most
//     aggregators). tracked-ats/ATS-resolved live recs keep last_seen_at
//     fresh via layers 1/2, so this only ever reaps genuinely-stale rows.
const CLOSE_STATUSES = new Set([404, 410, 451]);
const STALE_TTL_DAYS = 45;
const GENERIC_BATCH = 30;

// LinkedIn job id from /jobs/view/<id> or ?currentJobId=<id>.
function linkedInJobId(u: string): string | null {
  try {
    const url = new URL(u);
    if (!/(?:^|\.)linkedin\.com$/.test(url.hostname.toLowerCase())) return null;
    const q = url.searchParams.get('currentJobId');
    if (q && /^\d+$/.test(q)) return q;
    const m = url.pathname.match(/\/jobs\/view\/(\d+)/);
    return m ? m[1] : null;
  } catch { return null; }
}

// 'closed' = definitively gone, 'live' = reachable, 'skip' = inconclusive
// (timeout, anti-bot 429/999, soft 403). We NEVER close on 'skip' — age-out
// is the backstop for postings we can't authoritatively probe.
async function probeRecUrl(u: string): Promise<'closed' | 'live' | 'skip'> {
  const li = linkedInJobId(u);
  if (li) {
    try {
      const r = await fetch(`https://www.linkedin.com/jobs-guest/jobs/api/jobPosting/${li}`, {
        headers: { 'User-Agent': UA }, redirect: 'follow', signal: AbortSignal.timeout(8000),
      });
      if (r.status === 200) return 'live';
      if (r.status === 404 || r.status === 410 || r.status === 400) return 'closed';
      return 'skip';
    } catch { return 'skip'; }
  }
  try {
    let r = await fetch(u, { method: 'HEAD', redirect: 'follow', headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(8000) });
    if (r.status === 405 || r.status === 501) {
      r = await fetch(u, { method: 'GET', redirect: 'follow', headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(8000) });
    }
    if (CLOSE_STATUSES.has(r.status)) return 'closed';
    return 'live';
  } catch { return 'skip'; }
}

async function genericLivenessBatch(
  sql: ReturnType<typeof db>,
  limit: number,
): Promise<{ checked: number; open: number; closed: number; skipped: number }> {
  const rows = await sql<Array<{ id: string; url: string }>>`
    select id, coalesce(canonical_url, url) as url
      from job.recommended_roles
     where closed_at is null
       and dismissed_at is null
       and added_to_pipeline_slug is null
       and source <> 'tracked-ats'
       and coalesce(canonical_url, url) is not null
       and coalesce(canonical_url, url) !~* '(greenhouse|lever|ashbyhq|gh_jid=|ashby_jid=)'
     order by last_seen_at asc nulls first, suggested_at asc
     limit ${limit}
  `;
  const verdicts = await Promise.all(rows.map(async r => ({ id: r.id, v: await probeRecUrl(r.url) })));
  let open = 0, closed = 0, skipped = 0;
  for (const { id, v } of verdicts) {
    if (v === 'closed') {
      closed++;
      await sql`update job.recommended_roles set closed_at = now(), closure_reason = 'url-dead' where id = ${id} and closed_at is null`;
    } else if (v === 'live') {
      open++;
      await sql`update job.recommended_roles set last_seen_at = now() where id = ${id}`;
    } else {
      skipped++;
    }
  }
  return { checked: open + closed, open, closed, skipped };
}

// Close every active rec last confirmed open (or, if never confirmed, first
// suggested) more than STALE_TTL_DAYS ago. Single UPDATE, negligible cost.
async function ageOutStale(sql: ReturnType<typeof db>): Promise<number> {
  const res = await sql`
    update job.recommended_roles
       set closed_at = now(), closure_reason = 'stale'
     where closed_at is null
       and dismissed_at is null
       and added_to_pipeline_slug is null
       and coalesce(last_seen_at, suggested_at) < now() - make_interval(days => ${STALE_TTL_DAYS})
  `;
  return (res as unknown as { count: number }).count;
}

async function livenessBatch(limit: number): Promise<Response> {
  const sql = db();
  // Longest-unchecked first so the cron sweeps the whole pool over time.
  // Join the resolved company so vanity-domain postings (gh_jid/ashby_jid on
  // the company's own careers site) can borrow the board slug we already
  // resolved into hiring_companies.
  const rows = await sql<Array<{ id: string; url: string | null; canonical_url: string | null; hc_provider: string | null; hc_slug: string | null }>>`
    select r.id, r.url, r.canonical_url,
           hc.ats_provider as hc_provider, hc.ats_slug as hc_slug
      from job.recommended_roles r
      left join job.hiring_companies hc on hc.id = r.company_id
     where r.closed_at is null
       and r.dismissed_at is null
       and r.added_to_pipeline_slug is null
       and coalesce(r.canonical_url, r.url) ~* '(greenhouse|lever|ashbyhq|gh_jid=|ashby_jid=)'
     order by r.last_seen_at asc nulls first, r.suggested_at asc
     limit ${limit}
  `;

  const parsed = rows
    .map(r => ({ id: r.id, p: resolvePosting(r.url, r.canonical_url, { provider: r.hc_provider, slug: r.hc_slug }) }))
    .filter((x): x is { id: string; p: AtsPosting } => x.p !== null);

  const boardCache = new Map<string, Set<string> | null>();
  let checked = 0, open = 0, closed = 0, skipped = rows.length - parsed.length;

  for (const { id, p } of parsed) {
    const key = `${p.provider}:${p.slug}`;
    if (!boardCache.has(key)) boardCache.set(key, await fetchOpenIds(p.provider, p.slug));
    const ids = boardCache.get(key);
    if (!ids) { skipped++; continue; }          // board fetch failed → never close
    checked++;
    if (ids.has(String(p.jobId))) {
      open++;
      await sql`update job.recommended_roles set last_seen_at = now(), closed_at = null, closure_reason = null where id = ${id}`;
    } else {
      closed++;
      await sql`update job.recommended_roles set closed_at = now(), closure_reason = 'ats-delisted' where id = ${id}`;
    }
  }

  // Layer 3: probe the non-ATS active recs (LinkedIn/wwr/remotive/misc), then
  // age-out anything we haven't confirmed open in STALE_TTL_DAYS.
  const generic = await genericLivenessBatch(sql, GENERIC_BATCH);
  const agedOut = await ageOutStale(sql);

  const summary = {
    ok: true, version: VERSION,
    ats: { checked, open, closed, skipped },
    generic,
    agedOut,
    // legacy top-level fields (kept for callers that read them)
    checked: checked + generic.checked,
    closed: closed + generic.closed + agedOut,
  };
  console.log(`[enrich-job-source] liveness: ats(checked=${checked} closed=${closed}) generic(checked=${generic.checked} closed=${generic.closed} skipped=${generic.skipped}) agedOut=${agedOut}`);
  return new Response(JSON.stringify(summary, null, 2), {
    status: 200,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

// Same cascade as the public POST handler, but returns the result
// instead of formatting an HTTP response. Used by backfill to avoid
// recursing into the function via HTTP.
async function resolveOne(
  company: string,
  title: string,
  alertUrl: string,
  payload: Record<string, unknown> | null,
): Promise<EnrichResponse> {
  const sql = db();
  const hintAtsUrl = alertUrl;
  const hintDomain = (payload && typeof payload === 'object' && payload['sender'])
    ? String(payload['sender']).match(/@([a-z0-9.-]+)/i)?.[1]
    : undefined;

  const existing = await sql<CompanyRow[]>`
    select id, name, domain, ats_provider, ats_slug, careers_url, resolution_status, retry_count
      from job.hiring_companies
     where name_norm = lower(trim(${company})) limit 1`;
  let row = existing[0];
  if (!row) {
    const [inserted] = await sql<CompanyRow[]>`
      insert into job.hiring_companies (name, domain) values (${company}, ${normalizeDomain(hintDomain) || null})
      on conflict (name_norm) do update set domain = coalesce(job.hiring_companies.domain, excluded.domain), updated_at = now()
      returning id, name, domain, ats_provider, ats_slug, careers_url, resolution_status, retry_count
    `;
    row = inserted;
  }
  // 7 days — when the COMPANY is resolved but the title doesn't match
  // a current posting, we don't want to keep retrying on every drain
  // pass. The role probably just isn't listed under that exact title.
  const titleMissRetry = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();

  if (row.resolution_status === 'resolved' && row.ats_provider && row.ats_slug) {
    const canonical = await resolveCanonicalForTitle(row, title);
    return {
      resolved: !!canonical, companyId: row.id,
      atsProvider: row.ats_provider!, atsSlug: row.ats_slug!,
      canonicalUrl: canonical?.url, jdText: canonical?.jd,
      nextRetryAt: canonical ? undefined : titleMissRetry,
    };
  }
  const detected = await detectAts({ company, hintDomain, hintAtsUrl });
  if (detected) {
    await sql`
      update job.hiring_companies
         set ats_provider = ${detected.provider}, ats_slug = ${detected.slug},
             careers_url = ${detected.careersUrl ?? null}, resolution_status = 'resolved',
             last_resolved_at = now(), retry_count = 0, next_retry_at = null, updated_at = now()
       where id = ${row.id}
    `;
    const canonical = await resolveCanonicalForTitle({ ...row, ats_provider: detected.provider, ats_slug: detected.slug }, title);
    return {
      resolved: !!canonical, companyId: row.id,
      atsProvider: detected.provider, atsSlug: detected.slug,
      canonicalUrl: canonical?.url, jdText: canonical?.jd,
      nextRetryAt: canonical ? undefined : titleMissRetry,
    };
  }
  const nextCount = (row.retry_count || 0) + 1;
  const retryAt = nextRetry(nextCount);
  await sql`
    update job.hiring_companies
       set resolution_status = 'unresolved', retry_count = ${nextCount},
           next_retry_at = ${retryAt.toISOString()}, updated_at = now()
     where id = ${row.id}
  `;
  return { resolved: false, companyId: row.id, nextRetryAt: retryAt.toISOString(), reason: 'ats_unresolved' };
}

// ---------- ATS detection ----------

interface DetectedAts {
  provider: 'Greenhouse' | 'Lever' | 'Ashby';
  slug: string;
  careersUrl?: string;
}

// First, parse any URL we were given (alert URL might already be on
// the ATS). Then guess slugs from a normalized company name and probe
// each ATS's public JSON endpoint until one returns a 200.
async function detectAts(args: { company: string; hintDomain?: string; hintAtsUrl?: string }): Promise<DetectedAts | null> {
  // 1) URL-derived
  if (args.hintAtsUrl) {
    const fromUrl = atsFromUrl(args.hintAtsUrl);
    if (fromUrl) return fromUrl;
  }

  // 2) Slug guesses from company name + (optionally) domain
  const slugs = candidateSlugs(args.company, args.hintDomain);
  for (const slug of slugs) {
    const hit = await probeSlug(slug);
    if (hit) return hit;
  }
  return null;
}

function atsFromUrl(url: string): DetectedAts | null {
  try {
    const u = new URL(url);
    const host = u.hostname.toLowerCase();
    const seg = u.pathname.split('/').filter(Boolean);
    if (/(?:^|\.)(boards|job-boards)\.greenhouse\.io$/.test(host) && seg[0]) {
      return { provider: 'Greenhouse', slug: seg[0], careersUrl: `https://boards.greenhouse.io/${seg[0]}` };
    }
    if (/(?:^|\.)jobs\.lever\.co$/.test(host) && seg[0]) {
      return { provider: 'Lever', slug: seg[0], careersUrl: `https://jobs.lever.co/${seg[0]}` };
    }
    if (/(?:^|\.)jobs\.ashbyhq\.com$/.test(host) && seg[0]) {
      return { provider: 'Ashby', slug: seg[0], careersUrl: `https://jobs.ashbyhq.com/${seg[0]}` };
    }
  } catch { /* fallthrough */ }
  return null;
}

function candidateSlugs(company: string, domain?: string): string[] {
  const base = company.toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  const compact = base.replace(/-/g, '');
  const noSuffix = base.replace(/-(inc|llc|corp|corporation|ltd|labs|hq|ai|io|app)$/i, '');
  const fromDomain = domain ? normalizeDomain(domain)?.split('.')[0] : '';
  const out = [base, compact, noSuffix, fromDomain].filter(Boolean) as string[];
  return [...new Set(out)];
}

async function probeSlug(slug: string): Promise<DetectedAts | null> {
  const probes: Array<{ provider: DetectedAts['provider']; url: string; careers: string }> = [
    { provider: 'Greenhouse', url: `https://boards-api.greenhouse.io/v1/boards/${slug}/jobs`,           careers: `https://boards.greenhouse.io/${slug}` },
    { provider: 'Lever',      url: `https://api.lever.co/v0/postings/${slug}?mode=json`,                careers: `https://jobs.lever.co/${slug}` },
    { provider: 'Ashby',      url: `https://api.ashbyhq.com/posting-api/job-board/${slug}`,             careers: `https://jobs.ashbyhq.com/${slug}` },
  ];
  for (const p of probes) {
    try {
      const r = await fetch(p.url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(8000) });
      if (!r.ok) continue;
      const data = await r.json();
      // Only accept the slug if the board has at least one job — empty
      // boards on the wrong slug are common (squatted / archived
      // tenants). Cheap sanity check.
      const hasJobs =
        (Array.isArray((data as { jobs?: unknown[] }).jobs) && ((data as { jobs: unknown[] }).jobs.length > 0)) ||
        (Array.isArray(data) && data.length > 0);
      if (hasJobs) return { provider: p.provider, slug, careersUrl: p.careers };
    } catch { /* try next */ }
  }
  return null;
}

// ---------- Canonical posting lookup ----------

interface CanonicalHit { url: string; jd: string }

async function resolveCanonicalForTitle(
  row: { ats_provider: string | null; ats_slug: string | null },
  title: string,
): Promise<CanonicalHit | null> {
  if (!row.ats_provider || !row.ats_slug || !title) return null;
  const titleLc = title.toLowerCase();

  // Pull the company's live postings into a uniform shape, then match. We
  // try cheap token overlap first; if that misses we ask Haiku to pick the
  // same role semantically (board titles drift — "Product Lead, Platform"
  // for an alert that said "Senior Product Manager"). Haiku returns none
  // when nothing is clearly the same role, so we never attach the wrong JD.
  let postings: Array<{ title: string; url: string; jd: string }> = [];
  try {
    if (row.ats_provider === 'Greenhouse') {
      const r = await fetch(`https://boards-api.greenhouse.io/v1/boards/${row.ats_slug}/jobs?content=true`, {
        headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(10000),
      });
      if (!r.ok) return null;
      const data = await r.json() as { jobs?: Array<{ title: string; absolute_url: string; content?: string }> };
      postings = (data.jobs || []).map(j => ({ title: j.title, url: j.absolute_url, jd: stripHtml(j.content || '') }));
    } else if (row.ats_provider === 'Lever') {
      const r = await fetch(`https://api.lever.co/v0/postings/${row.ats_slug}?mode=json`, {
        headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(10000),
      });
      if (!r.ok) return null;
      const data = await r.json() as Array<{ text: string; hostedUrl: string; descriptionPlain?: string; description?: string }>;
      postings = (data || []).map(j => ({ title: j.text, url: j.hostedUrl, jd: j.descriptionPlain || stripHtml(j.description || '') }));
    } else if (row.ats_provider === 'Ashby') {
      const r = await fetch(`https://api.ashbyhq.com/posting-api/job-board/${row.ats_slug}`, {
        headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(10000),
      });
      if (!r.ok) return null;
      const data = await r.json() as { jobs?: Array<{ title: string; jobUrl: string; descriptionPlain?: string; descriptionHtml?: string }> };
      postings = (data.jobs || []).map(j => ({ title: j.title, url: j.jobUrl, jd: j.descriptionPlain || stripHtml(j.descriptionHtml || '') }));
    }
  } catch { return null; }
  if (!postings.length) return null;

  // 1) Fast path — token overlap.
  let idx = postings.findIndex(p => titleSimilar(p.title.toLowerCase(), titleLc));
  // 2) Semantic fallback — Haiku picks the same role or none.
  if (idx < 0) idx = await haikuPickPosting(title, postings.map(p => p.title));
  if (idx >= 0 && idx < postings.length) return { url: postings[idx].url, jd: postings[idx].jd };
  return null;
}

// Haiku semantic title match. Given the alert title and the company's live
// posting titles, return the 0-based index of the posting that is the SAME
// role (function + seniority) or -1 if none clearly matches. Strict on
// purpose — a wrong match attaches a wrong JD and corrupts candidate scoring.
const ANTHROPIC_URL   = 'https://api.anthropic.com/v1/messages';
const ANTHROPIC_MODEL = 'claude-haiku-4-5';
async function haikuPickPosting(target: string, titles: string[]): Promise<number> {
  const key = (Deno.env.get('LADDER_ANTHROPIC_API_KEY') || Deno.env.get('ANTHROPIC_API_KEY'));
  if (!key || !titles.length) return -1;
  const list = titles.slice(0, 60).map((t, i) => `${i + 1}. ${t}`).join('\n');
  const system = `You match a job title to a company's live job postings. The target title came from a job alert; the numbered list is that company's current openings. Titles may be phrased differently across systems (e.g. "Product Lead, Platform" vs "Senior Product Manager"). Return ONLY a number: the posting that is the SAME role — same function AND same seniority band — or 0 if none is clearly the same role. Be strict: a different function (e.g. engineering vs product), a different seniority (e.g. manager vs director/VP), or only vague overlap = 0.`;
  const user = `Target role: "${target}"\n\nOpenings:\n${list}\n\nAnswer with just the number (0 = no clear same-role match).`;
  try {
    const r = await fetch(ANTHROPIC_URL, {
      method: 'POST',
      headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({ model: ANTHROPIC_MODEL, max_tokens: 8, system, messages: [{ role: 'user', content: user }] }),
      signal: AbortSignal.timeout(12000),
    });
    if (!r.ok) return -1;
    const data = await r.json() as { content?: Array<{ text?: string }> };
    const txt = (data.content || []).map(c => c.text || '').join('').trim();
    const n = parseInt(txt.match(/\d+/)?.[0] || '0', 10);
    return (n >= 1 && n <= Math.min(60, titles.length)) ? n - 1 : -1;
  } catch { return -1; }
}

// Token-overlap similarity. Posting titles drift between aggregator
// ("Senior Product Manager") and ATS ("Senior PM, Platform"), so we
// match on shared meaningful tokens after light normalization.
function titleSimilar(a: string, b: string): boolean {
  const norm = (s: string) => s
    .replace(/\bproduct manager\b/g, 'pm')
    .replace(/[(),]/g, ' ')
    .split(/\s+/).filter(t => t && !STOP.has(t));
  const ta = new Set(norm(a));
  const tb = new Set(norm(b));
  if (!ta.size || !tb.size) return false;
  let shared = 0;
  for (const t of ta) if (tb.has(t)) shared++;
  // Need at least 2 shared meaningful tokens AND ≥50% overlap from the
  // shorter side. Tunable; this is conservative on purpose.
  const minSize = Math.min(ta.size, tb.size);
  return shared >= 2 && shared / minSize >= 0.5;
}

const STOP = new Set([
  'a','an','the','of','for','in','on','at','to','and','or','&','-','/','i','ii','iii',
  'job','jobs','role','position','opening','remote','hybrid','onsite',
]);

function stripHtml(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeDomain(d?: string | null): string | null {
  if (!d) return null;
  try {
    const trimmed = d.trim().toLowerCase();
    if (!trimmed) return null;
    if (trimmed.includes('://')) return new URL(trimmed).hostname.replace(/^www\./, '');
    return trimmed.replace(/^www\./, '').split('/')[0];
  } catch { return null; }
}
