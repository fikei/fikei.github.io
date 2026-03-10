-- ============================================
-- 030_mcp_connector.sql
-- Tables for the MCP Connector: OAuth tokens,
-- user privacy settings, and usage analytics
-- ============================================

-- 1. mcp_tokens — issued OAuth tokens mapped to user_id
-- MCP clients (Claude) authenticate with these tokens,
-- which are separate from Supabase JWTs.
CREATE TABLE IF NOT EXISTS mcp_tokens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  client_id TEXT NOT NULL,
  access_token TEXT NOT NULL UNIQUE,
  refresh_token TEXT UNIQUE,
  access_token_expires_at TIMESTAMPTZ NOT NULL,
  refresh_token_expires_at TIMESTAMPTZ,
  scopes TEXT[] DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_mcp_tokens_access_token
  ON mcp_tokens(access_token);

CREATE INDEX IF NOT EXISTS idx_mcp_tokens_refresh_token
  ON mcp_tokens(refresh_token) WHERE refresh_token IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_mcp_tokens_user_id
  ON mcp_tokens(user_id);

ALTER TABLE mcp_tokens ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role full access mcp_tokens"
  ON mcp_tokens FOR ALL
  USING (auth.role() = 'service_role');

-- 2. mcp_auth_codes — temporary authorization codes for OAuth flow
CREATE TABLE IF NOT EXISTS mcp_auth_codes (
  code TEXT PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  client_id TEXT NOT NULL,
  redirect_uri TEXT NOT NULL,
  code_challenge TEXT,
  code_challenge_method TEXT DEFAULT 'S256',
  scopes TEXT[] DEFAULT '{}',
  privacy_tier TEXT NOT NULL DEFAULT 'library',
  expires_at TIMESTAMPTZ NOT NULL,
  used BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE mcp_auth_codes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role full access mcp_auth_codes"
  ON mcp_auth_codes FOR ALL
  USING (auth.role() = 'service_role');

-- 3. mcp_clients — dynamic client registration (RFC 7591)
CREATE TABLE IF NOT EXISTS mcp_clients (
  client_id TEXT PRIMARY KEY,
  client_secret TEXT,
  client_name TEXT,
  redirect_uris TEXT[] NOT NULL DEFAULT '{}',
  grant_types TEXT[] DEFAULT '{authorization_code, refresh_token}',
  response_types TEXT[] DEFAULT '{code}',
  token_endpoint_auth_method TEXT DEFAULT 'none',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE mcp_clients ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role full access mcp_clients"
  ON mcp_clients FOR ALL
  USING (auth.role() = 'service_role');

-- Pre-register known Claude redirect URIs as a default client
INSERT INTO mcp_clients (client_id, client_name, redirect_uris)
VALUES (
  'claude-default',
  'Claude',
  ARRAY[
    'http://localhost:6274/oauth/callback',
    'http://localhost:6274/oauth/callback/debug',
    'https://claude.ai/api/mcp/auth_callback',
    'https://claude.com/api/mcp/auth_callback'
  ]
) ON CONFLICT (client_id) DO NOTHING;

-- 4. connector_settings — per-user privacy controls
CREATE TABLE IF NOT EXISTS connector_settings (
  user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  privacy_tier TEXT NOT NULL DEFAULT 'library'
    CHECK (privacy_tier IN ('taste_only', 'library', 'full_access')),
  board_visibility JSONB NOT NULL DEFAULT '{}',
  field_visibility JSONB NOT NULL DEFAULT '{}',
  auto_save_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE connector_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users see own connector settings"
  ON connector_settings FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users update own connector settings"
  ON connector_settings FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "Users insert own connector settings"
  ON connector_settings FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Service role full access connector_settings"
  ON connector_settings FOR ALL
  USING (auth.role() = 'service_role');

-- 5. connector_usage — analytics/instrumentation
CREATE TABLE IF NOT EXISTS connector_usage (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  tool_name TEXT NOT NULL,
  input_params JSONB,
  result_count INTEGER,
  privacy_tier TEXT,
  session_id TEXT,
  client_type TEXT,
  duration_ms INTEGER,
  error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_connector_usage_user_id
  ON connector_usage(user_id);

CREATE INDEX IF NOT EXISTS idx_connector_usage_tool_name
  ON connector_usage(tool_name);

CREATE INDEX IF NOT EXISTS idx_connector_usage_created_at
  ON connector_usage(created_at);

ALTER TABLE connector_usage ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role full access connector_usage"
  ON connector_usage FOR ALL
  USING (auth.role() = 'service_role');

-- Timestamp triggers
CREATE OR REPLACE FUNCTION update_mcp_tokens_updated_at()
RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER mcp_tokens_updated_at
  BEFORE UPDATE ON mcp_tokens
  FOR EACH ROW EXECUTE FUNCTION update_mcp_tokens_updated_at();

CREATE OR REPLACE FUNCTION update_connector_settings_updated_at()
RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER connector_settings_updated_at
  BEFORE UPDATE ON connector_settings
  FOR EACH ROW EXECUTE FUNCTION update_connector_settings_updated_at();
