-- ============================================
-- 028_extension_settings.sql
-- Per-user extension preferences for Phase 2 privacy controls.
-- Source of truth: chrome.storage.sync; this table mirrors it server-side.
-- ============================================

CREATE TABLE IF NOT EXISTS extension_settings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
  history_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  domain_blocklist TEXT[] NOT NULL DEFAULT '{}',
  backfill_days INTEGER NOT NULL DEFAULT 30,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE extension_settings IS
  'Per-user extension preferences. Source of truth is chrome.storage.sync; this mirrors it server-side.';
COMMENT ON COLUMN extension_settings.history_enabled IS
  'When false, extension stops capturing navigation events. Pause toggle.';
COMMENT ON COLUMN extension_settings.domain_blocklist IS
  'User-added domains to exclude from history capture. Merged with hardcoded DEFAULT_BLOCKLIST at runtime.';
COMMENT ON COLUMN extension_settings.backfill_days IS
  'How many days back to read from chrome.history on opt-in backfill. Default 30.';

CREATE OR REPLACE FUNCTION update_extension_settings_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER extension_settings_updated_at
  BEFORE UPDATE ON extension_settings
  FOR EACH ROW EXECUTE FUNCTION update_extension_settings_updated_at();

ALTER TABLE extension_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can read own settings"
  ON extension_settings FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own settings"
  ON extension_settings FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own settings"
  ON extension_settings FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete own settings"
  ON extension_settings FOR DELETE
  USING (auth.uid() = user_id);
