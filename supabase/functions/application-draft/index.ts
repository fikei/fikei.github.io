// application-draft — read + write the Apply-takeover state from
// job.application_draft. One row per (user_id, role_slug).
//
//   GET  ?slug=                  → { ...draft } | 404
//   POST { slug, ...patch }      → upserts and returns the row
//   DELETE { slug }              → drops the draft (e.g. after submit)
//
// All access is RLS-gated by auth.uid(); we additionally narrow to the
// authenticated user_id server-side as a belt-and-braces.
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { verifyJobUserDetailed, jsonResp, err, corsHeaders } from '../_shared/job-auth.ts';
import { db } from '../_shared/job-db.ts';

const VERSION = '0.1.0';
console.log(`[application-draft] v${VERSION} - apply takeover state`);

const SLUG_RE = /^[a-z0-9_-]+$/;
const STEP_RE = /^(general|resume|cover|questions|review)$/;
const STATUS_RE = /^(draft|submitted|abandoned)$/;
const ATS_RE = /^(greenhouse|lever|ashby|workday|smartrecruiters|other|unknown)$/;

function pickJson(v: unknown, fallback: unknown = null) {
  if (v === undefined) return undefined;
  if (v === null) return null;
  if (typeof v === 'object') return v;
  return fallback;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const user = await verifyJobUserDetailed(req);
    if (!user) return err('unauthorized', 401);
    const sql = db();

    if (req.method === 'GET') {
      const slug = (new URL(req.url).searchParams.get('slug') || '').toLowerCase();
      if (!SLUG_RE.test(slug)) return err('invalid slug', 400);
      const rows = await sql`
        select id, role_slug, apply_url, ats, fields, answers,
               current_step, status, extracted_at, submitted_at,
               created_at, updated_at
        from job.application_draft
        where user_id = ${user.id} and role_slug = ${slug}
        limit 1;
      `;
      if (rows.length === 0) return err('not found', 404);
      return jsonResp(rows[0]);
    }

    if (req.method === 'POST') {
      const body = await req.json().catch(() => ({}));
      const slug = String(body.slug || '').toLowerCase();
      if (!SLUG_RE.test(slug)) return err('invalid slug', 400);

      const patch: Record<string, unknown> = {};
      if (body.apply_url    !== undefined) patch.apply_url    = body.apply_url ? String(body.apply_url) : null;
      if (body.ats          !== undefined) {
        const a = String(body.ats || '').toLowerCase();
        if (a && !ATS_RE.test(a)) return err('invalid ats', 400);
        patch.ats = a || null;
      }
      if (body.current_step !== undefined) {
        const s = String(body.current_step || '').toLowerCase();
        if (!STEP_RE.test(s)) return err('invalid current_step', 400);
        patch.current_step = s;
      }
      if (body.status !== undefined) {
        const s = String(body.status || '').toLowerCase();
        if (!STATUS_RE.test(s)) return err('invalid status', 400);
        patch.status = s;
      }
      if (body.fields  !== undefined) patch.fields  = pickJson(body.fields, {});
      if (body.answers !== undefined) patch.answers = pickJson(body.answers, {});
      if (body.extracted_at !== undefined) patch.extracted_at = body.extracted_at || null;
      if (body.submitted_at !== undefined) patch.submitted_at = body.submitted_at || null;

      const insertCols: string[] = ['user_id', 'role_slug'];
      const insertVals: unknown[] = [user.id, slug];
      const updateSetters: string[] = [];
      for (const [k, v] of Object.entries(patch)) {
        insertCols.push(k);
        insertVals.push(v as never);
        updateSetters.push(`${k} = excluded.${k}`);
      }
      // Build a typed insert query. postgres.js doesn't support
      // dynamic column lists in tagged templates, so we use sql.unsafe
      // with parameterized values.
      const colList = insertCols.join(', ');
      const placeholders = insertCols.map((_, i) => `$${i + 1}`).join(', ');
      const updateClause = updateSetters.length
        ? `do update set ${updateSetters.join(', ')}, updated_at = now()`
        : `do nothing`;
      const stmt = `
        insert into job.application_draft (${colList})
        values (${placeholders})
        on conflict (user_id, role_slug) ${updateClause}
        returning id, role_slug, apply_url, ats, fields, answers,
                  current_step, status, extracted_at, submitted_at,
                  created_at, updated_at;
      `;
      const rows = await sql.unsafe(stmt, insertVals as never);
      return jsonResp(rows[0]);
    }

    if (req.method === 'DELETE') {
      const body = await req.json().catch(() => ({}));
      const slug = String(body.slug || '').toLowerCase();
      if (!SLUG_RE.test(slug)) return err('invalid slug', 400);
      await sql`
        delete from job.application_draft
        where user_id = ${user.id} and role_slug = ${slug};
      `;
      return jsonResp({ ok: true });
    }

    return err('method not allowed', 405);
  } catch (e) {
    console.error('[application-draft] error', e);
    return err((e as Error).message || 'server error', 500);
  }
});
