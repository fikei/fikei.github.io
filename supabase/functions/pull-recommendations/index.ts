// pull-recommendations — single tick of the recommendations worker.
//
// On every invocation:
//   1. Find user_sources rows that are enabled and due per schedule_cron.
//   2. For each one, look up the plugin in SOURCES[type] and call pull().
//   3. Score every returned posting with the same fit logic as the pipeline.
//   4. Drop hard-failed roles AND roles below user_sources.min_score.
//   5. Insert survivors into job.recommended_roles using ON CONFLICT
//      DO NOTHING RETURNING * to learn which rows are actually new.
//   6. For new rows only, ask Claude Haiku for 3 personalized match
//      bullets grounded in the user's resume / skills / wins / vision.
//   7. Stamp last_run_at, last_run_count, last_dropped, last_error.
//
// Auth: header X-Cron-Secret must match env CRON_SECRET. The pg_cron
// schedule sets this header.

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { db } from '../_shared/job-db.ts';
import { verifyJobUser } from '../_shared/job-auth.ts';
import { computeFit, type RoleRow, type UserContext as FitUserContext } from '../jobs-pipe/fit.ts';
import { SOURCES } from '../_shared/sources/registry.ts';
import type { RecommendedRoleInput } from '../_shared/sources/types.ts';
// pull-recommendations keeps a local copy of fetchJdText / haikuRoleMatch /
// loadFitContext for now. add-role uses the canonical versions in
// ../_shared/job-fit-haiku.ts. TODO: consolidate to one source of truth.

const VERSION = '0.7.0';
console.log(`[pull-recommendations] v${VERSION} - Phase 2.0 application-tracker scan side-effect in gmail-jobs source`);

const ANTHROPIC_MODEL = 'claude-haiku-4-5';
const ANTHROPIC_URL   = 'https://api.anthropic.com/v1/messages';

interface UserSourceRow {
  id:            string;
  user_email:    string;
  type:          string;
  config:        Record<string, unknown>;
  schedule_cron: string;
  min_score:     number;
  last_run_at:   string | null;
}

interface UserContext {
  resume:   string;
  skills:   string;
  wins:     string;
  vision:   string;
}

