-- ============================================
-- Migration 133: seed read state so the blue dot only marks real arrivals
--
-- 132's backfill keyed off recruit_votes, which is empty (the single vote on
-- record was Testy McTestface's veto, and it cascaded away with that row). Left
-- as-is, every one of the 58 applicants already in the Inbox would light up as
-- "new" the first time someone opened the app. Mark everything that exists
-- right now as seen by everyone who has signed in, so the dot starts clean and
-- only future applications carry it.
-- ============================================

INSERT INTO recruit_applicant_views (applicant_id, user_id, viewed_at)
  SELECT a.id, u.id, NOW() FROM recruit_applicants a CROSS JOIN auth.users u
  ON CONFLICT DO NOTHING;
