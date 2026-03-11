-- ============================================
-- 034_rename_mcp_to_connector.sql
-- Rename mcp_* tables → connector_* for multi-platform support.
-- Add platform column to connector_tokens for analytics.
-- ============================================

-- 1. Rename tables
ALTER TABLE IF EXISTS mcp_tokens RENAME TO connector_tokens;
ALTER TABLE IF EXISTS mcp_auth_codes RENAME TO connector_auth_codes;
ALTER TABLE IF EXISTS mcp_clients RENAME TO connector_clients;

-- 2. Rename indexes (Postgres keeps old names after table rename)
ALTER INDEX IF EXISTS idx_mcp_tokens_access_token RENAME TO idx_connector_tokens_access_token;
ALTER INDEX IF EXISTS idx_mcp_tokens_refresh_token RENAME TO idx_connector_tokens_refresh_token;
ALTER INDEX IF EXISTS idx_mcp_tokens_user_id RENAME TO idx_connector_tokens_user_id;

-- 3. Rename RLS policies
ALTER POLICY "Service role full access mcp_tokens" ON connector_tokens
  RENAME TO "Service role full access connector_tokens";

ALTER POLICY "Service role full access mcp_auth_codes" ON connector_auth_codes
  RENAME TO "Service role full access connector_auth_codes";

ALTER POLICY "Service role full access mcp_clients" ON connector_clients
  RENAME TO "Service role full access connector_clients";

-- 4. Rename trigger + function
DROP TRIGGER IF EXISTS mcp_tokens_updated_at ON connector_tokens;

CREATE OR REPLACE FUNCTION update_connector_tokens_updated_at()
RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER connector_tokens_updated_at
  BEFORE UPDATE ON connector_tokens
  FOR EACH ROW EXECUTE FUNCTION update_connector_tokens_updated_at();

-- Drop old function (no longer referenced)
DROP FUNCTION IF EXISTS update_mcp_tokens_updated_at();

-- 5. Add platform column for multi-platform analytics
ALTER TABLE connector_tokens
  ADD COLUMN IF NOT EXISTS platform TEXT NOT NULL DEFAULT 'claude';

-- 6. Add platform column to connector_usage for analytics
ALTER TABLE connector_usage
  ADD COLUMN IF NOT EXISTS platform TEXT NOT NULL DEFAULT 'mcp';

-- 7. Backfill existing tokens as claude
UPDATE connector_tokens SET platform = 'claude' WHERE platform = 'claude';

-- 8. Add index on platform for analytics queries
CREATE INDEX IF NOT EXISTS idx_connector_tokens_platform
  ON connector_tokens(platform);

CREATE INDEX IF NOT EXISTS idx_connector_usage_platform
  ON connector_usage(platform);
