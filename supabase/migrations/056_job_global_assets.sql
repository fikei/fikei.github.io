-- 056_job_global_assets — global (non-role-scoped) generated assets.
--
-- Currently used for the canonical base resume that per-role tailored
-- resumes diff against. Kept separate from job.role_assets because that
-- table has a FK to job.pipeline_roles(slug) and we don't want a phantom
-- role row to host this content.

create table if not exists job.global_assets (
  kind         text primary key,
  content_md   text not null,
  generated_by text,
  generated_at timestamptz default now(),
  edited_at    timestamptz,
  updated_at   timestamptz default now()
);

create or replace function job.touch_global_assets_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_global_assets_updated_at on job.global_assets;
create trigger trg_global_assets_updated_at
before update on job.global_assets
for each row execute function job.touch_global_assets_updated_at();
