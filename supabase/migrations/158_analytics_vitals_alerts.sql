-- 158_analytics_vitals_alerts.sql
-- Visibility build-out: web-vitals rows, server-side error rows, and the
-- error-spike alert cron (analytics-alerts fn, DM via the recruiting bot —
-- same no-new-secrets nonce handshake as migrations 123/136).

-- 1. Event types: 'vital' (client, via anon insert) and 'server_error'
--    (edge functions, via service role only — deliberately NOT in the policy).
do $$
declare c text;
begin
  select conname into c from pg_constraint
   where conrelid = 'public.analytics_events'::regclass and contype = 'c'
     and pg_get_constraintdef(oid) like '%pageview%';
  if c is not null then
    execute format('alter table public.analytics_events drop constraint %I', c);
  end if;
end $$;
alter table public.analytics_events
  add constraint analytics_events_type_check
  check (type in ('pageview', 'error', 'server_error', 'vital'));

drop policy if exists analytics_events_insert on public.analytics_events;
create policy analytics_events_insert on public.analytics_events
  for insert to anon, authenticated
  with check (type in ('pageview', 'error', 'vital'));

-- 2. Alert ledger — dedupes DMs (one per kind per cooldown window).
create table if not exists public.analytics_alerts (
  id bigint generated always as identity primary key,
  sent_at timestamptz not null default now(),
  kind text not null,
  detail text
);
alter table public.analytics_alerts enable row level security;
-- No policies on purpose: only the service role (analytics-alerts fn) touches it.

-- 3. analytics_summary v2: server errors count as errors, vitals p75 exposed.
create or replace function public.analytics_summary(days int default 30)
returns jsonb
language sql
security definer
set search_path = ''
as $$
  with window_events as (
    select * from public.analytics_events
    where occurred_at > now() - make_interval(days => days)
  )
  select jsonb_build_object(
    'days', days,
    'views_total', (select count(*) from window_events where type = 'pageview'),
    'views_today', (
      select count(*) from public.analytics_events
      where type = 'pageview' and occurred_at >= date_trunc('day', now())
    ),
    'uniques_total', (
      select count(distinct session_id) from window_events
      where type = 'pageview' and session_id is not null
    ),
    'errors_total', (select count(*) from window_events where type in ('error', 'server_error')),
    'daily', (
      select coalesce(jsonb_agg(row_to_json(d) order by d.day), '[]'::jsonb)
      from (
        select date_trunc('day', occurred_at)::date as day,
               count(*) filter (where type = 'pageview') as views,
               count(distinct session_id) filter (where type = 'pageview') as uniques,
               count(*) filter (where type in ('error', 'server_error')) as errors
        from window_events
        group by 1
      ) d
    ),
    'by_app', (
      select coalesce(jsonb_agg(row_to_json(a) order by a.views desc), '[]'::jsonb)
      from (
        select app,
               count(*) filter (where type = 'pageview') as views,
               count(distinct session_id) filter (where type = 'pageview') as uniques,
               count(*) filter (where type in ('error', 'server_error')) as errors,
               max(occurred_at) as last_seen
        from window_events
        group by app
      ) a
    ),
    'top_paths', (
      select coalesce(jsonb_agg(row_to_json(p)), '[]'::jsonb)
      from (
        select app, path, count(*) as views
        from window_events
        where type = 'pageview'
        group by app, path
        order by views desc
        limit 25
      ) p
    ),
    'top_referrers', (
      select coalesce(jsonb_agg(row_to_json(r)), '[]'::jsonb)
      from (
        select referrer, count(*) as views
        from window_events
        where type = 'pageview' and referrer is not null and referrer <> ''
        group by referrer
        order by views desc
        limit 15
      ) r
    ),
    'recent_errors', (
      select coalesce(jsonb_agg(row_to_json(e)), '[]'::jsonb)
      from (
        select occurred_at, type, app, path, message, stack, ua
        from public.analytics_events
        where type in ('error', 'server_error')
        order by occurred_at desc
        limit 50
      ) e
    ),
    'vitals', (
      select coalesce(jsonb_agg(row_to_json(v)), '[]'::jsonb)
      from (
        select meta->>'name' as name,
               round((percentile_cont(0.75) within group
                 (order by (meta->>'value')::numeric))::numeric, 2) as p75,
               count(*) as samples
        from window_events
        where type = 'vital' and meta ? 'name' and meta ? 'value'
          and (meta->>'value') ~ '^[0-9.]+$'
        group by 1
      ) v
    )
  );
$$;
revoke execute on function public.analytics_summary(int) from public, anon, authenticated;
grant execute on function public.analytics_summary(int) to service_role;

-- 4. Spike-check cron: every 30 min, nonce handshake (see migration 123 for
--    why the Authorization header is the public anon key and not the auth).
do $$
declare
  job_id int;
begin
  select jobid into job_id from cron.job where jobname = 'analytics_alerts_tick';
  if job_id is not null then perform cron.unschedule(job_id); end if;
end $$;

select cron.schedule(
  'analytics_alerts_tick',
  '7,37 * * * *',
  $$
  with n as (
    insert into recruit_cron_nonce default values returning nonce
  )
  select net.http_post(
    url := 'https://yfhudwakpgzswiylhfbh.supabase.co/functions/v1/analytics-alerts',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InlmaHVkd2FrcGd6c3dpeWxoZmJoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njk4MTE3ODYsImV4cCI6MjA4NTM4Nzc4Nn0.bemC-CPA2vkoM5P4P-tmsPQ1RPr4ifPa5iginUXPKLI',
      'X-Cron-Nonce', (select nonce::text from n)
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 30000
  );
  $$
);
