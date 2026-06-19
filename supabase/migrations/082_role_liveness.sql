-- 082_role_liveness.sql — in-pipeline role-liveness detection (backlog #9).
--
-- A recommended_roles row currently lives forever once created, so the
-- For You list accumulates filled/expired postings. These columns let the
-- two liveness layers retire stale roles using authoritative ATS data:
--   * layer 1 (pull-recommendations): tracked-ats "disappeared since last
--     pull" diff — a previously-seen source_id no longer returned by a
--     successfully-fetched board = closed ('delisted').
--   * layer 2 (enrich-job-source action=liveness): re-check ATS-resolved
--     roles against the live board-API open-id set = closed ('ats-delisted').
-- A closed role is filtered out of For You (like dismissed) but kept in the
-- DB for history/analytics. last_seen_at tracks the last time we confirmed
-- the posting was still open; both layers clear closed_at when an id
-- reappears (reopen semantics).

alter table job.recommended_roles
  add column if not exists closed_at      timestamptz,
  add column if not exists last_seen_at   timestamptz,
  add column if not exists closure_reason text;   -- 'delisted' | 'ats-delisted'

-- Hot path for the liveness layers + the read filter: active rows per source.
create index if not exists recommended_roles_active_idx
  on job.recommended_roles (source)
  where closed_at is null and dismissed_at is null;