serve(async (req) => {
  if (req.method !== 'POST' && req.method !== 'GET') {
    return new Response('POST only', { status: 405 });
  }
  // Two auth paths:
  //   - X-Cron-Secret: the pg_cron schedule + back-end function-to-function calls
  //   - verifyJobUser: a signed-in user triggering a per-slug rescore from the drill page
  const secret = Deno.env.get('CRON_SECRET');
  const hasCronSecret = !!secret && req.headers.get('x-cron-secret') === secret;
  const userEmail = hasCronSecret ? null : await verifyJobUser(req);
  if (!hasCronSecret && !userEmail) {
    return new Response('forbidden', { status: 403 });
  }

  // Optional force-run: POST { id: '<user_source_id>' } from user-sources
  // bypasses both the enabled flag and the schedule, so the user can
  // trigger a single source from the UI without waiting for cron.
  let forceId: string | null = null;
  let rescoreOnly = false;
  let backfillDescriptions = false;
  if (req.method === 'POST') {
    try {
      const body = await req.json();
      if (body && typeof body.id === 'string') forceId = body.id;
      if (body && body.rescore === true) rescoreOnly = true;
      if (body && body.backfillDescriptions === true) backfillDescriptions = true;
    } catch { /* no body, that's fine */ }
  }
  if (new URL(req.url).searchParams.get('rescore') === '1') rescoreOnly = true;
  if (new URL(req.url).searchParams.get('backfill_descriptions') === '1') backfillDescriptions = true;

  const sql = db();

  // Backfill missing JD descriptions on pipeline_roles by re-fetching the
  // posting URL. Strips HTML to plain text. Bounded to 50 rows per call
  // so a Cloudflare ATS rate-limit can't burn the request budget.
  if (backfillDescriptions) {
    try {
      const pipeRows = await sql<Array<{ key: string; url: string | null }>>`
        select slug as key, url
          from job.pipeline_roles
         where deleted_at is null
           and (description is null or length(description) < 200)
           and url is not null
         limit 50`;
      // Cap at 50 so we don't blow the edge-function 150s ceiling on
      // slow ATSes. Re-running the endpoint picks up the rest.
      const recRows = await sql<Array<{ key: string; url: string | null }>>`
        select id::text as key, url
          from job.recommended_roles
         where dismissed_at is null
           and added_to_pipeline_slug is null
           and (description is null or length(description) < 200)
           and url is not null
         limit 50`;
      const results: Array<{ table: string; key: string; ok: boolean; len?: number; error?: string }> = [];
      for (const r of pipeRows) {
        try {
          const text = await fetchJdText(r.url!);
          if (!text || text.length < 200) { results.push({ table: 'pipeline', key: r.key, ok: false, error: `short body (${text?.length ?? 0} chars)` }); continue; }
          await sql`update job.pipeline_roles set description = ${text} where slug = ${r.key}`;
          results.push({ table: 'pipeline', key: r.key, ok: true, len: text.length });
        } catch (e) {
          results.push({ table: 'pipeline', key: r.key, ok: false, error: (e as Error).message });
        }
      }
      for (const r of recRows) {
        try {
          const text = await fetchJdText(r.url!);
          if (!text || text.length < 200) { results.push({ table: 'recommended', key: r.key, ok: false, error: `short body (${text?.length ?? 0} chars)` }); continue; }
          await sql`update job.recommended_roles set description = ${text} where id = ${r.key}::uuid`;
          results.push({ table: 'recommended', key: r.key, ok: true, len: text.length });
        } catch (e) {
          results.push({ table: 'recommended', key: r.key, ok: false, error: (e as Error).message });
        }
      }
      return new Response(JSON.stringify({ ok: true, version: VERSION,
        pipeline: { fetched: pipeRows.length, succeeded: results.filter(r => r.table === 'pipeline' && r.ok).length },
        recommended: { fetched: recRows.length, succeeded: results.filter(r => r.table === 'recommended' && r.ok).length },
        results,
      }, null, 2), { status: 200, headers: { 'content-type': 'application/json' } });
    } catch (outer) {
      console.error('[pull-recommendations] backfill outer error:', (outer as Error).stack || (outer as Error).message);
      return new Response(JSON.stringify({ ok: false, error: (outer as Error).message, stack: (outer as Error).stack }, null, 2),
        { status: 500, headers: { 'content-type': 'application/json' } });
    }
  }

  // Backfill rescore — recompute fit_score and fit_breakdown for every
  // active recommended role using the v2 scorer + UserContext. Useful
  // after weight/shape changes so existing rows pick up the new model.
  if (rescoreOnly) {
    const ctx = await loadFitContext(sql);
    const useHaiku = new URL(req.url).searchParams.get('haiku') !== '0';
    // ?slug=X → scope rescore to one pipeline_role. Skips the
    // recommended_roles pass entirely (a single pipeline row doesn't
    // need the widget rescored). Used by the drill page's
    // auto-regen-analysis hook so picking up new company/title/url
    // data refreshes the fit_score without rescoring the whole pipeline.
    const slugParam = new URL(req.url).searchParams.get('slug')?.trim() || null;
    const force = new URL(req.url).searchParams.get('force') === '1';
    const rows = slugParam ? [] : await sql<Array<{ id: string; title: string | null; company: string | null; description: string | null; sector: string | null; investors: string[] | null; salary: string | null; source: string | null; role_match_score: number | null; role_match_rationale: string | null; role_match_seniority: string | null; role_match_scope: string | null }>>`
      select id, title, company, description, sector, investors, salary, source,
             role_match_score, role_match_rationale, role_match_seniority, role_match_scope
        from job.recommended_roles
       where dismissed_at is null and added_to_pipeline_slug is null
    `;
    let updated = 0, haikuCalls = 0;
    for (const r of rows) {
      const roleRow: RoleRow = {
        status: '', rank: '',
        company: r.company || '', title: r.title || '', url: '',
        source: r.source || '', contact: '', salary: r.salary || '',
        sector: r.sector || '', investors: (r.investors || []).join(', '),
        website: '', crunchbase: '', description: r.description || '',
      };
      let roleScore = r.role_match_score;
      let rationale = r.role_match_rationale;
      let seniority = r.role_match_seniority;
      let scope     = r.role_match_scope;
      const needsHaiku = useHaiku && (r.description || '').length > 200
        && (force || roleScore == null || seniority == null);
      if (needsHaiku) {
        const haiku = await haikuRoleMatch(roleRow, ctx);
        if (haiku) {
          roleScore = haiku.score; rationale = haiku.rationale;
          seniority = haiku.seniority; scope = haiku.scope;
          haikuCalls++;
        }
      }
      const fit = computeFit(roleRow, ctx, roleScore, seniority, rationale);
      await sql`
        update job.recommended_roles
           set fit_score            = ${fit.score},
               fit_breakdown        = ${sql.json(fit.breakdown)},
               fit_rationales       = ${sql.json(fit.rationales)},
               hard_fails           = ${fit.hardFails},
               role_match_score     = ${roleScore},
               role_match_rationale = ${rationale},
               role_match_seniority = ${seniority},
               role_match_scope     = ${scope}
         where id = ${r.id}
      `;
      updated++;
    }
    const pipeRows = slugParam
      ? await sql<Array<{ slug: string; title: string | null; company_name: string | null; description: string | null; sector: string | null; investors: string[] | null; salary_range: string | null; source: string | null; role_match_score: number | null; role_match_rationale: string | null; role_match_seniority: string | null; role_match_scope: string | null }>>`
          select slug, title, company_name, description, sector, investors, salary_range, source,
                 role_match_score, role_match_rationale, role_match_seniority, role_match_scope
            from job.pipeline_roles where deleted_at is null and slug = ${slugParam}`
      : await sql<Array<{ slug: string; title: string | null; company_name: string | null; description: string | null; sector: string | null; investors: string[] | null; salary_range: string | null; source: string | null; role_match_score: number | null; role_match_rationale: string | null; role_match_seniority: string | null; role_match_scope: string | null }>>`
          select slug, title, company_name, description, sector, investors, salary_range, source,
                 role_match_score, role_match_rationale, role_match_seniority, role_match_scope
            from job.pipeline_roles where deleted_at is null`;
    let pipeUpdated = 0;
    for (const r of pipeRows) {
      const roleRow: RoleRow = {
        status: '', rank: '',
        company: r.company_name || '', title: r.title || '', url: '',
        source: r.source || '', contact: '', salary: r.salary_range || '',
        sector: r.sector || '', investors: (r.investors || []).join(', '),
        website: '', crunchbase: '', description: r.description || '',
      };
      let pipeRoleScore = r.role_match_score;
      let pipeRationale = r.role_match_rationale;
      let pipeSeniority = r.role_match_seniority;
      let pipeScope     = r.role_match_scope;
      const needsHaiku = useHaiku && (r.description || '').length > 200
        && (force || pipeRoleScore == null || pipeSeniority == null);
      if (needsHaiku) {
        const haiku = await haikuRoleMatch(roleRow, ctx);
        if (haiku) {
          pipeRoleScore = haiku.score; pipeRationale = haiku.rationale;
          pipeSeniority = haiku.seniority; pipeScope = haiku.scope;
          haikuCalls++;
        }
      }
      const fit = computeFit(roleRow, ctx, pipeRoleScore, pipeSeniority, pipeRationale);
      await sql`
        update job.pipeline_roles
           set fit_score            = ${fit.score},
               fit_breakdown        = ${sql.json(fit.breakdown)},
               fit_rationales       = ${sql.json(fit.rationales)},
               hard_fails           = ${fit.hardFails},
               role_match_score     = ${pipeRoleScore},
               role_match_rationale = ${pipeRationale},
               role_match_seniority = ${pipeSeniority},
               role_match_scope     = ${pipeScope}
         where slug = ${r.slug}`;
      pipeUpdated++;
    }
    return new Response(JSON.stringify({ ok: true, version: VERSION, rescored: updated, pipelineRescored: pipeUpdated, haikuCalls }, null, 2),
      { status: 200, headers: { 'content-type': 'application/json' } });
  }
  const sources = forceId
    ? await sql<UserSourceRow[]>`
        select id, user_email, type, config, schedule_cron, min_score, last_run_at
        from job.user_sources
        where id = ${forceId}`
    : await sql<UserSourceRow[]>`
        select id, user_email, type, config, schedule_cron, min_score, last_run_at
        from job.user_sources
        where enabled = true`;

  const summary: Array<Record<string, unknown>> = [];
  for (const src of sources) {
    if (!forceId && !isDue(src)) { summary.push({ id: src.id, skipped: 'not-due' }); continue; }
    const plugin = SOURCES[src.type];
    if (!plugin) {
      await markRun(sql, src.id, { count: 0, dropped: 0, error: `unknown source type: ${src.type}` });
      summary.push({ id: src.id, skipped: 'unknown-type' });
      continue;
    }
    try {
      const since = src.last_run_at ? new Date(src.last_run_at) : null;
      const pulled = await plugin.pull(src.config, { userEmail: src.user_email, since });
      // Drop anything whose title doesn't match the user's target titles.
      const targetTitles = await loadTargetTitles(sql);
      const onTarget = targetTitles.length
        ? pulled.filter(r => titleMatches(r.title || '', targetTitles))
        : pulled;
      const droppedOffTarget = pulled.length - onTarget.length;
      // Drop anything whose location isn't one the user wants. Postings
      // with no location (rare on ATS; common on RSS) get the benefit of
      // the doubt — kept and flagged for the user via the bullet.
      const targetGeos = await loadTargetGeographies(sql);
      const inGeo = targetGeos.length
        ? onTarget.filter(r => geoMatches(r.location || '', targetGeos))
        : onTarget;
      const droppedOffGeo = onTarget.length - inGeo.length;
      const fitCtx = await loadFitContext(sql);
      const { kept, dropped } = scoreAndFilter(inGeo, src.min_score, fitCtx);
      // Drop anything the user already has in their pipeline (any state —
      // active, archived, deleted). Match on (lower(company), lower(title))
      // so a different ATS URL for the same posting still dedupes.
      const pipelineKeys = await sql<{ key: string }[]>`
        select distinct lower(company_name) || '|' || lower(title) as key
          from job.pipeline_roles
         where company_name is not null and title is not null
      `;
      const pipelineSet = new Set(pipelineKeys.map(r => r.key));
      const filtered = kept.filter(r => {
        const k = `${(r.input.company || '').toLowerCase()}|${(r.input.title || '').toLowerCase()}`;
        return !pipelineSet.has(k);
      });
      const droppedToPipeline = kept.length - filtered.length;
      const inserted = await insertNew(sql, src, filtered);
      // Productize the v3 fit pipeline: every NEW recommendation gets a
      // JD fetch (if the plugin didn't provide one) + Haiku-graded role
      // match + a v3 rescore using the structured fields. Cron pulls feed
      // straight into the same scoring stack the manual rescore uses, so
      // a posting that lands at 3am scores the same as one we re-graded.
      if (inserted.length) {
        await enrichAndScoreNewRows(sql, inserted.map(r => r.id), fitCtx);
      }
      // Bullets for newly-inserted rows AND any older active row that
      // never got bullets. Capped per tick so one Anthropic outage doesn't
      // burn the whole budget.
      const stale = await sql`
        select id, company, title, url, fit_score as "fitScore", fit_breakdown as "breakdown", payload
          from job.recommended_roles
         where (match_bullets is null or jsonb_array_length(match_bullets) = 0)
           and dismissed_at is null
           and added_to_pipeline_slug is null
           and (fit_score is null or fit_score >= 50)
         order by fit_score desc nulls last
         limit 10
      `;
      const toBullet = [...inserted, ...(stale as unknown as typeof inserted).filter(s => !inserted.some(i => i.id === s.id))];
      if (toBullet.length) {
        const ctx = await loadUserContext(sql);
        await Promise.all(toBullet.map(row => generateBullets(sql, row, ctx)));
      }
      await markRun(sql, src.id, { count: inserted.length, dropped: dropped + droppedToPipeline + droppedOffTarget + droppedOffGeo, error: null });
      summary.push({ id: src.id, type: src.type, pulled: pulled.length, droppedOffTarget, droppedOffGeo, kept: kept.length, dropped, droppedToPipeline, inserted: inserted.length });
    } catch (e) {
      await markRun(sql, src.id, { count: 0, dropped: 0, error: (e as Error).message });
      summary.push({ id: src.id, type: src.type, error: (e as Error).message });
    }
  }

  return new Response(JSON.stringify({ ok: true, version: VERSION, ranAt: new Date().toISOString(), sources: summary }, null, 2), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
});

// ---------- Target-title filter ----------
// Reads the user's vision.target_titles array (e.g. ['Founding PM',
// 'Senior PM', 'Product Lead', 'Head of Product']) and keeps only
// postings whose title contains one of those phrases (or a close
// synonym). When vision is empty, this is a no-op — computeFit's
// title hard-fails are the only floor.

let _titleCache: { rows: string[]; at: number } | null = null;
const TITLE_CACHE_MS = 60_000;

// Sensible default for product-track searches when vision.target_titles
// hasn't been filled in yet. Mirrors the seniority floor in computeFit.
const DEFAULT_TARGET_TITLES = [
  'founding pm', 'founding product',
  'product lead', 'head of product', 'vp product', 'chief product',
  'group product manager', 'principal product manager', 'principal pm',
  'staff product manager', 'staff pm',
  'senior product manager', 'senior pm', 'sr product manager',
  'director, product', 'director of product',
];

// Geography filter — read vision.target_geographies; fall back to the
// usual PM hubs + remote so empty vision still gives sane defaults.
const DEFAULT_TARGET_GEOGRAPHIES = [
  'remote', 'san francisco', 'sf bay', 'bay area', 'oakland', 'berkeley',
  'new york', 'nyc', 'brooklyn', 'manhattan',
  'us', 'united states',
];

let _geoCache: { rows: string[]; at: number } | null = null;

async function loadTargetGeographies(sql: ReturnType<typeof db>): Promise<string[]> {
  if (_geoCache && Date.now() - _geoCache.at < TITLE_CACHE_MS) return _geoCache.rows;
  const rows = await sql<{ geos: string[] | null }[]>`
    select target_geographies as geos from job.vision order by updated_at desc limit 1
  `;
  const fromVision = ((rows[0]?.geos as string[]) || []).map(s => s.toLowerCase()).filter(Boolean);
  const geos = fromVision.length ? fromVision : DEFAULT_TARGET_GEOGRAPHIES;
  _geoCache = { rows: geos, at: Date.now() };
  return geos;
}

// Posting "location" strings are wildly varied: "San Francisco, CA",
// "Remote · United States", "New York, NY (Hybrid)", "EMEA - Remote",
// just "" for some Ashby postings. We match by substring, lowercased,
// against any target keyword. Empty location = keep (give benefit of
// doubt; let the user resolve via the bullet's "verify location" line).
function geoMatches(loc: string, targets: string[]): boolean {
  const l = loc.toLowerCase();
  if (!l.trim()) return true;
  return targets.some(t => l.includes(t));
}

async function loadTargetTitles(sql: ReturnType<typeof db>): Promise<string[]> {
  if (_titleCache && Date.now() - _titleCache.at < TITLE_CACHE_MS) return _titleCache.rows;
  const rows = await sql<{ titles: string[] | null }[]>`
    select target_titles as titles from job.vision order by updated_at desc limit 1
  `;
  const fromVision = ((rows[0]?.titles as string[]) || []).map(s => s.toLowerCase()).filter(Boolean);
  const titles = fromVision.length ? fromVision : DEFAULT_TARGET_TITLES;
  _titleCache = { rows: titles, at: Date.now() };
  return titles;
}

// Tokenize each target title into the meaningful keywords that need to
// appear in the posting title. e.g. 'Founding PM' → ['founding', 'pm'].
// A posting matches when one full target's keywords are all present.
function titleMatches(postingTitle: string, targets: string[]): boolean {
  const t = postingTitle.toLowerCase();
  // Synonym expansion: pm ⇄ product manager, head of product ⇄ head, product
  const synonymized = (target: string): string[] => {
    const norm = target
      .replace(/\bproduct manager\b/g, 'pm')
      .replace(/\bsenior\b/g, 'sr')
      .trim();
    return norm.split(/[\s,]+/).filter(Boolean);
  };
  for (const target of targets) {
    const keywords = synonymized(target);
    if (!keywords.length) continue;
    // The posting title (also synonymized) must contain every keyword.
    const haystack = t
      .replace(/\bproduct manager\b/g, 'pm')
      .replace(/\bsenior\b/g, 'sr');
    if (keywords.every(k => haystack.includes(k))) return true;
  }
  return false;
}

// ---------- Scoring + filtering ----------

interface ScoredRow {
  input:     RecommendedRoleInput;
  fitScore:  number;
  breakdown: Record<string, number>;
  hardFails: string[];
}

function scoreAndFilter(rows: RecommendedRoleInput[], minScore: number, ctx?: FitUserContext): { kept: ScoredRow[]; dropped: number } {
  const kept: ScoredRow[] = [];
  let dropped = 0;
  for (const r of rows) {
    const fit = computeFit(toRoleRow(r), ctx);
    if (fit.hardFails.length || fit.score < minScore) { dropped++; continue; }
    kept.push({ input: r, fitScore: fit.score, breakdown: fit.breakdown as unknown as Record<string, number>, hardFails: fit.hardFails });
  }
  return { kept, dropped };
}

// ---------- Fit context loader ----------
// Pulls everything computeFit needs to score against the user's profile:
//   - mission keywords + anti-mission terms + missionRequired from job.vision
//   - skill names + years from job.skills
//   - past sector blobs from job.companies
//   - arc tags derived from narrative_arc (light keyword extraction)
let _fitCtxCache: { ctx: FitUserContext; at: number } | null = null;
const FIT_CTX_CACHE_MS = 60_000;

async function loadFitContext(sql: ReturnType<typeof db>): Promise<FitUserContext> {
  if (_fitCtxCache && Date.now() - _fitCtxCache.at < FIT_CTX_CACHE_MS) return _fitCtxCache.ctx;
  const [visionRows, skillRows, companyRows] = await Promise.all([
    sql`select impact_themes, mission_keywords, mission_required, anti_mission_terms,
               culture_keywords, interest_tags, score_weights,
               coalesce(narrative_arc,'') as narrative_arc
          from job.vision order by updated_at desc limit 1`,
    sql`select name, years_practiced from job.skills`,
    sql`select coalesce(sector,'') as sector from job.companies`,
  ]);
  const v = (visionRows as Array<Record<string, unknown>>)[0] || {};
  const arcSrc = (v.narrative_arc as string || '').toLowerCase();
  const arcTags: string[] = [];
  for (const tag of ['founding','zero-to-one','zero to one','platform','scale','scaled','ipo','acquisition','fractional','pmf','product-market fit','growth','greenfield']) {
    if (arcSrc.includes(tag)) arcTags.push(tag);
  }
  const ctx: FitUserContext = {
    missionKeywords:   (v.mission_keywords as string[] | null) || [],
    antiMissionTerms:  (v.anti_mission_terms as string[] | null) || [],
    impactThemes:      (v.impact_themes as string[] | null) || [],
    missionRequired:   Boolean(v.mission_required),
    cultureKeywords:   (v.culture_keywords as string[] | null) || [],
    interestTags:      (v.interest_tags as string[] | null) || [],
    skills:            (skillRows as Array<Record<string, unknown>>).map(s => ({
      name: String(s.name || ''),
      years: (s.years_practiced as number | null) ?? null,
    })),
    pastSectors: (companyRows as Array<Record<string, unknown>>).map(c => String(c.sector || '')).filter(Boolean),
    arcTags,
    weights:           (v.score_weights as Partial<FitUserContext['weights']>) || undefined,
  };
  _fitCtxCache = { ctx, at: Date.now() };
  return ctx;
}

// ---------- Productize: enrich + Haiku-grade + rescore new inserts ----------
// Each new row from a cron pull walks the same pipeline as the manual
// /rescore endpoint, so cron-fed recommendations score the same as
// hand-rescored ones. JD backfill is best-effort; Haiku is best-effort;
// the final computeFit uses whatever fields we ended up with.
async function enrichAndScoreNewRows(
  sql: ReturnType<typeof db>,
  ids: string[],
  ctx: FitUserContext,
): Promise<void> {
  if (!ids.length) return;
  const rows = await sql<Array<{ id: string; url: string | null; title: string | null; company: string | null; description: string | null; sector: string | null; investors: string[] | null; salary: string | null; source: string | null }>>`
    select id, url, title, company, description, sector, investors, salary, source
      from job.recommended_roles
     where id = any(${ids}::uuid[])`;
  for (const r of rows) {
    let description = r.description || '';
    // Best-effort JD backfill if the plugin didn't provide one.
    if (description.length < 200 && r.url) {
      try {
        const text = await fetchJdText(r.url);
        if (text && text.length >= 200) {
          description = text;
          await sql`update job.recommended_roles set description = ${text} where id = ${r.id}::uuid`;
        }
      } catch { /* best effort */ }
    }
    const roleRow: RoleRow = {
      status: '', rank: '',
      company: r.company || '', title: r.title || '', url: r.url || '',
      source: r.source || '', contact: '', salary: r.salary || '',
      sector: r.sector || '', investors: (r.investors || []).join(', '),
      website: '', crunchbase: '', description,
    };
    let roleScore: number | null = null;
    let rationale: string | null = null;
    let seniority: string | null = null;
    let scope: string | null = null;
    if (description.length > 200) {
      const haiku = await haikuRoleMatch(roleRow, ctx);
      if (haiku) {
        roleScore = haiku.score; rationale = haiku.rationale;
        seniority = haiku.seniority; scope = haiku.scope;
      }
    }
    const fit = computeFit(roleRow, ctx, roleScore, seniority, rationale);
    await sql`
      update job.recommended_roles
         set fit_score            = ${fit.score},
             fit_breakdown        = ${sql.json(fit.breakdown)},
             fit_rationales       = ${sql.json(fit.rationales)},
             hard_fails           = ${fit.hardFails},
             role_match_score     = ${roleScore},
             role_match_rationale = ${rationale},
             role_match_seniority = ${seniority},
             role_match_scope     = ${scope}
       where id = ${r.id}::uuid`;
  }
}

// ---------- JD description fetcher ----------
// Re-fetches a posting URL, strips HTML, returns plain text capped at 8KB.
// Best-effort: returns '' on any failure so the caller can skip without
// killing the batch.
async function fetchJdText(url: string): Promise<string> {
  // Browser-shaped headers — many ATSes (Workday, Greenhouse-on-Cloudflare,
  // SmartRecruiters) 403 our default bot UA. This matches a real Chrome.
  const resp = await fetch(url, {
    redirect: 'follow',
    headers: {
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.9',
      'Accept-Encoding': 'gzip, deflate, br',
      'Sec-Fetch-Dest': 'document',
      'Sec-Fetch-Mode': 'navigate',
      'Sec-Fetch-Site': 'none',
      'Sec-Fetch-User': '?1',
      'Upgrade-Insecure-Requests': '1',
    },
  });
  if (!resp.ok) throw new Error(`fetch ${resp.status}`);
  const ct = (resp.headers.get('content-type') || '').toLowerCase();
  if (!ct.includes('html') && !ct.includes('text')) throw new Error(`unsupported content-type ${ct}`);
  const html = await resp.text();
  // Very basic HTML→text: strip script/style blocks, then tags, collapse
  // whitespace. Good enough for a keyword-match scorer; we're not parsing
  // for accuracy, just for hit counts.
  const stripped = html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#\d+;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return stripped.slice(0, 8000);
}

// ---------- Haiku role-match scorer ----------
// Sends the JD + user's skills/interests to Claude Haiku and asks for a
// single integer 0–25 plus a one-sentence rationale. Returns null on any
// failure so the caller can fall back to the regex bucket. The score we
// get back is persisted on the row so rescore doesn't re-pay Haiku.
async function haikuRoleMatch(r: RoleRow, ctx: FitUserContext): Promise<{ score: number; rationale: string; seniority: string; scope: string } | null> {
  const apiKey = Deno.env.get('ANTHROPIC_API_KEY');
  if (!apiKey) return null;
  const system = `You grade a job posting against a candidate's profile and return four structured fields.

Inputs you will see:
  - Job posting (title, company, description)
  - The candidate's skills (with years of practice)
  - The candidate's interest tags (problem types they want to work on)
  - The candidate's target seniority: Senior PM, Staff PM, Principal PM, Lead PM, Product Lead, Head of Product, Founding PM. Manager-of-managers (Director, VP) is "above"; Senior PM IC is "equivalent"; below Senior is "below".

Output JSON only:
{
  "score":      <int 0-25>,
  "rationale":  "<one sentence, max 22 words>",
  "seniority":  "below" | "equivalent" | "above" | "founding",
  "scope":      "ic" | "ic_player_coach" | "manager"
}

Scoring rubric for "score" (real anchors, not platitudes):
  0-5   Wrong shape entirely (wrong seniority, wrong function, deal-breaker)
  6-12  Adjacent — title fits but JD responsibilities barely overlap with skills/interests
  13-18 Genuine match — multiple skills and at least one interest tag map cleanly to JD responsibilities
  19-22 Strong — JD reads like it was written for someone with this exact profile
  23-25 Reserved for rare alignment across seniority, scope, skills, and explicit interest overlap

Seniority guidance — title shape NOT just string-match:
  - "Lead PM" / "Lead Product Manager" at a civic/nonprofit/PBC → equivalent (same scope as Staff/Principal at venture-backed)
  - "Group PM" / "GPM" → equivalent
  - "Director, Product" with 0-1 reports → equivalent; with multi-team org → above
  - "Founding PM" → founding
  - "PM I/II/III" / "Associate PM" / "APM" → below

Scope:
  - ic              Pure individual contributor, no reports
  - ic_player_coach IC with 1-2 reports max, hands-on
  - manager         3+ reports, primarily managing

No prose outside the JSON. No bullets. No headers.`;
  const userPrompt = [
    `# Posting`,
    `Title: ${r.title}`,
    `Company: ${r.company}`,
    `Description (truncated):\n${(r.description || '').slice(0, 2500)}`,
    `\n# Candidate skills`,
    ...ctx.skills.map(s => `- ${s.name} (${s.years ?? '?'} yrs)`),
    `\n# Candidate interest tags`,
    `- ${(ctx.interestTags || []).join('\n- ')}`,
  ].join('\n');
  try {
    const res = await fetch(ANTHROPIC_URL, {
      method: 'POST',
      headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({
        model: ANTHROPIC_MODEL,
        max_tokens: 200,
        system,
        messages: [{ role: 'user', content: userPrompt }],
      }),
    });
    if (!res.ok) throw new Error(`anthropic ${res.status}`);
    const data = await res.json() as { content: Array<{ type: string; text: string }> };
    const text = (data.content || []).filter(c => c.type === 'text').map(c => c.text).join('').trim();
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) return null;
    const parsed = JSON.parse(match[0]) as { score?: number; rationale?: string; seniority?: string; scope?: string };
    if (typeof parsed.score !== 'number') return null;
    const seniority = ['below','equivalent','above','founding'].includes((parsed.seniority || '').toLowerCase())
      ? parsed.seniority!.toLowerCase() : 'equivalent';
    const scope = ['ic','ic_player_coach','manager'].includes((parsed.scope || '').toLowerCase())
      ? parsed.scope!.toLowerCase() : 'ic';
    return {
      score: Math.max(0, Math.min(25, Math.round(parsed.score))),
      rationale: String(parsed.rationale || '').slice(0, 400),
      seniority,
      scope,
    };
  } catch (e) {
    console.warn(`[pull-recommendations] haiku role-match failed: ${(e as Error).message}`);
    return null;
  }
}

