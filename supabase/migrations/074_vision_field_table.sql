-- 074_vision_field_table — Phase 1 of the vision data normalization.
-- One row per vision concept in job.vision_field with its own kind /
-- source / attribution / updated_at. Reads still come from job.vision in
-- this phase; writes go to vision_field and mirror back to the matching
-- job.vision column via the sync trigger so the existing reader chain
-- (pull-recommendations, computeFit, etc.) keeps working unchanged.
--
-- Phase 2 migrates readers one-by-one; Phase 3 retires the sync trigger
-- and the legacy columns become a view (or are dropped).

create extension if not exists "pgcrypto";

create table if not exists job.vision_field (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users(id) on delete cascade,
  name          text not null,
  value         jsonb not null default 'null'::jsonb,
  kind          text not null check (kind in (
                   'string_array','text_md','number','bool','json'
                 )),
  display_name  text,
  description   text,
  examples      jsonb,
  source        text not null default 'user'
                check (source in ('user','agent','migrate-job','import')),
  source_detail jsonb,
  updated_at    timestamptz not null default now(),
  created_at    timestamptz not null default now(),
  unique (user_id, name)
);

create index if not exists vision_field_user_idx    on job.vision_field (user_id);
create index if not exists vision_field_updated_idx on job.vision_field (updated_at desc);

comment on table  job.vision_field is 'Normalized search-preference + vision data. One row per concept. Source of truth in Phase 2+; mirrored to job.vision columns by sync trigger in Phase 1.';
comment on column job.vision_field.name is 'Canonical field name. Matches the legacy job.vision column name 1:1 during the migration.';
comment on column job.vision_field.kind is 'Determines how `value` is interpreted and how the sync trigger casts it back to the legacy job.vision column.';
comment on column job.vision_field.source is 'Who/what wrote this value. ''agent'' = ask-job-agent chat tool. ''migrate-job'' = batch seed. ''user'' = direct UI edit.';

-- ── Sync trigger: vision_field → job.vision ────────────────────────────
-- Writers update vision_field; this trigger keeps the legacy job.vision
-- row in sync so unmigrated readers still see fresh data. Retired in
-- Phase 3 once every reader has switched over.

create or replace function job.vision_field_sync_to_legacy()
returns trigger
language plpgsql
as $fn$
declare
  vid integer;
  arr_value text[];
  txt_value text;
  num_value numeric;
  bool_value boolean;
