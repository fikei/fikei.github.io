-- ============================================
-- Migration 137: what kind of event is this?
--
-- recruit_screenings has always modelled exactly one thing — the intro call
-- — and the calendar sweep inserted anything it could match into it. That
-- was safe only because the sweep read the shared account's own calendar,
-- where the only applicant-attended events ARE intro calls.
--
-- Pointing the sweep at the house calendar breaks that assumption: house
-- dinners, tours, and second visits all carry applicant invitees. Without a
-- kind, every one of them would arm the intro-call state machine — Watch
-- chips, "Notes on the way…", coverage reminders, recording bots.
--
--   intro_call   the screening call; the only kind that drives row states
--   visit        they came to the house
--   house_event  anything else they were invited to
--
-- Existing rows are intro_call: that's all the table has ever held.
-- ============================================

ALTER TABLE recruit_screenings
  ADD COLUMN IF NOT EXISTS kind TEXT NOT NULL DEFAULT 'intro_call',
  ADD COLUMN IF NOT EXISTS calendar_id TEXT,
  ADD COLUMN IF NOT EXISTS title TEXT;

DO $$
BEGIN
  ALTER TABLE recruit_screenings
    ADD CONSTRAINT recruit_screenings_kind_chk
    CHECK (kind IN ('intro_call', 'visit', 'house_event'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- The state machine reads "scheduled intro calls" constantly.
CREATE INDEX IF NOT EXISTS recruit_screenings_kind_idx
  ON recruit_screenings (kind, status);

-- Recording bots must never be scheduled for a dinner. The sweep sets these
-- explicitly, but a NULL-safe guard here documents the invariant.
CREATE INDEX IF NOT EXISTS recruit_screenings_gcal_idx
  ON recruit_screenings (gcal_event_id)
  WHERE gcal_event_id IS NOT NULL;
