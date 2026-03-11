-- ============================================================
-- 032_secondary_signals.sql
-- Secondary taste signals from file imports (Spotify, YouTube Takeout)
-- Stored separately from links — never shown as pins.
-- Pin-derived signals always outweigh these (enforced by source_weight).
-- ============================================================

-- ============================================================
-- secondary_signals: taste signals extracted from external data exports
-- Each row = one artist/channel/entity with aggregated taste data.
-- NOT one row per play event (500K Spotify plays → ~2K artist rows).
-- ============================================================
CREATE TABLE IF NOT EXISTS secondary_signals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  source TEXT NOT NULL CHECK (source IN ('spotify', 'youtube_takeout')),
  -- Taste data — same shape as pin fields consumed by taste-engine
  category TEXT NOT NULL DEFAULT 'listen',
  taste_tags TEXT[] DEFAULT '{}',
  practical_tags TEXT[] DEFAULT '{}',
  entities JSONB DEFAULT '[]',
  content_type TEXT DEFAULT 'music',
  -- Weight factor (0-1): pins always 1.0, secondary signals lower
  source_weight REAL NOT NULL DEFAULT 0.3 CHECK (source_weight BETWEEN 0 AND 1),
  -- Timestamp of most recent event — used for recency decay
  created_at TIMESTAMPTZ NOT NULL,
  -- Provenance
  import_job_id UUID,
  -- Dedup key: normalized artist/channel name
  external_id TEXT NOT NULL,
  UNIQUE(user_id, source, external_id)
);

CREATE INDEX IF NOT EXISTS idx_secondary_signals_user
  ON secondary_signals(user_id);
CREATE INDEX IF NOT EXISTS idx_secondary_signals_user_source
  ON secondary_signals(user_id, source);
CREATE INDEX IF NOT EXISTS idx_secondary_signals_tags
  ON secondary_signals USING GIN(taste_tags);
CREATE INDEX IF NOT EXISTS idx_secondary_signals_job
  ON secondary_signals(import_job_id) WHERE import_job_id IS NOT NULL;

-- ============================================================
-- import_jobs: tracks file import progress and status
-- ============================================================
CREATE TABLE IF NOT EXISTS import_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  source TEXT NOT NULL CHECK (source IN ('spotify', 'youtube_takeout')),
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'processing', 'complete', 'error')),
  total_events INTEGER DEFAULT 0,
  processed_events INTEGER DEFAULT 0,
  signals_created INTEGER DEFAULT 0,
  haiku_calls_made INTEGER DEFAULT 0,
  error_message TEXT,
  started_at TIMESTAMPTZ DEFAULT NOW(),
  completed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_import_jobs_user
  ON import_jobs(user_id, started_at DESC);

-- ============================================================
-- Row Level Security
-- ============================================================
ALTER TABLE secondary_signals ENABLE ROW LEVEL SECURITY;
ALTER TABLE import_jobs ENABLE ROW LEVEL SECURITY;

CREATE POLICY secondary_signals_user ON secondary_signals
  FOR ALL USING (auth.uid() = user_id);
CREATE POLICY import_jobs_user ON import_jobs
  FOR ALL USING (auth.uid() = user_id);
