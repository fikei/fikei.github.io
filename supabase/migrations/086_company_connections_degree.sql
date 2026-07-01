-- 086_company_connections_degree.sql
-- Add connection degree (1st vs 2nd) + mutual-connection count to
-- job.company_connections so the /ladder UI can distinguish direct contacts
-- (warm intro / referral) from high-quality 2nd-degree people worth a
-- connection request (decision-makers reachable through a mutual).

alter table job.company_connections
  add column if not exists degree  text not null default '1st',
  add column if not exists mutuals integer;

create index if not exists company_connections_company_degree_idx
  on job.company_connections (company_slug, degree);

comment on column job.company_connections.degree is
  '1st = Ian is directly connected; 2nd = reachable through a mutual (worth a connection request).';
comment on column job.company_connections.mutuals is
  'Shared-connection count for 2nd-degree people (intro feasibility signal).';
