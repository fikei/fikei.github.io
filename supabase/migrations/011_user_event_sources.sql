-- Migration 011: User Event Sources
-- Stores event source preferences per user so they persist across browsers/devices.
-- On login, client syncs localStorage sources to this table and loads from it.

CREATE TABLE user_event_sources (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  sources JSONB NOT NULL DEFAULT '[]'::jsonb,      -- full sources array [{id, name, url, type, enabled, category, region, ...}]
  settings JSONB NOT NULL DEFAULT '{}'::jsonb,      -- user settings (view prefs, filters, etc.)
  region TEXT DEFAULT 'bay-area',
  onboarded BOOLEAN DEFAULT false,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(user_id)
);

-- Index for fast lookup by user
CREATE INDEX idx_user_event_sources_user ON user_event_sources(user_id);

-- Auto-update updated_at
CREATE OR REPLACE FUNCTION update_user_event_sources_timestamp()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_user_event_sources_updated
  BEFORE UPDATE ON user_event_sources
  FOR EACH ROW EXECUTE FUNCTION update_user_event_sources_timestamp();

-- RLS: users can only read/write their own row
ALTER TABLE user_event_sources ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can read own sources"
  ON user_event_sources FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own sources"
  ON user_event_sources FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own sources"
  ON user_event_sources FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);
