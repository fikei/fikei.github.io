-- 157_analytics_people.sql
-- Attribute pageviews/errors to signed-in accounts and expose a per-person
-- rollup (last visit + visit history) for the /analytics accounts tab.
-- user_id is client-reported telemetry (spoofable by design, like ua/referrer);
-- it is never used for authorization.

alter table public.analytics_events
  add column if not exists user_id uuid;

create index if not exists analytics_events_user_occurred_idx
  on public.analytics_events (user_id, occurred_at desc)
  where user_id is not null;

create or replace function public.analytics_people(days int default 30)
returns jsonb
language sql
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(row_to_json(p) order by p.last_visit desc nulls last), '[]'::jsonb)
  from (
    select
      u.id as user_id,
      u.email,
      u.created_at,
      u.last_sign_in_at,
      (select array_agg(distinct i.provider)
         from auth.identities i where i.user_id = u.id) as providers,
      (select max(e.occurred_at)
         from public.analytics_events e where e.user_id = u.id) as last_visit,
      (select count(*)
         from public.analytics_events e
        where e.user_id = u.id and e.type = 'pageview'
          and e.occurred_at > now() - make_interval(days => days)) as views,
      (select count(distinct e.session_id)
         from public.analytics_events e
        where e.user_id = u.id and e.type = 'pageview'
          and e.occurred_at > now() - make_interval(days => days)) as sessions,
      (select count(*)
         from public.analytics_events e
        where e.user_id = u.id and e.type = 'error'
          and e.occurred_at > now() - make_interval(days => days)) as errors,
      (select array_agg(distinct e.app)
         from public.analytics_events e
        where e.user_id = u.id and e.type = 'pageview') as apps,
      (select coalesce(jsonb_agg(row_to_json(r)), '[]'::jsonb)
         from (
           select e.occurred_at, e.type, e.app, e.path, e.message
             from public.analytics_events e
            where e.user_id = u.id
            order by e.occurred_at desc
            limit 30
         ) r) as recent
    from auth.users u
    order by (select max(e.occurred_at) from public.analytics_events e where e.user_id = u.id) desc nulls last
    limit 200
  ) p;
$$;

revoke execute on function public.analytics_people(int) from public, anon, authenticated;
grant execute on function public.analytics_people(int) to service_role;
