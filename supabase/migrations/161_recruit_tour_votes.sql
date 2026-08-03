-- ============================================
-- Migration 161: Tour poll votes as buttons
--
-- Emoji reactions confused people and Discord rate-limits seeding them.
-- Tour polls now carry one button per slot; a tap toggles a vote row here.
-- Counts render in the button labels, and the confirm check runs straight
-- from the interaction handler (plus the scan sweep as a safety net).
-- ============================================

CREATE TABLE IF NOT EXISTS recruit_tour_votes (
  applicant_id TEXT NOT NULL REFERENCES recruit_applicants(id) ON DELETE CASCADE,
  slot_start TIMESTAMPTZ NOT NULL,
  discord_user_id TEXT NOT NULL,
  discord_username TEXT,
  voted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (applicant_id, slot_start, discord_user_id)
);

ALTER TABLE recruit_tour_votes ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Recruiting members read tour votes" ON recruit_tour_votes
  FOR SELECT TO authenticated USING (is_recruiting_member());
-- Writes are service-role only (recruit-discord button handler).
