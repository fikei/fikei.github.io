-- ============================================
-- Migration 132: veto invariant, per-viewer read state, test-record cleanup
--
-- 1. A veto must always mean archived. Reopening a vetoed applicant used to
--    drop them back into the Inbox with the veto still standing — the app even
--    admitted it in a toast. Reconcile the existing drift here; the client now
--    clears vetoes when a recruiter reopens, so the invariant holds going
--    forward: a standing veto ⇒ stage 'rejected'.
-- 2. recruit_applicant_views — which applicants each housemate has opened, so
--    genuinely new rows can carry the blue dot. Per-viewer and durable, so it
--    survives switching between phone and laptop.
-- 3. Delete the 'test-claim-flow' record (Testy McTestface) used while wiring
--    the screener scheduler. Cascades to its votes, emails, availability,
--    scheduler post, and screenings.
-- ============================================

UPDATE recruit_applicants a SET stage = 'rejected'
  WHERE a.stage NOT IN ('rejected', 'archived')
    AND EXISTS (SELECT 1 FROM recruit_votes v WHERE v.applicant_id = a.id AND v.veto);

CREATE TABLE IF NOT EXISTS recruit_applicant_views (
  applicant_id TEXT NOT NULL REFERENCES recruit_applicants(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  viewed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (applicant_id, user_id)
);
ALTER TABLE recruit_applicant_views ENABLE ROW LEVEL SECURITY;

-- Read state is personal: you see and write only your own.
CREATE POLICY "Members read own views" ON recruit_applicant_views
  FOR SELECT TO authenticated USING (is_recruiting_member() AND user_id = auth.uid());
CREATE POLICY "Members write own views" ON recruit_applicant_views
  FOR INSERT TO authenticated WITH CHECK (is_recruiting_member() AND user_id = auth.uid());
CREATE POLICY "Members update own views" ON recruit_applicant_views
  FOR UPDATE TO authenticated
  USING (is_recruiting_member() AND user_id = auth.uid())
  WITH CHECK (is_recruiting_member() AND user_id = auth.uid());

-- Everything already in the funnel counts as seen, so switching this on
-- doesn't light up 60 rows as "new".
INSERT INTO recruit_applicant_views (applicant_id, user_id, viewed_at)
  SELECT a.id, v.voter_id, NOW() FROM recruit_applicants a
  JOIN recruit_votes v ON v.applicant_id = a.id
  ON CONFLICT DO NOTHING;

DELETE FROM recruit_applicants WHERE id = 'test-claim-flow';
