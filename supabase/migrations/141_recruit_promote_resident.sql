-- ============================================
-- Migration 141: candidate → resident
--
-- The trial ends and the house says yes. Until now that had no home in the
-- data: the applicant stayed a "candidate" forever (or got archived, which
-- reads as a rejection), and the person in the room was a free-text name with
-- no link back to the application they came from.
--
-- Three pieces:
--   1. recruit_stays.applicant_id — the missing link. Nullable, because most
--      stays are founding residents who never applied through the funnel.
--   2. stage 'resident' — a terminal, non-rejecting end state. Drops them out
--      of the auto-placement sweep (which filters stage = 'candidate') for
--      free, and out of the Candidates rail.
--   3. recruit_onboarding — the post-promotion checklist. Rows, not a JSONB
--      blob, so each item carries who ticked it and when.
--
-- The promotion itself is one RPC, not four client writes: closing the trial
-- stay, opening the resident stay, moving the stage, and clearing placements
-- have to happen together or not at all.
-- ============================================

-- 1. Link a stay to the application it came from.
ALTER TABLE recruit_stays
  ADD COLUMN IF NOT EXISTS applicant_id TEXT REFERENCES recruit_applicants(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_recruit_stays_applicant
  ON recruit_stays (applicant_id) WHERE applicant_id IS NOT NULL;

COMMENT ON COLUMN recruit_stays.applicant_id IS
  'The application this stay came from. NULL for residents who predate the funnel.';

-- Backfill the live trials by name. Deliberately narrow: candidate stays
-- only, exact first-name match, and only when that name resolves to exactly
-- one applicant in the whole table. A wrong link here would be worse than no
-- link, so ambiguity is left NULL for a human.
--
-- Not filtered by stage on purpose. Alejandra is sitting in Priest on a trial
-- while her application row says 'archived' — the two surfaces drifted apart,
-- which is precisely the drift applicant_id exists to stop. Identity is what
-- the match is for; her stage is a separate question.
UPDATE recruit_stays s SET applicant_id = m.id
FROM (
  SELECT a.id, LOWER(TRIM(a.first_name)) AS fn FROM recruit_applicants a
) m
WHERE s.kind = 'candidate' AND s.applicant_id IS NULL
  AND LOWER(TRIM(s.occupant)) = m.fn
  AND (SELECT COUNT(*) FROM recruit_applicants a2
       WHERE LOWER(TRIM(a2.first_name)) = m.fn) = 1;

-- 2. 'resident' is an outcome, not an archive.
ALTER TABLE recruit_applicants DROP CONSTRAINT IF EXISTS recruit_applicants_stage_check;
ALTER TABLE recruit_applicants ADD CONSTRAINT recruit_applicants_stage_check
  CHECK (stage IN ('review', 'candidate', 'resident', 'rejected', 'archived'));

CREATE OR REPLACE FUNCTION recruit_set_stage(p_applicant TEXT, p_stage TEXT)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF NOT is_recruiting_member() THEN
    RAISE EXCEPTION 'recruiting members only';
  END IF;
  IF p_stage NOT IN ('review', 'candidate', 'resident', 'rejected', 'archived') THEN
    RAISE EXCEPTION 'unknown stage %', p_stage;
  END IF;
  UPDATE recruit_applicants SET stage = p_stage WHERE id = p_applicant;
END;
$$;

-- A trial that ends in "no" is its own exit reason — the archive should not
-- read the same as someone who never got past the application.
ALTER TABLE recruit_applicants DROP CONSTRAINT IF EXISTS recruit_applicants_exit_reason_chk;
ALTER TABLE recruit_applicants ADD CONSTRAINT recruit_applicants_exit_reason_chk
  CHECK (exit_reason IS NULL OR exit_reason IN ('future', 'opted_out', 'not_a_fit', 'trial_ended'));

-- 3. Onboarding checklist. Seeded on promotion, ticked by hand. Nothing here
--    provisions anything — it is the house's shared memory of what's left.
CREATE TABLE IF NOT EXISTS recruit_onboarding (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  stay_id UUID NOT NULL REFERENCES recruit_stays(id) ON DELETE CASCADE,
  item TEXT NOT NULL,
  sort INT NOT NULL DEFAULT 0,
  done_at TIMESTAMPTZ,
  done_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (stay_id, item)
);
CREATE INDEX IF NOT EXISTS idx_recruit_onboarding_stay ON recruit_onboarding (stay_id);

ALTER TABLE recruit_onboarding ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Recruiting members read onboarding" ON recruit_onboarding;
CREATE POLICY "Recruiting members read onboarding" ON recruit_onboarding
  FOR SELECT TO authenticated USING (is_recruiting_member());
DROP POLICY IF EXISTS "Recruiting members write onboarding" ON recruit_onboarding;
CREATE POLICY "Recruiting members write onboarding" ON recruit_onboarding
  FOR ALL TO authenticated
  USING (is_recruiting_member()) WITH CHECK (is_recruiting_member());

-- The default list. Kept in the migration rather than the client so the
-- checklist a promotion seeds doesn't drift with whatever the browser cached.
CREATE OR REPLACE FUNCTION recruit_onboarding_items()
RETURNS TABLE (item TEXT, sort INT)
LANGUAGE sql IMMUTABLE
AS $$
  VALUES
    ('Add to the Google Group', 1),
    ('Invite to the Notion workspace', 2),
    ('Give the resident Discord role', 3),
    ('Match them with a buddy', 4),
    ('Add to the chore + dues rotation', 5),
    ('Keys, door code, and a house walkthrough', 6)
$$;

-- 4. The promotion itself — all of it, or none of it.
--
-- Two doors into one core, because two kinds of people get promoted:
--   * a candidate the funnel knows (Candidates rail → recruit_promote_candidate)
--   * whoever is in a trial stay, application or not (occupancy drawer →
--     recruit_promote_stay). Sophia and Andy are both in this second group:
--     real trial candidates in real rooms with no application row behind them.
--     A promotion flow that only worked off recruit_applicants would be
--     useless for two of the three trials currently on the board.
--
-- p_starts_on defaults to the day after the trial ends; p_room_id to the
-- trial room, so passing a different one is how somebody changes rooms on the
-- way in. The trial stay is closed, never deleted — it is the record of how
-- they got here.
CREATE OR REPLACE FUNCTION recruit_promote_stay(
  p_stay_id UUID,
  p_room_id INT DEFAULT NULL,
  p_starts_on DATE DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $fn$
DECLARE
  v_trial recruit_stays%ROWTYPE;
  v_room INT;
  v_start DATE;
  v_stay_id UUID;
BEGIN
  IF NOT is_recruiting_member() THEN
    RAISE EXCEPTION 'recruiting members only';
  END IF;

  SELECT * INTO v_trial FROM recruit_stays WHERE id = p_stay_id;
  IF v_trial.id IS NULL THEN
    RAISE EXCEPTION 'no such stay %', p_stay_id;
  END IF;
  IF v_trial.kind <> 'candidate' THEN
    RAISE EXCEPTION 'stay % is a % stay, not a trial', p_stay_id, v_trial.kind;
  END IF;

  v_room := COALESCE(p_room_id, v_trial.room_id);
  v_start := COALESCE(
    p_starts_on,
    CASE WHEN v_trial.ends_on IS NOT NULL THEN v_trial.ends_on + 1 END,
    CURRENT_DATE);

  -- Close the trial the day before the residency starts: no overlap, no gap.
  -- A trial that already ended before that date is left as it is.
  IF v_trial.ends_on IS NULL OR v_trial.ends_on >= v_start THEN
    UPDATE recruit_stays
       SET ends_on = v_start - 1, updated_at = NOW()
     WHERE id = v_trial.id AND v_start - 1 >= starts_on;
  END IF;

  INSERT INTO recruit_stays (room_id, occupant, kind, starts_on, ends_on, applicant_id)
  VALUES (v_room, v_trial.occupant, 'resident', v_start, NULL, v_trial.applicant_id)
  RETURNING id INTO v_stay_id;

  INSERT INTO recruit_onboarding (stay_id, item, sort)
  SELECT v_stay_id, item, sort FROM recruit_onboarding_items()
  ON CONFLICT (stay_id, item) DO NOTHING;

  -- Only if the funnel knows them. A trial with no application still gets a
  -- resident stay and a checklist; there is simply no stage to move.
  IF v_trial.applicant_id IS NOT NULL THEN
    UPDATE recruit_applicants
       SET stage = 'resident', exit_reason = NULL, exit_until = NULL
     WHERE id = v_trial.applicant_id;
    -- They're housed; they have no business sitting in open listings. Marked
    -- removed rather than deleted — this table's tombstones are what stop the
    -- auto-sweep re-adding people, and they are worth keeping as history.
    UPDATE recruit_listing_candidates
       SET status = 'removed', updated_at = NOW()
     WHERE applicant_id = v_trial.applicant_id AND status = 'active';
  END IF;

  RETURN v_stay_id;
END;
$fn$;

-- Applicant-first door. Finds their trial and delegates; if there is no trial
-- stay on record (accepted straight off a screening, say), opens the resident
-- stay directly — p_room_id is required in that case.
CREATE OR REPLACE FUNCTION recruit_promote_candidate(
  p_applicant TEXT,
  p_room_id INT DEFAULT NULL,
  p_starts_on DATE DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $fn$
DECLARE
  v_trial_id UUID;
  v_name TEXT;
  v_stay_id UUID;
BEGIN
  IF NOT is_recruiting_member() THEN
    RAISE EXCEPTION 'recruiting members only';
  END IF;

  SELECT TRIM(CONCAT(first_name, ' ', COALESCE(last_name, ''))) INTO v_name
  FROM recruit_applicants WHERE id = p_applicant;
  IF v_name IS NULL THEN
    RAISE EXCEPTION 'no such applicant %', p_applicant;
  END IF;

  SELECT id INTO v_trial_id FROM recruit_stays
   WHERE kind = 'candidate' AND applicant_id = p_applicant
   ORDER BY starts_on DESC LIMIT 1;

  IF v_trial_id IS NOT NULL THEN
    RETURN recruit_promote_stay(v_trial_id, p_room_id, p_starts_on);
  END IF;

  IF p_room_id IS NULL THEN
    RAISE EXCEPTION 'no trial stay on record — pass a room to move them into';
  END IF;

  INSERT INTO recruit_stays (room_id, occupant, kind, starts_on, ends_on, applicant_id)
  VALUES (p_room_id, v_name, 'resident', COALESCE(p_starts_on, CURRENT_DATE), NULL, p_applicant)
  RETURNING id INTO v_stay_id;

  INSERT INTO recruit_onboarding (stay_id, item, sort)
  SELECT v_stay_id, item, sort FROM recruit_onboarding_items()
  ON CONFLICT (stay_id, item) DO NOTHING;

  UPDATE recruit_applicants
     SET stage = 'resident', exit_reason = NULL, exit_until = NULL
   WHERE id = p_applicant;
  UPDATE recruit_listing_candidates
     SET status = 'removed', updated_at = NOW()
   WHERE applicant_id = p_applicant AND status = 'active';

  RETURN v_stay_id;
END;
$fn$;

GRANT EXECUTE ON FUNCTION recruit_promote_stay(UUID, INT, DATE) TO authenticated;
GRANT EXECUTE ON FUNCTION recruit_promote_candidate(TEXT, INT, DATE) TO authenticated;