begin
  select id into vid from job.vision order by updated_at desc limit 1;
  if vid is null then
    insert into job.vision (id) values (1) returning id into vid;
  end if;
  if not exists (
    select 1 from information_schema.columns
     where table_schema = 'job' and table_name = 'vision' and column_name = new.name
  ) then
    return new;
  end if;
  case new.kind
    when 'string_array' then
      arr_value := coalesce(
        (select array_agg(t) from jsonb_array_elements_text(new.value) as t),
        '{}'::text[]
      );
      execute format('update job.vision set %I = $1, updated_at = now() where id = $2', new.name)
        using arr_value, vid;
    when 'text_md' then
      txt_value := new.value #>> '{}';
      execute format('update job.vision set %I = $1, updated_at = now() where id = $2', new.name)
        using txt_value, vid;
    when 'number' then
      num_value := nullif(new.value #>> '{}', '')::numeric;
      execute format('update job.vision set %I = $1, updated_at = now() where id = $2', new.name)
        using num_value, vid;
    when 'bool' then
      bool_value := nullif(new.value #>> '{}', '')::boolean;
      execute format('update job.vision set %I = $1, updated_at = now() where id = $2', new.name)
        using bool_value, vid;
    when 'json' then
      execute format('update job.vision set %I = $1, updated_at = now() where id = $2', new.name)
        using new.value, vid;
    else
      raise notice 'vision_field_sync_to_legacy: unknown kind %', new.kind;
  end case;
  return new;
end
$fn$;

drop trigger if exists vision_field_sync on job.vision_field;
create trigger vision_field_sync
  after insert or update of value on job.vision_field
  for each row
  execute function job.vision_field_sync_to_legacy();

-- ── Seed from job.vision into one row per known field ──────────────────
do $$
declare
  uid uuid;
  vrow job.vision%rowtype;
  jnull jsonb := 'null'::jsonb;
begin
  select user_id into uid from public.user_profile order by onboarding_complete_at desc nulls last limit 1;
  if uid is null then raise notice '074: no user_profile yet — skipping seed'; return; end if;
  select * into vrow from job.vision order by updated_at desc limit 1;
  if vrow.id is null then return; end if;

  insert into job.vision_field (user_id, name, value, kind, display_name, description, source) values
    (uid, 'target_titles',       coalesce(to_jsonb(vrow.target_titles),       jnull), 'string_array', 'Titles I''m targeting',          'Role-title phrases the recommender prefers.', 'migrate-job'),
    (uid, 'target_stages',       coalesce(to_jsonb(vrow.target_stages),       jnull), 'string_array', 'Company stages',                  'Funding stages I''m considering.', 'migrate-job'),
    (uid, 'target_sectors',      coalesce(to_jsonb(vrow.target_sectors),      jnull), 'string_array', 'Sectors',                          'Industries I''m interested in.', 'migrate-job'),
    (uid, 'target_geographies',  coalesce(to_jsonb(vrow.target_geographies),  jnull), 'string_array', 'Geographies',                      'Locations / remote policies.', 'migrate-job'),
    (uid, 'deal_breakers',       coalesce(to_jsonb(vrow.deal_breakers),       jnull), 'string_array', 'Deal-breakers',                    'Hard-stop conditions (consumed by Fit scoring).', 'migrate-job'),
    (uid, 'impact_themes',       coalesce(to_jsonb(vrow.impact_themes),       jnull), 'string_array', 'Impact themes',                    'Mission themes the role should touch.', 'migrate-job'),
    (uid, 'mission_keywords',    coalesce(to_jsonb(vrow.mission_keywords),    jnull), 'string_array', 'Mission keywords',                 'Words I want to see in the company mission.', 'migrate-job'),
    (uid, 'anti_mission_terms',  coalesce(to_jsonb(vrow.anti_mission_terms),  jnull), 'string_array', 'Anti-mission terms',               'Mission signals that disqualify a role.', 'migrate-job'),
    (uid, 'culture_keywords',    coalesce(to_jsonb(vrow.culture_keywords),    jnull), 'string_array', 'Culture keywords',                 'Cultural signals I''m drawn to.', 'migrate-job'),
    (uid, 'interest_tags',       coalesce(to_jsonb(vrow.interest_tags),       jnull), 'string_array', 'Interests',                        'Personal interests that bias recommendations.', 'migrate-job'),
    (uid, 'blocked_titles',      coalesce(to_jsonb(vrow.blocked_titles),      jnull), 'string_array', 'Blocked title patterns',           'Substring-match titles to exclude from recommendations. Written by the chat agent.', 'migrate-job'),
    (uid, 'must_have_keywords',  coalesce(to_jsonb(vrow.must_have_keywords),  jnull), 'string_array', 'Required keywords',                'Phrases a posting must contain to be recommended.', 'migrate-job'),
    (uid, 'narrative_arc',       coalesce(to_jsonb(vrow.narrative_arc),       jnull), 'text_md',      'Narrative arc',                    'The career story I''m telling.', 'migrate-job'),
    (uid, 'voice_rules_md',      coalesce(to_jsonb(vrow.voice_rules_md),      jnull), 'text_md',      'Voice + cover-letter rules',       'How my cover letters should sound.', 'migrate-job'),
    (uid, 'raw_md',              coalesce(to_jsonb(vrow.raw_md),              jnull), 'text_md',      'Raw KB seed (legacy)',             'Original concatenated markdown from the fikei/job KB.', 'migrate-job'),
    (uid, 'comp_floor_base',     coalesce(to_jsonb(vrow.comp_floor_base),     jnull), 'number',       'Base salary floor',                'Minimum acceptable base salary in dollars.', 'migrate-job'),
    (uid, 'comp_floor_total',    coalesce(to_jsonb(vrow.comp_floor_total),    jnull), 'number',       'Total comp floor',                 'Minimum acceptable total comp in dollars.', 'migrate-job'),
    (uid, 'mission_required',    coalesce(to_jsonb(vrow.mission_required),    jnull), 'bool',         'Mission alignment required',       'If true, anti-mission terms hard-fail a role.', 'migrate-job'),
    (uid, 'score_weights',       coalesce(vrow.score_weights,                 jnull), 'json',         'Fit score weights',                'Per-dimension weights for computeFit.', 'migrate-job')
  on conflict (user_id, name) do nothing;
end $$;

alter table job.vision_field enable row level security;

drop policy if exists "vision_field: owner select" on job.vision_field;
create policy "vision_field: owner select" on job.vision_field
  for select using (auth.uid() = user_id);

drop policy if exists "vision_field: owner insert" on job.vision_field;
create policy "vision_field: owner insert" on job.vision_field
  for insert with check (auth.uid() = user_id);

drop policy if exists "vision_field: owner update" on job.vision_field;
create policy "vision_field: owner update" on job.vision_field
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

grant select, insert, update on job.vision_field to authenticated;