// Map a RecommendedRoleInput → the RoleRow shape computeFit expects.
// computeFit was written against the spreadsheet row, so this is mostly
// a field-renaming pass with a few "we don't have it yet" defaults.
function toRoleRow(r: RecommendedRoleInput): RoleRow {
  return {
    status:     '',
    rank:      '',
    company:    r.company || '',
    title:      r.title || '',
    url:        r.url,
    source:     r.sourceLabel || r.source,
    contact:    '',
    salary:     r.salary || '',
    sector:     r.sector || '',
    investors:  (r.investors || []).join(', '),
    website:    '',
    crunchbase: '',
    description: r.description || '',
  };
}

// ---------- Insert ----------

async function insertNew(
  sql: ReturnType<typeof db>,
  src: UserSourceRow,
  rows: ScoredRow[],
): Promise<Array<{ id: string; company: string | null; title: string | null; url: string; fitScore: number; breakdown: Record<string, number>; payload: Record<string, unknown> | null }>> {
  if (!rows.length) return [];
  const values = rows.map(r => ({
    user_email:     src.user_email,
    user_source_id: src.id,
    source:         r.input.source,
    source_id:      r.input.sourceId,
    source_label:   r.input.sourceLabel ?? null,
    url:            r.input.url,
    company:        r.input.company ?? null,
    title:          r.input.title ?? null,
    location:       r.input.location ?? null,
    salary:         r.input.salary ?? null,
    logo_url:       r.input.logoUrl ?? null,
    posted_at:      r.input.postedAt ?? null,
    description:    r.input.description ?? null,
    fit_score:      r.fitScore,
    fit_breakdown:  r.breakdown,
    hard_fails:     r.hardFails,
    sector:         r.input.sector ?? null,
    investors:      r.input.investors ?? [],
    payload:        r.input.payload ?? null,
    enrichment_status:   r.input.enrichmentStatus   ?? null,
    enrichment_retry_at: r.input.enrichmentRetryAt  ?? null,
    canonical_url:       r.input.canonicalUrl       ?? null,
    company_id:          r.input.companyId          ?? null,
  }));
  const inserted = await sql`
    insert into job.recommended_roles ${sql(values)}
    on conflict (source, source_id) do nothing
    returning id, company, title, url, fit_score as "fitScore", fit_breakdown as "breakdown", payload
  `;
  return inserted as unknown as Array<{ id: string; company: string | null; title: string | null; url: string; fitScore: number; breakdown: Record<string, number>; payload: Record<string, unknown> | null }>;
}

