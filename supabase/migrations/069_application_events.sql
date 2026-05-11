-- Phase 2.0 — Gmail application tracker.
--
-- New event-level metadata for application progress signals classified
-- out of the inbox. Stage taxonomy stays the 4-value enum (drafting →
-- applied → interviewing → offer); per-event granularity lives in
-- application_events.round_label + pipeline_roles.process_outline.
--
-- See: docs/strategy/prds/gmail-application-tracker.md

create table if not exists job.application_events (
  id                uuid primary key default gen_random_uuid(),
  role_slug         text not null references job.pipeline_roles(slug) on delete cascade,
  gmail_message_id  text not null,                    -- RFC822 Message-ID header
  gmail_thread_id   text not null,
  gmail_api_id      text,                             -- for the "source email" link
  sender            text,
  subject           text,
  event_type        text not null check (event_type in (
    'applied_confirmation',
    'screen_scheduled',
    'next_round_invited',
    'take_home_assigned',
    'offer_received',
    'rejection_any_stage',
    'follow_up_needed',
    'interview_rescheduled',
    'informational'
  )),
  detected_stage    text check (detected_stage in ('applied','interviewing','offer','rejected') or detected_stage is null),
  summary           text,                             -- 1-line Haiku summary (NEVER raw body)
  confidence        numeric,                          -- 0..1
  round_label       text,                             -- "phone screen", "onsite #2", etc.
  round_n           int,                              -- when explicit, e.g. "round 2 of 4"
  auto_applied      boolean not null default false,
  needs_review      boolean not null default false,
  reviewed_at       timestamptz,                      -- when the user acted (Action-needed clear)
  received_at       timestamptz not null,
  source            text not null default 'gmail-scan' check (source in ('gmail-scan','gmail-backfill','manual')),
  created_at        timestamptz not null default now(),
  unique (gmail_message_id)
);

create index if not exists ae_role_idx
  on job.application_events (role_slug, received_at desc);
create index if not exists ae_thread_idx
  on job.application_events (gmail_thread_id);
create index if not exists ae_review_idx
  on job.application_events (needs_review) where needs_review;
create index if not exists ae_unreviewed_action_idx
  on job.application_events (role_slug, received_at desc)
  where needs_review and reviewed_at is null;

alter table job.application_events enable row level security;

-- pipeline_roles columns.
--   gmail_thread_ids  — threads associated with this role (poison-resistant:
--                       only persisted after an event lands at conf >= 0.8).
--   last_activity_at  — most recent event received_at, used for stale-14d chip.
--   process_outline   — semi-structured per-role round map; see PRD.
alter table job.pipeline_roles
  add column if not exists gmail_thread_ids text[] not null default '{}',
  add column if not exists last_activity_at timestamptz,
  add column if not exists process_outline  jsonb;

create index if not exists pipeline_roles_thread_gin
  on job.pipeline_roles using gin (gmail_thread_ids);
create index if not exists pipeline_roles_last_activity_idx
  on job.pipeline_roles (last_activity_at desc)
  where last_activity_at is not null;
