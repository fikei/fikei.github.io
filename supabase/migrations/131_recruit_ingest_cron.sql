-- ============================================
-- Migration 131: hourly application-sheet ingest
--
-- Pulls the application spreadsheet through the Sheets API with the shared
-- Google account's token (recruit-ingest/pull) instead of relying on an Apps
-- Script trigger living inside the sheet. Same one-time-nonce handshake as
-- the reminder cron (migration 123): each tick inserts a nonce and sends it
-- as X-Cron-Nonce; the function burns it on use.
--
-- Ingest is idempotent (id = name-slug + submission timestamp, duplicates
-- ignored), so re-reading the whole sheet every hour costs nothing.
-- ============================================

do $$
declare
  job_id int;
begin
  select jobid into job_id from cron.job where jobname = 'recruit_application_ingest_tick';
  if job_id is not null then perform cron.unschedule(job_id); end if;
end$$;

select cron.schedule(
  'recruit_application_ingest_tick',
  '7 * * * *',   -- hourly, off the hour so it doesn't collide with other jobs
  $$
  with purge as (
    delete from recruit_cron_nonce where created_at < now() - interval '1 hour'
  ), n as (
    insert into recruit_cron_nonce default values returning nonce
  )
  select net.http_post(
    url := 'https://yfhudwakpgzswiylhfbh.supabase.co/functions/v1/recruit-ingest/pull',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'X-Cron-Nonce', (select nonce::text from n)
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 60000
  );
  $$
);
