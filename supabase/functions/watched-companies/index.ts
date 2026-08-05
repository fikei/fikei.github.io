// watched-companies — CRUD for the green-lit watched company list.
//
//   GET                → list this user's watched companies (+ active rec counts)
//   POST { company, adapter?, config?, filterMode?, titleKeywords?, locations? }
//                      → add a watch. When adapter/config are omitted the
//                        server resolves them: known-major registry →
//                        hiring_companies cache → ATS board probe.
//   PATCH { id, ... }  → update filter_mode / keywords / locations / enabled / config
//   DELETE { id }      → remove the watch and dismiss its active recs
//
// Adding the first watch also ensures a user_sources row of type
// 'company-watch' exists (enabled, 6-hourly) so the pull-recommendations
// cron starts ticking it without manual setup.

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { verifyJobUser, jsonResp, err, corsHeaders } from '../_shared/job-auth.ts';
import { db } from '../_shared/job-db.ts';

const VERSION = '0.2.0';
console.log(`[watched-companies] v${VERSION} - optional careers URL on POST: ATS derivation from board URLs + custom-page fallback adapter`);

const FILTER_MODES = new Set(['all', 'role_level', 'good_fits', 'exceptional']);

// Known majors with custom careers backends. Config queries default to
// 'product manager' — the UI lets the user edit per watch.
const KNOWN_MAJORS: Record<string, { adapter: string; config: Record<string, unknown> }> = {
  google:     { adapter: 'google',    config: { query: 'product manager' } },
  youtube:    { adapter: 'google',    config: { query: 'product manager' } },
  amazon:     { adapter: 'amazon',    config: { query: 'product manager' } },
  apple:      { adapter: 'apple',     config: { query: 'product manager' } },
  netflix:    { adapter: 'eightfold', config: { base: 'https://explore.jobs.netflix.net', domain: 'netflix.com', query: 'product manager' } },
  nvidia:     { adapter: 'workday',   config: { host: 'nvidia.wd5.myworkdayjobs.com', tenant: 'nvidia', site: 'NVIDIAExternalCareerSite', query: 'product manager' } },
  salesforce: { adapter: 'workday',   config: { host: 'salesforce.wd12.myworkdayjobs.com', tenant: 'salesforce', site: 'External_Career_Site', query: 'product manager' } },
  adobe:      { adapter: 'workday',   config: { host: 'adobe.wd5.myworkdayjobs.com', tenant: 'adobe', site: 'external_experienced', query: 'product manager' } },
};

// ---------- ATS board probe (Greenhouse / Lever / Ashby) ----------
// Same probe trio enrich-job-source uses, trimmed: try the company name as
// a slug (spaces stripped / hyphenated) against each provider.
function slugCandidates(name: string): string[] {
  const base = name.toLowerCase().trim();
  return [...new Set([
    base.replace(/[^a-z0-9]+/g, ''),
    base.replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, ''),
  ])].filter(Boolean);
}

async function probeAts(name: string): Promise<{ adapter: string; config: Record<string, unknown> } | null> {
  const probes: Array<{ adapter: string; url: (s: string) => string; ok: (d: unknown) => boolean }> = [
    { adapter: 'greenhouse', url: s => `https://boards-api.greenhouse.io/v1/boards/${s}/jobs`,
      ok: d => Array.isArray((d as { jobs?: unknown[] })?.jobs) && ((d as { jobs: unknown[] }).jobs.length > 0) },
    { adapter: 'lever',      url: s => `https://api.lever.co/v0/postings/${s}?mode=json&limit=1`,
      ok: d => Array.isArray(d) && d.length > 0 },
    { adapter: 'ashby',      url: s => `https://api.ashbyhq.com/posting-api/job-board/${s}`,
      ok: d => Array.isArray((d as { jobs?: unknown[] })?.jobs) && ((d as { jobs: unknown[] }).jobs.length > 0) },
  ];
  for (const slug of slugCandidates(name)) {
    const results = await Promise.allSettled(probes.map(async p => {
      const res = await fetch(p.url(slug));
      if (!res.ok) throw new Error(String(res.status));
      const data = await res.json();
      if (!p.ok(data)) throw new Error('empty board');
      return { adapter: p.adapter, config: { slug } };
    }));
    const hit = results.find(r => r.status === 'fulfilled');
    if (hit && hit.status === 'fulfilled') return hit.value;
  }
  return null;
}

