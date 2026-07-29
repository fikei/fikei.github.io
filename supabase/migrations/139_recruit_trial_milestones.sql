-- ============================================
-- Migration 139: trial-candidate check-in + decision dates
--
-- A trial candidate ("candidate" stay) has two moments the house has to
-- remember and currently doesn't: a check-in after their first month, and a
-- decision a month before their sublet ends — late enough to have real
-- signal, early enough that either side can still plan.
--
-- Both live on the stay itself, not on the applicant: the dates are derived
-- from the stay's window, a person can trial twice, and the occupancy drawer
-- is where the house already edits these people.
--
-- Reminders ride the existing 15-minute recruit-discord /remind tick
-- (migration 122) rather than a cron of their own — the tick already runs
-- every quarter hour and already owns Discord posting. The *_reminded_at
-- stamps make each reminder once-only.
-- ============================================

ALTER TABLE recruit_stays
  ADD COLUMN IF NOT EXISTS checkin_on DATE,
  ADD COLUMN IF NOT EXISTS decision_on DATE,
  ADD COLUMN IF NOT EXISTS checkin_reminded_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS decision_reminded_at TIMESTAMPTZ;

COMMENT ON COLUMN recruit_stays.checkin_on IS
  'Trial candidates only: mid-trial check-in, defaults to starts_on + 1 month.';
COMMENT ON COLUMN recruit_stays.decision_on IS
  'Trial candidates only: house decision, defaults to ends_on - 1 month.';

-- The reminder tick scans by due date; candidates are a handful of rows, but
-- the partial index keeps the scan off the residents.
CREATE INDEX IF NOT EXISTS idx_recruit_stays_milestones
  ON recruit_stays (checkin_on, decision_on) WHERE kind = 'candidate';

-- Backfill live trials only. Andy's Jan–Feb trial is five months finished;
-- stamping dates on it would only create noise (and its two-month window
-- puts "start + 1 month" after "end - 1 month" anyway).
UPDATE recruit_stays SET
  checkin_on = COALESCE(checkin_on, (starts_on + INTERVAL '1 month')::date),
  decision_on = COALESCE(decision_on, (ends_on - INTERVAL '1 month')::date)
WHERE kind = 'candidate'
  AND ends_on IS NOT NULL
  AND ends_on >= CURRENT_DATE
  AND (starts_on + INTERVAL '1 month')::date < (ends_on - INTERVAL '1 month')::date;

-- Milestones the backfill placed in the past already happened — the house
-- doesn't need a Discord post about a check-in date three weeks gone.
UPDATE recruit_stays
   SET checkin_reminded_at = NOW()
 WHERE kind = 'candidate' AND checkin_on IS NOT NULL
   AND checkin_on < CURRENT_DATE AND checkin_reminded_at IS NULL;
UPDATE recruit_stays
   SET decision_reminded_at = NOW()
 WHERE kind = 'candidate' AND decision_on IS NOT NULL
   AND decision_on < CURRENT_DATE AND decision_reminded_at IS NULL;
