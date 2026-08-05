-- 164: allow auto_action='role_created' on application_events.
-- The auto-create paths (unmatched receipts since v0.29, engaged-thread
-- discovery since v0.30) insert events with auto_action='role_created',
-- but migration 103's CHECK never included it — the insert threw, the
-- role row survived (inserted just before), and the exception aborted
-- the rest of the scan run.

alter table job.application_events
  drop constraint application_events_auto_action_check;

alter table job.application_events
  add constraint application_events_auto_action_check
  check (auto_action in ('stage_offer', 'archived', 'stage_advance',
                         'archived_stale', 'archived_closed', 'role_created')
         or auto_action is null);
