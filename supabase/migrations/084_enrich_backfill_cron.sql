-- 084_enrich_backfill_cron.sql
-- Auto-retry unresolved recommendations on a schedule.
--
-- Problem: enrich-job-source marks rows it can't resolve as
-- enrichment_status='unresolved' with an exponential-backoff
-- enrichment_retry_at (1h → 4h → 24h → 3d → 7d). The backfill action exists
-- to re-attempt due rows, but nothing ever called it on a schedule — so once
-- a row went unresolved it was only retried if a brand-new pull happened to
-- re-process it (which it never does, behind the Gmail cursor). Unresolved
-- rows (the "Verifying" badge) were effectively stuck forever, including the
-- resolvable ones whose company is on Greenhouse/Lever/Ashby but missed on
-- the first slug/title guess.
--
-- Fix: tick enrich-job-source?action=backfill every 10 minutes. Each tick
-- drains up to 15 due rows (the function's own cap); rows that resolve clear
-- the badge, rows that fail get a fresh backoff. Steady-state cost is low —
-- once the backlog drains, only rows past their backoff are reselected.
--
-- Auth: enrich-job-source is verify_jwt=true. We pass the project's PUBLIC
-- anon key as the bearer (same token shipped in the frontend) — it satisfies
-- the JWT gateway; the function does its writes via its own service-role DB
-- connection regardless of caller role.

create extension if not exists pg_cron;
create extension if not exists pg_net;

-- Idempotent re-schedule: drop any prior tick first, then create.
do $$
declare
  job_id int;
begin
  select jobid into job_id from cron.job where jobname = 'job_enrich_backfill_tick';
  if job_id is not null then perform cron.unschedule(job_id); end if;
end$$;

select cron.schedule(
  'job_enrich_backfill_tick',
  '*/10 * * * *',
  $$
  select net.http_post(
    url := 'https://yfhudwakpgzswiylhfbh.supabase.co/functions/v1/enrich-job-source',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InlmaHVkd2FrcGd6c3dpeWxoZmJoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njk4MTE3ODYsImV4cCI6MjA4NTM4Nzc4Nn0.bemC-CPA2vkoM5P4P-tmsPQ1RPr4ifPa5iginUXPKLI'
    ),
    body := '{"action":"backfill","limit":15}'::jsonb,
    timeout_milliseconds := 120000
  );
  $$
);
