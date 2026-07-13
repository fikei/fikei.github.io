// check-liveness — probe job posting URLs and auto-archive 404'd / dead rows.
//
//   POST                 → batch (up to 10 oldest-checked rows). Allowlist
//                          auth required.
//   POST { slug }        → single role, force-recheck.
//   POST cron mode       → pass header 'x-cron-secret: <CRON_SECRET>' to bypass
//                          user auth. Used by pg_cron.

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { verifyJobUser, jsonResp, err, corsHeaders } from '../_shared/job-auth.ts';
import { db } from '../_shared/job-db.ts';

const VERSION = '0.2.0';
console.log(`[check-liveness] v${VERSION} - greenhouse dead-job 302 detection`);

const BATCH = 10;
const TIMEOUT_MS = 8000;
const CLOSE_STATUSES = new Set([404, 410, 451]);

// Some sites return HTML 200 with a "this job is no longer available"
// banner. Detecting that requires per-site parsing — out of scope for v1.
// We only auto-close on 4xx/5xx where the URL is genuinely unreachable.

interface CheckResult {
  slug: string;
  url: string;
  status: number | null;
  isLive: boolean | null;
  willClose: boolean;
  error?: string;
}

async function probe(url: string): Promise<{ status: number | null; error?: string }> {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    // Greenhouse removes dead jobs by 302-redirecting the job URL to the
    // board root — redirect:'follow' turns that into a 200 and the row reads
    // as alive forever (bit us on 2 real roles, 2026-07-13). Probe job-page
    // URLs on greenhouse.io manually: a redirect whose Location drops the
    // job id means the posting is gone → report 404.
    if (/greenhouse\.io$/i.test(new URL(url).hostname) && /\/jobs\/(\d+)/.test(url)) {
      const jobId = url.match(/\/jobs\/(\d+)/)![1];
      const res = await fetch(url, { method: 'GET', redirect: 'manual', signal: controller.signal });
      if (res.status >= 300 && res.status < 400) {
        const loc = res.headers.get('location') || '';
        return { status: loc.includes(jobId) ? res.status : 404 };
      }
      return { status: res.status };
    }

    // Many ATS pages don't honour HEAD — fall back to GET.
    let res = await fetch(url, { method: 'HEAD', redirect: 'follow', signal: controller.signal });
    if (res.status === 405 || res.status === 501) {
      res = await fetch(url, { method: 'GET', redirect: 'follow', signal: controller.signal });
    }
    return { status: res.status };
  } catch (e) {
    return { status: null, error: (e as Error).message };
  } finally {
    clearTimeout(t);
  }
}

async function checkRoles(filter: { slug?: string }): Promise<CheckResult[]> {
  const sql = db();
  const rows = filter.slug
    ? await sql`
        select slug, url from job.pipeline_roles
        where slug = ${filter.slug} and url is not null;
      `
    : await sql`
        select slug, url from job.pipeline_roles
        where url is not null
          and deleted_at is null
          and archived_at is null
          and (status is null or status not in ('Closed','Rejected','Pass'))
        order by liveness_checked_at nulls first
        limit ${BATCH};
      `;

  const results: CheckResult[] = [];
  for (const r of rows) {
    const probed = await probe(r.url);
    const status = probed.status;
    const willClose = status != null && CLOSE_STATUSES.has(status);
    const isLive = status == null ? null : (status >= 200 && status < 400);

    if (willClose) {
      await sql`
        update job.pipeline_roles set
          liveness_checked_at = now(),
          liveness_status_code = ${status},
          is_live = false,
          closed_detected_at = coalesce(closed_detected_at, now()),
          status = 'Closed',
          status_changed_at = now(),
          archived_at = coalesce(archived_at, now()),
          status_history = coalesce(status_history, '[]'::jsonb) || ${sql.json([{ status: 'Closed', at: new Date().toISOString(), by: 'liveness' }])}
        where slug = ${r.slug};
      `;
    } else {
      await sql`
        update job.pipeline_roles set
          liveness_checked_at = now(),
          liveness_status_code = ${status ?? null},
          is_live = ${isLive}
        where slug = ${r.slug};
      `;
    }

    results.push({ slug: r.slug, url: r.url, status, isLive, willClose, error: probed.error });
  }
  return results;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return err('POST only', 405);

  // Cron mode: shared secret in header bypasses user auth.
  const cronSecret = req.headers.get('x-cron-secret');
  const expected = Deno.env.get('CRON_SECRET');
  const cronAuthed = expected && cronSecret && cronSecret === expected;

  if (!cronAuthed) {
    const email = await verifyJobUser(req);
    if (!email) return err('unauthorized', 401);
  }

  try {
    const body = await req.json().catch(() => ({}));
    const slug = body.slug ? String(body.slug).toLowerCase() : undefined;
    const results = await checkRoles({ slug });
    return jsonResp({
      ok: true,
      version: VERSION,
      checked: results.length,
      closed: results.filter(r => r.willClose).map(r => r.slug),
      results,
    });
  } catch (e) {
    console.error('[check-liveness] error', e);
    return err((e as Error).message || 'server error', 500);
  }
});
