-- ============================================
-- Migration 123: nonce auth for the reminder cron
--
-- CRON_SECRET / app.cron_secret are not configured on this project, so the
-- X-Cron-Secret path in migration 122 never authenticates. Replace it with a
-- secretless one-time-nonce handshake: each tick INSERTs a UUID into a
-- service-role-only table and sends it as X-Cron-Nonce; recruit-discord
-- consumes it (delete-on-use, 10-minute expiry). If CRON_SECRET is ever set,
-- the fn still accepts X-Cron-Secret as an alternative.
-- ============================================

CREATE TABLE IF NOT EXISTS recruit_cron_nonce (
  nonce UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE recruit_cron_nonce ENABLE ROW LEVEL SECURITY;
-- No policies on purpose: only service role (the edge fn) and postgres (cron) touch it.

do $$
declare
  job_id int;
begin
  select jobid into job_id from cron.job where jobname = 'recruit_screening_reminder_tick';
  if job_id is not null then perform cron.unschedule(job_id); end if;
end$$;

select cron.schedule(
  'recruit_screening_reminder_tick',
  '*/15 * * * *',
  $$
  with purge as (
    delete from recruit_cron_nonce where created_at < now() - interval '1 hour'
  ), n as (
    insert into recruit_cron_nonce default values returning nonce
  )
  select net.http_post(
    url := 'https://yfhudwakpgzswiylhfbh.supabase.co/functions/v1/recruit-discord/remind',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'X-Cron-Nonce', (select nonce::text from n)
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 30000
  );
  $$
);
