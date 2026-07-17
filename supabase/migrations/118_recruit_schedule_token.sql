-- ============================================
-- Migration 118: public scheduling token per applicant
-- Knowledge of the token authorizes an applicant to view/submit their own
-- availability on the public /applications/schedule/ page (no account).
-- ============================================

ALTER TABLE recruit_applicants ADD COLUMN IF NOT EXISTS schedule_token UUID NOT NULL DEFAULT gen_random_uuid();
CREATE UNIQUE INDEX IF NOT EXISTS idx_recruit_applicants_schedule_token ON recruit_applicants(schedule_token);
