-- ============================================
-- Source Health Tracking
-- Migration 024
-- Tracks per-source scrape outcomes to detect degraded or broken sources.
-- Pattern mirrors domain_profiles: accumulate outcomes, compute success rate.
-- ============================================

CREATE TABLE IF NOT EXISTS source_health (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Identity
  source_id TEXT UNIQUE NOT NULL,
  source_name TEXT,
  source_url TEXT,
  source_type TEXT,

  -- Rolling outcome accumulator (mirrors types_seen in domain_profiles)
  -- Structure: { "success": 42, "zero_results": 8, "timeout": 2, "blocked": 1, ... }
  outcomes_seen JSONB DEFAULT '{}',

  -- Derived metrics (recomputed on each upsert)
  total_scrapes INTEGER DEFAULT 0,
  success_count INTEGER DEFAULT 0,
  zero_result_count INTEGER DEFAULT 0,
  error_count INTEGER DEFAULT 0,
  success_rate REAL DEFAULT 1.0,

  -- Consecutive failure tracking (resets on any successful scrape with >0 events)
  consecutive_failures INTEGER DEFAULT 0,
  last_failure_reason TEXT,
  last_failure_at TIMESTAMPTZ,

  -- Last known good state
  last_success_at TIMESTAMPTZ,
  last_success_event_count INTEGER,

  -- Status (derived, stored for fast querying)
  status TEXT DEFAULT 'unknown'
    CHECK (status IN ('healthy', 'degraded', 'broken', 'unknown')),

  -- Repair tracking (for future auto-repair phases)
  repair_attempted_at TIMESTAMPTZ,
  repair_strategy TEXT,
  repair_result TEXT,

  -- Timestamps
  first_seen_at TIMESTAMPTZ DEFAULT NOW(),
  last_scraped_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_source_health_status
  ON source_health(status) WHERE status IN ('degraded', 'broken');

CREATE INDEX IF NOT EXISTS idx_source_health_source_id
  ON source_health(source_id);

CREATE INDEX IF NOT EXISTS idx_source_health_consecutive_failures
  ON source_health(consecutive_failures DESC);

ALTER TABLE source_health ENABLE ROW LEVEL SECURITY;

-- Anyone can read health data
CREATE POLICY "Public read source health"
  ON source_health FOR SELECT USING (true);

-- Anon can insert/update (client reports outcomes after each scrape)
CREATE POLICY "Anon insert source health"
  ON source_health FOR INSERT WITH CHECK (true);

CREATE POLICY "Anon update source health"
  ON source_health FOR UPDATE USING (true);

-- Service role full access
CREATE POLICY "Service role full access to source health"
  ON source_health FOR ALL USING (auth.role() = 'service_role');

-- Auto-update updated_at
CREATE OR REPLACE FUNCTION update_source_health_timestamp()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER source_health_updated_at
  BEFORE UPDATE ON source_health
  FOR EACH ROW EXECUTE FUNCTION update_source_health_timestamp();
