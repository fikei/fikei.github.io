-- Echo: Suggestion log and episode history tables
-- Tracks daily suggestions shown to users and persists generated episodes

-- Log every suggestion ever shown (tapped or not)
create table echo_suggestion_log (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id),
  suggestion_id uuid not null,
  title text not null,
  topic text not null,
  mode text not null,
  category text not null,
  rank integer not null,
  was_tapped boolean default false,
  generated_at timestamptz not null,
  tapped_at timestamptz,
  created_at timestamptz default now()
);

create index idx_echo_suggestion_log_user on echo_suggestion_log(user_id, generated_at desc);

-- Episode history — persists generated episodes across sessions
create table echo_episode_history (
  id uuid primary key,
  user_id uuid references auth.users(id),
  topic text not null,
  title text not null,
  mode text not null,
  transcript jsonb not null default '[]'::jsonb,
  sources jsonb not null default '[]'::jsonb,
  bias_distribution jsonb,
  audio_urls text[] default '{}',
  duration_seconds integer default 0,
  listened_seconds integer default 0,
  is_saved boolean default false,
  suggestion_id uuid,
  created_at timestamptz default now()
);

create index idx_echo_episode_history_user on echo_episode_history(user_id, created_at desc);

-- RLS policies (allow authenticated users to access their own data)
alter table echo_suggestion_log enable row level security;
alter table echo_episode_history enable row level security;

create policy "Users can read their own suggestion logs"
  on echo_suggestion_log for select
  using (auth.uid() = user_id);

create policy "Users can update their own suggestion logs"
  on echo_suggestion_log for update
  using (auth.uid() = user_id);

create policy "Service role can insert suggestion logs"
  on echo_suggestion_log for insert
  with check (true);

create policy "Users can read their own episode history"
  on echo_episode_history for select
  using (auth.uid() = user_id);

create policy "Users can insert their own episode history"
  on echo_episode_history for insert
  with check (auth.uid() = user_id);

create policy "Users can update their own episode history"
  on echo_episode_history for update
  using (auth.uid() = user_id);
