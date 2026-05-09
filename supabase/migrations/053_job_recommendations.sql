-- Recommendations staging. The /jobs skill (or future LinkedIn pull
-- worker) inserts here; the recommendations Edge Function reads.
-- Card layout in /job/jobs/ expects: logo, title, company · location ·
-- salary, posted date, source, 3 bullets explaining the match.
create table if not exists job.recommended_roles (
  id              uuid primary key default gen_random_uuid(),
  source          text not null,                 -- 'linkedin' | 'web' | 'manual'
  source_id       text,                          -- per-source dedup key
  source_label    text,                          -- "Web-sourced", "LinkedIn Recommended"
  url             text not null,
  company         text,
  title           text,
  location        text,                          -- "San Francisco (Hybrid)"
  salary          text,                          -- "$320,000 – $375,000"
  logo_url        text,
  posted_at       timestamptz,                   -- "Posted 1w ago" derived
  description     text,                          -- 1 sentence headline
  match_bullets   jsonb,                         -- array of markdown strings (3 by convention)
  suggested_at    timestamptz not null default now(),
  dismissed_at    timestamptz,
  added_to_pipeline_slug text references job.pipeline_roles(slug) on delete set null,
  payload         jsonb,
  unique (source, source_id)
);

create index if not exists recommended_roles_active_idx
  on job.recommended_roles (suggested_at desc)
  where dismissed_at is null and added_to_pipeline_slug is null;

alter table job.recommended_roles enable row level security;
