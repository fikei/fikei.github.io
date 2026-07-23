-- ============================================
-- Migration 123: multi-listing placements + hold cleanup
--
-- 1. recruit_listing_candidates — a candidate can now sit in EVERY open
--    listing they qualify for (the client computes qualification: track,
--    budget vs rent, move-in window) instead of one listing via
--    recruit_decisions.listing_id. source 'auto' = placed by the sweep,
--    'manual' = a recruiter added them. status 'removed' is a tombstone so
--    the auto-sweep never re-adds someone a recruiter pulled out.
-- 2. Backfill: existing outreach attachments become manual placements.
-- 3. Legacy "Hold" applicants (backfilled to candidate in migration 120)
--    go back to review — under the vote model they still need their votes.
-- ============================================

CREATE TABLE IF NOT EXISTS recruit_listing_candidates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  applicant_id TEXT NOT NULL REFERENCES recruit_applicants(id) ON DELETE CASCADE,
  listing_id UUID NOT NULL REFERENCES recruit_listings(id) ON DELETE CASCADE,
  source TEXT NOT NULL DEFAULT 'auto' CHECK (source IN ('auto', 'manual')),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'removed')),
  added_by_name TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (applicant_id, listing_id)
);
CREATE INDEX IF NOT EXISTS idx_recruit_listing_candidates_listing
  ON recruit_listing_candidates(listing_id, status);

ALTER TABLE recruit_listing_candidates ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Recruiting members read placements" ON recruit_listing_candidates
  FOR SELECT TO authenticated USING (is_recruiting_member());
CREATE POLICY "Recruiting members write placements" ON recruit_listing_candidates
  FOR ALL TO authenticated
  USING (is_recruiting_member()) WITH CHECK (is_recruiting_member());

-- Existing single-listing attachments become manual placements.
INSERT INTO recruit_listing_candidates (applicant_id, listing_id, source, added_by_name)
  SELECT d.applicant_id, d.listing_id, 'manual', d.decided_by_name
  FROM recruit_decisions d
  WHERE d.decision = 'outreach' AND d.listing_id IS NOT NULL
  ON CONFLICT (applicant_id, listing_id) DO NOTHING;

-- Hold ≠ passed review: send them back through the vote gate.
UPDATE recruit_applicants a SET stage = 'review'
  FROM recruit_decisions d
  WHERE d.applicant_id = a.id AND d.decision = 'hold' AND a.stage = 'candidate';
