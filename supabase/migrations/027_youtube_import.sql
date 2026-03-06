-- ============================================
-- 027_youtube_import.sql
-- Adds import_source tracking to links table
-- and connected_accounts table for OAuth tokens
-- ============================================

-- 1. import_source on links
-- Tracks which platform a pin was bulk-imported from
-- NULL = user-saved pin (first-class citizen)
-- 'youtube' = imported from YouTube liked videos / playlists
ALTER TABLE links ADD COLUMN IF NOT EXISTS import_source TEXT DEFAULT NULL;

CREATE INDEX IF NOT EXISTS idx_links_import_source
  ON links(import_source) WHERE import_source IS NOT NULL;

-- 2. connected_accounts table
CREATE TABLE IF NOT EXISTS connected_accounts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  platform TEXT NOT NULL,
  access_token TEXT NOT NULL,
  refresh_token TEXT,
  token_expires_at TIMESTAMPTZ,
  scopes TEXT[],
  platform_user_id TEXT,
  platform_username TEXT,
  status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'revoked', 'expired', 'error')),
  last_import_at TIMESTAMPTZ,
  last_import_count INTEGER DEFAULT 0,
  connected_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(user_id, platform)
);

CREATE INDEX IF NOT EXISTS idx_connected_accounts_user_platform
  ON connected_accounts(user_id, platform);

ALTER TABLE connected_accounts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users see own connected accounts"
  ON connected_accounts FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users insert own connected accounts"
  ON connected_accounts FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users update own connected accounts"
  ON connected_accounts FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "Service role full access connected_accounts"
  ON connected_accounts FOR ALL
  USING (auth.role() = 'service_role');

CREATE OR REPLACE FUNCTION update_connected_accounts_updated_at()
RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER connected_accounts_updated_at
  BEFORE UPDATE ON connected_accounts
  FOR EACH ROW EXECUTE FUNCTION update_connected_accounts_updated_at();
