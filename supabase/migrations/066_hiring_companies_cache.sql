-- Phase 1.5 enrichment: hiring_companies cache.
--
-- Resolves a (company, title) pair from a Gmail alert to a canonical
-- Greenhouse / Lever / Ashby posting. Cached per company so the cascade
-- (probe-3-ATSes) only runs once per company across all recs/users.
--
-- Separate from job.companies (which is career-history). Naming
-- collision in Phase 1 cost us a session; keep it firewalled.

create table if not exists job.hiring_companies (
  id                  uuid primary key default gen_random_uuid(),
  name                text not null,
  name_norm           text generated always as (lower(trim(name))) stored,
  domain              text,                          -- 'acme.com'
  ats_provider        text,                          -- 'Greenhouse' | 'Lever' | 'Ashby' | null
  ats_slug            text,
  careers_url         text,
  resolution_status   text not null default 'unresolved'
                       check (resolution_status in ('resolved','unresolved','failed')),
  last_resolved_at    timestamptz,
  next_retry_at       timestamptz,
  retry_count         int not null default 0,
  notes               text,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  unique (name_norm)
);

create index if not exists hiring_companies_domain_idx
  on job.hiring_companies (domain) where domain is not null;
create index if not exists hiring_companies_unresolved_idx
  on job.hiring_companies (next_retry_at)
  where resolution_status <> 'resolved';

alter table job.hiring_companies enable row level security;

-- recommended_roles.company_id was added in migration 058 without an FK
-- (the cache table didn't exist yet). Wire it up now.
do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conname = 'recommended_roles_company_id_fkey'
       and conrelid = 'job.recommended_roles'::regclass
  ) then
    alter table job.recommended_roles
      add constraint recommended_roles_company_id_fkey
      foreign key (company_id) references job.hiring_companies(id) on delete set null;
  end if;
end$$;
