// Bundled schema for migrate-job. Mirrors 047–053 from supabase/migrations.
export const SCHEMA_SQL = String.raw`
-- /job product schema (Phase 2 migration foundation).
-- Tables live in their own schema to avoid colliding with Boards.
-- Seeded by a one-shot Edge Function that reads the existing Google
-- Sheet + fikei/job repo + local desktop assets uploaded via API.

create schema if not exists job;

-- ============================================================================
-- Career KB
-- ============================================================================

create table if not exists job.companies (
  slug              text primary key,
  name              text not null,
  sector            text,
  stage_at_time     text,
  tenure_start      date,
  tenure_end        date,                                -- null = "Present"
  location          text,
  body_md           text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create table if not exists job.projects (
  slug              text primary key,
  company_slug      text references job.companies(slug) on delete set null,
  title             text not null,
  start_date        date,
  end_date          date,
  role              text,
  team_size         text,
  status            text,
  body_md           text,
  metric_value      text,
  updated_at        timestamptz not null default now()
);

create table if not exists job.skills (
  slug              text primary key,
  name              text not null,
  type              text,                                -- craft | strategic | technical | leadership
  level             text,                                -- foundational | working | expert | world-class
  years_practiced   int,
  body_md           text,
  cover_letter_blurb text,
  updated_at        timestamptz not null default now()
);

create table if not exists job.wins (
  slug              text primary key,
  company_slug      text references job.companies(slug) on delete set null,
  project_slug      text references job.projects(slug) on delete set null,
  headline          text not null,
  body_md           text,
  metric_value      text,
  occurred_at       date,
  updated_at        timestamptz not null default now()
);

create table if not exists job.project_skills (
  project_slug      text references job.projects(slug) on delete cascade,
  skill_slug        text references job.skills(slug) on delete cascade,
  primary key (project_slug, skill_slug)
);

create table if not exists job.win_skills (
  win_slug          text references job.wins(slug) on delete cascade,
  skill_slug        text references job.skills(slug) on delete cascade,
  primary key (win_slug, skill_slug)
);

-- ============================================================================
-- Vision (single-row in v1; flip the constraint to support multi-vision later)
-- ============================================================================

create table if not exists job.vision (
  id                int primary key default 1 check (id = 1),
  narrative_arc     text,
  target_titles     text[] default '{}',
  target_stages     text[] default '{}',
  target_sectors    text[] default '{}',
  target_geographies text[] default '{}',
  comp_floor_base   int,
  comp_floor_total  int,
  deal_breakers     text[] default '{}',
  voice_rules_md    text,
  raw_md            text,
  updated_at        timestamptz not null default now()
);

-- ============================================================================
-- Pipeline
-- ============================================================================

create table if not exists job.tracked_companies (
  slug              text primary key,
  name              text not null,
  sector            text,
  presence          text,
  website_url       text,
  careers_url       text,
  ats               text,                                -- 'Greenhouse' | 'Ashby' | 'Lever' | 'Workday' | 'Other'
  ats_slug          text,
  notes             text,
  updated_at        timestamptz not null default now()
);

create table if not exists job.pipeline_roles (
  id                uuid primary key default gen_random_uuid(),
  slug              text unique not null,                -- stable; survives sheet edits
  source_row        int,                                 -- original Roles row for audit
  company_slug      text references job.tracked_companies(slug) on delete set null,
  company_name      text not null,
  title             text not null,
  url               text,
  source            text,                                -- LinkedIn Saved | Network | …
  status            text not null default 'New',
  contact           text,
  salary_range      text,
  salary_low        int,
  salary_high       int,
  sector            text,
  geo               text,
  stage             text,
  investors         text[] default '{}',
  fit_score         int,
  fit_breakdown     jsonb,
  hard_fails        text[] default '{}',
  first_seen        date default current_date,
  last_seen         date,
  miss_count        int default 0,
  applied_at        timestamptz,
  status_changed_at timestamptz,
  status_history    jsonb default '[]'::jsonb,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create index if not exists pipeline_roles_status_idx on job.pipeline_roles (status);
create index if not exists pipeline_roles_fit_idx    on job.pipeline_roles (fit_score desc);

-- ============================================================================
-- Per-role workspace
-- ============================================================================

create table if not exists job.role_assets (
  role_slug         text references job.pipeline_roles(slug) on delete cascade,
  kind              text not null check (kind in ('resume', 'cover-letter', 'notes')),
  content_md        text not null,
  source_path       text,                                -- e.g. ~/Desktop/IanFike_Resume_Stedi.pdf for imported PDFs
  generated_by      text,                                -- 'claude-haiku-4-5' | 'manual' | 'imported-pdf'
  generated_at      timestamptz,
  edited_at         timestamptz,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  primary key (role_slug, kind)
);

-- ============================================================================
-- updated_at triggers
-- ============================================================================

create or replace function job.touch_updated_at() returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end $$;

do $$
declare t text;
begin
  for t in select unnest(array[
    'companies','projects','skills','wins','vision',
    'tracked_companies','pipeline_roles','role_assets'
  ]) loop
    execute format($f$
      drop trigger if exists touch_%I on job.%I;
      create trigger touch_%I before update on job.%I
        for each row execute function job.touch_updated_at();
    $f$, t, t, t, t);
  end loop;
end $$;

-- ============================================================================
-- RLS — single allowlisted user (fike101) reads + writes through Edge Functions.
-- Edge Functions use the service-role key, which bypasses RLS, so we keep
-- RLS enabled but no broad policies.
-- ============================================================================

do $$
declare t text;
begin
  for t in select unnest(array[
    'companies','projects','skills','wins','project_skills','win_skills',
    'vision','tracked_companies','pipeline_roles','role_assets'
  ]) loop
    execute format('alter table job.%I enable row level security;', t);
  end loop;
end $$;
-- 048 ----------------------------------------------------------------
-- Allow analysis as a role_assets kind. The detail page stores Claude's
-- structured analysis (brief, why-fits, risks, candidate-strength) here.
alter table job.role_assets drop constraint if exists role_assets_kind_check;
alter table job.role_assets add constraint role_assets_kind_check
  check (kind in ('resume', 'cover-letter', 'notes', 'analysis'));
-- 049 ----------------------------------------------------------------
-- Soft-archive flag for pipeline_roles. archived_at IS NULL means active;
-- a non-null timestamp means the row is archived (hidden from the default
-- pipeline view).
alter table job.pipeline_roles
  add column if not exists archived_at timestamptz;

create index if not exists pipeline_roles_archived_idx
  on job.pipeline_roles (archived_at)
  where archived_at is not null;
-- 050 ----------------------------------------------------------------
-- Sector tag normalization. Free-text sector strings on pipeline_roles
-- (e.g. "Healthcare AI", "Mental Health / AI", "Legal AI") get parsed into
-- atomic tags and joined many-to-many.
create table if not exists job.sector_tags (
  slug        text primary key,                    -- 'healthcare', 'ai', 'legal'
  name        text not null,                       -- canonical display name
  category    text,                                -- optional grouping ('industry' | 'modality' | …)
  created_at  timestamptz not null default now()
);

create table if not exists job.role_sector_tags (
  role_slug   text references job.pipeline_roles(slug) on delete cascade,
  tag_slug    text references job.sector_tags(slug) on delete cascade,
  primary key (role_slug, tag_slug)
);

create index if not exists role_sector_tags_tag_idx on job.role_sector_tags (tag_slug);

alter table job.sector_tags enable row level security;
alter table job.role_sector_tags enable row level security;
-- 051 ----------------------------------------------------------------
-- Soft-delete column for pipeline_roles. Hidden from every UI surface
-- (no filter exposes it), kept in DB for continuity / undo.
alter table job.pipeline_roles
  add column if not exists deleted_at timestamptz;

create index if not exists pipeline_roles_deleted_idx
  on job.pipeline_roles (deleted_at)
  where deleted_at is null;
-- 052 ----------------------------------------------------------------
-- Liveness tracking for pipeline_roles. A background job HEADs each URL
-- on a cadence; rows that 404 (or otherwise become unreachable) get
-- closed_detected_at stamped, status flipped to 'Closed', and archived.
alter table job.pipeline_roles
  add column if not exists liveness_checked_at timestamptz,
  add column if not exists is_live boolean,
  add column if not exists liveness_status_code int,
  add column if not exists closed_detected_at timestamptz;

create index if not exists pipeline_roles_liveness_idx
  on job.pipeline_roles (liveness_checked_at nulls first)
  where deleted_at is null;
-- 053 ----------------------------------------------------------------
-- Recommendations staging. The /jobs skill (or future LinkedIn pull
-- worker) inserts here; the recommendations Edge Function reads.
-- Card layout in /job/jobs/ expects: logo, title, company · location ·
-- salary, posted date, source, 3 bullets explaining the match.
create table if not exists job.recommended_roles (
  id              uuid primary key default gen_random_uuid(),
  source          text not null,                 -- 'linkedin' | 'web' | 'manual'
  source_id       text,                          -- per-source dedup key
  source_label    text,                          -- "Web-sourced", "LinkedIn Recommended"
  url             text not null,
  company         text,
  title           text,
  location        text,                          -- "San Francisco (Hybrid)"
  salary          text,                          -- "$320,000 – $375,000"
  logo_url        text,
  posted_at       timestamptz,                   -- "Posted 1w ago" derived
  description     text,                          -- 1 sentence headline
  match_bullets   jsonb,                         -- array of markdown strings (3 by convention)
  suggested_at    timestamptz not null default now(),
  dismissed_at    timestamptz,
  added_to_pipeline_slug text references job.pipeline_roles(slug) on delete set null,
  payload         jsonb,
  unique (source, source_id)
);

alter table job.recommended_roles
  add column if not exists fit_score      int,
  add column if not exists fit_breakdown  jsonb,
  add column if not exists hard_fails     text[] default '{}',
  add column if not exists sector         text,
  add column if not exists investors      text[] default '{}',
  add column if not exists user_email     text,
  add column if not exists user_source_id uuid;

create index if not exists recommended_roles_active_idx
  on job.recommended_roles (suggested_at desc)
  where dismissed_at is null
    and added_to_pipeline_slug is null
    and (fit_score is null or fit_score >= 50);

alter table job.recommended_roles enable row level security;

-- User-configured recommendation sources (see migration 054).
create table if not exists job.user_sources (
  id              uuid primary key default gen_random_uuid(),
  user_email      text not null,
  type            text not null,
  label           text,
  config          jsonb not null default '{}'::jsonb,
  enabled         boolean not null default true,
  schedule_cron   text not null default '0 */6 * * *',
  min_score       int not null default 50,
  last_run_at     timestamptz,
  last_run_count  int,
  last_dropped    int,
  last_error      text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
alter table job.user_sources enable row level security;

-- Backfill ats / ats_slug on tracked_companies from any pipeline_roles
-- URL we already have. Idempotent: only updates rows where the field
-- is still null. Safe to re-run on every schema apply.
with derived as (
  select distinct on (pr.company_slug)
    pr.company_slug,
    case
      when pr.url ~* 'boards\\.greenhouse\\.io/[^/]+'                  then 'Greenhouse'
      when pr.url ~* 'jobs\\.lever\\.co/[^/]+'                         then 'Lever'
      when pr.url ~* 'jobs\\.ashbyhq\\.com/[^/]+'                      then 'Ashby'
    end as ats,
    case
      when pr.url ~* 'boards\\.greenhouse\\.io/([^/?#]+)'
        then substring(pr.url from 'boards\\.greenhouse\\.io/([^/?#]+)')
      when pr.url ~* 'jobs\\.lever\\.co/([^/?#]+)'
        then substring(pr.url from 'jobs\\.lever\\.co/([^/?#]+)')
      when pr.url ~* 'jobs\\.ashbyhq\\.com/([^/?#]+)'
        then substring(pr.url from 'jobs\\.ashbyhq\\.com/([^/?#]+)')
    end as ats_slug
  from job.pipeline_roles pr
  where pr.company_slug is not null
    and pr.url is not null
    and pr.url ~* '(boards\\.greenhouse\\.io|jobs\\.lever\\.co|jobs\\.ashbyhq\\.com)/'
)
update job.tracked_companies tc
   set ats      = coalesce(tc.ats, d.ats),
       ats_slug = coalesce(tc.ats_slug, d.ats_slug),
       updated_at = now()
  from derived d
 where d.company_slug = tc.slug
   and (tc.ats is null or tc.ats_slug is null);
`;