// ---------- Bullet generation ----------
//
// Bullets answer two halves at once:
//   - Why does the user fit this role? (cite their skills/wins/vision)
//   - Why does the role fit the user? (cite the breakdown — e.g. "+22 title")

async function loadUserContext(sql: ReturnType<typeof db>): Promise<UserContext> {
  const [skills, wins, vision] = await Promise.all([
    sql`select name, type, level, body_md from job.skills order by name`,
    sql`select headline, metric_value, body_md from job.wins order by updated_at desc limit 30`,
    sql`select coalesce(raw_md, narrative_arc) as body_md from job.vision order by updated_at desc limit 1`,
  ]);
  return {
    resume: '', // hook for a future "primary resume" lookup
    skills: (skills as Array<Record<string, unknown>>).map(s => `- ${s.name} (${s.type}/${s.level}): ${(s.body_md || '').toString().slice(0, 200)}`).join('\n'),
    wins:   (wins as Array<Record<string, unknown>>).map(w => `- ${w.headline} (${w.metric_value || 'n/a'}): ${(w.body_md || '').toString().slice(0, 200)}`).join('\n'),
    vision: (vision as Array<Record<string, unknown>>)[0]?.body_md as string || '',
  };
}

async function generateBullets(
  sql: ReturnType<typeof db>,
  row: { id: string; company: string | null; title: string | null; url: string; fitScore: number; breakdown: Record<string, number>; payload: Record<string, unknown> | null },
  user: UserContext,
): Promise<void> {
  const apiKey = Deno.env.get('ANTHROPIC_API_KEY');
  if (!apiKey) return;       // no key → leave bullets null, widget falls back to description
  const system = `Write exactly 3 markdown bullets. HARD LIMIT: 12 words per bullet.
Use **bold** for the single most important phrase in each bullet. No headers, no lead-ins.

Every bullet MUST reference something specific from the candidate's vision (their sector / stage / comp / location / scope preferences) — never generic statements about the company.

Bullet 1 — one-line snapshot of company + role.
Bullet 2 — why this matches the candidate's stated needs (cite the exact preference from vision).
Bullet 3 — the single thing to verify before applying.

Each bullet ≤12 words. Reject any bullet over the limit.
Return only the 3 bullets, nothing else.`;
  const userPrompt = [
    `# Role`,
    `Title: ${row.title}`,
    `Company: ${row.company}`,
    `Fit score: ${row.fitScore} (${Object.entries(row.breakdown).map(([k, v]) => `${k}=${v}`).join(', ')})`,
    `URL: ${row.url}`,
    `\n# Candidate's job-search needs (vision — this is what they care about)\n${user.vision || '(none)'}`,
  ].join('\n');
  try {
    const res = await fetch(ANTHROPIC_URL, {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: ANTHROPIC_MODEL,
        max_tokens: 400,
        system,
        messages: [{ role: 'user', content: userPrompt }],
      }),
    });
    if (!res.ok) throw new Error(`anthropic ${res.status}`);
    const data = await res.json() as { content: Array<{ type: string; text: string }> };
    const text = (data.content || []).filter(c => c.type === 'text').map(c => c.text).join('\n').trim();
    const bullets = text.split('\n').map(l => l.replace(/^[-*]\s*/, '').trim()).filter(Boolean).slice(0, 3);
    if (bullets.length) {
      await sql`update job.recommended_roles set match_bullets = ${sql.json(bullets)} where id = ${row.id}`;
    }
  } catch (e) {
    console.warn(`[pull-recommendations] bullet gen failed for ${row.id}: ${(e as Error).message}`);
  }
}

