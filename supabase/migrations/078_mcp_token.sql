-- 078 — Personal-access tokens for the /job MCP endpoint (job-mcp).
-- Replaces the broken UX where users had to paste a 1-hour-expiring
-- Supabase JWT into Claude Desktop / Cursor / Claude Code config.
--
-- Format: a raw token is "mcp_" + 32 random base64url chars (~192 bits
-- of entropy). The server stores only sha256(token) in token_hash and
-- a short prefix for display in the settings UI. The raw token is
-- returned ONCE at creation; lost tokens require minting a new one.

create table if not exists job.mcp_token (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users(id) on delete cascade,
  label         text not null,
  token_hash    text not null unique,
  prefix        text not null,
  created_at    timestamptz not null default now(),
  last_used_at  timestamptz,
  expires_at    timestamptz,
  revoked_at    timestamptz
);
create index if not exists mcp_token_user_idx       on job.mcp_token (user_id, created_at desc);
create index if not exists mcp_token_hash_lookup_idx on job.mcp_token (token_hash) where revoked_at is null;

comment on table  job.mcp_token is 'Personal-access tokens for the /job MCP endpoint. Raw tokens are returned only at creation; storage is hashed.';
comment on column job.mcp_token.token_hash is 'hex sha256 of the raw "mcp_<32 chars>" token.';
comment on column job.mcp_token.prefix is 'First 8 chars of the suffix portion (after "mcp_") shown in the settings UI so users can identify which token is which.';

alter table job.mcp_token enable row level security;

drop policy if exists "mcp_token: owner select" on job.mcp_token;
create policy "mcp_token: owner select" on job.mcp_token
  for select using (auth.uid() = user_id);

drop policy if exists "mcp_token: owner insert" on job.mcp_token;
create policy "mcp_token: owner insert" on job.mcp_token
  for insert with check (auth.uid() = user_id);

drop policy if exists "mcp_token: owner update" on job.mcp_token;
create policy "mcp_token: owner update" on job.mcp_token
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

grant select, insert, update on job.mcp_token to authenticated;

create or replace function job.mcp_token_verify(p_hash text)
returns table (user_id uuid, token_id uuid)
language sql
security definer
set search_path = public, job
as $$
  select user_id, id
    from job.mcp_token
   where token_hash = p_hash
     and revoked_at is null
     and (expires_at is null or expires_at > now())
   limit 1
$$;

revoke all on function job.mcp_token_verify(text) from public;
grant execute on function job.mcp_token_verify(text) to anon, authenticated;

create or replace function job.mcp_token_bump_used(p_id uuid)
returns void
language sql
security definer
set search_path = public, job
as $$
  update job.mcp_token set last_used_at = now() where id = p_id
$$;
revoke all on function job.mcp_token_bump_used(uuid) from public;
grant execute on function job.mcp_token_bump_used(uuid) to anon, authenticated;
