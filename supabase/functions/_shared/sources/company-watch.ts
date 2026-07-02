// company-watch — direct careers-page sources for watched companies.
//
// Reads job.watched_companies for the user and pulls open roles straight
// from each company's careers backend. One plugin, six adapters:
//
//   google     — careers search page embeds job JSON (AF_initDataCallback
//                ds:1); no public API since careers.google.com/api/v3 died.
//   amazon     — amazon.jobs/en/search.json (full JD inline).
//   workday    — POST /wday/cxs/{tenant}/{site}/jobs; JD via detail GET.
//                Covers Nvidia, Salesforce, Adobe, and any Workday tenant.
//   eightfold  — /api/apply/v2/jobs; JD via per-id detail GET. Netflix etc.
//   apple      — jobs.apple.com search page embeds results in
//                __staticRouterHydrationData (server-rendered).
//   greenhouse / lever / ashby — public board APIs (same shape tracked-ats
//                uses), for watched companies on a standard ATS.
//
// Config is empty on the user_sources row: the company list + per-company
// adapter config live in job.watched_companies, so the watch list is a
// first-class concept the UI can edit without touching user_sources.

import type { Source, RecommendedRoleInput } from './types.ts';
import { db } from '../job-db.ts';

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36';

// Per-company caps so one giant board can't blow the function's memory or
// wall-clock. Detail fetches (Workday/Eightfold JDs) are the expensive
// part — new postings arrive incrementally after the first run, so a low
// cap only slows the very first backfill.
const MAX_ROLES_PER_COMPANY = 60;
const MAX_DETAIL_FETCHES    = 12;
const JD_CAP                = 5000;

export interface WatchedCompanyRow {
  id:             string;
  company:        string;
  company_norm:   string;
  adapter:        string;
  adapter_config: Record<string, unknown>;
  title_keywords: string[];
  locations:      string[];
}

function stripHtml(html: string): string {
  return (html || '')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, ' ')
    .trim();
}

function capJd(s: string | undefined): string | undefined {
  const t = (s || '').trim();
  return t ? t.slice(0, JD_CAP) : undefined;
}

function slugify(s: string): string {
  return (s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80);
}

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    ...init,
    headers: { 'user-agent': UA, accept: 'application/json', ...(init?.headers || {}) },
  });
  if (!res.ok) throw new Error(`${url.split('?')[0]} → ${res.status}`);
  return await res.json() as T;
}

