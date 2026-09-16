-- ============================================
-- Migration 180: package delivery notices → Discord #mail
--
-- Packages land at the house all day and nobody knows whose they are until
-- someone opens the box. Every delivery already announces itself by email
-- (Amazon, ShipStation, the Shopify stores, CVS, Arc'teryx); this table is
-- the ledger that turns that mail into one post in #mail, exactly once.
--
-- Phase 1 reads Ian's two inboxes only. The schema is already multi-inbox
-- (owner_label, inbox_email) so Phase 2 — each housemate connecting their
-- own Gmail — is a loop, not a rewrite.
--
-- Design note on privacy: there is deliberately NO column for item names.
-- A delivery notice names what somebody bought, and #mail is a room, not a
-- DM. We store and post the merchant only. Bodies are never retained — the
-- classifier reads them in flight and discards them.
-- ============================================

create table if not exists mail_deliveries (
  id             uuid primary key default gen_random_uuid(),
  -- Dedupe key. Amazon sends the same "Delivered" notice up to three times
  -- (thread 19f091aa02459a90 has three in 25 minutes), so the unique index
  -- is what lets the cron re-scan an overlapping window forever.
  gmail_msg_id   text not null unique,
  inbox_email    text not null,
  owner_label    text not null,
  merchant       text,
  carrier        text,
  delivered_at   timestamptz,
  confidence     real,
  posted_at      timestamptz,
  discord_msg_id text,
  created_at     timestamptz not null default now()
);

-- The scan's dedupe ("have I already seen these ids?") rides the unique
-- index on gmail_msg_id. This one is for reading the ledger back by time.
create index if not exists mail_deliveries_created_idx
  on mail_deliveries (created_at desc);

alter table mail_deliveries enable row level security;
-- Service role only. Nothing in the browser reads this.
revoke all on mail_deliveries from anon, authenticated;

-- ---- cron -------------------------------------------------------------
-- Same secretless handshake as migrations 123/136: mint a one-time nonce
-- into recruit_cron_nonce, send it as X-Cron-Nonce, the function burns it.
--
-- Minute 7 of every quarter hour, not :00 — it shares the Google quota with
-- the recruiting sweep (*/20) and the reminder tick, and offsetting keeps
-- the three off each other.
do $$
declare
  job_id int;
begin
  select jobid into job_id from cron.job where jobname = 'mail_watch_scan_tick';
  if job_id is not null then perform cron.unschedule(job_id); end if;
end$$;

select cron.schedule(
  'mail_watch_scan_tick',
  '7,22,37,52 * * * *',
  $$
  with purge as (
    delete from recruit_cron_nonce where created_at < now() - interval '1 hour'
  ), n as (
    insert into recruit_cron_nonce default values returning nonce
  )
  select net.http_post(
    url := 'https://yfhudwakpgzswiylhfbh.supabase.co/functions/v1/mail-watch/scan',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      -- Public anon key: satisfies the function gateway only. The nonce is
      -- what actually authorizes the sweep.
      'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InlmaHVkd2FrcGd6c3dpeWxoZmJoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njk4MTE3ODYsImV4cCI6MjA4NTM4Nzc4Nn0.bemC-CPA2vkoM5P4P-tmsPQ1RPr4ifPa5iginUXPKLI',
      'X-Cron-Nonce', (select nonce::text from n)
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 120000
  );
  $$
);
