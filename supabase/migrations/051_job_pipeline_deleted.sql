-- Soft-delete column for pipeline_roles. Hidden from every UI surface
-- (no filter exposes it), kept in DB for continuity / undo.
alter table job.pipeline_roles
  add column if not exists deleted_at timestamptz;

create index if not exists pipeline_roles_deleted_idx
  on job.pipeline_roles (deleted_at)
  where deleted_at is null;
