-- Daily cache for paid source plugins. Keyed by (source, config_hash,
-- date) so manual re-runs (e.g. tweaking the title filter or scoring
-- logic) don't burn API budget. The plugin checks the cache first and
-- only hits the upstream API on the first call of the day for a given
-- config.

create table if not exists job.source_cache (
  source        text not null,
  config_hash   text not null,
  fetched_on    date not null default current_date,
  raw           jsonb not null,
  fetched_count int,
  fetched_at    timestamptz not null default now(),
  primary key (source, config_hash, fetched_on)
);

create index if not exists source_cache_recent_idx
  on job.source_cache (source, fetched_on desc);

alter table job.source_cache enable row level security;
