-- ============================================
-- Migration 170: move-in onboarding lives on the stay
--
-- Booking a room (migration 168) answers "who and where". This adds the
-- "what happens next": the buddy, the confirmed money/logistics payload the
-- welcome email and agreement are built from, the generated agreement, and
-- the two send stamps (welcome email at acceptance, day-of email on move-in
-- morning). All on recruit_stays — one row already owns the tenancy.
--
-- `movein` is the payload the recruiter confirmed in the "Confirm move-in
-- details" sheet: {rent, dues, food, total, deposit, links...}. A snapshot,
-- deliberately: the email and agreement must say what was agreed, not what
-- the room costs later.
-- ============================================

ALTER TABLE recruit_stays
  ADD COLUMN IF NOT EXISTS buddy_name TEXT,
  ADD COLUMN IF NOT EXISTS movein JSONB,
  ADD COLUMN IF NOT EXISTS agreement_url TEXT,
  ADD COLUMN IF NOT EXISTS agreement_signed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS welcome_email_sent_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS dayof_email_sent_at TIMESTAMPTZ;

COMMENT ON COLUMN recruit_stays.buddy_name IS
  'Current resident paired as their buddy. Also feeds the next-up rotation (least-recently named goes first).';
COMMENT ON COLUMN recruit_stays.movein IS
  'Confirmed move-in payload from the acceptance flow: rent/dues/food/total/deposit and logistics. Snapshot at confirmation, not live.';
COMMENT ON COLUMN recruit_stays.agreement_url IS
  'The generated housemate agreement (Google Doc URL).';