// ---------- Google (embedded AF_initDataCallback JSON) ----------
// The careers search-results page server-renders the full result set as a
// JSON blob. Entry shape (verified 2026-07): [0]=id, [1]=title, [2]=apply
// url, [3]=[null, responsibilities html], [4]=[null, quals html],
// [7]=company ("Google"/"YouTube"), [9]=locations, [10]=[null, about html],
// [12]=[epochSec, nanos] posted.
async function pullGoogle(w: WatchedCompanyRow): Promise<RecommendedRoleInput[]> {
  const cfg = w.adapter_config as { searchUrl?: string; query?: string; location?: string };
  let url = cfg.searchUrl;
  if (!url) {
    const p = new URLSearchParams();
    p.set('q', cfg.query || 'product manager');
    if (cfg.location) p.set('location', cfg.location);
    p.set('employment_type', 'FULL_TIME');
    url = `https://www.google.com/about/careers/applications/jobs/results?${p}`;
  }
  const res = await fetch(url, { headers: { 'user-agent': UA } });
  if (!res.ok) throw new Error(`google careers → ${res.status}`);
  const html = await res.text();
  const m = html.match(/AF_initDataCallback\(\{key: 'ds:1'[\s\S]*?data:(\[[\s\S]*?\]), sideChannel/);
  if (!m) throw new Error('google careers: ds:1 blob not found (page layout changed?)');
  const data = JSON.parse(m[1]) as unknown[];
  const jobs = (Array.isArray(data?.[0]) ? data[0] : []) as unknown[][];
  return jobs.slice(0, MAX_ROLES_PER_COMPANY).map((j) => {
    const id      = String(j[0] ?? '');
    const title   = String(j[1] ?? '');
    const brand   = typeof j[7] === 'string' && j[7] ? String(j[7]) : w.company;
    const locs    = (Array.isArray(j[9]) ? j[9] as unknown[][] : [])
      .map(l => String(l?.[0] ?? '')).filter(Boolean);
    const aboutH  = (Array.isArray(j[10]) ? String(j[10][1] ?? '') : '');
    const respH   = (Array.isArray(j[3])  ? String(j[3][1]  ?? '') : '');
    const qualH   = (Array.isArray(j[4])  ? String(j[4][1]  ?? '') : '');
    const posted  = (Array.isArray(j[12]) && typeof j[12][0] === 'number')
      ? new Date((j[12][0] as number) * 1000).toISOString() : undefined;
    if (!id || !title) return null;
    return {
      source:      'company-watch',
      sourceId:    `cw:google:${id}`,
      sourceLabel: `${brand} Careers`,
      url:         `https://www.google.com/about/careers/applications/jobs/results/${id}-${slugify(title)}`,
      company:     brand,
      title,
      location:    locs.slice(0, 3).join(' · ') || undefined,
      description: capJd(stripHtml([aboutH, respH, qualH].filter(Boolean).join(' '))),
      postedAt:    posted,
      payload:     { adapter: 'google', watchedCompanyId: w.id, jobId: id },
    } as RecommendedRoleInput;
  }).filter(Boolean) as RecommendedRoleInput[];
}

// ---------- Amazon (amazon.jobs/en/search.json) ----------
async function pullAmazon(w: WatchedCompanyRow): Promise<RecommendedRoleInput[]> {
  const cfg = w.adapter_config as { query?: string; location?: string };
  const p = new URLSearchParams();
  p.set('base_query', cfg.query || 'product manager');
  if (cfg.location) p.set('loc_query', cfg.location);
  p.set('result_limit', String(MAX_ROLES_PER_COMPANY));
  p.set('sort', 'recent');
  const data = await fetchJson<{ jobs?: Array<Record<string, unknown>> }>(
    `https://www.amazon.jobs/en/search.json?${p}`);
  return (data.jobs || []).map(j => ({
    source:      'company-watch',
    sourceId:    `cw:amazon:${String(j.id_icims ?? j.id ?? '')}`,
    sourceLabel: `Amazon Careers`,
    url:         `https://www.amazon.jobs${String(j.job_path || '')}`,
    company:     w.company,
    title:       String(j.title || ''),
    location:    String(j.normalized_location || j.location || '') || undefined,
    description: capJd(stripHtml([j.description, j.basic_qualifications, j.preferred_qualifications]
                   .filter(Boolean).map(String).join(' '))),
    postedAt:    j.posted_date ? new Date(String(j.posted_date)).toISOString() : undefined,
    payload:     { adapter: 'amazon', watchedCompanyId: w.id, jobId: String(j.id_icims ?? j.id ?? '') },
  })).filter(r => r.title && r.sourceId !== 'cw:amazon:');
}

// ---------- Workday (CXS API — any tenant) ----------
async function pullWorkday(w: WatchedCompanyRow): Promise<RecommendedRoleInput[]> {
  const cfg = w.adapter_config as { host?: string; tenant?: string; site?: string; query?: string };
  if (!cfg.host || !cfg.tenant || !cfg.site) throw new Error('workday config needs host/tenant/site');
  const base = `https://${cfg.host}/wday/cxs/${cfg.tenant}/${cfg.site}`;
  const data = await fetchJson<{ jobPostings?: Array<{ title?: string; externalPath?: string; locationsText?: string; postedOn?: string; bulletFields?: string[] }> }>(
    `${base}/jobs`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ searchText: cfg.query || 'product manager', limit: 20, offset: 0, appliedFacets: {} }),
    });
  const postings = (data.jobPostings || []).filter(j => j.externalPath).slice(0, MAX_ROLES_PER_COMPANY);
  const out: RecommendedRoleInput[] = [];
  let detailBudget = MAX_DETAIL_FETCHES;
  for (const j of postings) {
    const reqId = j.bulletFields?.[0] || j.externalPath!;
    let description: string | undefined;
    let posted: string | undefined;
    if (detailBudget > 0) {
      detailBudget--;
      try {
        const d = await fetchJson<{ jobPostingInfo?: { jobDescription?: string; startDate?: string } }>(
          `${base}${j.externalPath}`);
        description = capJd(stripHtml(d.jobPostingInfo?.jobDescription || ''));
        posted = d.jobPostingInfo?.startDate ? new Date(d.jobPostingInfo.startDate).toISOString() : undefined;
      } catch { /* JD is best-effort; the row still lands and grades later */ }
    }
    out.push({
      source:      'company-watch',
      sourceId:    `cw:workday:${cfg.tenant}:${reqId}`,
      sourceLabel: `${w.company} Careers`,
      url:         `https://${cfg.host}/en-US/${cfg.site}${j.externalPath}`,
      company:     w.company,
      title:       j.title || '',
      location:    j.locationsText || undefined,
      description,
      postedAt:    posted,
      payload:     { adapter: 'workday', watchedCompanyId: w.id, jobId: reqId },
    });
  }
  return out.filter(r => r.title);
}

