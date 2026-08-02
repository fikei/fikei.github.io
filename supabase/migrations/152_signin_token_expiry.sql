-- 152: per-token expiry for sign-in links.
-- A single 10-minute TTL suited the ephemeral reply you get from tapping a
-- button, and was wrong for a link DM'd to someone who reads Discord later:
-- four of the first five DM'd links expired unused, while the one that was
-- redeemed was opened 12 seconds after it arrived. Expiry now travels with
-- the token so each delivery channel can set its own.
ALTER TABLE recruit_signin_tokens
  ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ;

UPDATE recruit_signin_tokens
  SET expires_at = created_at + INTERVAL '10 minutes'
  WHERE expires_at IS NULL;

ALTER TABLE recruit_signin_tokens
  ALTER COLUMN expires_at SET DEFAULT (NOW() + INTERVAL '10 minutes');