// ---------- Schedule ----------
// Tiny cron predicate. Supports the cases we actually use: '0 */6 * * *',
// '*/30 * * * *', '0 9 * * *'. Falls back to "due if last_run_at older
// than 6h" for anything fancier.
function isDue(src: UserSourceRow): boolean {
  if (!src.last_run_at) return true;
  const lastMs = Date.parse(src.last_run_at);
  if (!isFinite(lastMs)) return true;
  const ageMin = (Date.now() - lastMs) / 60_000;
  const cron = src.schedule_cron.trim();
  // hourly modulus
  const m = cron.match(/^(\S+)\s+\*\/(\d+)\s+\*\s+\*\s+\*$/);
  if (m) return ageMin >= Number(m[2]) * 60 - 5;
  // every-N-minutes
  const m2 = cron.match(/^\*\/(\d+)\s+\*\s+\*\s+\*\s+\*$/);
  if (m2) return ageMin >= Number(m2[1]) - 1;
  // daily at HH
  const m3 = cron.match(/^0\s+(\d+)\s+\*\s+\*\s+\*$/);
  if (m3) return ageMin >= 24 * 60 - 30;
  return ageMin >= 6 * 60;
}

async function markRun(
  sql: ReturnType<typeof db>,
  id: string,
  { count, dropped, error }: { count: number; dropped: number; error: string | null },
) {
  await sql`
    update job.user_sources
       set last_run_at    = now(),
           last_run_count = ${count},
           last_dropped   = ${dropped},
           last_error     = ${error},
           updated_at     = now()
     where id = ${id}
  `;
}
