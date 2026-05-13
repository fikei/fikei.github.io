-- Migration 071_chat.sql
-- Adds chat_message — the per-user agent chat history shown in the
-- floating chat drawer at the bottom-right of every /job page.
--
-- P0 design (see docs/strategy/prds/job-chat.md — to be written):
--   - single rolling thread per user, so no thread_id column yet
--   - role enum mirrors the Anthropic message-API role taxonomy plus a
--     local 'tool' value for tool-result events once P1 lands
--   - tool_name + tool_payload are nullable today and populated by the
--     agent loop in P1 when actions like update_pipeline_row run
--
-- RLS: standard owner-only pattern. The edge function uses the user's
-- bearer token so insert/select policies cover both reads and writes.

create table public.chat_message (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  role        text not null check (role in ('user', 'assistant', 'tool', 'system')),
  body        text not null default '',
  tool_name   text,
  tool_payload jsonb,
  created_at  timestamptz not null default now()
);

create index chat_message_user_created_idx
  on public.chat_message (user_id, created_at desc);

alter table public.chat_message enable row level security;

create policy "chat_message: owner select"
  on public.chat_message for select
  using (auth.uid() = user_id);

create policy "chat_message: owner insert"
  on public.chat_message for insert
  with check (auth.uid() = user_id);

-- Grant the standard role set; RLS handles the actual gating.
grant select, insert on public.chat_message to authenticated;
