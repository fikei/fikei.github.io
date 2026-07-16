-- ============================================
-- Migration 115: per-user display names + shared Gmail pipe
--
-- 1. recruit_profiles — display name per recruiting member ("Ian Fike"
--    instead of the Discord handle). Read by all members, written by owner.
-- 2. recruit_gmail_account — the single shared Google account
--    (live.at.agapesf@gmail.com) the house sends/receives through. Holds
--    the OAuth refresh token: NO member policies at all — only the
--    recruit-gmail edge fn (service role) touches it.
-- 3. recruit_emails — every inbound/outbound message exchanged with an
--    applicant through the shared account, shown on the applicant's
--    Emails tab. Written by the edge fn, read by members.
-- ============================================

CREATE TABLE IF NOT EXISTS recruit_profiles (
  user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  display_name TEXT NOT NULL CHECK (char_length(display_name) BETWEEN 1 AND 60),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE recruit_profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Recruiting members read profiles" ON recruit_profiles
  FOR SELECT TO authenticated USING (is_recruiting_member());
CREATE POLICY "Members write own profile" ON recruit_profiles
  FOR ALL TO authenticated
  USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid() AND is_recruiting_member());

CREATE TABLE IF NOT EXISTS recruit_gmail_account (
  id INT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  email TEXT NOT NULL,
  refresh_token TEXT NOT NULL,
  connected_by_name TEXT,
  connected_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE recruit_gmail_account ENABLE ROW LEVEL SECURITY;
-- no policies: service-role only.

CREATE TABLE IF NOT EXISTS recruit_emails (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  applicant_id TEXT NOT NULL REFERENCES recruit_applicants(id) ON DELETE CASCADE,
  gmail_id TEXT UNIQUE,
  thread_id TEXT,
  direction TEXT NOT NULL CHECK (direction IN ('in', 'out')),
  subject TEXT DEFAULT '',
  snippet TEXT DEFAULT '',
  body_text TEXT DEFAULT '',
  from_email TEXT DEFAULT '',
  to_email TEXT DEFAULT '',
  sent_by_name TEXT,                -- housemate who hit send (outbound)
  sent_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_recruit_emails_applicant ON recruit_emails(applicant_id, sent_at DESC);
ALTER TABLE recruit_emails ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Recruiting members read emails" ON recruit_emails
  FOR SELECT TO authenticated USING (is_recruiting_member());
-- writes via the recruit-gmail edge fn (service role).
