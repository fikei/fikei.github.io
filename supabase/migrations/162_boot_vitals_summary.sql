-- ============================================
-- Migration 162: boot_vitals_summary()
--
-- Aggregate-only window into the recruiting app's boot phases
-- (boot_access / boot_data / boot_enter / boot_since_nav vitals from
-- track.js). Exists so the scheduled boot-telemetry routine can decide
-- which optimization to take without any row-level read on
-- analytics_events, which stays insert-only for anon. Percentile
-- timings carry no personal data.
-- ============================================

create or replace function public.boot_vitals_summary()
returns jsonb
language sql stable security definer
set search_path = public
as $$
  select jsonb_build_object(
    'window_days', 14,
    'days_with_data', (
      select count(distinct date_trunc('day', occurred_at))
      from analytics_events
      where type = 'vital' and meta->>'name' like 'boot\_%' escape '\'
        and occurred_at > now() - interval '14 days'
    ),
    'metrics', coalesce((
      select jsonb_object_agg(name, stats) from (
        select meta->>'name' as name,
          jsonb_build_object(
            'n', count(*),
            'p50', round(percentile_cont(0.5) within group (order by (meta->>'value')::numeric)::numeric, 1),
            'p75', round(percentile_cont(0.75) within group (order by (meta->>'value')::numeric)::numeric, 1)
          ) as stats
        from analytics_events
        where type = 'vital' and meta->>'name' like 'boot\_%' escape '\'
          and occurred_at > now() - interval '14 days'
        group by 1
      ) s
    ), '{}'::jsonb)
  );
$$;

grant execute on function public.boot_vitals_summary() to anon, authenticated;
