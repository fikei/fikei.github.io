-- Allow `analysis` as a role_assets kind. The detail page stores Claude's
-- structured analysis (brief, why-fits, risks, candidate-strength) here.
alter table job.role_assets drop constraint if exists role_assets_kind_check;
alter table job.role_assets add constraint role_assets_kind_check
  check (kind in ('resume', 'cover-letter', 'notes', 'analysis'));
