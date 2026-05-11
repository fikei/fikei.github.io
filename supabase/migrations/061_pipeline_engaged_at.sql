-- pipeline_roles.engaged_at — set when the user shows engagement on a
-- role *before* moving its status forward (e.g. opens the drill page,
-- taps Apply). Drives the "In progress" pill on the Saved bucket so
-- saved-but-touched rows surface above saved-but-untouched ones.
--
-- Also backfilled from hasResume: if a resume exists for the role, the
-- user clearly engaged with it at some point.

alter table job.pipeline_roles
  add column if not exists engaged_at timestamptz;

-- Backfill: any role with a generated resume counts as engaged.
update job.pipeline_roles r
   set engaged_at = coalesce(r.engaged_at, ra.updated_at, now())
  from job.role_assets ra
 where ra.role_slug = r.slug
   and ra.kind = 'resume'
   and r.engaged_at is null;
