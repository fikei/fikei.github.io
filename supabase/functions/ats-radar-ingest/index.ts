// ats-radar-ingest — upload one /job-radar sweep into job.ats_radar_scans.
//
// The sweep runs locally (fetch_boards.py); push_to_ladder.py POSTs the
// whole raw-<date>/ directory here as one batch. This endpoint:
//   1. Upserts one staging row per company (idempotent on scan_run_at+slug).
//   2. Prunes staging to the last 10 runs.
//   3. Stamps the scan's health note (verified / unverified / html-text
//      board counts) into the ats-radar user_sources row's config — an
//      unreachable board is UNVERIFIED, not "no openings", and the Sources
//      UI says so.
//   4. Force-runs pull-recommendations for the ats-radar source so the
//      postings flow through the normal gate → dedupe → grade → bullets
//      pipeline immediately.
//
// Auth: X-Cron-Secret (CRON_SECRET) or a service-role bearer. The push
// script fetches the service key via the Supabase CLI's own auth.

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { db } from '../_shared/job-db.ts';
import { jsonResp, err, corsHeaders } from '../_shared/job-auth.ts';

const VERSION = '1.1.0';
console.log(`[ats-radar-ingest] v${VERSION} - job-radar sweep upload + force-run`);

const PULL_URL = 'https://yfhudwakpgzswiylhfbh.supabase.co/functions/v1/pull-recommendations';
const KEEP_RUNS = 10;

interface CompanyScan {
  slug:        string;               // registry file stem — stable board key
  company:     string;
  type?:       string;               // ats type
  segments?:   string[];
  location?:   string;
  careers_url?: string;
  fetched_at?: string;
  ok?:         boolean;
  kind?:       string;               // structured | html-text | no-board | error
  jobs?:       Array<{ title?: string; location?: string; url?: string; posted?: string }>;
  error?:      string;
}

// The API gateway rewrites/validates the Authorization header, so the
// service key travels in X-Ingest-Key instead (verify_jwt is off for this
// function; this check IS the auth). Accepted credentials:
//   - X-Cron-Secret matching CRON_SECRET
//   - the project service key (new sb_secret_… format, exact match on env)
//   - the legacy service_role JWT, verified against SUPABASE_JWT_SECRET
//     with role=service_role (HS256 — same check the platform gateway does)
async function authorized(req: Request): Promise<boolean> {
  const secret = Deno.env.get('CRON_SECRET');
  if (secret && req.headers.get('x-cron-secret') === secret) return true;
  const key = req.headers.get('x-ingest-key')
    || (req.headers.get('authorization') || '').replace(/^bearer\s+/i, '');
  if (!key) return false;
  const svc = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (svc && key === svc) return true;
  return await isServiceKey(key);
}

// A presented key (legacy service_role JWT or sb_secret) is genuine iff the
// project's own Auth admin API accepts it — admin endpoints require
// service-level credentials, so a 2xx is proof without needing the JWT
// secret locally.
async function isServiceKey(key: string): Promise<boolean> {
  const base = Deno.env.get('SUPABASE_URL');
  if (!base) return false;
  try {
    const r = await fetch(`${base}/auth/v1/admin/users?page=1&per_page=1`, {
      headers: { apikey: key, Authorization: `Bearer ${key}` },
    });
    return r.ok;
  } catch {
    return false;
  }
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return err('POST only', 405);
  if (!(await authorized(req))) return err('forbidden', 403);

  let body: { runAt?: string; companies?: CompanyScan[] };
  try {
    body = await req.json();
  } catch {
    return err('invalid JSON body', 400);
  }
  const runAt = body.runAt ? new Date(body.runAt) : null;
  const companies = Array.isArray(body.companies) ? body.companies : [];
  if (!runAt || isNaN(runAt.getTime())) return err('runAt (ISO timestamp) required', 400);
  if (!companies.length) return err('companies[] required', 400);

  const sql = db();

  const rows = companies
    .filter(c => c && c.slug && c.company)
    .map(c => ({
      scan_run_at:  runAt.toISOString(),
      company:      c.company,
      company_slug: c.slug,
      ats_type:     c.type ?? null,
      segments:     Array.isArray(c.segments) ? c.segments : [],
      location:     c.location ?? null,
      careers_url:  c.careers_url ?? null,
      kind:         c.kind || (c.ok === false ? 'error' : 'structured'),
      ok:           c.ok === true,
      fetched_at:   c.fetched_at ?? null,
      jobs:         JSON.stringify(Array.isArray(c.jobs) ? c.jobs : []),
      error:        c.error ?? null,
    }));
  if (!rows.length) return err('no valid company rows', 400);

  await sql`
    insert into job.ats_radar_scans ${sql(rows)}
    on conflict (scan_run_at, company_slug) do update
       set kind = excluded.kind, ok = excluded.ok, fetched_at = excluded.fetched_at,
           jobs = excluded.jobs, error = excluded.error`;

  // Keep staging small — the plugin only ever reads the latest run.
  await sql`
    delete from job.ats_radar_scans
     where scan_run_at not in (
       select distinct scan_run_at from job.ats_radar_scans
        order by scan_run_at desc limit ${KEEP_RUNS})`;

  // Health note for the Sources row. Unverified = the board errored this
  // run; html-text = reachable but needs a manual read (the skill's report
  // covers those) — neither means "no openings".
  const verified   = rows.filter(r => r.ok && r.kind === 'structured');
  const htmlText   = rows.filter(r => r.ok && r.kind === 'html-text');
  const unverified = rows.filter(r => !r.ok && r.kind !== 'no-board');
  const jobCount   = verified.reduce((n, r) => n + JSON.parse(r.jobs).length, 0);
  const lastScan = {
    runAt:      runAt.toISOString(),
    boards:     rows.length,
    verified:   verified.length,
    jobs:       jobCount,
    htmlText:   htmlText.length,
    unverified: unverified.map(r => r.company),
  };
  const srcRows = await sql<{ id: string }[]>`
    update job.user_sources
       set config = coalesce(config, '{}'::jsonb) || jsonb_build_object('lastScan', ${sql.json(lastScan)}::jsonb),
           updated_at = now()
     where type = 'ats-radar'
     returning id`;
  const sourceId = srcRows[0]?.id ?? null;

  // Kick the worker for this one source (bypasses the schedule). Fire and forget
  // forget — a big scan's grade pass can outlast this function's own 150s
  // budget, so we must not await it. The Sources row's lastRunAt/lastError
  // show the outcome; the Inbox picks up new recs on its next fetch.
  let kicked = false;
  if (sourceId) {
    const kick = fetch(PULL_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Cron-Secret': Deno.env.get('CRON_SECRET') || '' },
      body: JSON.stringify({ id: sourceId }),
    }).then(r => console.log(`[ats-radar-ingest] worker kick → ${r.status}`))
      .catch(e => console.warn(`[ats-radar-ingest] worker kick failed: ${(e as Error).message}`));
    // Keep the kick alive past this response where the runtime supports it.
    // deno-lint-ignore no-explicit-any
    (globalThis as any).EdgeRuntime?.waitUntil?.(kick);
    kicked = true;
  }

  return jsonResp({ ok: true, version: VERSION, sourceId, kicked, ...lastScan });
});
