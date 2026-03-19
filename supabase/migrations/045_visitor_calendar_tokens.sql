-- Visitor calendar tokens: ephemeral OAuth tokens for booking visitors
create table if not exists visitor_calendar_tokens (
  id uuid primary key default gen_random_uuid(),
  session_token text not null unique,
  google_refresh_token text not null,
  google_access_token text,
  token_expires_at timestamptz,
  calendar_ids jsonb default '["primary"]'::jsonb,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  expires_at timestamptz not null default (now() + interval '24 hours')
);

create index on visitor_calendar_tokens(session_token);
create index on visitor_calendar_tokens(expires_at);

-- No RLS client access — only service role reads this table
alter table visitor_calendar_tokens enable row level security;

-- Cleanup function for expired visitor tokens
create or replace function cleanup_visitor_tokens() returns void as $$
  delete from visitor_calendar_tokens where expires_at < now();
$$ language sql;
