-- Updates queue — proactive resolution (rev 2 of the post-application journey).
--
-- The scan now ACTS on high-confidence outcomes (offer → stage=offer,
-- rejection → Archive with a mapped exit_reason) instead of parking them
-- behind needs_review. Every auto/prompted action stores the role's
-- prior state on the event row so Undo works from the Updates feed at
-- any time — no transient token, no toast window.
--
--   auto_action  — what the system (or a one-click prompt) did:
--                  'stage_offer' | 'archived' | 'stage_advance' | 'archived_stale'
--   prev_state   — { status, stage, exit_reason, exit_context } before the action
--   undone_at    — user reverted the action from the feed
--   dismissed_at — user acknowledged (×) the feed row; server-persisted so
--                  dismissals survive devices/reloads (replaces localStorage)
--
-- 'no_response_timeout' is the synthetic event type for the 30-day quiet
-- sweep (Active+applied roles with no signal → auto-archived as
-- applied_no_response). Synthetic events carry sentinel gmail ids.

alter table job.application_events
  add column if not exists auto_action  text check (auto_action in ('stage_offer','archived','stage_advance','archived_stale') or auto_action is null),
  add column if not exists prev_state   jsonb,
  add column if not exists undone_at    timestamptz,
  add column if not exists dismissed_at timestamptz;

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
    'no_response_timeout'
  ));

alter table job.application_events
  drop constraint if exists application_events_source_check;
alter table job.application_events
  add constraint application_events_source_check check (source in (
    'gmail-scan','gmail-backfill','manual','stale-sweep'
  ));

-- Feed query: recent actionable/undoable rows not yet acknowledged.
create index if not exists ae_updates_feed_idx
  on job.application_events (received_at desc)
  where dismissed_at is null and undone_at is null;
