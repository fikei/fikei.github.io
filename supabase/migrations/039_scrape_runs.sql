-- Migration 039: Scrape runs tracking table
-- Tracks each server-side scrape invocation for observability and freshness display.

CREATE TABLE IF NOT EXISTS scrape_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  sources_attempted INTEGER DEFAULT 0,
  sources_succeeded INTEGER DEFAULT 0,
  sources_failed INTEGER DEFAULT 0,
  events_total INTEGER DEFAULT 0,
  events_new INTEGER DEFAULT 0,
  events_updated INTEGER DEFAULT 0,
  error_log JSONB DEFAULT '[]'::jsonb,
  triggered_by TEXT DEFAULT 'cron'
);

CREATE INDEX idx_scrape_runs_started ON scrape_runs(started_at DESC);

-- RLS: public read, service role write
ALTER TABLE scrape_runs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Public read access" ON scrape_runs
  FOR SELECT USING (true);

CREATE POLICY "Service role full access" ON scrape_runs
  FOR ALL USING (auth.role() = 'service_role');

-- Auto-cleanup: keep last 90 days
CREATE OR REPLACE FUNCTION cleanup_old_scrape_runs()
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  deleted_count INTEGER;
BEGIN
  DELETE FROM scrape_runs
  WHERE started_at < NOW() - INTERVAL '90 days';
  GET DIAGNOSTICS deleted_count = ROW_COUNT;
  RETURN deleted_count;
END;
$$;
