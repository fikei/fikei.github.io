-- 063_job_narratives — discrete, auto-tagged stories that the cover-letter
-- generator can draw from. Each narrative has freeform tags (industry,
-- skill, theme) inferred by Claude, plus an optional company link that
-- points back into the canonical work history. When the AI can't pick a
-- linked company with high confidence, the row is marked needs_link=true
-- so the Career UI can prompt the user to wire it up.

create table if not exists job.narratives (
  id                  text primary key,
  title               text not null,
  content_md          text not null default '',
  tags                text[] not null default array[]::text[],
  linked_company_slug text references job.companies(slug) on delete set null,
  needs_link          boolean not null default true,
  source_role         text,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

create index if not exists idx_narratives_company on job.narratives(linked_company_slug);
create index if not exists idx_narratives_needs_link on job.narratives(needs_link) where needs_link;

create or replace function job.touch_narratives_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_narratives_updated_at on job.narratives;
create trigger trg_narratives_updated_at
before update on job.narratives
for each row execute function job.touch_narratives_updated_at();
