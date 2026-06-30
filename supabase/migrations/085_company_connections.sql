-- 085_company_connections.sql
-- Ian's 1st-degree LinkedIn connections who currently work at a given company.
-- Surfaced on /ladder lead detail pages ("People you may know here") and as an
-- avatar stack in the leads table. Joined into jobs-pipe responses as
-- r.connections, keyed on pipeline_roles.company_slug.
--
-- Pilot data was mined manually for 6 companies. See the productization brief at
-- docs/strategy/prds/linkedin-connection-mining.md for the path to automating
-- this (LinkedIn ingestion, photo caching, refresh cadence).

create table if not exists job.company_connections (
  id            uuid primary key default gen_random_uuid(),
  company_slug  text not null,
  full_name     text not null,
  headline      text,
  current_title text,
  profile_url   text not null,
  photo_url     text,
  source        text not null default 'linkedin',
  mined_at      timestamptz not null default now(),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (company_slug, profile_url)
);

create index if not exists company_connections_company_idx
  on job.company_connections (company_slug);

alter table job.company_connections enable row level security;

drop policy if exists company_connections_auth_read on job.company_connections;
create policy company_connections_auth_read
  on job.company_connections for select to authenticated using (true);

comment on table job.company_connections is
  'Ian''s 1st-degree LinkedIn connections who currently work at a given company_slug. Surfaced on /ladder lead detail pages + leads table. Mined manually (pilot).';
