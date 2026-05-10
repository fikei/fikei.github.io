// enrich-job-source — first-class enrichment step. Takes a (company,
// title?) pair (and an optional aggregator URL) and resolves it to a
// canonical posting on a known ATS. Returns the canonical_url, JD text,
// and ats_provider — or an unresolved flag with a retry timestamp.
//
// Cascade (cheapest → most expensive):
//   1. job.companies cache hit (resolved row).
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

const VERSION = '0.1.0';
console.log(`[enrich-job-source] v${VERSION} - cache → ats → scrape cascade`);

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

  const body = await req.json().catch(() => ({})) as EnrichRequest;
  const company = (body.company || '').trim();
  if (!company) return json({ error: 'company required' }, 400);
  const title = (body.title || '').trim();

  const sql = db();

  // 1) Cache lookup or insert.
  const existing = await sql<CompanyRow[]>`
    select id, name, domain, ats_provider, ats_slug, careers_url, resolution_status, retry_count
      from job.companies
     where name_norm = lower(trim(${company}))
     limit 1
  `;
  let row = existing[0] as CompanyRow | undefined;
  if (!row) {
    const [inserted] = await sql<CompanyRow[]>`
      insert into job.companies (name, domain)
        values (${company}, ${normalizeDomain(body.hintDomain) || null})
      on conflict (name_norm) do update
        set domain = coalesce(job.companies.domain, excluded.domain),
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
    });
  }

  // 2) ATS detection.
  const detected = await detectAts({ company, hintDomain: body.hintDomain, hintAtsUrl: body.hintAtsUrl });

  if (detected) {
    // Persist the resolution before we even try to fetch the title —
    // even a partial resolve (provider+slug, no canonical match) helps
    // the next user querying the same company.
    await sql`
      update job.companies
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
    });
  }

  // 3) Mark unresolved with backoff.
  const nextCount = (row.retry_count || 0) + 1;
  const retryAt = nextRetry(nextCount);
  await sql`
    update job.companies
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
  try {
    if (row.ats_provider === 'Greenhouse') {
      const r = await fetch(`https://boards-api.greenhouse.io/v1/boards/${row.ats_slug}/jobs?content=true`, {
        headers: { 'User-Agent': UA },
        signal: AbortSignal.timeout(10000),
      });
      if (!r.ok) return null;
      const data = await r.json() as { jobs?: Array<{ title: string; absolute_url: string; content?: string }> };
      const match = (data.jobs || []).find(j => titleSimilar(j.title.toLowerCase(), titleLc));
      if (match) return { url: match.absolute_url, jd: stripHtml(match.content || '') };
    }
    if (row.ats_provider === 'Lever') {
      const r = await fetch(`https://api.lever.co/v0/postings/${row.ats_slug}?mode=json`, {
        headers: { 'User-Agent': UA },
        signal: AbortSignal.timeout(10000),
      });
      if (!r.ok) return null;
      const data = await r.json() as Array<{ text: string; hostedUrl: string; descriptionPlain?: string; description?: string }>;
      const match = (data || []).find(j => titleSimilar(j.text.toLowerCase(), titleLc));
      if (match) return { url: match.hostedUrl, jd: match.descriptionPlain || stripHtml(match.description || '') };
    }
    if (row.ats_provider === 'Ashby') {
      const r = await fetch(`https://api.ashbyhq.com/posting-api/job-board/${row.ats_slug}`, {
        headers: { 'User-Agent': UA },
        signal: AbortSignal.timeout(10000),
      });
      if (!r.ok) return null;
      const data = await r.json() as { jobs?: Array<{ title: string; jobUrl: string; descriptionPlain?: string; descriptionHtml?: string }> };
      const match = (data.jobs || []).find(j => titleSimilar(j.title.toLowerCase(), titleLc));
      if (match) return { url: match.jobUrl, jd: match.descriptionPlain || stripHtml(match.descriptionHtml || '') };
    }
  } catch { /* fall through */ }
  return null;
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
