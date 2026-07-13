-- 104_apply_ease.sql — Easy Apply flagging (Phase 16.1).
--
-- Adds an apply-ease tier to pipeline_roles (and recommended_roles for the
-- later For You reuse): a classification of the role's application form —
-- easy | short_answer | essay | special | portal | unknown — derived from
-- extract-application-fields output by classify-apply-ease. canonical_apply_url
-- stores the resolved ATS URL for LinkedIn aggregator links.
--
-- Also schedules the sweep: batch of 8 oldest-checked Saved/Drafting rows
-- every 2 hours (roles re-check after 14 days), mirroring the
-- saved-liveness-3h cron's auth pattern.

alter table job.pipeline_roles
  add column if not exists apply_ease            text,
  add column if not exists apply_ease_meta       jsonb,
  add column if not exists apply_ease_checked_at timestamptz,
  add column if not exists canonical_apply_url   text;

alter table job.pipeline_roles
  drop constraint if exists pipeline_roles_apply_ease_check;
alter table job.pipeline_roles
  add constraint pipeline_roles_apply_ease_check
  check (apply_ease is null or apply_ease in ('easy','short_answer','essay','special','portal','unknown'));

alter table job.recommended_roles
  add column if not exists apply_ease            text,
  add column if not exists apply_ease_meta       jsonb,
  add column if not exists apply_ease_checked_at timestamptz;

alter table job.recommended_roles
  drop constraint if exists recommended_roles_apply_ease_check;
alter table job.recommended_roles
  add constraint recommended_roles_apply_ease_check
  check (apply_ease is null or apply_ease in ('easy','short_answer','essay','special','portal','unknown'));

-- ---- cron: apply-ease sweep every 2h -------------------------------------
create extension if not exists pg_cron;
create extension if not exists pg_net;

do $$
declare
  job_id int;
begin
  select jobid into job_id from cron.job where jobname = 'apply-ease-2h';
  if job_id is not null then perform cron.unschedule(job_id); end if;
end$$;

select cron.schedule(
  'apply-ease-2h',
  '45 */2 * * *',
  $$
  select net.http_post(
    url     := 'https://yfhudwakpgzswiylhfbh.supabase.co/functions/v1/classify-apply-ease',
    -- Same two-layer auth as saved-liveness-3h: anon key satisfies the
    -- platform gateway (verify_jwt), x-cron-secret bypasses per-user auth
    -- inside the function.
    headers := jsonb_build_object(
      'Content-Type',  'application/json',
      'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InlmaHVkd2FrcGd6c3dpeWxoZmJoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njk4MTE3ODYsImV4cCI6MjA4NTM4Nzc4Nn0.bemC-CPA2vkoM5P4P-tmsPQ1RPr4ifPa5iginUXPKLI',
      'x-cron-secret', '850f11f7cf611308809c5ac44233cdc6e60f5abddf3e56b9a1e068d3efa18ca1'
    ),
    body    := '{}'::jsonb,
    timeout_milliseconds := 120000
  );
  $$
);
