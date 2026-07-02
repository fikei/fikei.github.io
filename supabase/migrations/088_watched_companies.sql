-- 088: job.watched_companies — green-lit direct company sources.
--
-- Each row is a company the user explicitly watches. The company-watch
-- source plugin pulls open roles straight from the company's careers
-- backend (Google embedded JSON, Amazon search.json, Workday CXS,
-- Eightfold, Apple hydration JSON, or a Greenhouse/Lever/Ashby board)
-- and inserts them into job.recommended_roles like any other source.
--
-- filter_mode controls when the company's roles surface in the For You
-- carousel (the full list always shows everything active):
--   'all'         → every role the watch pulls
--   'role_level'  → roles that match the user's role & level (Haiku
--                   role-match ≥13/25 and not below seniority), no
--                   fit/candidate floors
--   'good_fits'   → the standard For You gates (default)
--   'exceptional' → candidate_score ≥ 60 only ("really good fits")

create table if not exists job.watched_companies (
  id             uuid primary key default gen_random_uuid(),
  user_email     text not null,
  company        text not null,                  -- display name, e.g. "Google"
  company_norm   text not null,                  -- lower(trim(company)) — dedup key
  adapter        text not null,                  -- 'google' | 'amazon' | 'workday' | 'eightfold' | 'apple' | 'greenhouse' | 'lever' | 'ashby'
  adapter_config jsonb not null default '{}',    -- per-adapter settings (query, host/tenant/site, slug, …)
  filter_mode    text not null default 'good_fits'
                 check (filter_mode in ('all', 'role_level', 'good_fits', 'exceptional')),
  title_keywords text[] not null default '{}',   -- optional extra include filter (any-match, substring)
  locations      text[] not null default '{}',   -- optional location filter (any-match, substring)
  enabled        boolean not null default true,
  created_at     timestamptz not null default now(),
  last_pulled_at timestamptz,
  last_pull_count integer,
  last_error     text,
  unique (user_email, company_norm)
);

comment on table job.watched_companies is
  'Green-lit companies watched via direct careers-page sources. filter_mode gates For You surfacing per company.';

alter table job.watched_companies enable row level security;

-- Link recs back to the watch that produced them so the recommendations
-- read path can apply the watch''s live filter_mode without re-pulling.
alter table job.recommended_roles
  add column if not exists watched_company_id uuid references job.watched_companies(id) on delete set null;

create index if not exists recommended_roles_watched_idx
  on job.recommended_roles (watched_company_id)
  where watched_company_id is not null;
