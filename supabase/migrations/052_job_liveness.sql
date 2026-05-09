-- Liveness tracking for pipeline_roles. A background job HEADs each URL
-- on a cadence; rows that 404 (or otherwise become unreachable) get
-- closed_detected_at stamped, status flipped to 'Closed', and archived.
alter table job.pipeline_roles
  add column if not exists liveness_checked_at timestamptz,
  add column if not exists is_live boolean,
  add column if not exists liveness_status_code int,
  add column if not exists closed_detected_at timestamptz;

create index if not exists pipeline_roles_liveness_idx
  on job.pipeline_roles (liveness_checked_at nulls first)
  where deleted_at is null;
