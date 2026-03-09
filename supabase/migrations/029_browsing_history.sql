-- ============================================
-- 029_browsing_history.sql
-- Append-only table for hashed navigation events from the Chrome extension.
-- Raw URLs are NEVER stored — only url_hash (SHA-256), canonical_domain,
-- page_title (truncated 100 chars), referrer_domain, session_id.
-- Deduplication: one record per user per URL (same URL on different days
-- is still one row — we track first visit only).
-- ============================================

CREATE TABLE IF NOT EXISTS browsing_history (
  event_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  device_id TEXT NOT NULL,
  visited_at TIMESTAMPTZ NOT NULL,
  canonical_domain TEXT NOT NULL,
  url_hash TEXT NOT NULL,
  page_title TEXT,
  referrer_domain TEXT,
  session_id TEXT NOT NULL,
  source TEXT NOT NULL CHECK (source IN ('history', 'navigation'))
);

COMMENT ON TABLE browsing_history IS
  'Hashed navigation events. Raw URLs never stored. One record per user per URL.';
COMMENT ON COLUMN browsing_history.url_hash IS
  'SHA-256 hex of normalized URL. Used for deduplication. Raw URL never transmitted or stored.';
COMMENT ON COLUMN browsing_history.page_title IS
  'Page title truncated to 100 characters. May be empty for backfill events.';
COMMENT ON COLUMN browsing_history.session_id IS
  'Client-generated UUID, reset when gap since last event exceeds 30 minutes.';
COMMENT ON COLUMN browsing_history.source IS
  '''history'' = backfill from chrome.history API; ''navigation'' = live webNavigation event.';

-- Deduplication: one row per user per URL
CREATE UNIQUE INDEX idx_browsing_history_user_url
  ON browsing_history (user_id, url_hash);

-- Time-range queries (most common access pattern)
CREATE INDEX idx_browsing_history_user_time
  ON browsing_history (user_id, visited_at DESC);

-- Domain aggregation queries for taste graph
CREATE INDEX idx_browsing_history_user_domain
  ON browsing_history (user_id, canonical_domain);

-- Device-level queries for cross-device merging
CREATE INDEX idx_browsing_history_device
  ON browsing_history (device_id, visited_at DESC);

ALTER TABLE browsing_history ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can read own history"
  ON browsing_history FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own history"
  ON browsing_history FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete own history"
  ON browsing_history FOR DELETE
  USING (auth.uid() = user_id);

-- No UPDATE policy — browsing_history is append-only.

-- Rolling retention: pg_cron deletes events older than 12 months daily.
-- Run this manually in Supabase Dashboard → SQL Editor after applying migration:
--
-- SELECT cron.schedule(
--   'purge-old-browsing-history',
--   '0 3 * * *',
--   $$DELETE FROM browsing_history WHERE visited_at < NOW() - INTERVAL '12 months'$$
-- );
