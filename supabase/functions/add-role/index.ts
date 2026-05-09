// add-role — accept a pasted URL (and optional title/company) and insert
// a new pipeline_role. Best-effort enrichment via the page's <title>; the
// user can refine via the detail page.
//
// POST { url, title?, company?, source?, fromRecommendationId? }

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { verifyJobUser, jsonResp, err, corsHeaders, slugify, roleSlug } from '../_shared/job-auth.ts';
import { db } from '../_shared/job-db.ts';
import { parseSectorTags } from '../_shared/sector-tags.ts';

const VERSION = '0.1.0';
console.log(`[add-role] v${VERSION}`);

const URL_RE = /^https?:\/\//i;
const TITLE_RE = /<title[^>]*>([\s\S]*?)<\/title>/i;
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

async function fetchTitle(url: string): Promise<string | null> {
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 8000);
    const res = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; ctrl-rodeo-job/1.0)' },
      redirect: 'follow',
      signal: ctrl.signal,
    });
    clearTimeout(t);
    if (!res.ok) return null;
    const html = await res.text();
    const m = html.match(TITLE_RE);
    if (!m) return null;
    return m[1].replace(/&amp;/g, '&').replace(/&[a-z]+;/g, ' ').replace(/\s+/g, ' ').trim() || null;
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
      const pageTitle = await fetchTitle(url);
      const guess = splitTitleCompany(pageTitle);
      if (!title && guess.title) title = guess.title;
      if (!company && guess.company) company = guess.company;
    }
    if (!title) title = '(untitled role)';
    if (!company) company = '(unknown company)';

    const slug = roleSlug(company, title);
    if (!slug) return err('could not derive slug from title/company', 400);

    const { source, sourceLabel } = detectSource(url);
    const finalSource = body.source ? String(body.source) : source;

    const sql = db();
    // Insert / restore — if a deleted row exists for this slug, un-delete it.
    await sql`
      insert into job.pipeline_roles (
        slug, company_slug, company_name, title, url, source, status
      ) values (
        ${slug}, ${slugify(company)}, ${company}, ${title},
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
