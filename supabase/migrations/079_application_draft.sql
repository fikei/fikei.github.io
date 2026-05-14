-- 079 — Application draft state for the /job Apply takeover flow.
--
-- One row per (user, role-slug). Stores the extracted field schema,
-- the user's in-progress answers (AI drafts + edits + annotations),
-- the current wizard step, and a status enum so we can later filter
-- "drafts in flight" vs "submitted."
--
-- Pure JSONB blobs so the wizard schema can evolve without migrations.

create table if not exists job.application_draft (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users(id) on delete cascade,
  role_slug     text not null,
  apply_url     text,
  ats           text,
  fields        jsonb not null default '{}'::jsonb,
  answers       jsonb not null default '{}'::jsonb,
  current_step  text not null default 'general',
  status        text not null default 'draft',
  extracted_at  timestamptz,
  submitted_at  timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (user_id, role_slug)
);

create index if not exists application_draft_user_updated_idx
  on job.application_draft (user_id, updated_at desc);

comment on table  job.application_draft is 'In-progress Apply-flow state per (user, role). Survives reloads; one row per role-slug.';
comment on column job.application_draft.fields  is 'Normalized extracted application schema (see extract-application-fields edge function): {general:[…], custom_questions:[…], requires:{resume,cover_letter}}';
comment on column job.application_draft.answers is 'User-edited + AI-drafted answers keyed by field id, plus annotation state (rationale/opportunities) per question.';
comment on column job.application_draft.ats    is 'Detected ATS provider (greenhouse|lever|ashby|workday|other|unknown).';

create or replace function job.application_draft_touch()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

drop trigger if exists application_draft_touch on job.application_draft;
create trigger application_draft_touch
  before update on job.application_draft
  for each row execute function job.application_draft_touch();

alter table job.application_draft enable row level security;

drop policy if exists "application_draft: owner select" on job.application_draft;
create policy "application_draft: owner select" on job.application_draft
  for select using (auth.uid() = user_id);

drop policy if exists "application_draft: owner insert" on job.application_draft;
create policy "application_draft: owner insert" on job.application_draft
  for insert with check (auth.uid() = user_id);

drop policy if exists "application_draft: owner update" on job.application_draft;
create policy "application_draft: owner update" on job.application_draft
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "application_draft: owner delete" on job.application_draft;
create policy "application_draft: owner delete" on job.application_draft
  for delete using (auth.uid() = user_id);

grant select, insert, update, delete on job.application_draft to authenticated;
