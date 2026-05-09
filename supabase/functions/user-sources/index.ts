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
