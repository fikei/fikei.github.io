-- Role closures become first-class application events.
--
-- check-liveness previously set legacy status='Closed' + archived_at with
-- no exit_reason and no event row — the Updates-queue notification was a
-- client-side inference with localStorage dismissal (didn't survive
-- devices). Now a closure: archives the role WITH rationale
-- (exit_reason='role_closed') and inserts an application_events row
-- (event_type='role_closed', source='liveness', auto_action=
-- 'archived_closed') so the notification is server-backed and its
-- dismissal persists like every other queue row.

alter table job.application_events
  drop constraint if exists application_events_event_type_check;
alter table job.application_events
  add constraint application_events_event_type_check check (event_type in (
    'applied_confirmation',
    'screen_scheduled',
    'next_round_invited',
    'take_home_assigned',
    'offer_received',
    'rejection_any_stage',
    'follow_up_needed',
    'interview_rescheduled',
    'informational',
    'no_response_timeout',
    'role_closed'
  ));

alter table job.application_events
  drop constraint if exists application_events_source_check;
alter table job.application_events
  add constraint application_events_source_check check (source in (
    'gmail-scan','gmail-backfill','manual','stale-sweep','liveness'
  ));

alter table job.application_events
  drop constraint if exists application_events_auto_action_check;
alter table job.application_events
  add constraint application_events_auto_action_check check (
    auto_action in ('stage_offer','archived','stage_advance','archived_stale','archived_closed')
    or auto_action is null);

-- Backfill: normalize legacy 'Closed' roles into the 3-value taxonomy with
-- the role_closed rationale, and emit events for recent closures (last 7
-- days) so the current notifications become server-backed.
update job.pipeline_roles
   set status      = 'Archive',
       stage       = null,
       exit_reason = coalesce(exit_reason, 'role_closed')
 where closed_detected_at is not null
   and deleted_at is null
   and (status = 'Closed' or exit_reason is null);

insert into job.application_events (
  role_slug, gmail_message_id, gmail_thread_id, event_type,
  summary, auto_applied, needs_review, received_at, source,
  auto_action, prev_state
)
select r.slug,
       'synthetic:role-closed:' || r.slug,
       'synthetic:role-closed:' || r.slug,
       'role_closed',
       'Posting is no longer live — archived automatically',
       true, false, r.closed_detected_at, 'liveness',
       'archived_closed',
       jsonb_build_object('status', 'Saved', 'stage', null, 'exit_reason', null, 'exit_context', null)
  from job.pipeline_roles r
 where r.closed_detected_at > now() - interval '7 days'
   and r.deleted_at is null
on conflict (gmail_message_id) do nothing;
