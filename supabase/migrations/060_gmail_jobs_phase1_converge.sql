-- Phase 1 converge: collapses the failed/partial state from migrations
-- 058 + 059 into a single idempotent block. Drops the hiring-company
-- cache (deferred to Phase 1.5) and keeps only what Feature 1 needs:
-- OAuth tokens, Gmail scan cursor, skipped-message audit log.
--
-- Safe to run regardless of which earlier patches succeeded.

-- ---------- 1) OAuth token store ----------
create table if not exists public.user_google_tokens (
  id                    uuid primary key default gen_random_uuid(),
  user_id               uuid not null references auth.users(id) on delete cascade,
  scope_set             text not null,
  google_refresh_token  text not null,
  google_access_token   text,
  token_expires_at      timestamptz,
  google_email          text,
  granted_for           text,
  revoked_at            timestamptz,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  unique (user_id, scope_set)
);
create index if not exists user_google_tokens_active_idx
  on public.user_google_tokens (user_id) where revoked_at is null;
alter table public.user_google_tokens enable row level security;

-- ---------- 2) Gmail scan cursor ----------
create table if not exists job.gmail_scan_state (
  user_email      text primary key,
  history_id      text,
  last_scan_at    timestamptz,
  last_error      text,
  updated_at      timestamptz not null default now()
);
alter table job.gmail_scan_state enable row level security;

-- ---------- 3) Skipped message audit log ----------
create table if not exists job.gmail_skipped (
  id           uuid primary key default gen_random_uuid(),
  user_email   text not null,
  message_id   text not null,
  gmail_id     text not null,
  sender       text,
  subject      text,
  reason       text not null,
  details      jsonb,
  skipped_at   timestamptz not null default now(),
  unique (user_email, message_id)
);
create index if not exists gmail_skipped_user_idx
  on job.gmail_skipped (user_email, skipped_at desc);
alter table job.gmail_skipped enable row level security;

-- ---------- 4) Clean up the cache attempt ----------
-- 058 added enrichment columns to recommended_roles + tried to point at
-- a job.companies cache. We're deferring the cache to Phase 1.5, so:
--   - drop the cache table if it got created (was empty, no data loss)
--   - drop the FK on recommended_roles.company_id if it exists
--   - leave the orphan columns nullable; they're harmless and Phase
--     1.5 will use them.
drop table if exists job.hiring_companies cascade;

alter table job.recommended_roles
  drop constraint if exists recommended_roles_company_id_fkey;

-- 058 also added 9 cache columns to job.companies (the career-history
-- table). They were never populated. Dropping reverts the schema to
-- what it was before 058 touched it.
alter table job.companies drop column if exists domain;
alter table job.companies drop column if exists ats_provider;
alter table job.companies drop column if exists ats_slug;
alter table job.companies drop column if exists careers_url;
alter table job.companies drop column if exists resolution_status;
alter table job.companies drop column if exists last_resolved_at;
alter table job.companies drop column if exists next_retry_at;
alter table job.companies drop column if exists retry_count;
alter table job.companies drop column if exists notes;
alter table job.companies drop constraint if exists companies_resolution_status_check;
drop index if exists job.companies_domain_idx;
drop index if exists job.companies_unresolved_idx;
