-- Calendar tokens: stores Google Calendar OAuth tokens for scheduling
create table if not exists calendar_tokens (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade not null,
  google_refresh_token text not null,
  google_access_token text,
  token_expires_at timestamptz,
  calendar_ids jsonb default '["primary"]'::jsonb,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  unique(user_id)
);

-- No RLS client access — only service role reads this table
alter table calendar_tokens enable row level security;
-- No policies = no client access (service role bypasses RLS)
