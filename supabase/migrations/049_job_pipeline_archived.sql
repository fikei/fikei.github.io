-- Soft-archive flag for pipeline_roles. archived_at IS NULL means active;
-- a non-null timestamp means the row is archived (hidden from the default
-- pipeline view).
alter table job.pipeline_roles
  add column if not exists archived_at timestamptz;

create index if not exists pipeline_roles_archived_idx
  on job.pipeline_roles (archived_at)
  where archived_at is not null;
