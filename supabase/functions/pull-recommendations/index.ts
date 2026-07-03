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
import { computeFit, type RoleRow, type UserContext as FitUserContext } from '../jobs-pipe/fit.ts';
import { SOURCES } from '../_shared/sources/registry.ts';
import type { RecommendedRoleInput } from '../_shared/sources/types.ts';
import { loadFitContext, fetchJdText, haikuRoleMatch } from '../_shared/job-fit-haiku.ts';
import { extractCompensation } from '../_shared/comp.ts';
import { corsHeaders } from '../_shared/job-auth.ts';
import { loadVisionStringArray, loadVisionField } from '../_shared/job-vision.ts';

const VERSION = '0.26.0';
console.log(`[pull-recommendations] v${VERSION} - Haiku grader also emits company_description (factual 1-2 sentence blurb) persisted on recs`);

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
  // CORS preflight — the For You "Refresh" button calls this from the
  // browser, not just pg_cron. Without OPTIONS handling Chrome rejects
  // the actual POST.
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST' && req.method !== 'GET') {
    return new Response('POST only', { status: 405, headers: corsHeaders });
  }
  const secret = Deno.env.get('CRON_SECRET');
  // Browser calls authenticate via the Supabase Authorization Bearer token
  // (sent by every authed page), not via the cron secret. Accept either:
  // - x-cron-secret matching CRON_SECRET (pg_cron + curl path), OR
  // - a Bearer token (browser path — function-level auth is enough here
  //   since this only enqueues a refresh of the caller's own sources).
  if (secret) {
    const hasCronSecret = req.headers.get('x-cron-secret') === secret;
    const hasBearer = (req.headers.get('authorization') || '').toLowerCase().startsWith('bearer ');
    if (!hasCronSecret && !hasBearer) {
      return new Response('forbidden', { status: 403, headers: corsHeaders });
    }
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
      }, null, 2), { status: 200, headers: { ...corsHeaders, 'content-type': 'application/json' } });
    } catch (outer) {
      console.error('[pull-recommendations] backfill outer error:', (outer as Error).stack || (outer as Error).message);
      return new Response(JSON.stringify({ ok: false, error: (outer as Error).message, stack: (outer as Error).stack }, null, 2),
        { status: 500, headers: { ...corsHeaders, 'content-type': 'application/json' } });
    }
  }

  // Backfill rescore — recompute fit_score and fit_breakdown for every
  // active recommended role using the v2 scorer + UserContext. Useful
  // after weight/shape changes so existing rows pick up the new model.
  if (rescoreOnly) {
    const ctx = await loadFitContext(sql);
    const qp = new URL(req.url).searchParams;
    const useHaiku = qp.get('haiku') !== '0';
    const force = qp.get('force') === '1';
    // Targeted grading drain: ?ungraded=1 restricts to rows that still
    // need a Haiku grade (no candidate_score yet) and that actually have
    // a JD to grade against — the only rows a grade pass can move. Pair
    // with ?limit=N (newest first) so each call finishes well under the
    // function wall-clock and the backlog drains across repeated calls
    // instead of one giant pass that times out before reaching anything.
    const ungradedOnly = qp.get('ungraded') === '1';
    const limitN = Math.max(0, Math.min(100, parseInt(qp.get('limit') || '0', 10) || 0));
    const rows = await sql<Array<{ id: string; title: string | null; company: string | null; description: string | null; sector: string | null; investors: string[] | null; salary: string | null; source: string | null; role_match_score: number | null; role_match_rationale: string | null; role_match_seniority: string | null; role_match_scope: string | null; fit_summary: string | null; candidate_score: number | null; watched_company_id: string | null }>>`
      select id, title, company, description, sector, investors, salary, source, watched_company_id,
             role_match_score, role_match_rationale, role_match_seniority, role_match_scope, fit_summary, candidate_score
        from job.recommended_roles
       where dismissed_at is null and added_to_pipeline_slug is null
         ${ungradedOnly ? sql`and candidate_score is null and length(coalesce(description,'')) > 200` : sql``}
       order by suggested_at desc
       ${limitN ? sql`limit ${limitN}` : sql``}
    `;
    let updated = 0, haikuCalls = 0;
    for (const r of rows) {
      // Comp fallback so rescoring an old row picks up a pay range that
      // only ever existed inside the JD body. Persisted below.
      const extractedComp = r.salary ? null : extractCompensation(r.description);
      const roleRow: RoleRow = {
        status: '', rank: '',
        company: r.company || '', title: r.title || '', url: '',
        source: r.source || '', contact: '', salary: r.salary || extractedComp || '',
        sector: r.sector || '', investors: (r.investors || []).join(', '),
        website: '', crunchbase: '', description: r.description || '',
      };
      let roleScore = r.role_match_score;
      let rationale = r.role_match_rationale;
      let seniority = r.role_match_seniority;
      let scope     = r.role_match_scope;
      let fitSummary: string | null = r.fit_summary;
      let companyDescription: string | null = null;
      let candidate: Awaited<ReturnType<typeof haikuRoleMatch>> extends infer T ? (T extends { candidate?: infer C } ? C | null : null) : null = null;
      const needsHaiku = useHaiku && (r.description || '').length > 200
        && (force || roleScore == null || seniority == null || !fitSummary || r.candidate_score == null);
      if (needsHaiku) {
        const haiku = await haikuRoleMatch(roleRow, ctx);
        if (haiku) {
          roleScore = haiku.score; rationale = haiku.rationale;
          seniority = haiku.seniority; scope = haiku.scope;
          fitSummary = haiku.fitSummary || null;
          companyDescription = haiku.companyDescription;
          candidate = haiku.candidate || null;
          haikuCalls++;
        }
      }
      const fit = computeFit(roleRow, ctx, roleScore, seniority, rationale, { watchedCompany: !!r.watched_company_id });
      await sql`
        update job.recommended_roles
           set fit_score            = ${fit.score},
               fit_breakdown        = ${sql.json(fit.breakdown)},
               fit_rationales       = ${sql.json(fit.rationales)},
               hard_fails           = ${fit.hardFails},
               salary               = coalesce(salary, ${extractedComp}),
               role_match_score     = ${roleScore},
               role_match_rationale = ${rationale},
               role_match_seniority = ${seniority},
               role_match_scope     = ${scope},
               fit_summary          = coalesce(${fitSummary}, fit_summary),
               company_description  = coalesce(${companyDescription}, company_description),
               candidate_score      = coalesce(${candidate?.score ?? null}, candidate_score),
               candidate_breakdown  = coalesce(${candidate ? sql.json(candidate.breakdown) : null}, candidate_breakdown),
               candidate_rationales = coalesce(${candidate ? sql.json(candidate.rationales) : null}, candidate_rationales),
               candidate_summary    = coalesce(${candidate?.summary ?? null}, candidate_summary),
               comp_acceptable      = coalesce(${candidate?.compAcceptable ?? null}, comp_acceptable)
         where id = ${r.id}
      `;
      updated++;
    }
    const pipeRows = await sql<Array<{ slug: string; title: string | null; company_name: string | null; description: string | null; sector: string | null; investors: string[] | null; salary_range: string | null; source: string | null; role_match_score: number | null; role_match_rationale: string | null; role_match_seniority: string | null; role_match_scope: string | null; fit_summary: string | null; candidate_score: number | null }>>`
      select slug, title, company_name, description, sector, investors, salary_range, source,
             role_match_score, role_match_rationale, role_match_seniority, role_match_scope, fit_summary, candidate_score
        from job.pipeline_roles where deleted_at is null`;
    let pipeUpdated = 0;
    for (const r of pipeRows) {
      const pipeExtractedComp = r.salary_range ? null : extractCompensation(r.description);
      const roleRow: RoleRow = {
        status: '', rank: '',
        company: r.company_name || '', title: r.title || '', url: '',
        source: r.source || '', contact: '', salary: r.salary_range || pipeExtractedComp || '',
        sector: r.sector || '', investors: (r.investors || []).join(', '),
        website: '', crunchbase: '', description: r.description || '',
      };
      let pipeRoleScore = r.role_match_score;
      let pipeRationale = r.role_match_rationale;
      let pipeSeniority = r.role_match_seniority;
      let pipeScope     = r.role_match_scope;
      let pipeFitSummary: string | null = r.fit_summary;
      let pipeCandidate: Awaited<ReturnType<typeof haikuRoleMatch>> extends infer T ? (T extends { candidate?: infer C } ? C | null : null) : null = null;
      const needsHaiku = useHaiku && (r.description || '').length > 200
        && (force || pipeRoleScore == null || pipeSeniority == null || !pipeFitSummary || r.candidate_score == null);
      if (needsHaiku) {
        const haiku = await haikuRoleMatch(roleRow, ctx);
        if (haiku) {
          pipeRoleScore = haiku.score; pipeRationale = haiku.rationale;
          pipeSeniority = haiku.seniority; pipeScope = haiku.scope;
          pipeFitSummary = haiku.fitSummary || null;
          pipeCandidate = haiku.candidate || null;
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
               salary_range         = coalesce(salary_range, ${pipeExtractedComp}),
               role_match_score     = ${pipeRoleScore},
               role_match_rationale = ${pipeRationale},
               role_match_seniority = ${pipeSeniority},
               role_match_scope     = ${pipeScope},
               fit_summary          = coalesce(${pipeFitSummary}, fit_summary),
               candidate_score      = coalesce(${pipeCandidate?.score ?? null}, candidate_score),
               candidate_breakdown  = coalesce(${pipeCandidate ? sql.json(pipeCandidate.breakdown) : null}, candidate_breakdown),
               candidate_rationales = coalesce(${pipeCandidate ? sql.json(pipeCandidate.rationales) : null}, candidate_rationales),
               candidate_summary    = coalesce(${pipeCandidate?.summary ?? null}, candidate_summary),
               comp_acceptable      = coalesce(${pipeCandidate?.compAcceptable ?? null}, comp_acceptable)
         where slug = ${r.slug}`;
      pipeUpdated++;
    }
    return new Response(JSON.stringify({ ok: true, version: VERSION, rescored: updated, pipelineRescored: pipeUpdated, haikuCalls }, null, 2),
      { status: 200, headers: { ...corsHeaders, 'content-type': 'application/json' } });
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
      const pulledRaw = await plugin.pull(src.config, { userEmail: src.user_email, since });
      // Firehose gate. tracked-ats pulls a company's ENTIRE board (every
      // eng/design/sales/ops opening), so without a title gate it floods the
      // pipeline with off-target roles and burns grading on them. Keep only
      // roles inside the user's role universe — vision.target_titles when
      // set (scales to ANY role a user searches for), else a broad
      // product-family default. Pre-targeted sources (gmail alerts, Jack &
      // Jill, theirstack queries) are already scoped, so they skip this.
      let pulled = pulledRaw;
      if (src.type === 'tracked-ats') {
        const universe = await loadRoleUniverse(sql);
        const before = pulledRaw.length;
        pulled = pulledRaw.filter(r => matchesRoleUniverse(r.title || '', universe));
        if (pulled.length !== before) console.log(`[pull-recommendations] tracked-ats role-universe: kept ${pulled.length}/${before}`);
      }
      // "Don't recommend this company" — drop blocked companies at the
      // source so they never re-accumulate (the recommendations read filter
      // hides any that slip through). Applies to every source.
      const blockedCos = await loadBlockedCompanies(sql, src.user_email);
      if (blockedCos.size) {
        const before = pulled.length;
        pulled = pulled.filter(r => !blockedCos.has((r.company || '').toLowerCase().trim()));
        if (pulled.length !== before) console.log(`[pull-recommendations] blocked-company filter: kept ${pulled.length}/${before}`);
      }
      // Surface every rec — don't drop at off-target / off-geo / min_score.
      // The fit_score breakdown already factors sector/geo/experience
      // mismatch into the score itself, so a poor match just gets a low
      // score and surfaces low in the sorted list. UI filters at read
      // time. Pipeline-dedup stays (don't show roles already tracked).
      const fitCtx = await loadFitContext(sql);
      // Blocked-title prefilter: drop any posting whose title substring-
      // matches a term in vision.blocked_titles BEFORE scoring. Saves the
      // Fit compute on roles the user has explicitly opted out of, and
      // makes the agent-driven update_preferences flow actually take
      // effect end-to-end.
      const blockedTitles  = await loadBlockedTitles(sql);
      const mustHaveTerms  = await loadMustHaveKeywords(sql);
      const beforeBlock = pulled.length;
      let stage1 = blockedTitles.length
        ? pulled.filter(r => !titleMatchesAny((r.title || '').toLowerCase(), blockedTitles))
        : pulled;
      const droppedByBlocked = beforeBlock - stage1.length;
      if (droppedByBlocked > 0) console.log(`[pull-recommendations] dropped ${droppedByBlocked}/${beforeBlock} by blocked_titles`);
      // must_have_keywords: at least one term must appear in the title or
      // description. Empty list = no-op.
      const beforeMust = stage1.length;
      const filteredPull = mustHaveTerms.length
        ? stage1.filter(r => {
            const hay = `${(r.title || '').toLowerCase()} ${(r.description || '').toLowerCase()}`;
            return mustHaveTerms.some(t => t && hay.includes(t));
          })
        : stage1;
      const droppedByMust = beforeMust - filteredPull.length;
      if (droppedByMust > 0) console.log(`[pull-recommendations] dropped ${droppedByMust}/${beforeMust} by must_have_keywords`);
      // Comp fallback for every source: most postings disclose pay inside
      // the JD body, not a structured field — without this the comp bucket
      // grades "not disclosed" while the description plainly states a range.
      const compFilled = filteredPull.map(r =>
        r.salary ? r : { ...r, salary: extractCompensation(r.description) ?? undefined });
      const { kept } = scoreAndFilter(compFilled, /* minScore */ 0, fitCtx);
      // Drop anything the user already has in their pipeline (any state —
      // active, archived, deleted). Match on (lower(company), lower(title))
      // so a different ATS URL for the same posting still dedupes.
      const pipelineKeys = await sql<{ key: string }[]>`
        select distinct lower(company_name) || '|' || lower(title) as key
          from job.pipeline_roles
         where company_name is not null and title is not null
      `;
      const pipelineSet = new Set(pipelineKeys.map(r => r.key));
      const pipeFiltered = kept.filter(r => {
        const k = `${(r.input.company || '').toLowerCase()}|${(r.input.title || '').toLowerCase()}`;
        return !pipelineSet.has(k);
      });
      const droppedToPipeline = kept.length - pipeFiltered.length;
      // Follow-up #4 — dedup against EXISTING active recs (the on-conflict
      // in insertNew only catches an identical source+source_id). Catches:
      //   - same LinkedIn job re-sent with different ?trackingId (we key on
      //     the normalized /jobs/view/<id>, not the raw url)
      //   - the same canonical ATS posting (canonical_url)
      //   - the same role arriving from a second source (company|title)
      // Also dedups within this batch. Conservative: URL/canonical match is
      // exact; company|title requires BOTH to match so Heidi's genuinely
      // distinct openings (different titles) aren't collapsed.
      //
      // NO dismissed/added filter here: a dismissal is a user decision, and
      // the next weekly digest re-sending the same posting (fresh source_id,
      // so insertNew's on-conflict can't catch it) must not resurrect it as
      // a new rec. Dedup against EVERY known rec, whatever its state.
      const existing = await sql<{ url: string | null; canonical_url: string | null; company: string | null; title: string | null }[]>`
        select url, canonical_url, company, title
          from job.recommended_roles
      `;
      const seenKeys = new Set<string>();
      const addKeys = (url: string | null, canonical: string | null, company: string | null, title: string | null) => {
        const nu = normalizeJobUrl(canonical || url || '');
        if (nu) seenKeys.add('u:' + nu);
        if (company && title) seenKeys.add('ct:' + company.toLowerCase().trim() + '|' + title.toLowerCase().trim());
      };
      const hitsKey = (url: string | null, canonical: string | null, company: string | null, title: string | null) => {
        const nu = normalizeJobUrl(canonical || url || '');
        if (nu && seenKeys.has('u:' + nu)) return true;
        if (company && title && seenKeys.has('ct:' + company.toLowerCase().trim() + '|' + title.toLowerCase().trim())) return true;
        return false;
      };
      for (const e of existing) addKeys(e.url, e.canonical_url, e.company, e.title);
      const filtered = pipeFiltered.filter(r => {
        if (hitsKey(r.input.url, r.input.canonicalUrl ?? null, r.input.company ?? null, r.input.title ?? null)) return false;
        // accept — register its keys so a later row in THIS batch dedups too
        addKeys(r.input.url, r.input.canonicalUrl ?? null, r.input.company ?? null, r.input.title ?? null);
        return true;
      });
      const droppedAsDup = pipeFiltered.length - filtered.length;
      if (droppedAsDup > 0) console.log(`[pull-recommendations] dropped ${droppedAsDup} duplicate(s) vs existing/within-batch`);
      const upserted = await insertNew(sql, src, filtered);
      // Layer 1 role-liveness (backlog #9) — tracked-ats re-pulls EVERY open
      // posting from each tracked board every run, so a previously-seen
      // source_id that's no longer in the pull = the posting was taken down.
      // Use `pulledRaw` (the full board BEFORE the role-universe gate) so a
      // still-open posting that's merely filtered out of recs isn't falsely
      // closed. Only operate on slugs we actually fetched this run — a
      // transient board-fetch failure yields zero rows for that slug, and we
      // must never mass-close a company on an error.
      if (src.type === 'tracked-ats') {
        await trackedAtsLiveness(sql, pulledRaw);
      }
      // Same disappeared-since-pull liveness for company-watch: each run
      // re-pulls a company's full (query-scoped) result set, so an active
      // rec from a watch we fetched this run whose source_id is absent =
      // the posting was taken down. Keyed by watched_company_id so a
      // transient adapter failure (no rows for that watch) never closes
      // anything — failed watches don't appear in the fetched-id set.
      if (src.type === 'company-watch') {
        await companyWatchLiveness(sql, pulledRaw);
      }
      // Only genuinely-new rows go through inline enrich+grade. Rows that
      // were conflict-updated to backfill a missing JD are drained by the
      // grade-ungraded cron instead — inline-grading a whole tracked-ats
      // re-pull (hundreds of backfills) would time out the run.
      const inserted = upserted.filter(r => r.isNew);
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
      await markRun(sql, src.id, { count: inserted.length, dropped: droppedToPipeline, error: null });
      summary.push({ id: src.id, type: src.type, pulled: pulled.length, kept: kept.length, droppedToPipeline, inserted: inserted.length });
    } catch (e) {
      await markRun(sql, src.id, { count: 0, dropped: 0, error: (e as Error).message });
      summary.push({ id: src.id, type: src.type, error: (e as Error).message });
    }
  }

  // Durable copy of the run summary — net._http_response gets pruned,
  // job.pull_runs doesn't (30-day opportunistic retention). Never let
  // bookkeeping fail the run.
  try {
    const hadError = summary.some(s => s.error != null);
    const totalInserted = summary.reduce((n, s) => n + (typeof s.inserted === 'number' ? s.inserted : 0), 0);
    await sql`
      insert into job.pull_runs (version, sources, had_error, total_inserted)
        values (${VERSION}, ${sql.json(summary)}, ${hadError}, ${totalInserted})`;
    await sql`delete from job.pull_runs where ran_at < now() - interval '30 days'`;
  } catch (e) {
    console.warn(`[pull-recommendations] pull_runs bookkeeping failed: ${(e as Error).message}`);
  }

  return new Response(JSON.stringify({ ok: true, version: VERSION, ranAt: new Date().toISOString(), sources: summary }, null, 2), {
    status: 200,
    headers: { ...corsHeaders, 'content-type': 'application/json' },
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

// Role universe for the firehose gate (tracked-ats). Broader than the
// seniority-prefixed target_titles above so a bare "Product Manager" or
// "Lead Product Manager" still qualifies — these are core role-family
// phrases matched as substrings. Used only when the user hasn't defined
// their own vision.target_titles. To support a DIFFERENT track (design,
// eng, etc.), a user sets target_titles and that becomes their universe —
// the mechanism is role-agnostic; only this default is product-flavored.
const DEFAULT_ROLE_UNIVERSE = [
  'product manager', 'product management', 'product lead', 'product owner',
  'head of product', 'director of product', 'director, product',
  'vp of product', 'vp product', 'chief product', 'cpo',
  'group product manager', 'gpm', 'principal product', 'staff product',
  'senior product', 'founding product', 'founding pm', 'product strategy',
  'platform product', 'technical product manager', 'tpm',
];

// The role universe = the user's vision.target_titles when set (scales to
// any role they search for), else the broad product-family default.
async function loadRoleUniverse(sql: ReturnType<typeof db>): Promise<string[]> {
  const fromVision = await loadVisionStringArray(sql, 'target_titles');
  return (fromVision.length ? fromVision : DEFAULT_ROLE_UNIVERSE).map(s => s.toLowerCase().trim()).filter(Boolean);
}

// Inclusive substring match — a role is in-universe if its title contains
// any universe phrase. Broad on purpose: better to keep a borderline role
// (the candidate score + floor sort it out) than to drop a real one.
function matchesRoleUniverse(title: string, universe: string[]): boolean {
  if (!universe.length) return true;          // no universe defined → keep all
  const t = title.toLowerCase();
  return universe.some(u => u && t.includes(u));
}

// Per-user "Don't recommend this company" set (normalized company names).
async function loadBlockedCompanies(sql: ReturnType<typeof db>, userEmail: string): Promise<Set<string>> {
  try {
    const rows = await sql<{ company_norm: string }[]>`
      select company_norm from job.blocked_companies where user_email = ${userEmail}`;
    return new Set(rows.map(r => r.company_norm));
  } catch {
    return new Set();
  }
}

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
  const fromVision = await loadVisionStringArray(sql, 'target_geographies');
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
  const fromVision = await loadVisionStringArray(sql, 'target_titles');
  const titles = fromVision.length ? fromVision : DEFAULT_TARGET_TITLES;
  _titleCache = { rows: titles, at: Date.now() };
  return titles;
}

// Blocked-title list (vision.blocked_titles). Each entry is a lowercase
// phrase; if it substring-matches a posting title, the role is dropped
// before scoring. Written by the agent chat's update_preferences tool
// after expanding the user's vague ask into concrete role-title terms.
let _blockedCache: { rows: string[]; at: number } | null = null;
async function loadBlockedTitles(sql: ReturnType<typeof db>): Promise<string[]> {
  if (_blockedCache && Date.now() - _blockedCache.at < TITLE_CACHE_MS) return _blockedCache.rows;
  const list = await loadVisionStringArray(sql, 'blocked_titles');
  _blockedCache = { rows: list, at: Date.now() };
  return list;
}

// Required keywords (must_have_keywords). When any are configured, drop
// postings whose title doesn't contain at least one. Empty = no-op.
let _mustHaveCache: { rows: string[]; at: number } | null = null;
async function loadMustHaveKeywords(sql: ReturnType<typeof db>): Promise<string[]> {
  if (_mustHaveCache && Date.now() - _mustHaveCache.at < TITLE_CACHE_MS) return _mustHaveCache.rows;
  const list = await loadVisionStringArray(sql, 'must_have_keywords');
  _mustHaveCache = { rows: list, at: Date.now() };
  return list;
}
// Substring-match any blocked phrase against a (lowercased) posting title.
function titleMatchesAny(title: string, blocked: string[]): boolean {
  if (!title) return false;
  for (const b of blocked) {
    if (b && title.includes(b)) return true;
  }
  return false;
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
    const fit = computeFit(toRoleRow(r), ctx, null, null, null, { watchedCompany: !!r.watchedCompanyId });
    // Surface-all-recs: only drop when min_score floor is set AND not met.
    // Hard-fails are kept with their flag so they show in the UI rather
    // than vanish silently.
    if (minScore > 0 && fit.score < minScore) { dropped++; continue; }
    kept.push({ input: r, fitScore: fit.score, breakdown: fit.breakdown as unknown as Record<string, number>, hardFails: fit.hardFails });
  }
  return { kept, dropped };
}


// ---------- Layer 1 role-liveness (tracked-ats disappeared-since-pull) ----------
// Given the FULL board pull (pre-universe-gate), reopen/stamp every active
// tracked-ats rec whose source_id is in the pull, and close every active
// rec whose slug WAS fetched this run but whose source_id is NOT in the
// pull. tracked-ats source_ids encode the board as `<provider>:<slug>:<id>`,
// so the slug is the middle (split_part …, 2) segment.
async function trackedAtsLiveness(
  sql: ReturnType<typeof db>,
  pulledRaw: RecommendedRoleInput[],
): Promise<void> {
  const pulledIds = [...new Set(pulledRaw.map(r => r.sourceId).filter(Boolean))] as string[];
  // Slugs we successfully fetched this run = the middle segment of every
  // pulled source_id. Only these slugs are eligible to close anything.
  const fetchedSlugs = [...new Set(
    pulledIds.map(sid => sid.split(':')[1]).filter(Boolean),
  )] as string[];
  if (!fetchedSlugs.length) return;   // nothing fetched → never close

  // 1) Stamp last_seen + reopen every active rec present in this pull.
  const seen = await sql`
    update job.recommended_roles
       set last_seen_at   = now(),
           closed_at      = null,
           closure_reason = null
     where source = 'tracked-ats'
       and dismissed_at is null
       and source_id = any(${pulledIds}::text[])`;
  // 2) Close every active rec whose slug we fetched but whose id vanished.
  const closed = await sql`
    update job.recommended_roles
       set closed_at      = now(),
           closure_reason = 'delisted'
     where source = 'tracked-ats'
       and closed_at is null
       and dismissed_at is null
       and split_part(source_id, ':', 2) = any(${fetchedSlugs}::text[])
       and source_id <> all(${pulledIds}::text[])`;
  const seenN   = (seen   as unknown as { count: number }).count;
  const closedN = (closed as unknown as { count: number }).count;
  console.log(`[pull-recommendations] tracked-ats liveness: closed ${closedN}, seen ${seenN}`);
}

// ---------- company-watch disappeared-since-pull liveness ----------
// Mirror of trackedAtsLiveness keyed on watched_company_id: only watches
// whose ids appear in this pull are eligible to close rows, so a failed
// adapter (zero rows for that watch) can never mass-close a company.
// Caveat: tightening a watch's title/location filters removes rows from
// the pull, which closes previously-surfaced recs as 'delisted' — that's
// the intended UX (the watch no longer covers them).
async function companyWatchLiveness(
  sql: ReturnType<typeof db>,
  pulledRaw: RecommendedRoleInput[],
): Promise<void> {
  const pulledIds = [...new Set(pulledRaw.map(r => r.sourceId).filter(Boolean))] as string[];
  const fetchedWatchIds = [...new Set(pulledRaw.map(r => r.watchedCompanyId).filter(Boolean))] as string[];
  if (!fetchedWatchIds.length) return;
  const seen = await sql`
    update job.recommended_roles
       set last_seen_at   = now(),
           closed_at      = null,
           closure_reason = null
     where source = 'company-watch'
       and dismissed_at is null
       and source_id = any(${pulledIds}::text[])`;
  const closed = await sql`
    update job.recommended_roles
       set closed_at      = now(),
           closure_reason = 'delisted'
     where source = 'company-watch'
       and closed_at is null
       and dismissed_at is null
       and watched_company_id = any(${fetchedWatchIds}::uuid[])
       and source_id <> all(${pulledIds}::text[])`;
  const seenN   = (seen   as unknown as { count: number }).count;
  const closedN = (closed as unknown as { count: number }).count;
  console.log(`[pull-recommendations] company-watch liveness: closed ${closedN}, seen ${seenN}`);
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
  const rows = await sql<Array<{ id: string; url: string | null; title: string | null; company: string | null; description: string | null; sector: string | null; investors: string[] | null; salary: string | null; source: string | null; watched_company_id: string | null }>>`
    select id, url, title, company, description, sector, investors, salary, source, watched_company_id
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
    // Comp fallback — a freshly-fetched JD often carries the pay range the
    // plugin's structured fields lacked. Persist so the UI shows it too.
    let salary = r.salary || '';
    if (!salary) {
      const comp = extractCompensation(description);
      if (comp) {
        salary = comp;
        await sql`update job.recommended_roles set salary = ${comp} where id = ${r.id}::uuid and salary is null`;
      }
    }
    const roleRow: RoleRow = {
      status: '', rank: '',
      company: r.company || '', title: r.title || '', url: r.url || '',
      source: r.source || '', contact: '', salary,
      sector: r.sector || '', investors: (r.investors || []).join(', '),
      website: '', crunchbase: '', description,
    };
    let roleScore: number | null = null;
    let rationale: string | null = null;
    let seniority: string | null = null;
    let scope: string | null = null;
    let fitSummary: string | null = null;
    let companyDescription: string | null = null;
    let candidate: Awaited<ReturnType<typeof haikuRoleMatch>> extends infer T ? (T extends { candidate?: infer C } ? C | null : null) : null = null;
    if (description.length > 200) {
      const haiku = await haikuRoleMatch(roleRow, ctx);
      if (haiku) {
        roleScore = haiku.score; rationale = haiku.rationale;
        seniority = haiku.seniority; scope = haiku.scope;
        fitSummary = haiku.fitSummary || null;
        companyDescription = haiku.companyDescription;
        candidate = haiku.candidate || null;
      }
    }
    const fit = computeFit(roleRow, ctx, roleScore, seniority, rationale, { watchedCompany: !!r.watched_company_id });
    await sql`
      update job.recommended_roles
         set fit_score            = ${fit.score},
             fit_breakdown        = ${sql.json(fit.breakdown)},
             fit_rationales       = ${sql.json(fit.rationales)},
             hard_fails           = ${fit.hardFails},
             role_match_score     = ${roleScore},
             role_match_rationale = ${rationale},
             role_match_seniority = ${seniority},
             role_match_scope     = ${scope},
             fit_summary          = ${fitSummary},
             company_description  = coalesce(${companyDescription}, company_description),
             candidate_score      = ${candidate?.score ?? null},
             candidate_breakdown  = ${candidate ? sql.json(candidate.breakdown) : null},
             candidate_rationales = ${candidate ? sql.json(candidate.rationales) : null},
             candidate_summary    = ${candidate?.summary ?? null},
             comp_acceptable      = ${candidate?.compAcceptable ?? null}
       where id = ${r.id}::uuid`;
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

// Normalize a job URL into a stable dedup key. LinkedIn alert URLs carry
// per-email tracking params (?trackingId/refId/eid) that differ every send,
// so the same posting otherwise looks unique — collapse to the canonical
// /jobs/view/<id>. For other hosts, drop the query and trailing slash and
// lowercase. Returns '' for empty input.
function normalizeJobUrl(u: string): string {
  if (!u) return '';
  const li = u.match(/linkedin\.com\/(?:comm\/)?jobs\/view\/(\d+)/i);
  if (li) return `linkedin.com/jobs/view/${li[1]}`;
  try {
    const url = new URL(u);
    return (url.host + url.pathname).toLowerCase().replace(/\/+$/, '');
  } catch {
    return u.toLowerCase().trim();
  }
}

// For storage: collapse a LinkedIn tracking URL to its clean canonical form
// (still resolves, far shorter, dedup-stable). Non-LinkedIn URLs untouched
// so apply links that depend on query params keep working.
function cleanStoredUrl(u: string): string {
  if (!u) return u;
  const li = u.match(/linkedin\.com\/(?:comm\/)?jobs\/view\/(\d+)/i);
  return li ? `https://www.linkedin.com/jobs/view/${li[1]}/` : u;
}

async function insertNew(
  sql: ReturnType<typeof db>,
  src: UserSourceRow,
  rows: ScoredRow[],
): Promise<Array<{ id: string; company: string | null; title: string | null; url: string; fitScore: number; breakdown: Record<string, number>; payload: Record<string, unknown> | null; isNew: boolean }>> {
  if (!rows.length) return [];
  const values = rows.map(r => ({
    user_email:     src.user_email,
    user_source_id: src.id,
    source:         r.input.source,
    source_id:      r.input.sourceId,
    source_label:   r.input.sourceLabel ?? null,
    url:            cleanStoredUrl(r.input.url),
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
    watched_company_id:  r.input.watchedCompanyId   ?? null,
  }));
  // on conflict: backfill the JD (and salary) into an existing row that
  // landed without one — e.g. tracked-ats roles created before the adapter
  // captured descriptions. Only when the existing row lacks a real JD and
  // the new pull has one, so we never overwrite good data. `xmax = 0`
  // distinguishes a fresh insert from a backfill-update so the caller only
  // inline-grades genuinely new rows (the grade-ungraded cron drains the
  // backfilled ones — re-grading hundreds at once would time out the run).
  const inserted = await sql`
    insert into job.recommended_roles ${sql(values)}
    on conflict (source, source_id) do update
       set description = excluded.description,
           salary      = coalesce(job.recommended_roles.salary, excluded.salary)
     where coalesce(length(job.recommended_roles.description), 0) < 200
       and coalesce(length(excluded.description), 0) >= 200
    returning id, company, title, url, fit_score as "fitScore", fit_breakdown as "breakdown", payload, (xmax = 0) as "isNew"
  `;
  return inserted as unknown as Array<{ id: string; company: string | null; title: string | null; url: string; fitScore: number; breakdown: Record<string, number>; payload: Record<string, unknown> | null; isNew: boolean }>;
}

// ---------- Bullet generation ----------
//
// Bullets answer two halves at once:
//   - Why does the user fit this role? (cite their skills/wins/vision)
//   - Why does the role fit the user? (cite the breakdown — e.g. "+22 title")

async function loadUserContext(sql: ReturnType<typeof db>): Promise<UserContext> {
  const [skills, wins, rawMd, narrativeArc] = await Promise.all([
    sql`select name, type, level, body_md from job.skills order by name`,
    sql`select headline, metric_value, body_md from job.wins order by updated_at desc limit 30`,
    loadVisionField<string>(sql, 'raw_md'),
    loadVisionField<string>(sql, 'narrative_arc'),
  ]);
  return {
    resume: '', // hook for a future "primary resume" lookup
    skills: (skills as Array<Record<string, unknown>>).map(s => `- ${s.name} (${s.type}/${s.level}): ${(s.body_md || '').toString().slice(0, 200)}`).join('\n'),
    wins:   (wins as Array<Record<string, unknown>>).map(w => `- ${w.headline} (${w.metric_value || 'n/a'}): ${(w.body_md || '').toString().slice(0, 200)}`).join('\n'),
    vision: rawMd || narrativeArc || '',
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