// Derive an ATS adapter straight from a pasted board URL, so pasting
// https://jobs.lever.co/acme or a boards.greenhouse.io link watches the
// board API rather than scraping the page.
function adapterFromUrl(rawUrl: string): { adapter: string; config: Record<string, unknown> } | null {
  let u: URL;
  try { u = new URL(rawUrl); } catch { return null; }
  const host = u.hostname.toLowerCase();
  const seg = u.pathname.split('/').filter(Boolean);
  if (/(?:^|\.)(boards|job-boards)\.greenhouse\.io$/.test(host) && seg[0]) {
    return { adapter: 'greenhouse', config: { slug: seg[0] } };
  }
  if (/(?:^|\.)jobs\.lever\.co$/.test(host) && seg[0]) {
    return { adapter: 'lever', config: { slug: seg[0] } };
  }
  if (/(?:^|\.)jobs\.ashbyhq\.com$/.test(host) && seg[0]) {
    return { adapter: 'ashby', config: { slug: seg[0] } };
  }
  return null;
}

async function resolveAdapter(sql: ReturnType<typeof db>, company: string): Promise<{ adapter: string; config: Record<string, unknown> } | null> {
  const norm = company.toLowerCase().trim();
  if (KNOWN_MAJORS[norm]) return KNOWN_MAJORS[norm];
  // hiring_companies cache — enrich-job-source has often already resolved
  // this company's ATS provider + slug.
  try {
    const rows = await sql<{ ats_provider: string | null; ats_slug: string | null }[]>`
      select ats_provider, ats_slug from job.hiring_companies
       where name_norm = ${norm} and resolution_status = 'resolved'
       limit 1`;
    const c = rows[0];
    if (c?.ats_provider && c?.ats_slug) {
      const provider = c.ats_provider.toLowerCase();
      if (['greenhouse', 'lever', 'ashby'].includes(provider)) {
        return { adapter: provider, config: { slug: c.ats_slug } };
      }
    }
  } catch { /* cache miss is fine */ }
  return await probeAts(company);
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  try {
    const email = await verifyJobUser(req);
    if (!email) return err('unauthorized', 401);
    const sql = db();

    if (req.method === 'GET') {
      const rows = await sql`
        select w.id, w.company, w.adapter, w.adapter_config as "adapterConfig",
               w.filter_mode as "filterMode", w.title_keywords as "titleKeywords",
               w.locations, w.enabled, w.created_at as "createdAt",
               w.last_pulled_at as "lastPulledAt", w.last_pull_count as "lastPullCount",
               w.last_error as "lastError",
               (select count(*)::int from job.recommended_roles r
                 where r.watched_company_id = w.id
                   and r.dismissed_at is null and r.closed_at is null
                   and r.added_to_pipeline_slug is null) as "activeRecs"
          from job.watched_companies w
         where w.user_email = ${email}
         order by w.company`;
      return jsonResp({ ok: true, version: VERSION, watches: rows });
    }

    if (req.method === 'POST') {
      const body = await req.json().catch(() => ({}));
      const url = String(body.url || '').trim();
      let company = String(body.company || '').trim();
      // URL-only add: derive a display name from the domain ("medplum.com"
      // → "Medplum") so the user can paste just the careers link.
      if (!company && url) {
        try {
          const host = new URL(url).hostname.replace(/^www\./, '');
          const base = host.split('.')[0];
          company = base.charAt(0).toUpperCase() + base.slice(1);
        } catch { /* fall through to the required check */ }
      }
      if (!company) return err('company or url required', 400);
      if (url && !/^https?:\/\//i.test(url)) return err('url must be http(s)', 400);
      const norm = company.toLowerCase();

      let adapter = typeof body.adapter === 'string' ? body.adapter : '';
      let config  = (body.config && typeof body.config === 'object') ? body.config as Record<string, unknown> : {};
      if (!adapter && url) {
        // A pasted ATS board URL beats scraping; anything else becomes a
        // custom careers-page watch (Haiku-extracted at pull time).
        const fromUrl = adapterFromUrl(url);
        if (fromUrl) { adapter = fromUrl.adapter; config = { ...fromUrl.config, ...config }; }
        else { adapter = 'custom'; config = { url, ...config }; }
      }
      if (!adapter) {
        const resolved = await resolveAdapter(sql, company);
        if (!resolved) {
          return jsonResp({ ok: false, unresolved: true,
            error: `Couldn't find a careers backend for "${company}". Paste the careers page URL to track it directly, or use a company on Greenhouse / Lever / Ashby or major tech (Google, Amazon, Apple, Netflix, Nvidia, Salesforce, Adobe).` }, 422);
        }
        adapter = resolved.adapter;
        config  = { ...resolved.config, ...config };
      }
      const filterMode = FILTER_MODES.has(body.filterMode) ? body.filterMode : 'good_fits';
      const titleKeywords = Array.isArray(body.titleKeywords) ? body.titleKeywords.map(String).filter(Boolean) : [];
      const locations     = Array.isArray(body.locations)     ? body.locations.map(String).filter(Boolean)     : [];

      const [watch] = await sql`
        insert into job.watched_companies
          (user_email, company, company_norm, adapter, adapter_config, filter_mode, title_keywords, locations)
        values (${email}, ${company}, ${norm}, ${adapter}, ${sql.json(config)}, ${filterMode}, ${titleKeywords}, ${locations})
        on conflict (user_email, company_norm) do update
          set adapter = excluded.adapter,
              adapter_config = excluded.adapter_config,
              filter_mode = excluded.filter_mode,
              enabled = true
        returning id, company, adapter, adapter_config as "adapterConfig", filter_mode as "filterMode"`;

      // Ensure the cron-driven source row exists for this user.
      await sql`
        insert into job.user_sources (user_email, type, config, enabled, schedule_cron, min_score)
        select ${email}, 'company-watch', '{}'::jsonb, true, '0 */6 * * *', 0
         where not exists (
           select 1 from job.user_sources
            where user_email = ${email} and type = 'company-watch')`;

      return jsonResp({ ok: true, version: VERSION, watch });
    }

    if (req.method === 'PATCH') {
      const body = await req.json().catch(() => ({}));
      const id = String(body.id || '');
      if (!id) return err('id required', 400);
      if (body.filterMode !== undefined && !FILTER_MODES.has(body.filterMode)) {
        return err(`filterMode must be one of: ${[...FILTER_MODES].join(', ')}`, 400);
      }
      const [row] = await sql`
        update job.watched_companies
           set filter_mode    = coalesce(${body.filterMode ?? null}, filter_mode),
               title_keywords = coalesce(${Array.isArray(body.titleKeywords) ? body.titleKeywords.map(String) : null}, title_keywords),
               locations      = coalesce(${Array.isArray(body.locations) ? body.locations.map(String) : null}, locations),
               enabled        = coalesce(${typeof body.enabled === 'boolean' ? body.enabled : null}, enabled),
               adapter_config = coalesce(${body.config && typeof body.config === 'object' ? sql.json(body.config) : null}, adapter_config)
         where id = ${id} and user_email = ${email}
         returning id, company, adapter, adapter_config as "adapterConfig",
                   filter_mode as "filterMode", title_keywords as "titleKeywords",
                   locations, enabled`;
      if (!row) return err('not found', 404);
      return jsonResp({ ok: true, version: VERSION, watch: row });
    }

    if (req.method === 'DELETE') {
      const body = await req.json().catch(() => ({}));
      const id = String(body.id || '');
      if (!id) return err('id required', 400);
      const dis = await sql`
        update job.recommended_roles set dismissed_at = now()
         where watched_company_id = ${id} and user_email = ${email} and dismissed_at is null
         returning id`;
      const del = await sql`
        delete from job.watched_companies
         where id = ${id} and user_email = ${email}
         returning id`;
      if (!del.length) return err('not found', 404);
      return jsonResp({ ok: true, version: VERSION, deleted: id, dismissedRecs: dis.length });
    }

    return err('GET, POST, PATCH, or DELETE only', 405);
  } catch (e) {
    console.error('[watched-companies] error', e);
    return err((e as Error).message || 'server error', 500);
  }
});
