// build-sector-tags — backfill sector tags for every pipeline_role.
// Call once after migration 050; future syncs in jobs-pipe will keep it
// up to date inline.
//
// POST → { upsertedTags, taggedRoles }

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { verifyJobUser, jsonResp, err, corsHeaders } from '../_shared/job-auth.ts';
import { db } from '../_shared/job-db.ts';
import { parseSectorTags } from '../_shared/sector-tags.ts';

const VERSION = '0.1.0';
console.log(`[build-sector-tags] v${VERSION}`);

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return err('POST only', 405);

  try {
    const email = await verifyJobUser(req);
    if (!email) return err('unauthorized', 401);

    const sql = db();
    const roles = await sql`select slug, sector from job.pipeline_roles where sector is not null`;
    const tagSet = new Map<string, string>();
    let taggedRoles = 0;

    for (const r of roles) {
      const tags = parseSectorTags(r.sector);
      if (!tags.length) continue;
      for (const t of tags) tagSet.set(t.slug, t.name);
      // Upsert role↔tag rows. Clear and rewrite so removed tags drop off.
      await sql`delete from job.role_sector_tags where role_slug = ${r.slug}`;
      for (const t of tags) {
        await sql`
          insert into job.sector_tags (slug, name) values (${t.slug}, ${t.name})
          on conflict (slug) do nothing;
        `;
        await sql`
          insert into job.role_sector_tags (role_slug, tag_slug)
          values (${r.slug}, ${t.slug})
          on conflict do nothing;
        `;
      }
      taggedRoles += 1;
    }

    return jsonResp({ ok: true, upsertedTags: tagSet.size, taggedRoles, tags: Array.from(tagSet.entries()).map(([slug, name]) => ({ slug, name })) });
  } catch (e) {
    console.error('[build-sector-tags] error', e);
    return err((e as Error).message || 'server error', 500);
  }
});
