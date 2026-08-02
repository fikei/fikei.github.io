-- 159_applicant_uuid.sql
-- Every applicant gets a stable machine identifier alongside the
-- human-readable id. New ids (recruit-ingest v1.5.0) are normalized name
-- slugs ("jane-doe", numbered "jane-doe-2" on duplicate names); legacy
-- "<slug>-YYYYMMDDHHMMSS" ids are left untouched so posted links keep
-- working. The uuid never changes even if display ids are ever cleaned up.

alter table public.recruit_applicants
  add column if not exists uuid uuid not null default gen_random_uuid();

create unique index if not exists recruit_applicants_uuid_idx
  on public.recruit_applicants (uuid);
