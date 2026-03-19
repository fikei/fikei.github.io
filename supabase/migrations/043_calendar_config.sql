-- Calendar config: stores admin-configurable meeting type profiles
create table if not exists calendar_config (
  id uuid primary key default gen_random_uuid(),
  owner_user_id uuid references auth.users(id) on delete cascade not null,
  profile_id text not null,
  label text not null,
  meeting_title text not null,
  durations jsonb not null default '[15,30,60]'::jsonb,
  schedule jsonb not null default '{}'::jsonb,
  sort_order int not null default 0,
  is_active boolean not null default true,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  unique(owner_user_id, profile_id)
);

-- No RLS client access — only service role reads this table
alter table calendar_config enable row level security;
