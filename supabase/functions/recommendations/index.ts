// recommendations — list active recommendations for /job/jobs/.
//
//   GET                    → list active (not dismissed, not added)
//   POST { id, dismiss:true }  → dismiss a recommendation

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { verifyJobUser, jsonResp, err, corsHeaders } from '../_shared/job-auth.ts';
import { db } from '../_shared/job-db.ts';

const VERSION = '0.6.0';
console.log(`[recommendations] v${VERSION} - return enrichment fields (status, retry, canonical_url)`);

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
      const rows = await sql`
        select r.id, r.source, r.source_label as "sourceLabel", r.url, r.company, r.title, r.location,
               r.salary, r.logo_url as "logoUrl", r.posted_at as "postedAt",
               r.description, r.match_bullets as "matchBullets", r.suggested_at as "suggestedAt",
               r.fit_score as "fitScore", r.fit_breakdown as "breakdown",
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
        where r.dismissed_at is null
          and r.added_to_pipeline_slug is null
          and (${isAll} or r.fit_score is null or r.fit_score >= 50)
          and (${isAll} or coalesce(array_length(r.hard_fails, 1), 0) = 0)
          and not exists (
            select 1
              from job.pipeline_roles p
             where lower(p.company_name) = lower(r.company)
               and lower(p.title) = lower(r.title)
          )
        order by r.fit_score desc nulls last, r.suggested_at desc
        limit ${isAll ? 500 : 60};
      `;
      return jsonResp({ ok: true, version: VERSION, view, count: rows.length, recommendations: rows });
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
