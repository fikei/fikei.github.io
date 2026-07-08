-- Pipeline invariants tripwire (retro of 2026-07-08 dedupe incident).
-- Three standing assertions about the events pipeline, checked on a cron:
--   (a) no-duplicate-slots: no source has 2+ future rows pointing at the same
--       per-event URL on the same date (renamed listings minting siblings)
--   (b) rows-refresh-after-success: a source with a recent successful scrape
--       must have refreshed its future rows (poisoned-batch detector — the
--       bulk-update failure froze whole sources with green health)
--   (c) clean-cache-writes: no _cache-batch errors recorded in the last 24h
-- Violations are persisted to pipeline_invariant_checks and offending
-- sources are loudly marked degraded in source_health.

CREATE TABLE IF NOT EXISTS pipeline_invariant_checks (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  checked_at timestamptz NOT NULL DEFAULT now(),
  ok boolean NOT NULL,
  violations jsonb NOT NULL DEFAULT '[]'::jsonb
);

ALTER TABLE pipeline_invariant_checks ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "invariant checks readable" ON pipeline_invariant_checks;
CREATE POLICY "invariant checks readable" ON pipeline_invariant_checks
  FOR SELECT USING (true);

CREATE OR REPLACE FUNCTION check_pipeline_invariants() RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v jsonb := '[]'::jsonb;
  dupes jsonb;
  stale jsonb;
  batch_errs jsonb;
BEGIN
  -- (a) duplicate slots: same source + date + per-event URL, 2+ rows.
  -- Per-event URLs are the strong identity signal (BOTH date pages, Discord
  -- permalinks, ticket links). Registry/listing-page fallback URLs are
  -- excluded via the event_sources join; the count ceiling skips generic
  -- URLs shared by many same-day rows.
  SELECT jsonb_agg(jsonb_build_object('source', source_id, 'date', date, 'url', url, 'n', n))
  INTO dupes
  FROM (
    SELECT e.source_id, e.date, e.url, count(*) AS n
    FROM events e
    LEFT JOIN event_sources es ON es.id = e.source_id
    WHERE e.date >= CURRENT_DATE
      AND e.url IS NOT NULL AND e.url <> ''
      AND (es.url IS NULL OR e.url <> es.url)
    GROUP BY e.source_id, e.date, e.url
    HAVING count(*) > 1 AND count(*) <= 5
  ) d;
  IF dupes IS NOT NULL THEN
    v := v || jsonb_build_object('invariant', 'no-duplicate-slots', 'violations', dupes);
  END IF;

  -- (b) freshness: a source whose last scrape succeeded (with events) in the
  -- last 24h must have refreshed its future rows. >30% stale mirrors the
  -- reconciliation cap; small absolute floor avoids noise. Curation/manual
  -- feeds are excluded — their rows legitimately never re-scrape.
  SELECT jsonb_agg(jsonb_build_object('source', s.source_id, 'stale', s.stale, 'total', s.total))
  INTO stale
  FROM (
    SELECT e.source_id,
           count(*) FILTER (WHERE e.scraped_at < h.last_success_at - interval '10 minutes') AS stale,
           count(*) AS total
    FROM events e
    JOIN source_health h ON h.source_id = e.source_id
    JOIN event_sources es ON es.id = e.source_id
    WHERE e.date >= CURRENT_DATE
      AND h.last_success_at > now() - interval '24 hours'
      AND coalesce(h.last_success_event_count, 0) > 0
      AND es.type NOT IN ('discord', 'manual')
      AND coalesce(es.source_class, '') <> 'curation'
    GROUP BY e.source_id
  ) s
  WHERE s.stale > 5 AND s.stale::numeric / greatest(s.total, 1) > 0.3;
  IF stale IS NOT NULL THEN
    v := v || jsonb_build_object('invariant', 'rows-refresh-after-success', 'violations', stale);
  END IF;

  -- (c) cache write errors surfaced into scrape_runs in the last 24h
  SELECT jsonb_agg(jsonb_build_object('run_started', started_at, 'errors', error_log))
  INTO batch_errs
  FROM scrape_runs
  WHERE started_at > now() - interval '24 hours'
    AND error_log IS NOT NULL
    AND jsonb_array_length(error_log) > 0
    AND error_log::text ILIKE '%_cache-batch%';
  IF batch_errs IS NOT NULL THEN
    v := v || jsonb_build_object('invariant', 'clean-cache-writes', 'violations', batch_errs);
  END IF;

  INSERT INTO pipeline_invariant_checks (ok, violations)
  VALUES (jsonb_array_length(v) = 0, v);

  -- Loud flag: offending sources show degraded in the Settings health UI.
  -- The next clean scrape rewrites health, which is the correct recovery.
  IF dupes IS NOT NULL OR stale IS NOT NULL THEN
    UPDATE source_health h SET
      status = 'degraded',
      last_failure_reason = 'invariant violation — see pipeline_invariant_checks'
    WHERE h.source_id IN (
      SELECT DISTINCT x->>'source' FROM jsonb_array_elements(coalesce(dupes, '[]'::jsonb)) x
      UNION
      SELECT DISTINCT x->>'source' FROM jsonb_array_elements(coalesce(stale, '[]'::jsonb)) x
    );
  END IF;

  -- Keep 90 days of check history
  DELETE FROM pipeline_invariant_checks WHERE checked_at < now() - interval '90 days';

  RETURN jsonb_build_object('ok', jsonb_array_length(v) = 0, 'violations', v);
END $$;

-- Every 6 hours, offset from the 2h scrape cron so a run has settled
SELECT cron.unschedule('pipeline-invariants-6h')
WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'pipeline-invariants-6h');
SELECT cron.schedule('pipeline-invariants-6h', '45 */6 * * *', 'SELECT check_pipeline_invariants()');
