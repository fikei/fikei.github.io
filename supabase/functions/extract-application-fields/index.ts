// extract-application-fields — given a job apply URL, return a normalized
// schema describing every field and custom question the user has to fill
// out. The Apply takeover consumes this to drive the wizard.
//
//   POST { slug, url }   → { ats, source_url, general, requires, custom_questions,
//                            apply_ease, apply_ease_meta, raw? }
//
// Strategy:
//   1. Detect the ATS from the URL.
//   2. For Greenhouse / Lever / Ashby, hit their public read APIs which
//      expose application questions structurally. No scraping, no auth.
//   3. Fallback: fetch the HTML and ask Claude Haiku to extract a
//      schema, returning a best-effort guess (works for one-off ATSes,
//      Workday and Notion-careers landings).
//
// Extraction core lives in _shared/apply-extract.ts (shared with the
// classify-apply-ease sweep). Persists the schema into
// job.application_draft.fields keyed by (auth.uid(), slug), and stamps the
// derived apply-ease tier onto job.pipeline_roles so the table badge stays
// fresh whenever a form is (re)extracted.

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { verifyJobUserDetailed, jsonResp, err, corsHeaders } from '../_shared/job-auth.ts';
import { db } from '../_shared/job-db.ts';
import { extractSchema } from '../_shared/apply-extract.ts';
import { classifyApplyEase } from '../_shared/apply-ease.ts';

const VERSION = '0.4.0';
console.log(`[extract-application-fields] v${VERSION} - shared extraction core + apply-ease classification`);

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST')    return err('method not allowed', 405);

  try {
    const user = await verifyJobUserDetailed(req);
    if (!user) return err('unauthorized', 401);

    const body = await req.json().catch(() => ({}));
    const slug = String(body.slug || '').toLowerCase();
    const url  = String(body.url || '').trim();
    if (!/^[a-z0-9_-]+$/.test(slug)) return err('invalid slug', 400);
    if (!/^https?:\/\//.test(url))   return err('invalid url', 400);

    const schema = await extractSchema(url);
    const { tier, meta } = classifyApplyEase(schema);

    // Persist into the draft row so the takeover can pick it up.
    const sql = db();
    // sql.json() stores a real jsonb object. (`${JSON.stringify(x)}::jsonb`
    // double-encodes into a jsonb *string* under postgres.js prepare:false.)
    await sql`
      insert into job.application_draft (user_id, role_slug, apply_url, ats, fields, extracted_at)
      values (${user.id}, ${slug}, ${url}, ${schema.ats}, ${sql.json(schema)}, now())
      on conflict (user_id, role_slug) do update set
        apply_url = excluded.apply_url,
        ats       = excluded.ats,
        fields    = excluded.fields,
        extracted_at = now(),
        updated_at = now();
    `;

    // Keep the table badge in sync — an on-demand extraction is the freshest
    // signal we ever get for a role's tier. Best-effort: the wizard must not
    // fail because the badge column couldn't be stamped. A bare fallback
    // (empty schema) must NOT downgrade a previously-good classification, and
    // we persist the schema for reuse when it has real fields.
    try {
      const hasFields = !!(schema.general?.length || schema.custom_questions?.length);
      const prior = (await sql`select apply_ease from job.pipeline_roles where slug = ${slug};`)[0]?.apply_ease;
      if (!(tier === 'unknown' && prior && prior !== 'unknown')) {
        await sql`
          update job.pipeline_roles set
            apply_ease = ${tier},
            apply_ease_meta = ${sql.json(meta)},
            apply_ease_checked_at = now(),
            apply_schema = ${hasFields ? sql.json(schema) : sql`apply_schema`}
          where slug = ${slug};
        `;
      }
    } catch (e) {
      console.warn('[extract-application-fields] apply_ease stamp failed', (e as Error).message);
    }

    return jsonResp({ ...schema, apply_ease: tier, apply_ease_meta: meta });
  } catch (e) {
    console.error('[extract-application-fields] error', e);
    return err((e as Error).message || 'server error', 500);
  }
});
