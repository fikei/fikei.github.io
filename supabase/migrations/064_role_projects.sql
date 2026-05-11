-- 064_role_projects — structured projects + clients under each work-history
-- role. The existing roles still live inside the markdown body of
-- job.companies (parsed by the front-end). We attach projects to the
-- (company_slug, role_title) pair so we don't have to migrate role storage
-- yet — when we eventually move roles to their own table we'll just bind
-- role_projects to role_id directly.

create table if not exists job.role_projects (
  id            text primary key,
  company_slug  text not null references job.companies(slug) on delete cascade,
  role_title    text not null,
  name          text not null,
  description   text not null default '',
  outcome       text not null default '',
  metric        text not null default '',
  started_at    date,
  ended_at      date,
  position      int  not null default 0,        -- ordering within a role
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index if not exists idx_role_projects_role
  on job.role_projects(company_slug, role_title);

create table if not exists job.project_clients (
  id            text primary key,
  project_id    text not null references job.role_projects(id) on delete cascade,
  name          text not null,
  kind          text not null default 'customer', -- customer|stakeholder|partner|internal
  description   text not null default '',
  created_at    timestamptz not null default now()
);

create index if not exists idx_project_clients_project
  on job.project_clients(project_id);

create or replace function job.touch_role_projects_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_role_projects_updated_at on job.role_projects;
create trigger trg_role_projects_updated_at
before update on job.role_projects
for each row execute function job.touch_role_projects_updated_at();
