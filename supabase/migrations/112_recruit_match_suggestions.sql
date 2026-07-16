-- ============================================
-- Migration 112: AI listing-match suggestions
--
-- recruit-match (edge fn, Claude Haiku) writes one suggestion per applicant:
-- which open listing they fit (null = General interest), a short rationale,
-- and practicality flags (couple / timing / budget / duration) that the UI
-- surfaces as soft alerts. Server-written, member-read.
-- ============================================

CREATE TABLE IF NOT EXISTS recruit_match_suggestions (
  applicant_id TEXT PRIMARY KEY REFERENCES recruit_applicants(id) ON DELETE CASCADE,
  listing_id UUID REFERENCES recruit_listings(id) ON DELETE SET NULL,
  confidence REAL CHECK (confidence BETWEEN 0 AND 1),
  rationale TEXT DEFAULT '',
  flags JSONB NOT NULL DEFAULT '[]',
  model TEXT DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE recruit_match_suggestions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Recruiting members read match suggestions" ON recruit_match_suggestions
  FOR SELECT TO authenticated USING (is_recruiting_member());
-- No client writes: the recruit-match edge function uses the service role.
