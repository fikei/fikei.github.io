-- Sector tag normalization. Free-text sector strings on pipeline_roles
-- (e.g. "Healthcare AI", "Mental Health / AI", "Legal AI") get parsed into
-- atomic tags and joined many-to-many.
create table if not exists job.sector_tags (
  slug        text primary key,                    -- 'healthcare', 'ai', 'legal'
  name        text not null,                       -- canonical display name
  category    text,                                -- optional grouping ('industry' | 'modality' | …)
  created_at  timestamptz not null default now()
);

create table if not exists job.role_sector_tags (
  role_slug   text references job.pipeline_roles(slug) on delete cascade,
  tag_slug    text references job.sector_tags(slug) on delete cascade,
  primary key (role_slug, tag_slug)
);

create index if not exists role_sector_tags_tag_idx on job.role_sector_tags (tag_slug);

alter table job.sector_tags enable row level security;
alter table job.role_sector_tags enable row level security;
