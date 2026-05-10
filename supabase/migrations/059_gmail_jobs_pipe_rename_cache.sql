-- Fix migration 058: cache table collided with the existing
-- job.companies table (which is your *career history* — companies
-- you've worked at, keyed by slug). Move the hiring-side ATS cache
-- into a new job.hiring_companies table so the two concepts don't
-- share columns or rows.
--
-- Idempotent: safe whether or not 058 ran cleanly.

-- 1) Revert the columns 058 added to job.companies (the career-history
--    table). They were never populated and don't belong there.
alter table job.companies drop column if exists domain;
alter table job.companies drop column if exists ats_provider;
alter table job.companies drop column if exists ats_slug;
alter table job.companies drop column if exists careers_url;
alter table job.companies drop column if exists resolution_status;
alter table job.companies drop column if exists last_resolved_at;
alter table job.companies drop column if exists next_retry_at;
alter table job.companies drop column if exists retry_count;
alter table job.companies drop column if exists notes;

-- Drop the constraint we may have added in the cleanup pass.
alter table job.companies drop constraint if exists companies_resolution_status_check;

-- Drop indexes that referenced reverted columns.
drop index if exists job.companies_domain_idx;
drop index if exists job.companies_unresolved_idx;

-- 2) Create the real cache table.
create table if not exists job.hiring_companies (
  id                  uuid primary key default gen_random_uuid(),
  name                text not null,
  name_norm           text generated always as (lower(trim(name))) stored,
  domain              text,
  ats_provider        text,
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

-- 3) recommended_roles.company_id should reference the new table.
--    The column was added by 058 (without the FK because the target
--    didn't have an `id`). Add the FK now that the target exists.
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
