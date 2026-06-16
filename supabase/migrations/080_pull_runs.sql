-- 080: job.pull_runs — durable per-run summaries for pull-recommendations.
--
-- Why: run summaries previously lived only in net._http_response (the
-- pg_net response store), which gets pruned automatically. When the
-- gmail-jobs source went silently dead for 26 days (revoked OAuth token,
-- clean pulled:0 every run), there was no queryable history to spot the
-- flatline. This table keeps one row per orchestrator run with the full
-- per-source summary so health checks and humans can ask "when did this
-- source last insert anything?"

create table if not exists job.pull_runs (
  id          bigint generated always as identity primary key,
  ran_at      timestamptz not null default now(),
  version     text not null,
  -- The same summary array returned in the HTTP response:
  -- [{ id, type, pulled, kept, droppedToPipeline, inserted, error?, skipped? }]
  sources     jsonb not null,
  -- Denormalized convenience flags for cheap health queries.
  had_error   boolean not null default false,
  total_inserted int not null default 0
);

create index if not exists pull_runs_ran_at_idx on job.pull_runs (ran_at desc);

-- Retention: keep 30 days. Cheap delete piggybacked on insert volume
-- (96 rows/day at 15-min cadence) — no separate cron needed; the edge
-- function prunes opportunistically.

comment on table job.pull_runs is
  'Per-run summaries from pull-recommendations. Written by the edge function each run; pruned to ~30 days opportunistically.';
