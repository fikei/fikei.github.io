// add-role — accept a pasted URL (and optional title/company) and insert
// a new pipeline_role. Best-effort enrichment via the page's <title>; the
// user can refine via the detail page.
//
// POST { url, title?, company?, source?, fromRecommendationId? }

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { verifyJobUser, jsonResp, err, corsHeaders, slugify, roleSlug } from '../_shared/job-auth.ts';
import { db } from '../_shared/job-db.ts';
import { parseSectorTags } from '../_shared/sector-tags.ts';
import { computeFit } from '../jobs-pipe/fit.ts';
import { scoreOne } from '../_shared/job-fit-haiku.ts';
import { compClears } from '../_shared/comp.ts';

const VERSION = '0.7.1';
// Status default: 'Saved' (post-taxonomy collapse).
// Source-email-link: stash payload.gmailApiId as a Gmail web URL when
// the rec came from Gmail.
console.log(`[add-role] v${VERSION} - Outdoor sector recognition (inferSector + canonical tags)`);

const URL_RE = /^https?:\/\//i;
const TITLE_RE = /<title[^>]*>([\s\S]*?)<\/title>/i;
const OG_TITLE_RE = /<meta[^>]+property=["']og:title["'][^>]*content=["']([^"']+)["'][^>]*>/i;
const OG_TITLE_RE2 = /<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:title["'][^>]*>/i;
const OG_SITE_RE = /<meta[^>]+property=["']og:site_name["'][^>]*content=["']([^"']+)["'][^>]*>/i;
// LinkedIn job pages /jobs/view/{id}/ — try to coerce to the original
// posting if the page reveals it. Best-effort; many LinkedIn URLs are
// kept as-is.
function detectSource(url: string): { source: string; sourceLabel: string } {
  if (/(^|\.)linkedin\.com\b/i.test(url)) return { source: 'LinkedIn Saved', sourceLabel: 'LinkedIn Saved' };
  if (/ashby(hq)?\.com|greenhouse|lever\.co|workday|smartrecruiters|careerspage\.io|workable\.com|breezy\.hr|recruitee\.com|jobvite\.com|paylocity\.com|icims\.com|teamtailor\.com|bamboohr\.com|rippling\.com\/careers|notion\.so\/[^/]+\/[^/]+\/jobs/i.test(url)) {
    return { source: 'From Company Pages', sourceLabel: 'From Company Pages' };
  }
  return { source: 'Manual', sourceLabel: 'Manual' };
}

// Drop tracking params so two pastes of the same role don't diverge.
function cleanUrl(raw: string): string {
  try {
    const u = new URL(raw);
    const drop = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content',
      'gh_src', 'gh_jid', 'gh_aid', 'fbclid', 'gclid', 'mc_cid', 'mc_eid', 'ref', 'src'];
    for (const k of drop) u.searchParams.delete(k);
    return u.toString();
  } catch { return raw; }
}

// Title-case companies that arrive in lazy lower-case ("luro health" → "Luro Health").
// Single-cased acronyms (AWS, SaaS, AI) stay intact via the explicit re-case set.
function fixCompanyCase(s: string): string {
  if (!s) return s;
  const trimmed = s.trim();
  // Keep already-mixed-case names ("DoorDash", "GitHub") untouched.
  if (/[a-z][A-Z]|[A-Z]{2,}/.test(trimmed)) return trimmed;
  // All-lower or first-cap-rest-lower: title-case each word.
  return trimmed.split(/\s+/).map(w => {
    if (w.length <= 1) return w.toUpperCase();
    if (/^(ai|ml|hq|llc|inc|gmbh|ltd|co|fka|aka|ny|sf)$/i.test(w)) return w.toUpperCase();
    return w.charAt(0).toUpperCase() + w.slice(1).toLowerCase();
  }).join(' ');
}

function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&[a-z]+;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// Returns the structured JobPosting JSON-LD if the page ships one. Most
// modern ATSes (careerspage.io, Greenhouse, Workable, Ashby) embed it.
function parseJobPostingLd(html: string): { title?: string; company?: string; description?: string; salaryLow?: number; salaryHigh?: number; datePosted?: string; location?: string } | null {
  const blocks = [...html.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)];
  for (const m of blocks) {
    try {
      const raw = m[1].trim();
      const obj = JSON.parse(raw);
      const candidates = Array.isArray(obj) ? obj : [obj];
      for (const c of candidates) {
        const type = c?.['@type'];
        const isPosting = type === 'JobPosting' || (Array.isArray(type) && type.includes('JobPosting'));
        if (!isPosting) continue;
        const out: any = {};
        if (typeof c.title === 'string') out.title = c.title.trim();
        const org = c.hiringOrganization;
        if (typeof org === 'string') out.company = org.trim();
        else if (org && typeof org.name === 'string') out.company = org.name.trim();
        if (typeof c.description === 'string') out.description = c.description;
        if (typeof c.datePosted === 'string') out.datePosted = c.datePosted;
        const bs = c.baseSalary?.value;
        if (bs) {
          const lo = Number(bs.minValue ?? bs.value);
          const hi = Number(bs.maxValue ?? bs.value);
          if (Number.isFinite(lo)) out.salaryLow = lo;
          if (Number.isFinite(hi)) out.salaryHigh = hi;
        }
        // jobLocation → "City, Region"; multiple locations joined with "; ".
        // Fully-remote postings advertise jobLocationType: TELECOMMUTE.
        const fmtAddr = (loc: any): string | null => {
          const ad = loc?.address || loc;
          if (!ad || typeof ad !== 'object') return null;
          const parts = [ad.addressLocality, ad.addressRegion].filter((x: unknown) => typeof x === 'string' && x);
          if (parts.length) return parts.join(', ');
          const country = ad.addressCountry?.name || ad.addressCountry;
          return typeof country === 'string' ? country : null;
        };
        const jl = c.jobLocation;
        if (jl) {
          const arr = Array.isArray(jl) ? jl : [jl];
          const locs = Array.from(new Set(arr.map(fmtAddr).filter(Boolean) as string[]));
          if (locs.length) out.location = locs.join('; ');
        }
        if (!out.location && c.jobLocationType === 'TELECOMMUTE') out.location = 'Remote';
        if (out.title || out.company || out.description) return out;
      }
    } catch { /* malformed JSON-LD; try next block */ }
  }
  return null;
}

// Returns title, siteName, plain-text body, JSON-LD JobPosting (if any),
// and an ISO datePosted (if any). Order of preference for title/company is
// (1) caller-supplied → (2) JSON-LD → (3) og:title → (4) <title> → (5) URL host.
async function fetchPageMeta(url: string): Promise<{
  title: string | null;
  siteName: string | null;
  body: string;
  ld: ReturnType<typeof parseJobPostingLd>;
}> {
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 8000);
    const res = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; ctrl-rodeo-job/1.0)' },
      redirect: 'follow',
      signal: ctrl.signal,
    });
    clearTimeout(t);
    if (!res.ok) return { title: null, siteName: null, body: '', ld: null };
    const html = await res.text();

    const ld = parseJobPostingLd(html);

    let title: string | null = null;
    const og = html.match(OG_TITLE_RE) || html.match(OG_TITLE_RE2);
    if (og) title = decodeEntities(og[1]) || null;
    if (!title) {
      const m = html.match(TITLE_RE);
      if (m) title = decodeEntities(m[1]) || null;
    }

    const siteMatch = html.match(OG_SITE_RE);
    const siteName = siteMatch ? (decodeEntities(siteMatch[1]) || null) : null;

    // Body text: prefer JSON-LD description (full JD), then og:description,
    // then meta-description, then a crude tag strip.
    let body = '';
    if (ld?.description) body = decodeEntities(ld.description);
    if (!body) {
      const ogDesc = html.match(/<meta[^>]+property=["']og:description["'][^>]*content=["']([^"']+)["']/i)
        || html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:description["']/i);
      if (ogDesc) body = decodeEntities(ogDesc[1]);
    }
    if (!body) {
      const md = html.match(/<meta[^>]+name=["']description["'][^>]*content=["']([^"']+)["']/i);
      if (md) body = decodeEntities(md[1]);
    }
    if (!body) {
      body = decodeEntities(html.replace(/<script[\s\S]*?<\/script>/gi, '').replace(/<style[\s\S]*?<\/style>/gi, '').replace(/<[^>]+>/g, ' '));
    }

    return { title, siteName, body: body.slice(0, 12000), ld };
  } catch { return { title: null, siteName: null, body: '', ld: null }; }
}

// Pull a salary range out of free-text JD body. Looks for "$NNN,NNN - $NNN,NNN"
// or "$NNNk - $NNNk" patterns. Returns { low, high, range } in dollars.
function parseSalary(text: string): { low: number | null; high: number | null; range: string | null } {
  if (!text) return { low: null, high: null, range: null };
  const norm = text.replace(/–|—/g, '-').replace(/\s+/g, ' ');
  // $NNN,NNN(.NN)? - $NNN,NNN(.NN)?  | $NNNk - $NNNk
  const re = /\$\s*([\d,]+(?:\.\d+)?)\s*(k)?\s*[-–—to]+\s*\$?\s*([\d,]+(?:\.\d+)?)\s*(k)?/i;
  const m = norm.match(re);
  if (m) {
    const a = parseFloat(m[1].replace(/,/g, '')) * (m[2] ? 1000 : 1);
    const b = parseFloat(m[3].replace(/,/g, '')) * (m[4] ? 1000 : 1);
    if (a > 1000 && b > 1000 && b >= a) {
      const range = `$${Math.round(a / 1000)}k–$${Math.round(b / 1000)}k`;
      return { low: Math.round(a), high: Math.round(b), range };
    }
  }
  // single $NNN,NNN+ figure (e.g. "starting at $200,000")
  const single = norm.match(/\$\s*([\d,]+(?:\.\d+)?)\s*(k)?(?!\d)/);
  if (single) {
    const v = parseFloat(single[1].replace(/,/g, '')) * (single[2] ? 1000 : 1);
    if (v > 50000 && v < 1_000_000) {
      return { low: Math.round(v), high: Math.round(v), range: `$${Math.round(v / 1000)}k` };
    }
  }
  return { low: null, high: null, range: null };
}

// Crude sector tagger from JD text. Matches the same vocabulary the fit
// scorer / sector-tags module recognizes, so the score reflects the tag.
function inferSector(text: string, company: string): string {
  const haystack = (text + ' ' + company).toLowerCase();
  const tags: string[] = [];
  const map: Array<[RegExp, string]> = [
    [/\b(health(?:care)?|medical|clinical|telehealth|payer|provider|medicaid|medicare|patient)\b/, 'Healthcare'],
    [/\b(edtech|k-?12|university|undergrad|curriculum|tutor)\b/, 'EdTech'],
    [/\blegal\s*(ai|tech)\b/, 'Legal AI'],
    [/(\bai\b|\bml\b|\bllm\b|generative\s+ai|large\s+language\s+model)/, 'AI'],
    [/\b(fintech|banking|consumer\s+lending|payments?\s+platform|insurtech)\b/, 'Fintech'],
    [/saas/, 'SaaS'],
    [/marketplace/, 'Marketplace'],
    [/\b(outdoor|outdoors|camping|hiking|climbing|backpacks?|ski|snowboard|surf|cycling|apparel|sporting goods|gear for)\b/, 'Outdoor'],
    [/consumer|retail|e-?commerce/, 'Consumer'],
    [/hardware|robotics/, 'Hardware'],
    [/productivity|workflow|automation/, 'Productivity'],
    [/security|cyber/, 'Security'],
  ];
  for (const [re, name] of map) {
    if (re.test(haystack)) tags.push(name);
  }
  // Dedupe; keep the first 3 tags as the sector blob.
  return Array.from(new Set(tags)).slice(0, 3).join(' / ');
}

// "cityblockhealth.wd1.myworkdayjobs.com" → "Cityblock Health".
// "boards.greenhouse.io/acme" path-based fallback handled by the og:site_name.
function companyFromHost(urlStr: string): string | null {
  try {
    const u = new URL(urlStr);
    const host = u.hostname.toLowerCase();
    // Workday: <subdomain>.wdN.myworkdayjobs.com → subdomain is the company.
    const wd = host.match(/^([a-z0-9-]+)\.wd\d+\.myworkdayjobs\.com$/);
    if (wd) return spacedTitleCase(wd[1]);
    // Greenhouse: boards.greenhouse.io/<slug>/jobs/...
    if (/(^|\.)greenhouse\.io$/.test(host)) {
      const seg = u.pathname.split('/').filter(Boolean)[0];
      if (seg && seg !== 'jobs') return spacedTitleCase(seg);
    }
    // Lever: jobs.lever.co/<slug>/...
    if (/(^|\.)lever\.co$/.test(host)) {
      const seg = u.pathname.split('/').filter(Boolean)[0];
      if (seg) return spacedTitleCase(seg);
    }
    // Ashby: jobs.ashbyhq.com/<slug>/... or <slug>.ashbyhq.com
    const ashbySub = host.match(/^([a-z0-9-]+)\.ashbyhq\.com$/);
    if (ashbySub && ashbySub[1] !== 'jobs') return spacedTitleCase(ashbySub[1]);
    if (host === 'jobs.ashbyhq.com') {
      const seg = u.pathname.split('/').filter(Boolean)[0];
      if (seg) return spacedTitleCase(seg);
    }
    // careerspage.io: /<slug>/<role>
    if (/(^|\.)careerspage\.io$/.test(host)) {
      const seg = u.pathname.split('/').filter(Boolean)[0];
      if (seg) return spacedTitleCase(seg);
    }
    // Workable: <slug>.workable.com or apply.workable.com/<slug>/...
    const workableSub = host.match(/^([a-z0-9-]+)\.workable\.com$/);
    if (workableSub && workableSub[1] !== 'apply' && workableSub[1] !== 'www') return spacedTitleCase(workableSub[1]);
    if (host === 'apply.workable.com') {
      const seg = u.pathname.split('/').filter(Boolean)[0];
      if (seg) return spacedTitleCase(seg);
    }
    return null;
  } catch { return null; }
}

// "cityblockhealth" → "Cityblock Health"; best-effort split on common roots.
function spacedTitleCase(s: string): string {
  const cleaned = s.replace(/[-_]+/g, ' ').trim();
  // Split runs on common joiner words (health, labs, ai, hq, inc, co, app).
  const split = cleaned.replace(/(.+?)(health|labs|ai|hq|inc|co|app|tech|capital|partners)$/i, '$1 $2');
  return split.split(/\s+/).filter(Boolean).map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
}

// Strip trailing job IDs and noise suffixes:
//   "Senior PM - R-1466 - Cityblock"  → "Senior PM"
//   "Head of Product job in US"       → "Head of Product"
//   "Senior PM - Remote (US)"         → "Senior PM"
//   "Senior PM | Acme - Careers Page" → "Senior PM"
function cleanTitle(t: string): string {
  return t
    .replace(/\s+\(([^)]+)\)\s*$/i, '')                          // trailing "(Remote, US)"
    .replace(/[\s\-–—_·|,]+(careers?\s*page|careers?)\s*$/i, '') // " - Careers Page"
    .replace(/[\s\-–—_·|,]+R-?\d{2,}\s*$/i, '')
    .replace(/[\s\-–—_·|,]+Job\s*ID:?\s*\S+\s*$/i, '')
    .replace(/\s+job\s+in\s+[A-Z][\w\s,/&-]+$/i, '')             // " job in US" / "job in San Francisco"
    .replace(/\s+(in|at)\s+[A-Z][\w\s,/&-]+$/i, '')              // " in US"
    .replace(/[\s\-–—_·|,]+(remote|hybrid|on-?site)\s*$/i, '')
    .trim();
}

// Last-resort: pull a title from the URL's path. Workday role URLs end in
// /job/<Title-Slug>_R-1466.
function titleFromUrl(urlStr: string): string | null {
  try {
    const u = new URL(urlStr);
    const segs = u.pathname.split('/').filter(Boolean);
    const idx = segs.indexOf('job');
    if (idx >= 0 && segs[idx + 1]) {
      const raw = decodeURIComponent(segs[idx + 1]).split('_')[0];
      return cleanTitle(raw.replace(/[-_]+/g, ' '));
    }
    return null;
  } catch { return null; }
}

// "Senior PM, Foundations | Stripe" → { title: "Senior PM, Foundations", company: "Stripe" }
function splitTitleCompany(pageTitle: string | null): { title?: string; company?: string } {
  if (!pageTitle) return {};
  const seps = [' | ', ' - ', ' – ', ' — ', ' at '];
  for (const s of seps) {
    const idx = pageTitle.indexOf(s);
    if (idx > 0) return { title: pageTitle.slice(0, idx).trim(), company: pageTitle.slice(idx + s.length).trim() };
  }
  return { title: pageTitle };
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return err('POST only', 405);

  try {
    const email = await verifyJobUser(req);
    if (!email) return err('unauthorized', 401);

    const body = await req.json().catch(() => ({}));
    const rawUrl = String(body.url || '').trim();
    if (!rawUrl || !URL_RE.test(rawUrl)) return err('valid http(s) url required', 400);
    const url = cleanUrl(rawUrl);

    let title = String(body.title || '').trim();
    let company = String(body.company || '').trim();

    // Always pull the page so we have the JD body for salary + sector
    // detection, even if title/company were passed in by the caller.
    const meta = await fetchPageMeta(url);

    // 1) Prefer JSON-LD JobPosting — canonical, no marketing chrome.
    if (!title && meta.ld?.title) title = meta.ld.title;
    if (!company && meta.ld?.company) company = meta.ld.company;

    // 2) Fall back to og:title / <title> with " | " / " - " split.
    if (!title) {
      const guess = splitTitleCompany(meta.title);
      if (guess.title) title = guess.title;
    }
    if (!company) {
      const guess = splitTitleCompany(meta.title);
      if (guess.company) company = guess.company;
      if (!company && meta.siteName) company = meta.siteName;
    }

    // 3) Host-based fallback for company.
    if (!company) {
      const fromHost = companyFromHost(url);
      if (fromHost) company = fromHost;
    }

    // 4) URL-path fallback for title (Workday: /job/<Title>_R-1466).
    if (!title) {
      const fromPath = titleFromUrl(url);
      if (fromPath) title = fromPath;
    }

    if (title) title = cleanTitle(title);
    if (company) company = fixCompanyCase(company);
    if (!title) title = '(untitled role)';
    if (!company) company = '(unknown company)';

    const slug = roleSlug(company, title);
    if (!slug) return err('could not derive slug from title/company', 400);

    const { source, sourceLabel } = detectSource(url);
    const finalSource = body.source ? String(body.source) : source;

    // Location: caller-supplied (rec carry-over) wins, then JSON-LD jobLocation.
    // The rec-link block below also backfills from the source rec when present.
    const location = (String(body.location || '').trim() || meta.ld?.location || '') || null;

    const sql = db();
    const companySlug = slugify(company) || null;

    // Insert tracked_companies AND pipeline_roles in a single statement so
    // the FK target is visible inside the same statement (postgres
    // evaluates CTEs before the final INSERT). Avoids the
    // pipeline_roles_company_slug_fkey violation when adding a role for a
    // brand-new company (e.g. a Workday/Lever URL the crawler hasn't
    // seeded yet).
    if (companySlug) {
      await sql`
        with c as (
          insert into job.tracked_companies (slug, name)
          values (${companySlug}, ${company})
          on conflict (slug) do nothing
          returning slug
        )
        insert into job.pipeline_roles (
          slug, company_slug, company_name, title, url, location, source, status
        ) values (
          ${slug}, ${companySlug}, ${company}, ${title},
          ${url}, ${location}, ${finalSource}, 'Saved'
        )
        on conflict (slug) do update set
          url = excluded.url,
          title = excluded.title,
          company_name = excluded.company_name,
          company_slug = excluded.company_slug,
          location = coalesce(job.pipeline_roles.location, excluded.location),
          source = coalesce(job.pipeline_roles.source, excluded.source),
          deleted_at = null,
          archived_at = null,
          updated_at = now();
      `;
    } else {
      // No company slug — insert without the FK link.
      await sql`
        insert into job.pipeline_roles (
          slug, company_slug, company_name, title, url, location, source, status
        ) values (
          ${slug}, null, ${company}, ${title},
          ${url}, ${location}, ${finalSource}, 'Saved'
        )
        on conflict (slug) do update set
          url = excluded.url,
          title = excluded.title,
          company_name = excluded.company_name,
          company_slug = excluded.company_slug,
          location = coalesce(job.pipeline_roles.location, excluded.location),
          source = coalesce(job.pipeline_roles.source, excluded.source),
          deleted_at = null,
          archived_at = null,
          updated_at = now();
      `;
    }

    // --- Sector tagging ---
    // Caller-supplied (rec carry-over) wins, otherwise infer from JD body.
    const sectorIn = String(body.sector || '').trim();
    const sector = sectorIn || inferSector(meta.body, company);
    if (sector) {
      await sql`update job.pipeline_roles set sector = ${sector} where slug = ${slug}`;
      const tags = parseSectorTags(sector);
      await sql`delete from job.role_sector_tags where role_slug = ${slug}`;
      for (const t of tags) {
        await sql`insert into job.sector_tags (slug, name) values (${t.slug}, ${t.name}) on conflict do nothing`;
        await sql`insert into job.role_sector_tags (role_slug, tag_slug) values (${slug}, ${t.slug}) on conflict do nothing`;
      }
    }

    // --- Salary: JSON-LD structured data wins, body regex fallback. ---
    let sal = { low: null as number | null, high: null as number | null, range: null as string | null };
    if (meta.ld?.salaryLow && meta.ld?.salaryHigh && meta.ld.salaryHigh >= meta.ld.salaryLow) {
      const lo = meta.ld.salaryLow, hi = meta.ld.salaryHigh;
      sal = { low: lo, high: hi, range: lo === hi ? `$${Math.round(lo / 1000)}k` : `$${Math.round(lo / 1000)}k–$${Math.round(hi / 1000)}k` };
    } else {
      sal = parseSalary(meta.body);
    }
    if (sal.range) {
      await sql`
        update job.pipeline_roles
        set salary_range = ${sal.range},
            salary_low = ${sal.low},
            salary_high = ${sal.high}
        where slug = ${slug};
      `;
    }

    // --- Liveness stamps so the row reads as "seen today" in the UI. ---
    // first_seen prefers the JSON-LD datePosted when present; otherwise
    // it's stamped to today.
    let firstSeen: string | null = null;
    if (meta.ld?.datePosted) {
      const d = new Date(meta.ld.datePosted);
      if (!isNaN(d.getTime())) firstSeen = d.toISOString().slice(0, 10);
    }
    if (firstSeen) {
      await sql`
        update job.pipeline_roles
        set first_seen = coalesce(first_seen, ${firstSeen}::date),
            last_seen = current_date
        where slug = ${slug};
      `;
    } else {
      await sql`
        update job.pipeline_roles
        set first_seen = coalesce(first_seen, current_date),
            last_seen = current_date
        where slug = ${slug};
      `;
    }

    // --- Tracked-company enrichment so the logo + future crawls work. ---
    if (companySlug) {
      try {
        const u = new URL(url);
        const host = u.hostname.toLowerCase();
        const isAts = /(wd\d+\.myworkdayjobs|greenhouse\.io|lever\.co|ashbyhq\.com|smartrecruiters\.com|linkedin\.com|workable\.com)/.test(host);
        await sql`
          update job.tracked_companies
          set
            careers_url = coalesce(careers_url, ${url}),
            ats = coalesce(ats, ${
              /myworkdayjobs/.test(host) ? 'Workday'
              : /greenhouse/.test(host) ? 'Greenhouse'
              : /lever/.test(host) ? 'Lever'
              : /ashbyhq/.test(host) ? 'Ashby'
              : /smartrecruiters/.test(host) ? 'SmartRecruiters'
              : null
            }),
            website_url = coalesce(website_url, ${ isAts ? null : `https://${host}` })
          where slug = ${companySlug};
        `;
      } catch { /* best effort */ }
    }

    // --- Compute fit score using the v3 stack. ---
    // Path A (from a rec card): copy the rec's Haiku output + description so
    //   the pipeline row inherits the same score, no extra Anthropic call.
    // Path B (fresh URL paste): scoreOne() fetches the JD, calls Haiku, and
    //   computes the v3 fit against UserContext just like the cron pull.
    try {
      type FitOut = Awaited<ReturnType<typeof scoreOne>>;
      let fitOut: FitOut;
      if (body.fromRecommendationId) {
        const inherit = await sql<{ description: string | null; role_match_score: number | null; role_match_rationale: string | null; role_match_seniority: string | null; role_match_scope: string | null; fit_summary: string | null; location: string | null; candidate_score: number | null; candidate_breakdown: Record<string, number> | null; candidate_rationales: Record<string, string> | null; candidate_summary: string | null; comp_acceptable: boolean | null }[]>`
          select description, role_match_score, role_match_rationale, role_match_seniority, role_match_scope, fit_summary, location,
                 candidate_score, candidate_breakdown, candidate_rationales, candidate_summary, comp_acceptable
            from job.recommended_roles where id = ${body.fromRecommendationId} limit 1`;
        const src = inherit[0];
        if (src && src.role_match_seniority) {
          const enriched = { status: 'New', rank: '', company, title, url, source: finalSource, contact: '', salary: sal.range || '', sector: sector || '', investors: '', website: '', crunchbase: '', description: src.description || '' };
          const ctxFit = await (await import('../_shared/job-fit-haiku.ts')).loadFitContext(sql);
          const fit = computeFit(enriched, ctxFit, src.role_match_score, src.role_match_seniority, src.role_match_rationale);
          fitOut = {
            fit, roleScore: src.role_match_score, rationale: src.role_match_rationale,
            seniority: src.role_match_seniority, scope: src.role_match_scope,
            fitSummary: src.fit_summary, location: src.location, description: src.description || '',
            candidate: src.candidate_score != null ? {
              score: src.candidate_score,
              breakdown: src.candidate_breakdown as never,
              rationales: src.candidate_rationales as never,
              compAcceptable: src.comp_acceptable,
              summary: src.candidate_summary || '',
            } : null,
          };
        } else {
          fitOut = await scoreOne({ status: 'New', rank: '', company, title, url, source: finalSource, contact: '', salary: sal.range || '', sector: sector || '', investors: '', website: '', crunchbase: '' }, sql);
        }
      } else {
        fitOut = await scoreOne({ status: 'New', rank: '', company, title, url, source: finalSource, contact: '', salary: sal.range || '', sector: sector || '', investors: '', website: '', crunchbase: '' }, sql);
      }
      const breakdownJson = JSON.stringify(fitOut.fit.breakdown);
      const rationalesJson = JSON.stringify(fitOut.fit.rationales);
      await sql`
        update job.pipeline_roles
           set fit_score            = ${fitOut.fit.score},
               fit_breakdown        = ${breakdownJson}::jsonb,
               fit_rationales       = ${rationalesJson}::jsonb,
               hard_fails           = ${fitOut.fit.hardFails},
               track                = ${fitOut.fit.track},
               description          = ${fitOut.description || null},
               role_match_score     = ${fitOut.roleScore},
               role_match_rationale = ${fitOut.rationale},
               role_match_seniority = ${fitOut.seniority},
               role_match_scope     = ${fitOut.scope},
               fit_summary          = ${fitOut.fitSummary},
               location             = coalesce(location, ${fitOut.location}),
               candidate_score      = ${fitOut.candidate?.score ?? null},
               candidate_breakdown  = ${fitOut.candidate ? JSON.stringify(fitOut.candidate.breakdown) : null}::jsonb,
               candidate_rationales = ${fitOut.candidate ? JSON.stringify(fitOut.candidate.rationales) : null}::jsonb,
               candidate_summary    = ${fitOut.candidate?.summary ?? null},
               comp_acceptable      = ${compClears(sal.range, fitOut.compFloor) ?? fitOut.candidate?.compAcceptable ?? null}
         where slug = ${slug};
      `;
    } catch (e) { console.warn('[add-role] fit calc failed', e); }

    // Wire the recommendation → pipeline link, if any. Also stash a
    // back-link to the source email when the rec came from Gmail so the
    // user can re-open the originating thread from the role detail.
    if (body.fromRecommendationId) {
      try {
        const recRows = await sql<{ source: string; payload: Record<string, unknown> | null; location: string | null }[]>`
          select source, payload, location from job.recommended_roles
           where id = ${body.fromRecommendationId} limit 1`;
        await sql`
          update job.recommended_roles
          set added_to_pipeline_slug = ${slug}
          where id = ${body.fromRecommendationId};
        `;
        const rec = recRows[0];
        // Backfill location from the source rec when the page parse missed it.
        if (rec?.location && String(rec.location).trim()) {
          await sql`
            update job.pipeline_roles
               set location = coalesce(location, ${rec.location})
             where slug = ${slug};
          `;
        }
        const gmailApiId = rec?.source === 'gmail-jobs'
          ? (rec.payload as Record<string, unknown> | null)?.gmailApiId
          : null;
        if (gmailApiId) {
          await sql`
            update job.pipeline_roles
               set source_email_url = ${'https://mail.google.com/mail/u/0/#inbox/' + String(gmailApiId)}
             where slug = ${slug} and source_email_url is null;
          `;
        }
      } catch (e) { console.warn('[add-role] rec link failed', e); }
    }

    return jsonResp({
      ok: true,
      slug,
      title,
      company,
      source: finalSource,
      sourceLabel,
      sector,
      salaryRange: sal.range,
    });
  } catch (e) {
    console.error('[add-role] error', e);
    return err((e as Error).message || 'server error', 500);
  }
});