// ---------- Eightfold (explore.jobs.* — Netflix etc.) ----------
async function pullEightfold(w: WatchedCompanyRow): Promise<RecommendedRoleInput[]> {
  const cfg = w.adapter_config as { base?: string; domain?: string; query?: string };
  if (!cfg.base || !cfg.domain) throw new Error('eightfold config needs base/domain');
  const p = new URLSearchParams({ domain: cfg.domain, query: cfg.query || 'product manager', num: '50', start: '0' });
  const data = await fetchJson<{ positions?: Array<{ id?: number; name?: string; location?: string; locations?: string[]; t_create?: number; canonicalPositionUrl?: string; job_description?: string }> }>(
    `${cfg.base}/api/apply/v2/jobs?${p}`);
  const positions = (data.positions || []).slice(0, MAX_ROLES_PER_COMPANY);
  const out: RecommendedRoleInput[] = [];
  let detailBudget = MAX_DETAIL_FETCHES;
  for (const pos of positions) {
    if (!pos.id || !pos.name) continue;
    let description = capJd(stripHtml(pos.job_description || ''));
    if (!description && detailBudget > 0) {
      detailBudget--;
      try {
        const d = await fetchJson<{ job_description?: string }>(
          `${cfg.base}/api/apply/v2/jobs/${pos.id}?domain=${encodeURIComponent(cfg.domain)}`);
        description = capJd(stripHtml(d.job_description || ''));
      } catch { /* best effort */ }
    }
    out.push({
      source:      'company-watch',
      sourceId:    `cw:eightfold:${cfg.domain}:${pos.id}`,
      sourceLabel: `${w.company} Careers`,
      url:         pos.canonicalPositionUrl || `${cfg.base}/careers/job/${pos.id}`,
      company:     w.company,
      title:       pos.name,
      location:    (pos.locations || [pos.location]).filter(Boolean).slice(0, 3).join(' · ') || undefined,
      description,
      postedAt:    pos.t_create ? new Date(pos.t_create * 1000).toISOString() : undefined,
      payload:     { adapter: 'eightfold', watchedCompanyId: w.id, jobId: String(pos.id) },
    });
  }
  return out;
}

