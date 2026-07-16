-- ============================================
-- Migration 110: generalized decision reasons + freeform note
--
-- Every decision (outreach / hold / pass) now carries a multiple-choice
-- reason and an optional freeform note (typed or dictated). The old
-- hold-only check constraint goes away; existing hold values
-- (fit / timing / needs) remain valid reason ids.
-- ============================================

ALTER TABLE recruit_decisions DROP CONSTRAINT IF EXISTS recruit_decisions_hold_reason_check;
ALTER TABLE recruit_decisions RENAME COLUMN hold_reason TO reason;
ALTER TABLE recruit_decisions ADD COLUMN IF NOT EXISTS note TEXT DEFAULT '';
