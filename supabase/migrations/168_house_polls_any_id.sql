-- ============================================
-- Migration 168: House polls open to any massage-% or house-% poll id
--
-- The poll page is reusable by URL (/agape/massage/?poll=<id>); each poll's definition is its
-- own __meta row. 167 allowed only 'massage-2026'; this lets the page read and write any poll
-- whose id starts with massage- (e.g. the in-day round massage-2026-nov15) or house-.
-- ============================================

DROP POLICY IF EXISTS "House polls: anon read" ON house_polls;
DROP POLICY IF EXISTS "House polls: anon insert" ON house_polls;
DROP POLICY IF EXISTS "House polls: anon update" ON house_polls;

CREATE POLICY "House polls: anon read" ON house_polls
  FOR SELECT TO anon, authenticated
  USING (poll_id LIKE 'massage-%' OR poll_id LIKE 'house-%');
CREATE POLICY "House polls: anon insert" ON house_polls
  FOR INSERT TO anon, authenticated
  WITH CHECK (poll_id LIKE 'massage-%' OR poll_id LIKE 'house-%');
CREATE POLICY "House polls: anon update" ON house_polls
  FOR UPDATE TO anon, authenticated
  USING (poll_id LIKE 'massage-%' OR poll_id LIKE 'house-%')
  WITH CHECK (poll_id LIKE 'massage-%' OR poll_id LIKE 'house-%');
