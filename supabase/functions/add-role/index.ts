// add-role — accept a pasted URL (and optional title/company) and insert
// a new pipeline_role. Best-effort enrichment via the page's <title>; the
// user can refine via the detail page.
//
// POST { url, title?, company?, source?, fromRecommendationId? }

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { verifyJobUser, jsonResp, err, corsHeaders, slugify, roleSlug } from '../_shared/job-auth.ts';
import { db } from '../_shared/job-db.ts';
import { parseSectorTags } from '../_shared/sector-tags.ts';

const VERSION = '0.1.3';
console.log(`[add-role] v${VERSION} - og:title + ATS host parsing for Workday/Greenhouse/Lever/Ashby`);

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

// Returns { title, siteName } where title is og:title (preferred — Workday and
// most JS-rendered ATS pages leave <title> empty) or the <title> element text.
async function fetchPageMeta(url: string): Promise<{ title: string | null; siteName: string | null }> {
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 8000);
    const res = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; ctrl-rodeo-job/1.0)' },
      redirect: 'follow',
      signal: ctrl.signal,
    });
    clearTimeout(t);
    if (!res.ok) return { title: null, siteName: null };
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
    return { title, siteName };
  } catch { return { title: null, siteName: null }; }
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

    if (!title || !company) {
      const meta = await fetchPageMeta(url);
      const guess = splitTitleCompany(meta.title);
      if (!title && guess.title) title = guess.title;
      if (!company && guess.company) company = guess.company;
      if (!company && meta.siteName) company = meta.siteName;
    }
    // ATS host-based fallback (Workday subdomains, Greenhouse/Lever/Ashby
    // path slugs). Beats a no-op "(unknown company)" placeholder.
    if (!company) {
      const fromHost = companyFromHost(url);
      if (fromHost) company = fromHost;
    }
    // URL-path fallback for the role title (Workday: /job/<Title>_R-1466).
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

    // Tag the row using whatever sector blob the user / recommendation passed.
    const sector = String(body.sector || '').trim();
    if (sector) {
      await sql`update job.pipeline_roles set sector = ${sector} where slug = ${slug}`;
      const tags = parseSectorTags(sector);
      await sql`delete from job.role_sector_tags where role_slug = ${slug}`;
      for (const t of tags) {
        await sql`insert into job.sector_tags (slug, name) values (${t.slug}, ${t.name}) on conflict do nothing`;
        await sql`insert into job.role_sector_tags (role_slug, tag_slug) values (${slug}, ${t.slug}) on conflict do nothing`;
      }
    }

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

    return jsonResp({ ok: true, slug, title, company, source: finalSource, sourceLabel });
  } catch (e) {
    console.error('[add-role] error', e);
    return err((e as Error).message || 'server error', 500);
  }
});