// ---------- Apple (server-rendered hydration JSON) ----------
// The search page embeds results in window.__staticRouterHydrationData =
// JSON.parse("<escaped json>"). We unescape via JSON.parse of the string
// literal, then walk for the searchResults array.
async function pullApple(w: WatchedCompanyRow): Promise<RecommendedRoleInput[]> {
  const cfg = w.adapter_config as { query?: string; location?: string };
  const p = new URLSearchParams({ search: cfg.query || 'product manager' });
  if (cfg.location) p.set('location', cfg.location);
  const res = await fetch(`https://jobs.apple.com/en-us/search?${p}`, { headers: { 'user-agent': UA } });
  if (!res.ok) throw new Error(`apple careers → ${res.status}`);
  const html = await res.text();
  const m = html.match(/__staticRouterHydrationData\s*=\s*JSON\.parse\((".*?")\);/s);
  if (!m) throw new Error('apple careers: hydration blob not found (page layout changed?)');
  const state = JSON.parse(JSON.parse(m[1]) as string) as Record<string, unknown>;
  // The job list lives somewhere under loaderData — find the first array
  // whose entries look like postings (positionId + postingTitle).
  let jobs: Array<Record<string, unknown>> = [];
  const walk = (v: unknown) => {
    if (jobs.length) return;
    if (Array.isArray(v)) {
      if (v.length && typeof v[0] === 'object' && v[0] !== null
          && 'positionId' in (v[0] as Record<string, unknown>)
          && 'postingTitle' in (v[0] as Record<string, unknown>)) {
        jobs = v as Array<Record<string, unknown>>;
        return;
      }
      for (const x of v) walk(x);
    } else if (v && typeof v === 'object') {
      for (const x of Object.values(v)) walk(x);
    }
  };
  walk(state);
  return jobs.slice(0, MAX_ROLES_PER_COMPANY).map(j => {
    const id    = String(j.positionId || '');
    const title = String(j.postingTitle || '');
    if (!id || !title) return null;
    const slug  = String(j.transformedPostingTitle || slugify(title));
    const locs  = (Array.isArray(j.locations) ? j.locations as Array<Record<string, unknown>> : [])
      .map(l => String(l.name || l.city || '')).filter(Boolean);
    return {
      source:      'company-watch',
      sourceId:    `cw:apple:${id}`,
      sourceLabel: 'Apple Careers',
      url:         `https://jobs.apple.com/en-us/details/${id}/${slug}`,
      company:     w.company,
      title,
      location:    locs.slice(0, 3).join(' · ') || undefined,
      description: capJd(stripHtml(String(j.jobSummary || ''))),
      postedAt:    j.postDateInGMT ? new Date(String(j.postDateInGMT)).toISOString() : undefined,
      payload:     { adapter: 'apple', watchedCompanyId: w.id, jobId: id },
    } as RecommendedRoleInput;
  }).filter(Boolean) as RecommendedRoleInput[];
}

// ---------- Standard ATS boards (Greenhouse / Lever / Ashby) ----------
// For watched companies that run a public board. Same endpoints as
// tracked-ats but namespaced under company-watch so filter_mode applies.
async function pullAtsBoard(w: WatchedCompanyRow): Promise<RecommendedRoleInput[]> {
  const cfg = w.adapter_config as { slug?: string };
  if (!cfg.slug) throw new Error(`${w.adapter} config needs slug`);
  const slug = encodeURIComponent(cfg.slug);
  if (w.adapter === 'greenhouse') {
    const data = await fetchJson<{ jobs?: Array<{ id: number; title: string; absolute_url: string; updated_at: string; location?: { name: string } }> }>(
      `https://boards-api.greenhouse.io/v1/boards/${slug}/jobs`);
    return (data.jobs || []).slice(0, MAX_ROLES_PER_COMPANY).map(j => ({
      source: 'company-watch', sourceId: `cw:gh:${cfg.slug}:${j.id}`,
      sourceLabel: `${w.company} Careers`, url: j.absolute_url,
      company: w.company, title: j.title, location: j.location?.name,
      postedAt: j.updated_at,
      payload: { adapter: 'greenhouse', watchedCompanyId: w.id, jobId: String(j.id) },
    }));
  }
  if (w.adapter === 'lever') {
    const data = await fetchJson<Array<{ id: string; text: string; hostedUrl: string; createdAt: number; categories?: { location?: string }; descriptionPlain?: string }>>(
      `https://api.lever.co/v0/postings/${slug}?mode=json`);
    return (data || []).slice(0, MAX_ROLES_PER_COMPANY).map(j => ({
      source: 'company-watch', sourceId: `cw:lever:${cfg.slug}:${j.id}`,
      sourceLabel: `${w.company} Careers`, url: j.hostedUrl,
      company: w.company, title: j.text, location: j.categories?.location,
      description: capJd(j.descriptionPlain),
      postedAt: j.createdAt ? new Date(j.createdAt).toISOString() : undefined,
      payload: { adapter: 'lever', watchedCompanyId: w.id, jobId: j.id },
    }));
  }
  if (w.adapter === 'ashby') {
    const data = await fetchJson<{ jobs?: Array<{ id: string; title: string; jobUrl: string; publishedAt?: string; locationName?: string; compensationTierSummary?: string; descriptionPlain?: string }> }>(
      `https://api.ashbyhq.com/posting-api/job-board/${slug}?includeCompensation=true`);
    return (data.jobs || []).slice(0, MAX_ROLES_PER_COMPANY).map(j => ({
      source: 'company-watch', sourceId: `cw:ashby:${cfg.slug}:${j.id}`,
      sourceLabel: `${w.company} Careers`, url: j.jobUrl,
      company: w.company, title: j.title, location: j.locationName,
      salary: j.compensationTierSummary, description: capJd(j.descriptionPlain),
      postedAt: j.publishedAt,
      payload: { adapter: 'ashby', watchedCompanyId: w.id, jobId: j.id },
    }));
  }
  throw new Error(`unknown ats adapter: ${w.adapter}`);
}

