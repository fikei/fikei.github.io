// jobs-pipe — read pipeline from Postgres, sync from Sheet on demand,
// write status changes back to both.
//
//   GET                          → list pipeline_roles (Postgres)
//   GET ?sync=1                  → sheet → Postgres upsert, then list
//   POST { rowNumber|slug, status } → updates Postgres + sheet (dual-write)

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { readSheetValues, writeSheetCell } from './sheets.ts';
import { computeFit, RoleRow } from './fit.ts';
import { verifyJobUser, jsonResp, err, corsHeaders, slugify, roleSlug } from '../_shared/job-auth.ts';
import { db } from '../_shared/job-db.ts';

const VERSION = '0.4.0';
console.log(`[jobs-pipe] v${VERSION} - Postgres cutover + sheet sync`);

const SHEET_ID = '1YtZp3vxlsVP8t_eWpcYzYEVjaSKu8rVYmVRPr4AGeAU';
const STATUS_ENUM = new Set([
  '', 'New', 'Apply', 'Talking', 'Applied', 'Pass', 'Rejected', 'Closed', 'Not Listed', 'Nudge / Network',
]);

function rowToRole(row: string[]): RoleRow {
  return {
    status: (row[2] || '').trim(),
    rank: (row[1] || '').trim(),
    company: (row[3] || '').trim(),
    title: (row[4] || '').trim(),
    url: (row[5] || '').trim(),
    source: (row[6] || '').trim(),
    contact: (row[7] || '').trim(),
    salary: (row[8] || '').trim(),
    sector: (row[9] || '').trim(),
    investors: (row[10] || '').trim(),
    website: (row[11] || '').trim(),
    crunchbase: (row[12] || '').trim(),
  };
}

function parseSalary(s: string | undefined): { low: number | null; high: number | null } {
  if (!s) return { low: null, high: null };
  const norm = s.toLowerCase().replace(/[,$]/g, '').replace(/\s+/g, '');
  const nums = Array.from(norm.matchAll(/(\d+(?:\.\d+)?)(k)?/g)).map(m => {
    const n = parseFloat(m[1]);
    return m[2] === 'k' ? Math.round(n * 1000) : Math.round(n);
  }).filter(n => n >= 1000);
  if (!nums.length) return { low: null, high: null };
  if (nums.length === 1) return { low: nums[0], high: nums[0] };
  return { low: Math.min(...nums), high: Math.max(...nums) };
}

async function syncFromSheet() {
  const sql = db();
  const rows = await readSheetValues(SHEET_ID, 'Roles!A2:M1000');
  let upserted = 0;
  for (let idx = 0; idx < rows.length; idx++) {
    const r = rows[idx];
    const role = rowToRole(r);
    if (!role.company && !role.title) continue;
    const slug = roleSlug(role.company, role.title);
    if (!slug) continue;
    const fit = computeFit(role);
    const { low, high } = parseSalary(role.salary);
    const investors = role.investors ? role.investors.split(/,|;/).map(s => s.trim()).filter(Boolean) : [];

    await sql`
      insert into job.pipeline_roles (
        slug, source_row, company_slug, company_name, title, url, source, status,
        contact, salary_range, salary_low, salary_high, sector, investors,
        fit_score, fit_breakdown, hard_fails
      ) values (
        ${slug}, ${idx + 2}, ${slugify(role.company)}, ${role.company}, ${role.title},
        ${role.url || null}, ${role.source || null}, ${role.status || 'New'},
        ${role.contact || null}, ${role.salary || null}, ${low}, ${high},
        ${role.sector || null}, ${investors},
        ${fit.score}, ${sql.json(fit.breakdown)}, ${fit.hardFails}
      )
      on conflict (slug) do update set
        source_row = excluded.source_row,
        company_name = excluded.company_name, title = excluded.title,
        url = excluded.url, source = excluded.source, status = excluded.status,
        contact = excluded.contact, salary_range = excluded.salary_range,
        salary_low = excluded.salary_low, salary_high = excluded.salary_high,
        sector = excluded.sector, investors = excluded.investors,
        fit_score = excluded.fit_score, fit_breakdown = excluded.fit_breakdown,
        hard_fails = excluded.hard_fails,
        updated_at = now();
    `;
    upserted += 1;
  }
  return upserted;
}

async function listRoles() {
  const sql = db();
  const rows = await sql`
    select
      r.slug, r.source_row as "rowNumber",
      r.company_name as company, r.title, r.url, r.source, r.status,
      r.contact, r.salary_range as salary, r.salary_low, r.salary_high,
      r.sector, r.investors, r.fit_score as score, r.fit_breakdown as breakdown,
      r.hard_fails as "hardFails", r.applied_at, r.status_changed_at,
      coalesce(ra_resume.role_slug is not null, false) as "hasResume",
      coalesce(ra_cover.role_slug is not null, false) as "hasCoverLetter"
    from job.pipeline_roles r
    left join job.role_assets ra_resume on ra_resume.role_slug = r.slug and ra_resume.kind = 'resume'
    left join job.role_assets ra_cover  on ra_cover.role_slug = r.slug and ra_cover.kind = 'cover-letter'
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
      const url = new URL(req.url);
      const sync = url.searchParams.get('sync') === '1';
      let synced = 0;
      if (sync) synced = await syncFromSheet();
      const roles = await listRoles();
      return jsonResp({ version: VERSION, count: roles.length, synced, roles });
    }

    if (req.method === 'POST') {
      const body = await req.json().catch(() => ({}));
      const status = String(body.status ?? '');
      if (!STATUS_ENUM.has(status)) {
        return err(`status must be one of: ${Array.from(STATUS_ENUM).filter(Boolean).join(', ')}`, 400);
      }
      let slug = body.slug ? String(body.slug) : '';
      let rowNumber = Number(body.rowNumber);
      const sql = db();

      if (!slug && Number.isInteger(rowNumber)) {
        const r = await sql`select slug from job.pipeline_roles where source_row = ${rowNumber} limit 1`;
        slug = r[0]?.slug || '';
      } else if (slug && !rowNumber) {
        const r = await sql`select source_row from job.pipeline_roles where slug = ${slug} limit 1`;
        rowNumber = r[0]?.source_row || 0;
      }
      if (!slug) return err('role not found (provide slug or rowNumber)', 404);

      // Update Postgres first.
      await sql`
        update job.pipeline_roles
        set status = ${status},
            applied_at = case when ${status} in ('Applied','Talking') and applied_at is null then now() else applied_at end,
            status_changed_at = now(),
            status_history = coalesce(status_history, '[]'::jsonb) || ${sql.json([{ status, at: new Date().toISOString() }])}
        where slug = ${slug};
      `;
      // Mirror to the sheet so the /jobs skill stays in sync. Best-effort.
      if (Number.isInteger(rowNumber) && rowNumber >= 2) {
        try { await writeSheetCell(SHEET_ID, `Roles!C${rowNumber}`, status); } catch (e) {
          console.warn('[jobs-pipe] sheet writeback failed', e);
        }
      }
      return jsonResp({ ok: true, slug, rowNumber, status });
    }

    return err('GET or POST only', 405);
  } catch (e) {
    console.error('[jobs-pipe] error', e);
    return err((e as Error).message || 'server error', 500);
  }
});
