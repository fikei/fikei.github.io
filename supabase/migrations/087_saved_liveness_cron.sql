-- 087_saved_liveness_cron.sql — schedule the Saved-pipeline liveness sweep.
--
-- check-liveness HEAD-probes job.pipeline_roles URLs and auto-closes rows that
-- 404/410/451. Until now it only ran when the user opened the Saved tab
-- (frontend, 1h debounce) — so a saved role that expired while the tab was
-- closed stayed "open" indefinitely. This adds a server-side cron, mirroring
-- the For You liveness-check-6h job, so Saved expiry is detected regardless of
-- whether anyone visits the page.
--
-- Batch is 10 oldest-checked rows per tick (see check-liveness/index.ts), so a
-- 3-hour cadence sweeps the whole ~50-row pipeline several times a day.

create extension if not exists pg_cron;
create extension if not exists pg_net;

-- Idempotent re-schedule: drop any prior tick first, then create.
do $$
declare
  job_id int;
begin
  select jobid into job_id from cron.job where jobname = 'saved-liveness-3h';
  if job_id is not null then perform cron.unschedule(job_id); end if;
end$$;

select cron.schedule(
  'saved-liveness-3h',
  '30 */3 * * *',
  $$
  select net.http_post(
    url     := 'https://yfhudwakpgzswiylhfbh.supabase.co/functions/v1/check-liveness',
    -- check-liveness has verify_jwt=true, so the platform gateway needs a
    -- valid Authorization header (anon key satisfies it) BEFORE the request
    -- reaches the function; the x-cron-secret then bypasses the function's
    -- own per-user auth. Mirrors the liveness-check-6h / enrich-backfill crons.
    headers := jsonb_build_object(
      'Content-Type',  'application/json',
      'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InlmaHVkd2FrcGd6c3dpeWxoZmJoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njk4MTE3ODYsImV4cCI6MjA4NTM4Nzc4Nn0.bemC-CPA2vkoM5P4P-tmsPQ1RPr4ifPa5iginUXPKLI',
      'x-cron-secret', '850f11f7cf611308809c5ac44233cdc6e60f5abddf3e56b9a1e068d3efa18ca1'
    ),
    body    := '{}'::jsonb,
    timeout_milliseconds := 120000
  );
  $$
);
