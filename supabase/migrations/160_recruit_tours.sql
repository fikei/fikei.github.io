-- ============================================
-- Migration 160: House-tour scheduling flow
--
-- The second "schedule" action. One row per applicant tracks the whole
-- arc: tour ask emailed (natural-language availability request, T–Th
-- 5–7pm preferred) → applicant replies with windows (parsed by the same
-- Gmail extraction that feeds recruit_availability) → an emoji poll is
-- posted to the house → when more than tour_confirm_votes housemates
-- react to one slot, the confirmation email (address + visit shape)
-- goes out automatically.
-- ============================================

CREATE TABLE IF NOT EXISTS recruit_tours (
  applicant_id TEXT PRIMARY KEY REFERENCES recruit_applicants(id) ON DELETE CASCADE,
  -- asked → polled → confirmed; cancelled is the manual out.
  status TEXT NOT NULL DEFAULT 'asked' CHECK (status IN ('asked', 'polled', 'confirmed', 'cancelled')),
  asked_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  asked_by_name TEXT,
  -- The applicant windows the poll was built from (PT wall times, same
  -- shape as recruit_availability.windows).
  windows JSONB,
  -- Posted poll slots: [{start: ISO-UTC, label: "Tue Aug 11 · 5:30p", emoji: "1️⃣"}]
  slots JSONB,
  -- true when none of their windows overlapped Tue–Thu 5–7pm and the poll
  -- posted their raw windows instead, flagged for a human call.
  off_hours BOOLEAN NOT NULL DEFAULT false,
  discord_channel_id TEXT,
  discord_message_id TEXT,
  polled_at TIMESTAMPTZ,
  confirmed_slot TIMESTAMPTZ,
  confirmed_count INT,
  confirmed_at TIMESTAMPTZ,
  confirm_gmail_id TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_recruit_tours_polled
  ON recruit_tours(polled_at) WHERE status = 'polled';

ALTER TABLE recruit_tours ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Recruiting members read tours" ON recruit_tours
  FOR SELECT TO authenticated USING (is_recruiting_member());
-- Writes are service-role only (recruit-gmail).
