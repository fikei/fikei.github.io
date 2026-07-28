-- ============================================
-- Migration 130: Phase B + post-screening decisions + draft listings
--
-- 1. New-application Discord ping tracking (auto ping rides the scan;
--    one post per applicant, digest guard client of the column).
-- 2. Rejection-email queue state: rejected applicants owe an update email
--    until sent or skipped. Sent is stamped server-side by recruit-gmail's
--    send-update; skip goes through the RPC below.
-- 3. recruit_decision_votes — the post-screening house decision (yes/no +
--    note, one row per voter per applicant). Tally is advisory; moving the
--    person remains a human action.
-- 4. recruit_listings gains a 'draft' status — auto-generated from
--    occupancy gaps; bucketing only ever sees 'open'.
-- 5. Settings: discord_auto_post (default false) — the manual→auto claim
--    cutover is a toggle, not a deploy.
-- ============================================

ALTER TABLE recruit_applicants
  ADD COLUMN IF NOT EXISTS discord_ping_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS update_email_sent_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS update_email_skipped_at TIMESTAMPTZ;

CREATE TABLE IF NOT EXISTS recruit_decision_votes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  applicant_id TEXT NOT NULL REFERENCES recruit_applicants(id) ON DELETE CASCADE,
  voter_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  voter_name TEXT,
  verdict TEXT NOT NULL CHECK (verdict IN ('yes', 'no')),
  note TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (applicant_id, voter_id)
);
ALTER TABLE recruit_decision_votes ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Recruiting members read decision votes" ON recruit_decision_votes
  FOR SELECT TO authenticated USING (is_recruiting_member());
CREATE POLICY "Recruiting members write own decision vote" ON recruit_decision_votes
  FOR INSERT TO authenticated WITH CHECK (is_recruiting_member() AND voter_id = auth.uid());
CREATE POLICY "Recruiting members update own decision vote" ON recruit_decision_votes
  FOR UPDATE TO authenticated
  USING (is_recruiting_member() AND voter_id = auth.uid())
  WITH CHECK (is_recruiting_member() AND voter_id = auth.uid());

-- Listings: allow drafts (auto-detected occupancy gaps awaiting a human open).
ALTER TABLE recruit_listings DROP CONSTRAINT IF EXISTS recruit_listings_status_check;
ALTER TABLE recruit_listings ADD CONSTRAINT recruit_listings_status_check
  CHECK (status IN ('draft', 'open', 'filled', 'closed'));

-- Skip marker for the update-email queue (applicants table is client-read-only).
CREATE OR REPLACE FUNCTION recruit_skip_update(p_applicant TEXT)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT is_recruiting_member() THEN RAISE EXCEPTION 'recruiting members only'; END IF;
  UPDATE recruit_applicants
    SET update_email_skipped_at = NOW(), stage = 'archived'
    WHERE id = p_applicant AND stage = 'rejected';
END;
$$;

INSERT INTO recruit_settings (key, value) VALUES ('discord_auto_post', 'false'::jsonb)
  ON CONFLICT (key) DO NOTHING;
