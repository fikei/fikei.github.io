// role-asset — read + write per-role assets from job.role_assets.
//
//   GET  ?slug=&kind=        → { content_md, source_path, generated_by, ... }
//   POST { slug, kind, content_md } → upserts the row
//
// Replaces the kb-read / kb-write round-trip for fikei/job/03-jobs/{slug}/{kind}.md.

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { verifyJobUser, jsonResp, err, corsHeaders } from '../_shared/job-auth.ts';
import { db } from '../_shared/job-db.ts';

const VERSION = '0.3.0';
console.log(`[role-asset] v${VERSION} - __base__ + __narratives__ routes to job.global_assets`);

const KIND_RE = /^(resume|cover-letter|notes|analysis)$/;
const SLUG_RE = /^[a-z0-9_-]+$/;
const MAX_BYTES = 64 * 1024;

// Sentinel slugs that route to job.global_assets instead of role_assets.
const BASE_SLUG = '__base__';
const BASE_GLOBAL_KIND = 'base-resume';
const NARRATIVES_SLUG = '__narratives__';
const NARRATIVES_GLOBAL_KIND = 'narrative-additions';

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const email = await verifyJobUser(req);
    if (!email) return err('unauthorized', 401);

    const sql = db();

    if (req.method === 'GET') {
      const url = new URL(req.url);
      const slug = (url.searchParams.get('slug') || '').toLowerCase();
      const kind = (url.searchParams.get('kind') || '').toLowerCase();
      if (!SLUG_RE.test(slug)) return err('invalid slug', 400);
      if (!KIND_RE.test(kind)) return err('invalid kind', 400);

      if (slug === BASE_SLUG) {
        if (kind !== 'resume') return err('not found', 404);
        const rows = await sql`
          select 'resume' as kind, content_md, generated_by, generated_at, edited_at, updated_at
          from job.global_assets
          where kind = ${BASE_GLOBAL_KIND}
          limit 1;
        `;
        if (rows.length === 0) return err('not found', 404);
        return jsonResp({ slug: BASE_SLUG, ...rows[0] });
      }

      if (slug === NARRATIVES_SLUG) {
        const rows = await sql`
          select ${kind}::text as kind, content_md, generated_by, generated_at, edited_at, updated_at
          from job.global_assets
          where kind = ${NARRATIVES_GLOBAL_KIND}
          limit 1;
        `;
        if (rows.length === 0) return err('not found', 404);
        return jsonResp({ slug: NARRATIVES_SLUG, ...rows[0] });
      }

      const rows = await sql`
        select role_slug as slug, kind, content_md, source_path, generated_by,
               generated_at, edited_at, updated_at
        from job.role_assets
        where role_slug = ${slug} and kind = ${kind}
        limit 1;
      `;
      if (rows.length === 0) return err('not found', 404);
      return jsonResp(rows[0]);
    }

    if (req.method === 'POST') {
      const body = await req.json().catch(() => ({}));
      const slug = String(body.slug || '').toLowerCase();
      const kind = String(body.kind || '').toLowerCase();
      const content_md = String(body.content_md ?? '');
      const source_path = body.source_path ? String(body.source_path) : null;
      if (!SLUG_RE.test(slug)) return err('invalid slug', 400);
      if (!KIND_RE.test(kind)) return err('invalid kind', 400);
      if (content_md.length > MAX_BYTES) return err(`content exceeds ${MAX_BYTES} bytes`, 413);

      if (slug === BASE_SLUG) {
        if (kind !== 'resume') return err('only resume kind is supported for __base__', 400);
        const result = await sql`
          insert into job.global_assets (kind, content_md, generated_by, edited_at)
          values (${BASE_GLOBAL_KIND}, ${content_md}, 'manual', now())
          on conflict (kind) do update set
            content_md = excluded.content_md,
            edited_at = now(),
            updated_at = now()
          returning kind, updated_at, edited_at;
        `;
        return jsonResp({ ok: true, ...result[0] });
      }

      // Confirm the role exists; we don't auto-create here.
      const role = await sql`select 1 from job.pipeline_roles where slug = ${slug} limit 1`;
      if (role.length === 0) return err('role not found', 404);

      const result = await sql`
        insert into job.role_assets (role_slug, kind, content_md, source_path, generated_by, edited_at)
        values (${slug}, ${kind}, ${content_md}, ${source_path}, 'manual', now())
        on conflict (role_slug, kind) do update set
          content_md = excluded.content_md,
          source_path = coalesce(excluded.source_path, job.role_assets.source_path),
          edited_at = now(),
          updated_at = now()
        returning kind, updated_at, edited_at;
      `;
      return jsonResp({ ok: true, ...result[0] });
    }

    return err('GET or POST only', 405);
  } catch (e) {
    console.error('[role-asset] error', e);
    return err((e as Error).message || 'server error', 500);
  }
});
