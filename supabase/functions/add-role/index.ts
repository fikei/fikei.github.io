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

const VERSION = '0.1.5';
console.log(`[add-role] v${VERSION} - tighten sector regex (no false-positive EdTech on "learning")`);

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
  if (/ashby(hq)?\.com|greenhouse|lever\.co|workday|smartrecruiters/i.test(url)) {
    return { source: 'From Company Pages', sourceLabel: 'From Company Pages' };
  }
  return { source: 'Manual', sourceLabel: 'Manual' };
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

// Returns title (og:title preferred), siteName, and a plain-text body
// distilled from og:description / meta-description / inner text. Used to
// detect salary range + sector hints without needing a real DOM parser.
async function fetchPageMeta(url: string): Promise<{ title: string | null; siteName: string | null; body: string }> {
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 8000);
    const res = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; ctrl-rodeo-job/1.0)' },
      redirect: 'follow',
      signal: ctrl.signal,
    });
    clearTimeout(t);
    if (!res.ok) return { title: null, siteName: null, body: '' };
    const html = await res.text();

    let title: string | null = null;
    const og = html.match(OG_TITLE_RE) || html.match(OG_TITLE_RE2);
    if (og) title = decodeEntities(og[1]) || null;
    if (!title) {
      const m = html.match(TITLE_RE);
      if (m) title = decodeEntities(m[1]) || null;
    }

    const siteMatch = html.match(OG_SITE_RE);
    const siteName = siteMatch ? (decodeEntities(siteMatch[1]) || null) : null;

    // Body text: prefer og:description (Workday, Greenhouse, Ashby all set
    // this with the full JD). Fall back to meta description, then a crude
    // tag strip.
    let body = '';
    const ogDesc = html.match(/<meta[^>]+property=["']og:description["'][^>]*content=["']([^"']+)["']/i)
      || html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:description["']/i);
    if (ogDesc) body = decodeEntities(ogDesc[1]);
    if (!body) {
      const md = html.match(/<meta[^>]+name=["']description["'][^>]*content=["']([^"']+)["']/i);
      if (md) body = decodeEntities(md[1]);
    }
    if (!body) {
      body = decodeEntities(html.replace(/<script[\s\S]*?<\/script>/gi, '').replace(/<style[\s\S]*?<\/style>/gi, '').replace(/<[^>]+>/g, ' '));
    }

    return { title, siteName, body: body.slice(0, 12000) };
  } catch { return { title: null, siteName: null, body: '' }; }
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

// "Senior Product Manager — R-1466 — Cityblock" → strip trailing job IDs.
function cleanTitle(t: string): string {
  return t
    .replace(/[\s\-–—_]*R-?\d{2,}\s*$/i, '')
    .replace(/[\s\-–—_]*Job\s*ID:?\s*\S+\s*$/i, '')
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
    const url = String(body.url || '').trim();
    if (!url || !URL_RE.test(url)) return err('valid http(s) url required', 400);

    let title = String(body.title || '').trim();
    let company = String(body.company || '').trim();

    // Always pull the page so we have the JD body for salary + sector
    // detection, even if title/company were passed in by the caller.
    const meta = await fetchPageMeta(url);
    if (!title) {
      const guess = splitTitleCompany(meta.title);
      if (guess.title) title = guess.title;
    }
    if (!company) {
      const guess = splitTitleCompany(meta.title);
      if (guess.company) company = guess.company;
      if (!company && meta.siteName) company = meta.siteName;
    }
    if (!company) {
      const fromHost = companyFromHost(url);
      if (fromHost) company = fromHost;
    }
    if (!title) {
      const fromPath = titleFromUrl(url);
      if (fromPath) title = fromPath;
    }
    if (title) title = cleanTitle(title);
    if (!title) title = '(untitled role)';
    if (!company) company = '(unknown company)';

    const slug = roleSlug(company, title);
    if (!slug) return err('could not derive slug from title/company', 400);

    const { source, sourceLabel } = detectSource(url);
    const finalSource = body.source ? String(body.source) : source;

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
          slug, company_slug, company_name, title, url, source, status
        ) values (
          ${slug}, ${companySlug}, ${company}, ${title},
          ${url}, ${finalSource}, 'New'
        )
        on conflict (slug) do update set
          url = excluded.url,
          title = excluded.title,
          company_name = excluded.company_name,
          company_slug = excluded.company_slug,
          source = coalesce(job.pipeline_roles.source, excluded.source),
          deleted_at = null,
          archived_at = null,
          updated_at = now();
      `;
    } else {
      // No company slug — insert without the FK link.
      await sql`
        insert into job.pipeline_roles (
          slug, company_slug, company_name, title, url, source, status
        ) values (
          ${slug}, null, ${company}, ${title},
          ${url}, ${finalSource}, 'New'
        )
        on conflict (slug) do update set
          url = excluded.url,
          title = excluded.title,
          company_name = excluded.company_name,
          company_slug = excluded.company_slug,
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

    // --- Salary parsing from JD body ---
    const sal = parseSalary(meta.body);
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
    await sql`
      update job.pipeline_roles
      set first_seen = coalesce(first_seen, current_date),
          last_seen = current_date
      where slug = ${slug};
    `;

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

    // --- Compute fit score so the row paints with a real pill. ---
    try {
      const fit = computeFit({
        status: 'New',
        rank: '',
        company,
        title,
        url,
        source: finalSource,
        contact: '',
        salary: sal.range || '',
        sector: sector || '',
        investors: '',
        website: '',
        crunchbase: '',
      });
      const breakdownJson = JSON.stringify(fit.breakdown);
      await sql`
        update job.pipeline_roles
        set fit_score = ${fit.score},
            fit_breakdown = ${breakdownJson}::jsonb,
            hard_fails = ${fit.hardFails}
        where slug = ${slug};
      `;
    } catch (e) { console.warn('[add-role] fit calc failed', e); }

    // Wire the recommendation → pipeline link, if any.
    if (body.fromRecommendationId) {
      try {
        await sql`
          update job.recommended_roles
          set added_to_pipeline_slug = ${slug}
          where id = ${body.fromRecommendationId};
        `;
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
