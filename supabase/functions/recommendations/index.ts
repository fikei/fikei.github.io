// recommendations — list active recommendations for /job/jobs/.
//
//   GET                    → list active (not dismissed, not added)
//   POST { id, dismiss:true }  → dismiss a recommendation

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { verifyJobUser, jsonResp, err, corsHeaders } from '../_shared/job-auth.ts';
import { db } from '../_shared/job-db.ts';

const VERSION = '0.9.0';
console.log(`[recommendations] v${VERSION} - default 'best' blended rank (candidate+fit) + candidate-score floor (drop graded <30)`);

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  try {
    const email = await verifyJobUser(req);
    if (!email) return err('unauthorized', 401);
    const sql = db();

    if (req.method === 'GET') {
      // ?view=all   → all active recs regardless of fit score (for the
      //               "Recommended for you" full-list page). Still excludes
      //               dismissed + already-in-pipeline; those are signal of
      //               user intent, not just score thresholds.
      // (default)   → score floor 50, max 60 rows (drives the carousel).
      const url = new URL(req.url);
      const view = url.searchParams.get('view') || 'default';
      const isAll = view === 'all';

      // Pagination (view=all only). The default carousel view stays a
      // single 60-row pull. limit caps at 200; the table loads pages via
      // infinite scroll and reads `total` to show "X of Y".
      const limit = isAll
        ? Math.min(200, Math.max(1, parseInt(url.searchParams.get('limit') || '100', 10) || 100))
        : 60;
      const offset = isAll ? Math.max(0, parseInt(url.searchParams.get('offset') || '0', 10) || 0) : 0;

      // Server-side sort — whitelist of sortable columns mapped to the
      // table's sortKeys. dir is validated to asc/desc. Both are safe to
      // splice via sql.unsafe because they only come from these fixed sets.
      const SORT_COLS: Record<string, string> = {
        fitScore:    'r.fit_score',
        title:       'r.title',
        location:    'r.location',
        source:      'r.source',
        suggestedAt: 'r.suggested_at',
      };
      // Follow-up #3 — default "best overall match" ranking. Blend the
      // Haiku candidate grade (responsibilities match — what the user
      // actually cares about) with heuristic fit, weighted toward
      // candidate. Ungraded rows fall back to fit with a 0.8 discount so a
      // graded-strong role outranks an un-graded high-fit one (the
      // Nava-PBC "high fit, no/low candidate" leakage). When the user
      // clicks a column header the explicit column wins.
      const BLENDED_RANK =
        `(case when r.candidate_score is not null
               then (r.candidate_score * 0.6 + coalesce(r.fit_score,0) * 0.4)
               else coalesce(r.fit_score,0) * 0.8 end)`;
      const sortParam = url.searchParams.get('sort') || 'best';
      const sortExpr = SORT_COLS[sortParam] || BLENDED_RANK;
      const sortDir = (url.searchParams.get('dir') || 'desc').toLowerCase() === 'asc' ? 'asc' : 'desc';

      // Follow-up #2 — candidate-score low-end threshold. Drop roles the
      // Haiku grader scored as a clearly weak responsibilities match
      // (< 30). Only applies to GRADED rows — un-graded (candidate_score
      // null, still "verifying") rows are never dropped on this basis.
      const CANDIDATE_FLOOR = 30;

      // Shared filter — reused by the page query and the count so "X of Y"
      // counts exactly what the list would show.
      const whereClause = sql`
        where r.dismissed_at is null
          and r.added_to_pipeline_slug is null
          and (${isAll} or r.fit_score is null or r.fit_score >= 50)
          and (${isAll} or coalesce(array_length(r.hard_fails, 1), 0) = 0)
          and not (r.candidate_score is not null and r.candidate_score < ${CANDIDATE_FLOOR})
          and not exists (
            select 1
              from job.pipeline_roles p
             where lower(p.company_name) = lower(r.company)
               and lower(p.title) = lower(r.title)
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
        order by ${sql.unsafe(sortExpr)} ${sql.unsafe(sortDir)} nulls last, r.suggested_at desc
        limit ${limit} offset ${offset};
      `;
      // Total matching count — only needed for the paginated view.
      let total = rows.length;
      if (isAll) {
        const [{ n }] = await sql`select count(*)::int as n from job.recommended_roles r ${whereClause}`;
        total = n;
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
        count: rows.length, total,
        offset, limit,
        hasMore: isAll && offset + rows.length < total,
        recommendations: rows, sourceHealth,
      });
    }

    if (req.method === 'POST') {
      const body = await req.json().catch(() => ({}));
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
