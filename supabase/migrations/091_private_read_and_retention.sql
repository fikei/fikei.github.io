-- ============================================
-- Authenticated private-event read + 60-day retention
-- Migration 091
--
-- 1. PRD event-source-architecture §8.1 (resolved): any Supabase-authenticated
--    user sees private rows (Agape events, demoted-feed events); anon sees
--    public only. Powers the client's "Agape recommended" filter.
-- 2. Retention 7d -> 60d so the "past events" toggle has data and
--    agape_coverage accumulates history.
-- ============================================

CREATE POLICY "Authenticated read all events" ON events
  FOR SELECT TO authenticated USING (true);

CREATE OR REPLACE FUNCTION run_events_maintenance()
RETURNS JSONB AS $$
DECLARE
  stale_events INTEGER;
  stale_discord INTEGER;
  old_runs INTEGER;
BEGIN
  DELETE FROM events WHERE date < CURRENT_DATE - INTERVAL '60 days';
  GET DIAGNOSTICS stale_events = ROW_COUNT;

  DELETE FROM discord_event_cache WHERE expires_at < NOW() - INTERVAL '7 days';
  GET DIAGNOSTICS stale_discord = ROW_COUNT;

  DELETE FROM scrape_runs WHERE started_at < NOW() - INTERVAL '90 days';
  GET DIAGNOSTICS old_runs = ROW_COUNT;

  RETURN jsonb_build_object(
    'stale_events', stale_events,
    'stale_discord', stale_discord,
    'old_runs', old_runs
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
