// Supabase Edge Function: job-entity
// Reads a single career-history entity (company / project / skill / win)
// from job.{companies,projects,skills,wins} by slug. Replaces the
// kb-read /01-job-history/{kind}/{slug}.md round-trip used by the
// /job/history/drill page.
//
// GET /functions/v1/job-entity?kind=companies|projects|skills|wins&slug=foo
//   → { kind, slug, title, body_md, frontmatter, updated_at }
//
// Auth: standard /job bearer token.

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { verifyJobUser, jsonResp, err, corsHeaders } from '../_shared/job-auth.ts';
import { db } from '../_shared/job-db.ts';

const VERSION = '0.1.0';
console.log(`[job-entity] v${VERSION}`);

const KIND_TABLE: Record<string, string> = {
  companies: 'job.companies',
  projects:  'job.projects',
  skills:    'job.skills',
  wins:      'job.wins',
};

// Columns returned in `frontmatter` by kind. Keep small + presentation-
// friendly so the frontend can render a metadata strip without a second
// round-trip.
const KIND_META: Record<string, string[]> = {
  companies: ['sector', 'stage_at_time', 'location', 'tenure_start', 'tenure_end'],
  projects:  ['company_slug', 'title', 'role', 'metric_value'],
  skills:    ['type', 'level', 'years_practiced', 'cover_letter_blurb'],
  wins:      ['company_slug', 'project_slug', 'headline', 'metric_value'],
};

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'GET') return err('method not allowed', 405);

  const email = await verifyJobUser(req);
  if (!email) return err('unauthorized', 401);

  const url = new URL(req.url);
  const kind = (url.searchParams.get('kind') || '').toLowerCase();
  const slug = (url.searchParams.get('slug') || '').toLowerCase();
  if (!KIND_TABLE[kind]) return err(`unknown kind: ${kind}`);
  if (!slug || !/^[a-z0-9_-]+$/.test(slug)) return err('invalid slug');

  const sql = db();
  // Dynamic table name — kind is whitelist-validated above so format() is
  // safe; postgres.js doesn't substitute table names so we use sql.unsafe.
  const tableSql = KIND_TABLE[kind];
  const metaCols = KIND_META[kind].join(', ');
  const rows = await sql.unsafe(
    `select slug, body_md, ${metaCols}, updated_at from ${tableSql} where slug = $1 limit 1`,
    [slug],
  );
  const row = (rows as Array<Record<string, unknown>>)[0];
  if (!row) return err('not found', 404);

  const body_md = String(row.body_md || '');
  const title = (body_md.match(/^#\s+(.+)$/m) || [, ''])[1].trim()
    || (KIND_META[kind].includes('title') ? String(row.title || row.slug) : String(row.slug));
  const frontmatter: Record<string, unknown> = {};
  for (const c of KIND_META[kind]) frontmatter[c] = row[c];

  return jsonResp({
    kind,
    slug: row.slug,
    title,
    body_md,
    frontmatter,
    updated_at: row.updated_at,
  });
});
