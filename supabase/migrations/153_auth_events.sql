-- 153: a record of every sign-in attempt.
-- Login failures were invisible: the only signal was a housemate saying "it
-- doesn't work", with no way to tell whether they were blocked, expired, or
-- never arrived. Every stage of the gate now writes here, so the question is
-- answerable without asking the person.
CREATE TABLE IF NOT EXISTS recruit_auth_events (
  id BIGSERIAL PRIMARY KEY,
  at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- 'link_sent' | 'link_redeemed' | 'link_expired' | 'gate_pass'
  -- | 'gate_no_channel' | 'gate_not_linked' | 'gate_error' | 'client_stall'
  event TEXT NOT NULL,
  discord_user_id TEXT,
  discord_username TEXT,
  user_id UUID,
  detail TEXT,
  -- how they arrived: 'button' | 'slash' | 'dm' | 'oauth' | 'link'
  channel TEXT,
  in_app_browser BOOLEAN
);
CREATE INDEX IF NOT EXISTS recruit_auth_events_at_idx ON recruit_auth_events (at DESC);
CREATE INDEX IF NOT EXISTS recruit_auth_events_event_idx ON recruit_auth_events (event, at DESC);

ALTER TABLE recruit_auth_events ENABLE ROW LEVEL SECURITY;
-- Recruiting members can read it; only the service role writes.
CREATE POLICY "Recruiting members read auth events" ON recruit_auth_events
  FOR SELECT TO authenticated USING (is_recruiting_member());
