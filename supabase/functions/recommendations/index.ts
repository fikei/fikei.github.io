// recommendations — list active recommendations for /job/jobs/.
//
//   GET                    → list active (not dismissed, not added)
//   POST { id, dismiss:true }  → dismiss a recommendation

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { verifyJobUser, jsonResp, err, corsHeaders } from '../_shared/job-auth.ts';
import { db } from '../_shared/job-db.ts';

const VERSION = '0.1.0';
console.log(`[recommendations] v${VERSION}`);

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  try {
    const email = await verifyJobUser(req);
    if (!email) return err('unauthorized', 401);
    const sql = db();

    if (req.method === 'GET') {
      const rows = await sql`
        select id, source, source_label as "sourceLabel", url, company, title, location,
               salary, logo_url as "logoUrl", posted_at as "postedAt",
               description, match_bullets as "matchBullets", suggested_at as "suggestedAt"
        from job.recommended_roles
        where dismissed_at is null and added_to_pipeline_slug is null
        order by suggested_at desc
        limit 24;
      `;
      return jsonResp({ ok: true, version: VERSION, count: rows.length, recommendations: rows });
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
