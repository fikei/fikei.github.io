-- 077 — chat_thread + chat_message.thread_id.
-- Promotes the previously-single-rolling-thread chat to be navigable.
-- /job/chat/ permalink page reads from these tables. Older messages
-- (created before this migration) get backfilled into a single
-- "Default thread" per user so history isn't lost.

create table if not exists public.chat_thread (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  title       text not null default 'Conversation',
  archived_at timestamptz,
  created_at  timestamptz not null default now(),
  last_message_at timestamptz not null default now()
);
create index chat_thread_user_idx on public.chat_thread (user_id, last_message_at desc nulls last);

alter table public.chat_thread enable row level security;
drop policy if exists "chat_thread: owner select" on public.chat_thread;
create policy "chat_thread: owner select" on public.chat_thread
  for select using (auth.uid() = user_id);
drop policy if exists "chat_thread: owner insert" on public.chat_thread;
create policy "chat_thread: owner insert" on public.chat_thread
  for insert with check (auth.uid() = user_id);
drop policy if exists "chat_thread: owner update" on public.chat_thread;
create policy "chat_thread: owner update" on public.chat_thread
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
grant select, insert, update on public.chat_thread to authenticated;

alter table public.chat_message
  add column if not exists thread_id uuid references public.chat_thread(id) on delete set null;
create index if not exists chat_message_thread_idx on public.chat_message (thread_id, created_at);

-- Backfill: one default thread per user, all existing messages re-tagged.
do $$
declare uid uuid; tid uuid;
begin
  for uid in select distinct user_id from public.chat_message where thread_id is null loop
    insert into public.chat_thread (user_id, title)
      values (uid, 'Default thread') returning id into tid;
    update public.chat_message set thread_id = tid where user_id = uid and thread_id is null;
    update public.chat_thread set last_message_at = (
      select max(created_at) from public.chat_message where thread_id = tid
    ) where id = tid;
  end loop;
end $$;
