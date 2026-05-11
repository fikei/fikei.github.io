-- Status taxonomy collapse: 9 statuses → 3 (Saved / Active / Archive)
-- with a sub-stage on Active and an exit_reason on Archive.
--
-- We keep `status` as text (no enum constraint at the DB layer — the
-- frontend + backend validate). Old rows are backfilled into the new
-- 3-value model:
--
--   '' / 'New' / 'Nudge / Network'           → Saved
--   'Apply' / 'Talking' / 'Applied'          → Active + stage mapped
--   'Pass' / 'Rejected' / 'Closed' / 'Not Listed'  → Archive + exit reason mapped
--
-- Stage is set on Active rows only. Saved/Archive rows carry stage=null.
-- exit_reason + exit_context are set on Archive rows only.

alter table job.pipeline_roles
  add column if not exists stage          text,
  add column if not exists exit_reason    text,
  add column if not exists exit_context   text;

-- Backfill in three passes so we don't mutate rows under our own filter.

-- 1) Archive rows
update job.pipeline_roles
   set exit_reason = case status
       when 'Rejected'   then 'rejected_after_interview'
       when 'Pass'       then 'changed_mind'
       when 'Closed'     then 'role_closed'
       when 'Not Listed' then 'role_closed'
       else null
   end,
       status = 'Archive'
 where status in ('Pass', 'Rejected', 'Closed', 'Not Listed');

-- 2) Active rows with sub-stage
update job.pipeline_roles
   set stage = case status
       when 'Apply'   then 'drafting'
       when 'Talking' then 'interviewing'
       when 'Applied' then 'applied'
       else null
   end,
       status = 'Active'
 where status in ('Apply', 'Talking', 'Applied');

-- 3) Saved rows (everything else)
update job.pipeline_roles
   set status = 'Saved'
 where status in ('', 'New', 'Nudge / Network');

-- Catch-all for any rows that don't fit (defensive — shouldn't exist).
update job.pipeline_roles set status = 'Saved' where status is null or status not in ('Saved', 'Active', 'Archive');

create index if not exists pipeline_roles_stage_idx
  on job.pipeline_roles (stage)
  where stage is not null;
