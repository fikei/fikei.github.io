-- 132: one-time sign-in tokens for the bot-issued magic-link flow.
-- A "Get sign-in link" button in the recruiting channel mints a short-lived
-- single-use token (recruit-discord); redeeming it at /redeem exchanges the
-- token for a Supabase session via auth.admin.generateLink + verifyOtp.
-- Service-role only: RLS on, no policies.
CREATE TABLE IF NOT EXISTS recruit_signin_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  token_hash text UNIQUE NOT NULL,          -- sha256 of the raw token; raw never stored
  discord_user_id text NOT NULL,
  discord_username text,
  created_at timestamptz NOT NULL DEFAULT now(),
  used_at timestamptz
);

ALTER TABLE recruit_signin_tokens ENABLE ROW LEVEL SECURITY;

-- Hygiene: tokens are 10-minute single-use; anything older is dead weight.
CREATE INDEX IF NOT EXISTS recruit_signin_tokens_created_idx ON recruit_signin_tokens (created_at);
