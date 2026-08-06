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

const VERSION = '1.0.0';
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

function authorized(req: Request): boolean {
  const secret = Deno.env.get('CRON_SECRET');
  if (secret && req.headers.get('x-cron-secret') === secret) return true;
  const svc = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  const bearer = (req.headers.get('authorization') || '').replace(/^bearer\s+/i, '');
  if (svc && bearer === svc) return true;
  return false;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return err('POST only', 405);
  if (!authorized(req)) return err('forbidden', 403);

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

  // Kick the worker for this one source (bypasses the schedule). Fire and
  // wait — the caller is a local script that wants the end-to-end result.
  let run: unknown = null;
  if (sourceId) {
    try {
      const r = await fetch(PULL_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Cron-Secret': Deno.env.get('CRON_SECRET') || '' },
        body: JSON.stringify({ id: sourceId }),
      });
      run = { status: r.status, body: await r.json().catch(() => null) };
    } catch (e) {
      run = { error: (e as Error).message };
    }
  }

  return jsonResp({ ok: true, version: VERSION, sourceId, ...lastScan, run });
});
