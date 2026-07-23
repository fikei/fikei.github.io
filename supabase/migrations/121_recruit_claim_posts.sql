-- ============================================
-- Migration 121: Discord screening-claim posts
--
-- When applicant availability lands (email extraction or the /schedule
-- picker), a claimable message is posted to #recruiting-interviews.
-- One row per applicant (the dedup rule: re-availability edits the
-- existing post). First housemate to tap a slot claims atomically via
-- UPDATE ... WHERE status='open'.
-- ============================================

CREATE TABLE IF NOT EXISTS recruit_claim_posts (
  applicant_id TEXT PRIMARY KEY REFERENCES recruit_applicants(id) ON DELETE CASCADE,
  discord_message_id TEXT NOT NULL,
  discord_channel_id TEXT NOT NULL,
  -- Concrete 30-min slots that were posted: [{start: ISO-UTC, label: "Fri Jul 25 · 9:00a"}]
  slots JSONB NOT NULL DEFAULT '[]',
  -- Requested medium from extraction: {kind, handle?} or null (default = Meet)
  platform JSONB,
  -- e.g. "applicant is in Europe, +9h from PT — windows converted"
  timezone_note TEXT,
  -- true = couldn't parse concrete times; post asks for manual coordination
  needs_human BOOLEAN NOT NULL DEFAULT false,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'claimed', 'expired', 'manual')),
  claimed_by_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  claimed_slot JSONB,
  posted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  claimed_at TIMESTAMPTZ,
  reminded_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_recruit_claim_posts_open
  ON recruit_claim_posts(posted_at) WHERE status = 'open';

ALTER TABLE recruit_claim_posts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Recruiting members read claim posts" ON recruit_claim_posts
  FOR SELECT TO authenticated USING (is_recruiting_member());
-- Writes are service-role only (recruit-gmail / recruit-availability / recruit-discord).