const ADAPTERS: Record<string, (w: WatchedCompanyRow) => Promise<RecommendedRoleInput[]>> = {
  google:     pullGoogle,
  amazon:     pullAmazon,
  workday:    pullWorkday,
  eightfold:  pullEightfold,
  apple:      pullApple,
  greenhouse: pullAtsBoard,
  lever:      pullAtsBoard,
  ashby:      pullAtsBoard,
};

// Per-company include filters — cheap substring prefilters the user can
// set on the watch (title keywords, locations). Empty lists = no-op.
function passesWatchFilters(r: RecommendedRoleInput, w: WatchedCompanyRow): boolean {
  if (w.title_keywords?.length) {
    const t = (r.title || '').toLowerCase();
    if (!w.title_keywords.some(k => k && t.includes(k.toLowerCase().trim()))) return false;
  }
  if (w.locations?.length) {
    const l = (r.location || '').toLowerCase();
    if (l && !w.locations.some(k => k && l.includes(k.toLowerCase().trim()))) return false;
  }
  return true;
}

export const companyWatchSource: Source = {
  type: 'company-watch',
  async pull(_cfg, ctx) {
    const sql = db();
    const watches = await sql<WatchedCompanyRow[]>`
      select id, company, company_norm, adapter, adapter_config, title_keywords, locations
        from job.watched_companies
       where user_email = ${ctx.userEmail} and enabled = true`;
    const out: RecommendedRoleInput[] = [];
    for (const w of watches) {
      const adapter = ADAPTERS[w.adapter];
      if (!adapter) {
        await sql`update job.watched_companies set last_error = ${'unknown adapter: ' + w.adapter} where id = ${w.id}`;
        continue;
      }
      try {
        const rows = (await adapter(w))
          .filter(r => passesWatchFilters(r, w))
          .map(r => ({ ...r, watchedCompanyId: w.id }));
        out.push(...rows);
        await sql`
          update job.watched_companies
             set last_pulled_at = now(), last_pull_count = ${rows.length}, last_error = null
           where id = ${w.id}`;
        console.log(`[company-watch] ${w.company} (${w.adapter}): ${rows.length} roles`);
      } catch (e) {
        await sql`update job.watched_companies set last_pulled_at = now(), last_error = ${(e as Error).message} where id = ${w.id}`;
        console.warn(`[company-watch] ${w.company} (${w.adapter}): ${(e as Error).message}`);
      }
    }
    return out;
  },
};
