-- 106_easy_apply_submissions.sql — Easy Apply submissions (Phase 16.2c).
--
-- application_events gains the 'easy-apply' source so submissions emit a
-- first-class applied_confirmation event (synthetic gmail ids; the real
-- confirmation email is later corroborated by the Gmail tracker).

alter table job.application_events drop constraint if exists application_events_source_check;
alter table job.application_events add constraint application_events_source_check
  check (source = any (array['gmail-scan','gmail-backfill','manual','stale-sweep','easy-apply']));
