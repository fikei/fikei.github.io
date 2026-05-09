// jobs-pipe — read pipeline from Postgres, write status changes there.
// Google Sheet integration was removed in v0.8.0 (the sheet was a
// migration-era input feed; ongoing changes flow through Postgres only).
// migrate-job retains the sheet helpers for one-shot backfill if needed.
//
//   GET                          → list pipeline_roles (Postgres)
//   POST { slug, status }        → status writeback (Postgres only)
//   POST { slug, archived }      → archive / unarchive
//   POST { slug, action: 'delete' } → soft delete

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { verifyJobUser, jsonResp, err, corsHeaders } from '../_shared/job-auth.ts';
import { db } from '../_shared/job-db.ts';

const VERSION = '0.8.0';
console.log(`[jobs-pipe] v${VERSION} - sheet removed`);

const STATUS_ENUM = new Set([
  '', 'New', 'Apply', 'Talking', 'Applied', 'Pass', 'Rejected', 'Closed', 'Not Listed', 'Nudge / Network',
]);

async function listRoles() {
  const sql = db();
  const rows = await sql`
    select
      r.slug, r.source_row as "rowNumber",
      r.company_name as company, r.title, r.url, r.source, r.status,
      r.contact, r.salary_range as salary, r.salary_low, r.salary_high,
      r.sector, r.investors, r.fit_score as score, r.fit_breakdown as breakdown,
      r.hard_fails as "hardFails", r.applied_at, r.status_changed_at,
      r.first_seen, r.last_seen,
      r.archived_at as "archivedAt",
      coalesce(ra_resume.role_slug is not null, false) as "hasResume",
      coalesce(ra_cover.role_slug is not null, false) as "hasCoverLetter",
      coalesce((
        select array_agg(json_build_object('slug', t.slug, 'name', t.name) order by t.name)
        from job.role_sector_tags rt
        join job.sector_tags t on t.slug = rt.tag_slug
        where rt.role_slug = r.slug
      ), array[]::json[]) as "sectorTags"
    from job.pipeline_roles r
    left join job.role_assets ra_resume on ra_resume.role_slug = r.slug and ra_resume.kind = 'resume'
    left join job.role_assets ra_cover  on ra_cover.role_slug = r.slug and ra_cover.kind = 'cover-letter'
    where r.deleted_at is null
    order by r.fit_score desc nulls last, r.title asc;
  `;
  return rows;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const email = await verifyJobUser(req);
    if (!email) return err('unauthorized', 401);

    if (req.method === 'GET') {
      const roles = await listRoles();
      return jsonResp({ version: VERSION, count: roles.length, roles });
    }

    if (req.method === 'POST') {
      const body = await req.json().catch(() => ({}));
      const slug = body.slug ? String(body.slug) : '';
      const sql = db();
      if (!slug) return err('role not found (provide slug)', 404);

      // Archive / unarchive — independent from status changes.
      if ('archived' in body) {
        const archived = !!body.archived;
        await sql`
          update job.pipeline_roles
          set archived_at = ${archived ? sql`now()` : null}
          where slug = ${slug};
        `;
        return jsonResp({ ok: true, slug, archived });
      }

      // Soft delete — row stays in DB but disappears from every list.
      if (body.action === 'delete') {
        await sql`
          update job.pipeline_roles
          set deleted_at = now()
          where slug = ${slug};
        `;
        return jsonResp({ ok: true, slug, deleted: true });
      }

      // Status writeback.
      const status = String(body.status ?? '');
      if (!STATUS_ENUM.has(status)) {
        return err(`status must be one of: ${Array.from(STATUS_ENUM).filter(Boolean).join(', ')}`, 400);
      }
      await sql`
        update job.pipeline_roles
        set status = ${status},
            applied_at = case when ${status} in ('Applied','Talking') and applied_at is null then now() else applied_at end,
            status_changed_at = now(),
            status_history = coalesce(status_history, '[]'::jsonb) || ${sql.json([{ status, at: new Date().toISOString() }])}
        where slug = ${slug};
      `;
      return jsonResp({ ok: true, slug, status });
    }

    return err('GET or POST only', 405);
  } catch (e) {
    console.error('[jobs-pipe] error', e);
    return err((e as Error).message || 'server error', 500);
  }
});
