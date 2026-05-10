-- /job — Search Plan v2 schema.
--
-- v1 stored the entire 02-goals-intents corpus as a single `job.vision` row
-- with a handful of typed columns plus a `raw_md` blob (see migration 047).
-- Most fields were never populated and the /jobs scorer fell back to grep.
--
-- v2 moves to a sections + fields model that mirrors the on-disk convention
-- (`**Label:** value` headers between H1 and first H2). Each markdown file
-- under fikei/job/02-goals-intents/ becomes one row in
-- `job.search_plan_sections`; every parsed field becomes one row in
-- `job.search_plan_fields`. List values (comma/semicolon/slash-separated)
-- are stored as text[] so the scorer can do set intersection against
-- pipeline_roles.sector / sectorTags / title without re-parsing prose.
--
-- A singleton `job.search_plan_summary` denormalizes the most-used fields
-- for the scorer's hot path (compensation floor, geo, stage, primary
-- sectors/titles, deal-breakers). It's refreshed by migrate-job whenever the
-- sections table is upserted.
--
-- Backwards-compat: `job.vision` stays in place for now — migrate-job keeps
-- writing it. A later migration drops it once the scorer + UI are off it.

-- ============================================================================
-- Sections (one row per markdown file)
-- ============================================================================
create table if not exists job.search_plan_sections (
  slug              text primary key,            -- e.g. 'compensation', 'narrative-arc'
  title             text not null,               -- H1 of the file
  category          text not null
                     check (category in ('narrative','goals','intents','filters','other')),
  source_path       text not null,               -- '02-goals-intents/compensation.md'
  body_md           text,                        -- markdown after the fields block
  raw_md            text,                        -- entire file content (audit trail)
  ord               int not null default 0,      -- display order within category
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create index if not exists search_plan_sections_category_idx
  on job.search_plan_sections (category, ord);

-- ============================================================================
-- Fields (one row per **Label:** value line)
-- ============================================================================
create table if not exists job.search_plan_fields (
  section_slug      text not null references job.search_plan_sections(slug) on delete cascade,
  ord               int not null default 0,      -- preserves on-disk order
  label             text not null,               -- exact label, e.g. 'Base floor'
  label_norm        text not null,               -- lowercase, ascii, whitespace-collapsed
  value             text not null,               -- raw string value as written
  value_list        text[],                      -- non-null when value parsed as a list
  -- For monetary fields, parsed cents bounds so the scorer can compare
  -- numerically against pipeline_roles.salary_low/high. Either both null
  -- (not a money field) or both set; if the value is a single point both
  -- equal each other.
  value_min_cents   bigint,
  value_max_cents   bigint,
  -- Free-form classifier so a later trigger can route a field to the
  -- summary row without depending on label spelling alone.
  kind              text check (kind in ('money','list','range','text','date') ),
  updated_at        timestamptz not null default now(),
  primary key (section_slug, ord)
);

create index if not exists search_plan_fields_label_idx
  on job.search_plan_fields (label_norm);

-- ============================================================================
-- Summary (singleton — the scorer's hot path)
-- ============================================================================
-- Populated by migrate-job after sections/fields are upserted. Anything not
-- yet provided by Ian's KB files is null; the scorer treats nulls as "no
-- preference expressed" and falls back to neutral weights.
create table if not exists job.search_plan_summary (
  id                       smallint primary key default 1 check (id = 1),

  -- Compensation (cents, USD assumed)
  base_floor_cents         bigint,
  base_target_cents        bigint,
  total_comp_target_cents  bigint,
  equity_target_pct_low    numeric(6,3),
  equity_target_pct_high   numeric(6,3),
  fractional_day_rate_cents bigint,
  fractional_hourly_cents  bigint,

  -- Geography
  geo_primary              text[] default '{}',  -- ['SF','NYC']
  geo_remote               text,                 -- 'US-only', 'Global', null
  travel_willingness       text,                 -- '2 days/qtr', 'none', etc.

  -- Stage / company shape
  stage_min                text,                 -- 'pre-seed'
  stage_max                text,                 -- 'Series C'
  headcount_min            int,
  headcount_max            int,

  -- Sectors
  sector_primary           text[] default '{}',
  sector_adjacent          text[] default '{}',
  sector_avoid             text[] default '{}',

  -- Titles
  title_primary            text[] default '{}',
  title_adjacent           text[] default '{}',
  title_avoid              text[] default '{}',

  -- Hard filters + voice
  deal_breakers            text[] default '{}',
  narrative_arc_md         text,
  voice_rules_md           text,

  updated_at               timestamptz not null default now()
);

-- Seed the singleton row so callers can `update ... where id = 1` without a
-- prior insert.
insert into job.search_plan_summary (id) values (1) on conflict (id) do nothing;
