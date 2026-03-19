-- Calendar blocks: manual time-range and full-day blocks set by admin
create table if not exists calendar_blocks (
  id uuid primary key default gen_random_uuid(),
  owner_user_id uuid references auth.users(id) on delete cascade not null,
  block_type text not null check (block_type in ('time-range', 'full-day')),
  profile_id text,
  block_date date not null,
  start_time time,
  end_time time,
  note text,
  created_at timestamptz default now()
);

create index on calendar_blocks(owner_user_id, block_date);

-- No RLS client access — only service role reads this table
alter table calendar_blocks enable row level security;

-- Add singleton profile support to calendar_tokens
alter table calendar_tokens add column if not exists singleton_profile_id text;
