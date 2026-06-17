-- 081: job.blocked_companies — per-user "don't recommend this company" list.
--
-- Driven by the For You row menu ("Don't recommend this company"). Recs from
-- a blocked company are hidden at read time AND filtered at pull time so they
-- don't re-accumulate. Keyed by user_email (same key recommended_roles uses)
-- so the recommendations function can filter without resolving auth user ids.

create table if not exists job.blocked_companies (
  user_email   text not null,
  company_norm text not null,          -- lower(trim(company))
  created_at   timestamptz not null default now(),
  primary key (user_email, company_norm)
);

comment on table job.blocked_companies is
  'Per-user blocked companies — recs from these are hidden in For You and filtered at pull time.';
