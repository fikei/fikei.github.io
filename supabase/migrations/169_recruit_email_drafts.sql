-- ============================================
-- Migration 169: saved email drafts — "Send later"
--
-- The compose modal's only outcomes were send or lose it. "Send later" saves
-- the edited draft server-side so anyone in the house can pick it up. One
-- draft per applicant: the outreach and update composers can't both apply to
-- the same person (archived people only get updates, everyone else only
-- outreach), so the slot is shared and latest-write wins.
--
-- Deliberately NOT a Gmail draft: the shared connection's scopes are
-- readonly + send, and adding gmail.compose would force re-consenting the
-- shared account (see the invalid_grant history). App-side rows need no new
-- scopes and no reconnect.
-- ============================================

CREATE TABLE IF NOT EXISTS recruit_email_drafts (
  applicant_id TEXT PRIMARY KEY REFERENCES recruit_applicants(id) ON DELETE CASCADE,
  mode TEXT NOT NULL DEFAULT 'outreach' CHECK (mode IN ('outreach', 'update')),
  kind TEXT,                       -- typed draft the compose was opened with (tour, accepted, …)
  subject TEXT NOT NULL DEFAULT '',
  body TEXT NOT NULL DEFAULT '',
  saved_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  saved_by_name TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE recruit_email_drafts ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Recruiting members read email drafts" ON recruit_email_drafts;
CREATE POLICY "Recruiting members read email drafts" ON recruit_email_drafts
  FOR SELECT TO authenticated USING (is_recruiting_member());
DROP POLICY IF EXISTS "Recruiting members write email drafts" ON recruit_email_drafts;
CREATE POLICY "Recruiting members write email drafts" ON recruit_email_drafts
  FOR ALL TO authenticated
  USING (is_recruiting_member()) WITH CHECK (is_recruiting_member());
