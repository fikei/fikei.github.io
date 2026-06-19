-- 083_pipeline_location.sql
-- Add `location` to job.pipeline_roles so Saved/Active/Archive list rows can
-- show location nested under Role — parity with job.recommended_roles, which
-- already carries it. Additive + nullable: safe, no data loss.

alter table job.pipeline_roles add column if not exists location text;

-- Backfill existing pipeline rows from their originating recommendation.
-- Preferred link: recommended_roles.added_to_pipeline_slug → pipeline_roles.slug.
update job.pipeline_roles p
set location = r.location
from job.recommended_roles r
where p.location is null
  and r.location is not null and btrim(r.location) <> ''
  and r.added_to_pipeline_slug = p.slug;

-- Fallback: match on exact posting URL for rows saved before the link existed
-- (e.g. manual pastes that also appeared as recs).
update job.pipeline_roles p
set location = r.location
from job.recommended_roles r
where p.location is null
  and r.location is not null and btrim(r.location) <> ''
  and r.url = p.url;
