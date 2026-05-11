-- 068_career_opportunities — persist AI-flagged opportunities so they
-- survive page reload. Each row carries the audit timestamp of the AI
-- run that produced it; we treat them as "open" until resolved_at or
-- dismissed_at is set. On load, the frontend reuses the cached set
-- unchanged unless a new narrative has been added since the latest
-- audit_ts — in which case the server re-audits in the background.

create table if not exists job.career_opportunities (
  id                  text primary key,
  audit_ts            timestamptz not null default now(),
  title               text not null,
  gap                 text not null default '',
  ask                 text not null default '',
  scope               text not null default 'narrative',  -- narrative|project|client|metric
  anchor_company_slug text references job.companies(slug) on delete set null,
  resolved_at         timestamptz,
  resolved_by_narrative_id text references job.narratives(id) on delete set null,
  dismissed_at        timestamptz,
  created_at          timestamptz not null default now()
);

-- Frequent filter: open rows only.
create index if not exists idx_career_opps_open
  on job.career_opportunities (audit_ts desc)
  where resolved_at is null and dismissed_at is null;
