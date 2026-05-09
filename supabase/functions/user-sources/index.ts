// user-sources — CRUD for the recommendations source registry.
//   GET                          → list
//   POST { type, label?, config?, schedule_cron?, min_score? } → create
//   POST { id, ... }             → update (any subset of fields)
//   POST { id, action: 'delete' } → delete
//   POST { id, action: 'run' }    → trigger a one-off pull (returns the worker's response)

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { verifyJobUser, jsonResp, err, corsHeaders } from '../_shared/job-auth.ts';
import { db } from '../_shared/job-db.ts';
import { SOURCES } from '../_shared/sources/registry.ts';

const VERSION = '0.1.0';
console.log(`[user-sources] v${VERSION}`);

const PULL_URL = 'https://yfhudwakpgzswiylhfbh.supabase.co/functions/v1/pull-recommendations';

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  try {
    const email = await verifyJobUser(req);
    if (!email) return err('unauthorized', 401);
    const sql = db();

    if (req.method === 'GET') {
      const rows = await sql`
        select id, type, label, config, enabled, schedule_cron, min_score,
               last_run_at as "lastRunAt", last_run_count as "lastRunCount",
               last_dropped as "lastDropped", last_error as "lastError"
        from job.user_sources
        where user_email = ${email}
        order by created_at desc
      `;
      return jsonResp({ ok: true, version: VERSION, sources: rows, knownTypes: Object.keys(SOURCES) });
    }

    if (req.method === 'POST') {
      const body = await req.json().catch(() => ({}));
      const id = body.id ? String(body.id) : '';

      if (id && body.action === 'delete') {
        await sql`delete from job.user_sources where id = ${id} and user_email = ${email}`;
        return jsonResp({ ok: true, id, deleted: true });
      }
      if (body.action === 'inspect_rows') {
        // Diagnostic: return raw rows from recommended_roles for a given
        // source value, ignoring all surface filters. Lets us figure out
        // why a row isn't appearing in the widget.
        const src = String(body.source || '').trim();
        if (!src) return err('source required', 400);
        const rows = await sql`
          select id, company, title, location, fit_score as "fitScore",
                 hard_fails as "hardFails", dismissed_at as "dismissedAt",
                 added_to_pipeline_slug as "addedToPipelineSlug",
                 (select 1 from job.pipeline_roles p
                   where lower(p.company_name) = lower(recommended_roles.company)
                     and lower(p.title) = lower(recommended_roles.title)
                   limit 1) as "matchesPipeline"
            from job.recommended_roles
           where source = ${src}
           limit 10`;
        return jsonResp({ ok: true, rows });
      }
      if (body.action === 'probe_url') {
        // Diagnostic: fetch any URL with a browser UA and return status +
        // the first 500 chars. Useful for figuring out which RSS feeds
        // actually serve a usable response.
        if (!body.url) return err('url required', 400);
        try {
          const r = await fetch(String(body.url), {
            headers: {
              'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15',
              'Accept': 'application/rss+xml, application/atom+xml, application/xml, text/xml, */*',
            },
          });
          const t = await r.text();
          return jsonResp({ ok: true, status: r.status, contentType: r.headers.get('content-type'), len: t.length, sample: t.replace(/\s+/g, ' ').slice(0, 500) });
        } catch (e) {
          return jsonResp({ ok: false, error: (e as Error).message });
        }
      }
      if (body.action === 'purge_source') {
        // One-off admin: hard-delete every recommended_roles row for a
        // given source value (e.g. 'wwr', 'remotive', 'hn'). Use after
        // changing the source plugin's parser so the fixed version
        // re-inserts cleanly on the next run.
        const src = String(body.source || '').trim();
        if (!src) return err('source required', 400);
        const r = await sql`delete from job.recommended_roles where source = ${src} returning id`;
        return jsonResp({ ok: true, source: src, deleted: (r as unknown as unknown[]).length });
      }
      if (body.action === 'reset_bullets') {
        // One-off admin: wipes match_bullets on every active recommendation
        // so the next worker tick(s) regenerate with the current prompt.
        const r = await sql`
          update job.recommended_roles
             set match_bullets = null
           where dismissed_at is null
             and added_to_pipeline_slug is null
             and match_bullets is not null
           returning id`;
        return jsonResp({ ok: true, cleared: (r as unknown as unknown[]).length });
      }
      if (body.action === 'purge_off_target') {
        // One-off admin: dismiss rows whose title doesn't match a basic
        // PM seniority pattern. Use after tightening the title filter so
        // already-inserted rows don't linger in the widget.
        const r = await sql`
          update job.recommended_roles
             set dismissed_at = now()
           where dismissed_at is null
             and added_to_pipeline_slug is null
             and not (
               lower(title) ~ '\\m(founding|product lead|head of product|vp product|chief product|group product manager|principal (product manager|pm)|staff (product manager|pm)|senior (product manager|pm)|sr\\.? (product manager|pm)|director,? product|director of product)\\M'
             )
           returning id`;
        return jsonResp({ ok: true, dismissed: (r as unknown as unknown[]).length });
      }
      if (id && body.action === 'run') {
        const cronSecret = Deno.env.get('CRON_SECRET') || '';
        const r = await fetch(PULL_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-Cron-Secret': cronSecret },
          // Pass the id so the worker bypasses the schedule for this one source.
          body: JSON.stringify({ id }),
        });
        const text = await r.text();
        return jsonResp({ ok: r.ok, id, runStatus: r.status, runBody: safeJson(text) });
      }

      if (id) {
        // Patch — accept any subset of fields.
        const patch: Record<string, unknown> = {};
        if (body.label !== undefined)        patch.label = body.label;
        if (body.config !== undefined)       patch.config = body.config;
        if (body.enabled !== undefined)      patch.enabled = !!body.enabled;
        if (body.schedule_cron !== undefined) patch.schedule_cron = body.schedule_cron;
        if (body.min_score !== undefined)    patch.min_score = Number(body.min_score) | 0;
        if (!Object.keys(patch).length) return err('no fields to update', 400);
        patch.updated_at = new Date().toISOString();
        await sql`update job.user_sources set ${sql(patch)} where id = ${id} and user_email = ${email}`;
        return jsonResp({ ok: true, id, updated: Object.keys(patch) });
      }

      const type = String(body.type || '').trim();
      if (!type || !SOURCES[type]) return err(`unknown type "${type}"`, 400);
      const row = {
        user_email:    email,
        type,
        label:         body.label ?? null,
        config:        body.config ?? {},
        enabled:       body.enabled ?? true,
        schedule_cron: body.schedule_cron ?? '0 */6 * * *',
        min_score:     Number(body.min_score ?? 50) | 0,
      };
      const [inserted] = await sql`insert into job.user_sources ${sql(row)} returning id`;
      return jsonResp({ ok: true, id: inserted.id });
    }

    return err('GET or POST only', 405);
  } catch (e) {
    console.error('[user-sources] error', e);
    return err((e as Error).message || 'server error', 500);
  }
});

function safeJson(s: string) {
  try { return JSON.parse(s); } catch { return s; }
}
