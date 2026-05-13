-- 075 — Phase 3 cutover for the vision normalization.
--
-- Phase 2 (PR #848) migrated every reader to go through job.vision_field
-- via the _shared/job-vision.ts helper. The sync trigger that mirrored
-- vision_field → job.vision was kept as a safety net during that phase.
-- This migration:
--   1. Drops the sync trigger (no more mirroring needed).
--   2. Replaces the job.vision table with a backwards-compat view derived
--      from job.vision_field. Source of truth is now the field table; any
--      reader that still does `SELECT col FROM job.vision` keeps working
--      but is invisibly routed to the new layout.
--   3. Drops the dead trigger function from migration 073 (the
--      field_updated_at jsonb map approach — superseded by
--      vision_field.updated_at per-row).
--
-- A snapshot table job.vision_legacy_snapshot_20260513 holds the legacy
-- row in case any reader we missed needs to be triaged before the view
-- is trusted in production. Drop the snapshot after a few weeks.

drop trigger if exists vision_field_sync on job.vision_field;
drop function if exists job.vision_field_sync_to_legacy();

create table if not exists job.vision_legacy_snapshot_20260513 as
  select * from job.vision;
comment on table job.vision_legacy_snapshot_20260513 is
  'Snapshot of job.vision taken at Phase 3 cutover (migration 075). Drop after a few weeks of stable operation.';

drop table job.vision cascade;

create or replace view job.vision as
  select
    1::int as id,
    (select (value #>> '{}')::text                                   from job.vision_field where name = 'narrative_arc'      limit 1) as narrative_arc,
    (select array(select jsonb_array_elements_text(value))::text[]   from job.vision_field where name = 'target_titles'      limit 1) as target_titles,
    (select array(select jsonb_array_elements_text(value))::text[]   from job.vision_field where name = 'target_stages'      limit 1) as target_stages,
    (select array(select jsonb_array_elements_text(value))::text[]   from job.vision_field where name = 'target_sectors'     limit 1) as target_sectors,
    (select array(select jsonb_array_elements_text(value))::text[]   from job.vision_field where name = 'target_geographies' limit 1) as target_geographies,
    (select nullif(value #>> '{}', '')::int                          from job.vision_field where name = 'comp_floor_base'    limit 1) as comp_floor_base,
    (select nullif(value #>> '{}', '')::int                          from job.vision_field where name = 'comp_floor_total'   limit 1) as comp_floor_total,
    (select array(select jsonb_array_elements_text(value))::text[]   from job.vision_field where name = 'deal_breakers'      limit 1) as deal_breakers,
    (select (value #>> '{}')::text                                   from job.vision_field where name = 'voice_rules_md'     limit 1) as voice_rules_md,
    (select (value #>> '{}')::text                                   from job.vision_field where name = 'raw_md'             limit 1) as raw_md,
    (select greatest(max(updated_at), now() - interval '100 years')  from job.vision_field) as updated_at,
    (select array(select jsonb_array_elements_text(value))::text[]   from job.vision_field where name = 'impact_themes'      limit 1) as impact_themes,
    (select array(select jsonb_array_elements_text(value))::text[]   from job.vision_field where name = 'mission_keywords'   limit 1) as mission_keywords,
    (select nullif(value #>> '{}', '')::boolean                      from job.vision_field where name = 'mission_required'   limit 1) as mission_required,
    (select array(select jsonb_array_elements_text(value))::text[]   from job.vision_field where name = 'anti_mission_terms' limit 1) as anti_mission_terms,
    (select array(select jsonb_array_elements_text(value))::text[]   from job.vision_field where name = 'culture_keywords'   limit 1) as culture_keywords,
    (select array(select jsonb_array_elements_text(value))::text[]   from job.vision_field where name = 'interest_tags'      limit 1) as interest_tags,
    (select value                                                     from job.vision_field where name = 'score_weights'      limit 1) as score_weights,
    (select array(select jsonb_array_elements_text(value))::text[]   from job.vision_field where name = 'blocked_titles'     limit 1) as blocked_titles,
    (select array(select jsonb_array_elements_text(value))::text[]   from job.vision_field where name = 'must_have_keywords' limit 1) as must_have_keywords
;

comment on view job.vision is
  'Backwards-compatibility view over job.vision_field. Source of truth is the field table; readers that still SELECT from job.vision keep working but should migrate to loadVisionField()/loadVisionFields(). Read-only — writes must go through vision_field.';

grant select on job.vision to authenticated;

drop function if exists job.vision_track_field_updates();
