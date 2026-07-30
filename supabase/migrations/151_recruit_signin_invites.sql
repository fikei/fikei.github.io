-- 151: one proactive sign-in DM per person, ever.
-- The cron sweep DMs a one-time link to anyone who can see the Recruiting
-- Society channel but has never signed in. This ledger is what stops it
-- becoming a recurring nag; it records the ask, not the outcome.
CREATE TABLE IF NOT EXISTS recruit_signin_invites (
  discord_user_id TEXT PRIMARY KEY,
  invited_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE recruit_signin_invites ENABLE ROW LEVEL SECURITY;
