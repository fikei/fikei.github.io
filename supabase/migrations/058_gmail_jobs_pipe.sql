-- Gmail → Jobs Pipe, Phase 1 (recommendations only).
-- Adds:
--   1. user_google_tokens — shared Google OAuth token store keyed by
--      (user_id, scope_set) so calendar and gmail track scopes
--      independently and survive partial revocation.
--   2. job.companies — cache of resolved ATS / careers data, the lever
--      that amortizes ATS resolution across users and alerts.
--   3. job.gmail_skipped — log of multi-role digests + parse failures
--      we deliberately did not turn into recommendations, so we can
--      audit and revisit later.
--   4. job.recommended_roles enrichment columns — flag unresolved
--      postings so the widget can render them honestly with a retry
--      timestamp.
--
-- Out of scope this phase: job.contacts, job.connections, network
-- overlay. Those are Phase 2.

-- ---------- 1) user_google_tokens ----------
-- One row per (user_id, scope_set). When a user re-consents to add a
-- scope (e.g. gmail.readonly on top of calendar.readonly), we write a
-- new row rather than mutating the calendar row, so revoking one scope
-- doesn't take down the other.
create table if not exists public.user_google_tokens (
  id                    uuid primary key default gen_random_uuid(),
  user_id               uuid not null references auth.users(id) on delete cascade,
  -- Sorted, comma-joined scope list — e.g.
  -- 'https://www.googleapis.com/auth/gmail.readonly'
  -- or 'https://www.googleapis.com/auth/calendar.events,https://www.googleapis.com/auth/calendar.readonly'.
  -- Sorting at write time keeps lookups deterministic.
  scope_set             text not null,
  google_refresh_token  text not null,
  google_access_token   text,
  token_expires_at      timestamptz,
  -- Google account email this consent is tied to. Helps the UI
  -- disambiguate when a user has multiple Google accounts.
  google_email          text,
  -- Where in the app the consent was granted. Diagnostic only.
  granted_for           text,                       -- 'calendar' | 'gmail-jobs' | 'gmail-jobs+calendar'
  revoked_at            timestamptz,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  unique (user_id, scope_set)
);

create index if not exists user_google_tokens_active_idx
  on public.user_google_tokens (user_id)
  where revoked_at is null;

alter table public.user_google_tokens enable row level security;

-- ---------- 2) job.companies cache ----------
-- name is the canonical display name (case-preserved). domain is the
-- primary marketing/website domain — the join key for "who do I know
-- here" in Phase 2 and the seed for ATS detection in Phase 1.
-- ats_provider is one of {'Greenhouse','Lever','Ashby','Workable',
-- 'Workday','Other'}; ats_slug is the per-provider tenant identifier.
-- resolution_status mirrors the cascade in enrich-job-source.
create table if not exists job.companies (
  id                  uuid primary key default gen_random_uuid(),
  name                text not null,
  -- Lowercase normalized form, used for case-insensitive lookups.
  name_norm           text generated always as (lower(trim(name))) stored,
  domain              text,                          -- 'acme.com' (no scheme, no path)
  ats_provider        text,                          -- null until resolved
  ats_slug            text,
  careers_url         text,
  resolution_status   text not null default 'unresolved'
                       check (resolution_status in ('resolved','unresolved','failed')),
  last_resolved_at    timestamptz,
  -- Backoff for retries on unresolved/failed rows. enrich-job-source
  -- skips a row whose next_retry_at is in the future.
  next_retry_at       timestamptz,
  retry_count         int not null default 0,
  notes               text,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  unique (name_norm)
);

create index if not exists companies_domain_idx
  on job.companies (domain) where domain is not null;
create index if not exists companies_unresolved_idx
  on job.companies (next_retry_at)
  where resolution_status <> 'resolved';

alter table job.companies enable row level security;

-- ---------- 3) job.gmail_skipped ----------
-- When the gmail-jobs plugin chooses NOT to emit a row (multi-role
-- digest, unparseable, no company found), it logs it here with a
-- reason. This keeps the inbox-pipe honest — we can review what we
-- skipped and add fan-out for digest senders later.
create table if not exists job.gmail_skipped (
  id           uuid primary key default gen_random_uuid(),
  user_email   text not null,
  message_id   text not null,                       -- Gmail Message-ID header
  gmail_id     text not null,                       -- Gmail API id (not the same as Message-ID)
  sender       text,
  subject      text,
  reason       text not null,                       -- 'multi_role_digest' | 'no_company' | 'no_url' | 'parse_error' | …
  details      jsonb,                               -- e.g. extracted role count
  skipped_at   timestamptz not null default now(),
  unique (user_email, message_id)
);

create index if not exists gmail_skipped_user_idx
  on job.gmail_skipped (user_email, skipped_at desc);

alter table job.gmail_skipped enable row level security;

-- ---------- 4) recommended_roles enrichment columns ----------
-- Honest-UI surface: when enrich-job-source can't find the canonical
-- JD/apply URL, we still insert the row but flag it so the widget can
-- show a "verifying source" badge. enrichment_retry_at lets the worker
-- re-attempt later without losing the row.
alter table job.recommended_roles
  add column if not exists enrichment_status   text
    check (enrichment_status in ('resolved','unresolved','failed')),
  add column if not exists enrichment_retry_at timestamptz,
  add column if not exists company_id          uuid references job.companies(id) on delete set null,
  add column if not exists canonical_url       text;

create index if not exists recommended_roles_unresolved_idx
  on job.recommended_roles (enrichment_retry_at)
  where enrichment_status <> 'resolved'
    and dismissed_at is null
    and added_to_pipeline_slug is null;

-- ---------- 5) gmail scan cursor ----------
-- Per-user high-water mark so gmail-scan only fetches new messages.
-- Stored as a Gmail historyId (preferred) and a fallback ISO timestamp
-- for first runs / history expiry.
create table if not exists job.gmail_scan_state (
  user_email      text primary key,
  history_id      text,
  last_scan_at    timestamptz,
  last_error      text,
  updated_at      timestamptz not null default now()
);

alter table job.gmail_scan_state enable row level security;
