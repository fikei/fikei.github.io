-- ============================================
-- Migration 136: schedule the inbox + calendar sweep
--
-- Why row states go stale: recruit-gmail's `scan` action — the thing that
-- matches inbound mail to applicants, picks up manually-booked calls off the
-- calendar, and backfills availability — only ever ran from the browser.
-- scanInbox() is throttled to one run per 10 minutes per device and skipped
-- entirely when nobody has /applications open. A week of nobody opening the
-- app meant a week of replies and bookings the surface never learned about.
--
-- This ticks it every 20 minutes regardless. Same secretless handshake as
-- migration 123's reminder cron: mint a one-time nonce into the
-- service-role-only recruit_cron_nonce table, send it as X-Cron-Nonce, and
-- the function burns it on use (10-minute expiry).
--
-- The cron path is /scan (recruit-gmail v1.16.0), which forces action='scan'
-- and skips the Discord-membership gate the app's calls go through.
--
-- The Authorization header is the PUBLIC anon key, and it is not the auth
-- for this endpoint — the nonce is. Supabase's function gateway rejects any
-- request with no Authorization header before the function ever runs
-- (UNAUTHORIZED_NO_AUTH_HEADER), so a nonce-only request never arrives.
-- recruit-discord sidesteps this with verify_jwt = false; recruit-gmail
-- can't take that route, because every one of its other actions relies on
-- a real user JWT plus the Discord-membership gate. Sending the anon key
-- satisfies the gateway and changes nothing about who can run the sweep.
--
-- 20 minutes, not 15: it shares the shared-Gmail token and Google's quota
-- with the reminder tick, and offsetting them keeps the two off each other.
-- ============================================

do $$
declare
  job_id int;
begin
  select jobid into job_id from cron.job where jobname = 'recruit_gmail_scan_tick';
  if job_id is not null then perform cron.unschedule(job_id); end if;
end$$;

select cron.schedule(
  'recruit_gmail_scan_tick',
  '*/20 * * * *',
  $$
  with purge as (
    delete from recruit_cron_nonce where created_at < now() - interval '1 hour'
  ), n as (
    insert into recruit_cron_nonce default values returning nonce
  )
  select net.http_post(
    url := 'https://yfhudwakpgzswiylhfbh.supabase.co/functions/v1/recruit-gmail/scan',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      -- Public anon key: satisfies the function gateway only. The nonce below
      -- is what actually authorizes the sweep.
      'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InlmaHVkd2FrcGd6c3dpeWxoZmJoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njk4MTE3ODYsImV4cCI6MjA4NTM4Nzc4Nn0.bemC-CPA2vkoM5P4P-tmsPQ1RPr4ifPa5iginUXPKLI',
      'X-Cron-Nonce', (select nonce::text from n)
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 120000
  );
  $$
);
