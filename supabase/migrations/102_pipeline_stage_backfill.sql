-- 102_pipeline_stage_backfill.sql
-- The four in-progress stages (Drafting / Applied / Interviewing / Offer) are
-- now first-class bucket pages in the Ladder pipeline nav, derived from
-- job.pipeline_roles.stage on Active rows. Any Active row without a stage would
-- have no bucket to live in, so give every stage-less Active row the pipeline
-- entry point, 'drafting'. Idempotent — safe to re-run.
--
-- Going forward the jobs-pipe edge function (v0.16.0+) guarantees every Active
-- row gets a stage on write; this backfills the rows that predate that rule.

update job.pipeline_roles
   set stage = 'drafting',
       updated_at = now()
 where status = 'Active'
   and stage is null;
