-- 105_application_answers.sql — Easy Apply answer bank (Phase 16.2a).
--
-- One row per (user_id, canonical_key). Keys come from the canonical
-- registry in supabase/functions/_shared/answer-bank.ts (Tier 1–4 of the
-- PRD's onboarding capture set). Values are jsonb — text, boolean, number,
-- or structured (onsite_willingness rules, comp_expectation policy).
--
-- Access goes through the application-answers edge function (service role +
-- per-user auth), mirroring job.application_draft; the job schema isn't
-- exposed via PostgREST.

create table if not exists job.application_answers (
  user_id       uuid not null,
  canonical_key text not null,
  value         jsonb not null,
  source        text not null default 'onboarding'
                check (source in ('onboarding','resume_extract','derived','writeback')),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  primary key (user_id, canonical_key)
);

comment on table job.application_answers is
  'Easy Apply answer bank: canonical application answers per user. Registry in _shared/answer-bank.ts.';
