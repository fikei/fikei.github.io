// recommendations — list active recommendations for /job/jobs/.
//
//   GET                    → list active (not dismissed, not added)
//   POST { id, dismiss:true }  → dismiss a recommendation

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { verifyJobUser, jsonResp, err, corsHeaders } from '../_shared/job-auth.ts';
import { db } from '../_shared/job-db.ts';

const VERSION = '0.14.1';
console.log(`[recommendations] v${VERSION} - view=all&floor=1 applies the quality floors with pagination; For You table sends it by default`);

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  try {
    const email = await verifyJobUser(req);
    if (!email) return err('unauthorized', 401);
    const sql = db();

    if (req.method === 'GET') {
      // ?view=all      → all active recs regardless of score (for the
      //                  "Recommended for you" full-list page). Still excludes
      //                  dismissed + already-in-pipeline; those are signal of
      //                  user intent, not just score thresholds. No score
      //                  floors at all — this is the inspection surface for
      //                  everything the default view filters out.
      // ?view=wildcard → "standout candidate, low fit" — roles where the
      //                  Haiku grade says you'd beat most applicants but the
      //                  heuristic fit flunks your stated criteria. Meant to
      //                  pressure-test the litmus, so hard-fails are ALLOWED
      //                  here (mega-cap / mission conflicts are exactly the
      //                  cases worth a second look). Top rows by strength.
      // (default)      → fit floor 50 + strength floor 50, max 60 rows
      //                  (drives the carousel).
      const url = new URL(req.url);

      // ?id=<uuid> → single-rec lookup for the pre-save detail page.
      // Returns the row regardless of score/dismissed/closed state (the
      // page renders those states itself), scoped to the caller's rows.
      const recId = url.searchParams.get('id');
      if (recId) {
        const one = await sql`
          select r.id, r.source, r.source_label as "sourceLabel", r.url, r.company, r.title, r.location,
                 r.salary, r.logo_url as "logoUrl", r.posted_at as "postedAt",
                 r.description, r.match_bullets as "matchBullets", r.suggested_at as "suggestedAt",
                 r.fit_score as "fitScore", r.fit_breakdown as "breakdown",
                 r.fit_rationales as "rationales", r.fit_summary as "fitSummary",
                 r.candidate_score as "candidateScore", r.candidate_breakdown as "candidateBreakdown",
                 r.candidate_rationales as "candidateRationales", r.candidate_summary as "candidateSummary",
                 r.comp_acceptable as "compAcceptable",
                 r.hard_fails as "hardFails", r.sector,
                 r.enrichment_status as "enrichmentStatus",
                 r.canonical_url as "canonicalUrl",
                 r.dismissed_at as "dismissedAt", r.closed_at as "closedAt",
                 r.closure_reason as "closureReason",
                 r.added_to_pipeline_slug as "addedToPipelineSlug",
                 case when r.source = 'gmail-jobs' and r.payload ? 'gmailApiId'
                      then 'https://mail.google.com/mail/u/0/#inbox/' || (r.payload->>'gmailApiId')
                      else null end as "sourceEmailUrl"
            from job.recommended_roles r
           where r.id = ${recId} and r.user_email = ${email}
           limit 1`;
        if (!one.length) return err('not found', 404);
        return jsonResp({ ok: true, version: VERSION, recommendation: one[0] });
      }

      const view = url.searchParams.get('view') || 'default';
      const isAll = view === 'all';
      const isWildcard = view === 'wildcard';
      // ?floor=1 (view=all only) → apply the default view's quality floors
      // (fit >= 50, strength >= 50, no hard fails, ungraded = pending)
      // while keeping pagination + sort. The For You table sends this by
      // default; turning it off is the explicit "show below-floor" toggle.
      const applyFloor = isAll && url.searchParams.get('floor') === '1';
      // True when this view skips the quality floors entirely.
      const unfloored = (isAll && !applyFloor) || isWildcard;

      // Pagination (view=all only). The default carousel view stays a
      // single 60-row pull; wildcard is a short strip. limit caps at 200;
      // the table loads pages via infinite scroll and reads `total` to
      // show "X of Y".
      const limit = isAll
        ? Math.min(200, Math.max(1, parseInt(url.searchParams.get('limit') || '100', 10) || 100))
        : isWildcard ? 6 : 60;
      const offset = isAll ? Math.max(0, parseInt(url.searchParams.get('offset') || '0', 10) || 0) : 0;

      // Server-side sort — whitelist of sortable columns mapped to the
      // table's sortKeys. Splicing via sql.unsafe is safe because keys and
      // dirs only ever come from these fixed sets after validation.
      const SORT_COLS: Record<string, string> = {
        fitScore:       'r.fit_score',
        candidateScore: 'r.candidate_score',   // "Strength" column
        title:          'r.title',
        location:       'r.location',
        source:         'r.source',
        suggestedAt:    'r.suggested_at',
      };
      // Default "best overall match" ranking — blend the Haiku candidate
      // grade with heuristic fit, weighted toward candidate; ungraded rows
      // fall back to fit with a 0.8 discount.
      const BLENDED_RANK =
        `(case when r.candidate_score is not null
               then (r.candidate_score * 0.6 + coalesce(r.fit_score,0) * 0.4)
               else coalesce(r.fit_score,0) * 0.8 end)`;
      // Multi-level (Google-Sheets-style) sort: sort=k1,k2,… & dir=d1,d2,…
      // most-significant first. Each layer must be a whitelisted column (or
      // 'best'); unknown layers are dropped. A stable tiebreaker always
      // trails so pagination stays deterministic.
      const sortKeys = (url.searchParams.get('sort') || 'best').split(',').map(s => s.trim()).filter(Boolean);
      const sortDirs = (url.searchParams.get('dir') || '').split(',').map(s => s.trim().toLowerCase());
      const layers: string[] = [];
      sortKeys.forEach((k, i) => {
        const dir = sortDirs[i] === 'asc' ? 'asc' : 'desc';
        if (k === 'best') layers.push(`${BLENDED_RANK} ${dir} nulls last`);
        else if (SORT_COLS[k]) layers.push(`${SORT_COLS[k]} ${dir} nulls last`);
      });
      if (!layers.length) layers.push(`${BLENDED_RANK} desc nulls last`);
      const orderBy = (isWildcard ? 'r.candidate_score desc nulls last' : layers.join(', '))
        + ', r.suggested_at desc, r.id desc';

      // Strength (candidate-score) floor for the default view. Raised from
      // 30 → 50 (2026-07): live distribution has strength median 52 / max 78,
      // so a floor of 30 only trimmed the bottom ~15% — roles that fit the
      // criteria but where you'd be a weak applicant still showed. Ungraded
      // rows are treated as PENDING (excluded) until enrichment grades them;
      // they remain visible in view=all.
      const CANDIDATE_FLOOR = 50;

      // Wildcard band: strength high enough to be a standout (the Haiku
      // rubric's "top 10-15%" band starts at 75 and nothing live scores
      // above 78, so 65 is genuinely rare air), fit below the default
      // view's floor. Percentile-anchored intent — revisit if the strength
      // distribution shifts.
      const WILDCARD_MIN_STRENGTH = 65;
      const WILDCARD_MAX_FIT = 50;

      // Per-user blocked companies (the "Don't recommend this company"
      // action). Filtered here so they vanish from For You immediately.
      let blocked: string[] = [];
      try {
        const br = await sql<{ company_norm: string }[]>`
          select company_norm from job.blocked_companies where user_email = ${email}`;
        blocked = br.map(b => b.company_norm);
      } catch { /* table absent / transient — don't fail the page */ }

      // URL normalizer — strips scheme, leading www., query string,
      // fragment, and trailing slashes so the same posting matches across
      // sources (e.g. a Gmail-sourced rec vs. the URL the user pasted when
      // saving). Returns '' for nulls so empty never equals empty. Columns
      // are fixed literals, so sql.unsafe is safe here.
      const normUrl = (col: string) => `
        regexp_replace(
          regexp_replace(
            regexp_replace(
              regexp_replace(lower(trim(coalesce(${col}, ''))), '^https?://', ''),
              '^www\\.', ''),
            '[?#].*$', ''),
          '/+$', '')`;

      // Shared filter — reused by the page query and the count so "X of Y"
      // counts exactly what the list would show.
      //
      // The `not exists` dedup keeps anything already in the pipeline out of
      // For You — whether it's Saved, Applied, or Rejected, since all live in
      // pipeline_roles and we don't filter on status. It matches two ways:
      //   1. exact (company, title) — the original check.
      //   2. normalized URL (rec.url OR rec.canonical_url == pipeline.url) —
      //      catches the same posting when title/company text drifted between
      //      the saved copy and a later re-ingested recommendation (the cause
      //      of saved jobs reappearing in For You).
      const whereClause = sql`
        where r.dismissed_at is null
          and r.closed_at is null
          and r.added_to_pipeline_slug is null
          and (${unfloored} or r.fit_score is null or r.fit_score >= 50)
          and (${unfloored} or coalesce(array_length(r.hard_fails, 1), 0) = 0)
          and (${isAll && !applyFloor} or (r.candidate_score is not null and r.candidate_score >= ${CANDIDATE_FLOOR}))
          and (${!isWildcard} or (r.candidate_score >= ${WILDCARD_MIN_STRENGTH}
                                  and coalesce(r.fit_score, 100) < ${WILDCARD_MAX_FIT}))
          and (${blocked.length === 0} or lower(trim(r.company)) <> all(${blocked}::text[]))
          and not exists (
            select 1
              from job.pipeline_roles p
             where (
                     lower(p.company_name) = lower(r.company)
                     and lower(p.title) = lower(r.title)
                   )
                or (
                     ${sql.unsafe(normUrl('p.url'))} <> ''
                     and ${sql.unsafe(normUrl('p.url'))} in (
                           ${sql.unsafe(normUrl('r.url'))},
                           ${sql.unsafe(normUrl('r.canonical_url'))}
                         )
                   )
          )`;

      const rows = await sql`
        select r.id, r.source, r.source_label as "sourceLabel", r.url, r.company, r.title, r.location,
               r.salary, r.logo_url as "logoUrl", r.posted_at as "postedAt",
               r.description, r.match_bullets as "matchBullets", r.suggested_at as "suggestedAt",
               r.fit_score as "fitScore", r.fit_breakdown as "breakdown",
               r.fit_rationales as "rationales", r.fit_summary as "fitSummary",
               r.candidate_score as "candidateScore", r.candidate_breakdown as "candidateBreakdown",
               r.candidate_rationales as "candidateRationales", r.candidate_summary as "candidateSummary",
               r.comp_acceptable as "compAcceptable",
               r.hard_fails as "hardFails", r.sector,
               r.enrichment_status as "enrichmentStatus",
               r.enrichment_retry_at as "enrichmentRetryAt",
               r.canonical_url as "canonicalUrl",
               -- Source-email URL — derived from payload.gmailApiId for
               -- Gmail-sourced recs so the UI can render a "view source"
               -- link without parsing the JSON client-side.
               case when r.source = 'gmail-jobs' and r.payload ? 'gmailApiId'
                    then 'https://mail.google.com/mail/u/0/#inbox/' || (r.payload->>'gmailApiId')
                    else null end as "sourceEmailUrl"
        from job.recommended_roles r
        ${whereClause}
        order by ${sql.unsafe(orderBy)}
        limit ${limit} offset ${offset};
      `;
      // Total matching count — only needed for the paginated view.
      let total = rows.length;
      if (isAll) {
        const [{ n }] = await sql`select count(*)::int as n from job.recommended_roles r ${whereClause}`;
        total = n;
      }
      // Count of recs the liveness layers auto-retired in the last 7 days.
      // Lets For You reassure the user that expired postings are being pruned
      // ("N expired removed") instead of silently vanishing. Never fail the
      // page over this — it's a cosmetic count.
      let recentlyExpired = 0;
      try {
        const [{ n }] = await sql`
          select count(*)::int as n
            from job.recommended_roles
           where closed_at is not null
             and closed_at > now() - interval '7 days'`;
        recentlyExpired = n;
      } catch (e) {
        console.warn(`[recommendations] recentlyExpired count failed: ${(e as Error).message}`);
      }
      // Source health — lets the UI tell "no new recs" apart from "a
      // source is dead". needs_reauth is true when the gmail-jobs source
      // errored with a token problem OR the scan-state row carries one.
      // Never fail the page over health bookkeeping.
      let sourceHealth: unknown[] = [];
      try {
        sourceHealth = await sql`
          select s.type,
                 s.enabled,
                 s.last_run_at   as "lastRunAt",
                 s.last_run_count as "lastRunCount",
                 s.last_error    as "lastError",
                 case when s.type = 'gmail-jobs' and (
                        coalesce(s.last_error, '')    ilike '%reauth%' or
                        coalesce(s.last_error, '')    ilike '%not connected%' or
                        coalesce(g.last_error, '')    ilike '%reauth%' or
                        coalesce(g.last_error, '')    ilike '%not connected%'
                      )
                      then true else false end as "needsReauth"
            from job.user_sources s
            left join job.gmail_scan_state g on g.user_email = s.user_email
           where s.user_email = ${email}
           order by s.type`;
      } catch (e) {
        console.warn(`[recommendations] sourceHealth failed: ${(e as Error).message}`);
      }
      return jsonResp({
        ok: true, version: VERSION, view,
        count: rows.length, total, recentlyExpired,
        offset, limit,
        hasMore: isAll && offset + rows.length < total,
        recommendations: rows, sourceHealth,
      });
    }

    if (req.method === 'POST') {
      const body = await req.json().catch(() => ({}));

      // "Don't recommend this company" — add to the per-user block list and
      // dismiss its current recs in one shot. Future pulls also skip it.
      if (body.blockCompany) {
        const company = String(body.blockCompany).trim();
        if (!company) return err('blockCompany required', 400);
        const norm = company.toLowerCase();
        await sql`insert into job.blocked_companies (user_email, company_norm)
                    values (${email}, ${norm})
                  on conflict (user_email, company_norm) do nothing`;
        const dis = await sql`
          update job.recommended_roles set dismissed_at = now()
           where user_email = ${email} and dismissed_at is null
             and lower(trim(company)) = ${norm}
          returning id`;
        return jsonResp({ ok: true, blockedCompany: company, dismissed: dis.length });
      }
      // Un-block (optional, for an undo affordance).
      if (body.unblockCompany) {
        const norm = String(body.unblockCompany).trim().toLowerCase();
        await sql`delete from job.blocked_companies where user_email = ${email} and company_norm = ${norm}`;
        return jsonResp({ ok: true, unblockedCompany: norm });
      }

      const id = body.id ? String(body.id) : '';
      if (!id) return err('id required', 400);
      if (body.dismiss) {
        await sql`update job.recommended_roles set dismissed_at = now() where id = ${id}`;
        return jsonResp({ ok: true, id, dismissed: true });
      }
      return err('unknown POST action', 400);
    }

    return err('GET or POST only', 405);
  } catch (e) {
    console.error('[recommendations] error', e);
    return err((e as Error).message || 'server error', 500);
  }
});
