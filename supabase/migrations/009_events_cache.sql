-- ============================================
-- Events Cache Schema
-- Dual-layer caching (localStorage L1 + Supabase L2) with content enrichment
-- Migration 009
-- ============================================

-- Events table: shared cache of scraped event data
CREATE TABLE IF NOT EXISTS events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Identity (composite key for deduplication)
  event_key TEXT UNIQUE NOT NULL,   -- MD5(source_id|date|name|venue)
  source_id TEXT NOT NULL,          -- Source identifier (e.g. '19hz-bayarea')

  -- Core scraped data
  date DATE NOT NULL,
  time TEXT,
  name TEXT NOT NULL,
  venue TEXT NOT NULL,
  address TEXT,
  city TEXT,
  genre TEXT,
  price TEXT,
  ages TEXT,
  promoter TEXT,
  url TEXT NOT NULL,
  content_type TEXT,                -- music|film|comedy|theater|other

  -- Enriched data (from enrich-event function)
  description TEXT,
  image_url TEXT,
  tags TEXT[],
  enrichment_status TEXT DEFAULT 'pending'
    CHECK (enrichment_status IN ('pending', 'processing', 'completed', 'failed', 'skipped')),
  enrichment_error TEXT,
  enriched_at TIMESTAMPTZ,

  -- Cache metadata
  scraped_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================
-- Indexes
-- ============================================
CREATE INDEX IF NOT EXISTS idx_events_source_date ON events(source_id, date DESC);
CREATE INDEX IF NOT EXISTS idx_events_date ON events(date DESC);
CREATE INDEX IF NOT EXISTS idx_events_scraped ON events(scraped_at DESC);
CREATE INDEX IF NOT EXISTS idx_events_enrichment
  ON events(enrichment_status) WHERE enrichment_status = 'pending';

-- ============================================
-- Row Level Security
-- ============================================
ALTER TABLE events ENABLE ROW LEVEL SECURITY;

-- Anyone can read events (public data)
CREATE POLICY "Public read access"
  ON events FOR SELECT
  USING (true);

-- Anon role can insert (client writes scraped data)
CREATE POLICY "Anon insert access"
  ON events FOR INSERT
  WITH CHECK (true);

-- Anon role can update (client refreshes scraped_at on re-scrape)
CREATE POLICY "Anon update access"
  ON events FOR UPDATE
  USING (true);

-- Service role full access (edge functions)
CREATE POLICY "Service role full access"
  ON events FOR ALL
  USING (auth.role() = 'service_role');

-- ============================================
-- Helper: generate event_key
-- ============================================
CREATE OR REPLACE FUNCTION generate_event_key(
  p_source_id TEXT,
  p_date DATE,
  p_name TEXT,
  p_venue TEXT
) RETURNS TEXT AS $$
BEGIN
  RETURN md5(p_source_id || '|' || p_date::text || '|' || lower(trim(p_name)) || '|' || lower(trim(p_venue)));
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- ============================================
-- Auto-update updated_at
-- ============================================
CREATE OR REPLACE FUNCTION update_events_timestamp()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER events_updated_at
  BEFORE UPDATE ON events
  FOR EACH ROW EXECUTE FUNCTION update_events_timestamp();

-- ============================================
-- Cleanup: delete events older than 7 days
-- ============================================
CREATE OR REPLACE FUNCTION cleanup_stale_events()
RETURNS INTEGER AS $$
DECLARE
  deleted INTEGER;
BEGIN
  DELETE FROM events WHERE date < CURRENT_DATE - INTERVAL '7 days';
  GET DIAGNOSTICS deleted = ROW_COUNT;
  RETURN deleted;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
