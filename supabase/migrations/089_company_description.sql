-- 089: company_description on job.recommended_roles.
--
-- A short, factual "what this company does" blurb (1-2 sentences), generated
-- by the Haiku grader in pull-recommendations alongside fit_summary. Shown on
-- the review overlay and pre-save rec detail page, right under the role
-- header — the JD itself is collapsed, so this is the only company context
-- in the reading flow. Nullable; older recs backfill on force-regrade only.

alter table job.recommended_roles
  add column if not exists company_description text;
