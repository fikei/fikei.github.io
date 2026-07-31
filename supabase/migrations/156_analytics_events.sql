-- 156_analytics_events.sql
-- Site-wide analytics: pageview + client error ingest, admin-only read via
-- security-definer functions called from the analytics-dashboard edge function.

create table if not exists public.analytics_events (
  id bigint generated always as identity primary key,
  occurred_at timestamptz not null default now(),
  type text not null check (type in ('pageview', 'error')),
  app text not null check (char_length(app) between 1 and 64),
  path text not null check (char_length(path) between 1 and 512),
  referrer text check (char_length(referrer) <= 512),
  session_id text check (char_length(session_id) <= 64),
  viewport text check (char_length(viewport) <= 32),
  ua text check (char_length(ua) <= 512),
  message text check (char_length(message) <= 1000),
  stack text check (char_length(stack) <= 4000),
  meta jsonb
);

create index if not exists analytics_events_occurred_idx
  on public.analytics_events (occurred_at desc);
create index if not exists analytics_events_type_occurred_idx
  on public.analytics_events (type, occurred_at desc);
create index if not exists analytics_events_app_occurred_idx
  on public.analytics_events (app, occurred_at desc);

alter table public.analytics_events enable row level security;

-- Anyone may write telemetry; nobody may read it through PostgREST.
-- Reads happen only via the security-definer functions below, which are
-- executable by service_role alone (the analytics-dashboard edge function).
drop policy if exists analytics_events_insert on public.analytics_events;
create policy analytics_events_insert on public.analytics_events
  for insert to anon, authenticated
  with check (type in ('pageview', 'error'));

-- Aggregate rollup for the dashboard.
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
    'errors_total', (select count(*) from window_events where type = 'error'),
    'daily', (
      select coalesce(jsonb_agg(row_to_json(d) order by d.day), '[]'::jsonb)
      from (
        select date_trunc('day', occurred_at)::date as day,
               count(*) filter (where type = 'pageview') as views,
               count(distinct session_id) filter (where type = 'pageview') as uniques,
               count(*) filter (where type = 'error') as errors
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
               count(*) filter (where type = 'error') as errors,
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
        select occurred_at, app, path, message, stack, ua
        from public.analytics_events
        where type = 'error'
        order by occurred_at desc
        limit 50
      ) e
    )
  );
$$;

-- Account stats read from auth.users (service_role callers only).
create or replace function public.analytics_account_stats()
returns jsonb
language sql
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'total', (select count(*) from auth.users),
    'new_7d', (select count(*) from auth.users where created_at > now() - interval '7 days'),
    'new_30d', (select count(*) from auth.users where created_at > now() - interval '30 days'),
    'active_7d', (select count(*) from auth.users where last_sign_in_at > now() - interval '7 days'),
    'active_30d', (select count(*) from auth.users where last_sign_in_at > now() - interval '30 days'),
    'recent', (
      select coalesce(jsonb_agg(row_to_json(u)), '[]'::jsonb)
      from (
        select email, created_at, last_sign_in_at,
               (select array_agg(distinct i.provider) from auth.identities i where i.user_id = users.id) as providers
        from auth.users
        order by created_at desc
        limit 20
      ) u
    )
  );
$$;

revoke execute on function public.analytics_summary(int) from public, anon, authenticated;
revoke execute on function public.analytics_account_stats() from public, anon, authenticated;
grant execute on function public.analytics_summary(int) to service_role;
grant execute on function public.analytics_account_stats() to service_role;
