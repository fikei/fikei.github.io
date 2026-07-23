-- ============================================
-- Migration 122: interview DM reminders
--
-- pg_cron pings recruit-discord/remind every 15 min; the fn DMs each
-- claimer ~an hour before their screening call. reminder_sent_at makes
-- the DM once-only. Auth mirrors pull-recommendations: X-Cron-Secret
-- header = app.cron_secret DB setting = CRON_SECRET fn env.
-- ============================================

ALTER TABLE recruit_screenings ADD COLUMN IF NOT EXISTS reminder_sent_at TIMESTAMPTZ;

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
  select net.http_post(
    url := 'https://yfhudwakpgzswiylhfbh.supabase.co/functions/v1/recruit-discord/remind',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'X-Cron-Secret', current_setting('app.cron_secret', true)
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 30000
  );
  $$
);
