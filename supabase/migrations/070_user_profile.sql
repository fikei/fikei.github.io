-- Phase 1 — /job onboarding flow.
--
-- New table: user_profile. Per-user JSONB seed for Fit scoring
-- (fit.ts UserContext), JD pulls, and cover-letter generation. Keyed by
-- auth.users.id. RLS-enabled — each user only reads/writes their own row.
--
-- Ungates /job from the single-tenant email allowlist that lived in
-- job/js/app.js and supabase/functions/_shared/job-auth.ts. Going forward
-- the runtime check is "user has a user_profile row" rather than
-- "email equals fike101@gmail.com".
--
-- See: docs/strategy/prds/job-onboarding-flow.md

create table if not exists public.user_profile (
  user_id              uuid primary key references auth.users(id) on delete cascade,
  identity             jsonb not null default '{}'::jsonb,
  location             jsonb not null default '{}'::jsonb,
  targeting            jsonb not null default '{}'::jsonb,
  values_seed          jsonb not null default '{}'::jsonb,
  capability           jsonb not null default '{}'::jsonb,
  preferences          jsonb not null default '{}'::jsonb,
  wins                 jsonb not null default '[]'::jsonb,
  onboarding_step      smallint not null default 0,
  onboarding_complete_at timestamptz,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);

comment on table public.user_profile is
  '/job onboarding seed. Drives Fit scoring (fit.ts UserContext), JD pull queries, and cover-letter generation. One row per authenticated user; created on first sign-in to /job.';
comment on column public.user_profile.identity is
  'Name, contact, links. Resume header source.';
comment on column public.user_profile.location is
  'city (user-entered) + inferred region/country/timezone + remotePreference + willingToRelocate[] + workAuth[]. Mirrored to vision/intents.md **Geo:** field.';
comment on column public.user_profile.targeting is
  'targetRoles[], targetSectors[], stagePreference[], compFloor, antiMissionTerms[], missionRequired bool.';
comment on column public.user_profile.values_seed is
  'missionKeywords[], impactThemes[], cultureKeywords[], antiCulture[]. Drives values + culture Fit buckets (40% of score).';
comment on column public.user_profile.capability is
  'skills [{name, years}], pastSectors[], arcTags[], history [{company, title, dates, scope}].';
comment on column public.user_profile.preferences is
  'compFloor, remote/hybrid/onsite, hard-fail toggles. Bound to Stage 4 fast-knobs.';
comment on column public.user_profile.wins is
  '[{headline, metric}]. Haiku-only signal — feeds role-match prompt + cover-letter hooks.';

create index if not exists user_profile_complete_idx
  on public.user_profile (onboarding_complete_at)
  where onboarding_complete_at is not null;

create or replace function public.user_profile_touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists user_profile_touch on public.user_profile;
create trigger user_profile_touch
  before update on public.user_profile
  for each row execute function public.user_profile_touch_updated_at();

alter table public.user_profile enable row level security;

drop policy if exists "user_profile_self_select" on public.user_profile;
create policy "user_profile_self_select"
  on public.user_profile for select
  using (auth.uid() = user_id);

drop policy if exists "user_profile_self_insert" on public.user_profile;
create policy "user_profile_self_insert"
  on public.user_profile for insert
  with check (auth.uid() = user_id);

drop policy if exists "user_profile_self_update" on public.user_profile;
create policy "user_profile_self_update"
  on public.user_profile for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "user_profile_self_delete" on public.user_profile;
create policy "user_profile_self_delete"
  on public.user_profile for delete
  using (auth.uid() = user_id);

-- Seed Ian's row so the ungated auth check doesn't lock him out post-deploy.
insert into public.user_profile (user_id, onboarding_complete_at, onboarding_step)
select id, now(), 5
from auth.users
where lower(email) = 'fike101@gmail.com'
on conflict (user_id) do update
  set onboarding_complete_at = coalesce(public.user_profile.onboarding_complete_at, now()),
      onboarding_step = greatest(public.user_profile.onboarding_step, 5);
