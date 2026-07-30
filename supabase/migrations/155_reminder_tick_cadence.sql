-- ============================================
-- Migration 155: the reminder tick cadence, left where it was
--
-- The call reminder moved from an hour out to the quarter hour before a call.
-- Briefly this ran on a */5 schedule so a literal "5 minutes before" could be
-- honest; fifteen minutes of notice is fine, and at that lead the original
-- cadence is exactly right — the tick before a call lands somewhere in the
-- preceding fifteen minutes, which is the window we want.
--
-- Recorded rather than silently reverted because the reasoning matters: a
-- reminder promising a lead time its own cron cannot deliver is worse than one
-- that states the call's actual time, which is what the copy does now.
--
-- Everything else on this tick — bot scheduling, recording harvest, notification
-- detection, digests — stays at fifteen minutes rather than running three times
-- as often purely to serve the reminder.
-- ============================================

do $$
declare job_id int;
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
    timeout_milliseconds := 120000
  );
  $$
);
