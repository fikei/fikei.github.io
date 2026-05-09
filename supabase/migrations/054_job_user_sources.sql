-- User-configured recommendation sources. The pull-recommendations
-- worker iterates rows where enabled=true and the schedule is due,
-- looks up the plugin in the in-code registry by `type`, calls
-- pull(config), and writes results into job.recommended_roles.
--
-- Each plugin owns the shape of `config`. Validation lives in the
-- plugin (TS), not here, so we keep this table dumb.

create table if not exists job.user_sources (
  id              uuid primary key default gen_random_uuid(),
  user_email      text not null,
  type            text not null,                   -- 'fixture' | 'tracked-ats' | 'linkedin-rss' | …
  label           text,                            -- human-readable, e.g. "PM jobs in NYC"
  config          jsonb not null default '{}'::jsonb,
  enabled         boolean not null default true,
  schedule_cron   text not null default '0 */6 * * *',
  -- Roles below min_score (or with any hard-fail) are scored and then
  -- dropped before insert. Default mirrors the pipeline UX: 50+ shows
  -- as "ok" or better. Set to 0 to keep everything.
  min_score       int not null default 50,
  last_run_at     timestamptz,
  last_run_count  int,                             -- # of new rows the last run inserted
  last_dropped    int,                             -- # filtered out by score / hard-fails
  last_error      text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

-- Score columns on the recommendations themselves so the widget can
-- show fit pills and the breakdown modal, exactly like the pipeline.
alter table job.recommended_roles
  add column if not exists fit_score      int,
  add column if not exists fit_breakdown  jsonb,
  add column if not exists hard_fails     text[] default '{}',
  add column if not exists sector         text,
  add column if not exists investors      text[] default '{}',
  add column if not exists user_email     text,
  add column if not exists user_source_id uuid references job.user_sources(id) on delete set null;

-- Active-list query becomes "active AND scored well." Replace the
-- prior partial index so the recommendations endpoint can rely on it.
drop index if exists job.recommended_roles_active_idx;
create index if not exists recommended_roles_active_idx
  on job.recommended_roles (suggested_at desc)
  where dismissed_at is null
    and added_to_pipeline_slug is null
    and (fit_score is null or fit_score >= 50);

create index if not exists user_sources_enabled_idx
  on job.user_sources (enabled, type)
  where enabled = true;

alter table job.user_sources enable row level security;

-- Backfill ats / ats_slug on tracked_companies from any pipeline_roles
-- URL we already have. Matches Greenhouse, Lever, and Ashby URLs;
-- leaves anything else alone (so Workday / iCIMS / careers pages stay
-- empty until you fill them in by hand).
with derived as (
  select distinct on (pr.company_slug)
    pr.company_slug,
    case
      when pr.url ~* 'boards\.greenhouse\.io/[^/]+'                  then 'Greenhouse'
      when pr.url ~* 'jobs\.lever\.co/[^/]+'                         then 'Lever'
      when pr.url ~* 'jobs\.ashbyhq\.com/[^/]+'                      then 'Ashby'
    end as ats,
    case
      when pr.url ~* 'boards\.greenhouse\.io/([^/?#]+)'
        then substring(pr.url from 'boards\.greenhouse\.io/([^/?#]+)')
      when pr.url ~* 'jobs\.lever\.co/([^/?#]+)'
        then substring(pr.url from 'jobs\.lever\.co/([^/?#]+)')
      when pr.url ~* 'jobs\.ashbyhq\.com/([^/?#]+)'
        then substring(pr.url from 'jobs\.ashbyhq\.com/([^/?#]+)')
    end as ats_slug
  from job.pipeline_roles pr
  where pr.company_slug is not null
    and pr.url is not null
    and pr.url ~* '(boards\.greenhouse\.io|jobs\.lever\.co|jobs\.ashbyhq\.com)/'
)
update job.tracked_companies tc
   set ats      = coalesce(tc.ats, d.ats),
       ats_slug = coalesce(tc.ats_slug, d.ats_slug),
       updated_at = now()
  from derived d
 where d.company_slug = tc.slug
   and (tc.ats is null or tc.ats_slug is null);

-- pg_cron + pg_net: tick the worker every 30 minutes. The function
-- itself decides which user_sources are due based on schedule_cron.
create extension if not exists pg_cron;
create extension if not exists pg_net;

-- Idempotent re-schedule: drop any prior tick first, then create.
do $$
declare
  job_id int;
begin
  select jobid into job_id from cron.job where jobname = 'job_pull_recommendations_tick';
  if job_id is not null then perform cron.unschedule(job_id); end if;
end$$;

select cron.schedule(
  'job_pull_recommendations_tick',
  '*/30 * * * *',
  $$
  select net.http_post(
    url := 'https://yfhudwakpgzswiylhfbh.supabase.co/functions/v1/pull-recommendations',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'X-Cron-Secret', current_setting('app.cron_secret', true)
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 60000
  );
  $$
);
