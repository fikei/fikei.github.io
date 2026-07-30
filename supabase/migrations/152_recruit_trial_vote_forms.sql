-- ============================================
-- Migration 152: the ballot behind each trial milestone
--
-- Migration 139 gave a trial candidate two dates the house has to remember:
-- a check-in a month in, and a decision a month before the sublet ends. What
-- it didn't carry is the thing housemates actually have to *do* on those
-- dates — fill in the feedback form the house votes with.
--
-- One form copy per person per milestone (never a shared form: answers about
-- two people in one response sheet can't be read separately), so the link
-- belongs on the stay next to the date it answers.
--
-- Naming convention for the copies, so the Drive folder stays legible and the
-- close date is visible without opening anything:
--
--   Agape vote · {member} · {Month 1 | Final decision} · {YYYY-MM-DD}
--
-- where the date is the *closing meeting* — the last Monday house meeting
-- before the milestone — not the milestone itself. Responses have to be in
-- before that meeting, because that meeting is where the house decides.
--
-- The reminders that chase these live in _shared/recruit-notify.ts
-- (detectTrialVotes) and ride the existing 15-minute /remind tick. They
-- replace the one-shot embeds migration 139 described; checkin_reminded_at and
-- decision_reminded_at are left in place but are no longer read.
-- ============================================

ALTER TABLE recruit_stays
  ADD COLUMN IF NOT EXISTS checkin_form_url TEXT,
  ADD COLUMN IF NOT EXISTS decision_form_url TEXT;

COMMENT ON COLUMN recruit_stays.checkin_form_url IS
  'Trial candidates only: the month-1 feedback form copy the house votes with.';
COMMENT ON COLUMN recruit_stays.decision_form_url IS
  'Trial candidates only: the final-decision feedback form copy.';
