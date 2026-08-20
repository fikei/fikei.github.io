-- ============================================
-- Migration 176: sublet → resident trial
--
-- The third stay transition, same contract as the other two (168 accept,
-- recruit_promote_stay from 141): multiple moving parts, one RPC. A subletter
-- who wants to stay starts a trial — the sublet closes the day before the
-- trial starts (no overlap, no gap), the trial opens with its check-in and
-- decision milestones, and the application link rides along so the funnel
-- still knows them. Promotion to resident later goes through
-- recruit_promote_stay as usual.
-- ============================================

CREATE OR REPLACE FUNCTION recruit_sublet_to_trial(
  p_stay_id UUID,
  p_room_id INT DEFAULT NULL,
  p_starts_on DATE DEFAULT NULL,
  p_ends_on DATE DEFAULT NULL,
  p_checkin_on DATE DEFAULT NULL,
  p_decision_on DATE DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $fn$
DECLARE
  v recruit_stays%ROWTYPE;
  v_room INT;
  v_start DATE;
  v_stay_id UUID;
BEGIN
  IF NOT is_recruiting_member() THEN
    RAISE EXCEPTION 'recruiting members only';
  END IF;

  SELECT * INTO v FROM recruit_stays WHERE id = p_stay_id;
  IF v.id IS NULL THEN
    RAISE EXCEPTION 'no such stay %', p_stay_id;
  END IF;
  IF v.kind <> 'sublet' THEN
    RAISE EXCEPTION 'stay % is a % stay, not a sublet', p_stay_id, v.kind;
  END IF;

  v_room := COALESCE(p_room_id, v.room_id);
  v_start := COALESCE(
    p_starts_on,
    CASE WHEN v.ends_on IS NOT NULL THEN v.ends_on + 1 END,
    CURRENT_DATE);
  IF p_ends_on IS NOT NULL AND p_ends_on < v_start THEN
    RAISE EXCEPTION 'the trial would end (%) before it starts (%)', p_ends_on, v_start;
  END IF;

  -- Close the sublet the day before the trial: no overlap, no gap. A sublet
  -- that already ended before that date is left as it is.
  IF v.ends_on IS NULL OR v.ends_on >= v_start THEN
    UPDATE recruit_stays
       SET ends_on = v_start - 1, updated_at = NOW()
     WHERE id = v.id AND v_start - 1 >= starts_on;
  END IF;

  INSERT INTO recruit_stays (room_id, occupant, kind, starts_on, ends_on,
                             applicant_id, buddy_name, movein,
                             checkin_on, decision_on)
  VALUES (v_room, v.occupant, 'candidate', v_start, p_ends_on,
          v.applicant_id, v.buddy_name, v.movein,
          p_checkin_on, p_decision_on)
  RETURNING id INTO v_stay_id;

  -- The funnel already knows them if they came through it; a hand-entered
  -- subletter simply has no stage to keep in sync.
  IF v.applicant_id IS NOT NULL THEN
    UPDATE recruit_applicants
       SET stage = 'candidate', exit_reason = NULL, exit_until = NULL
     WHERE id = v.applicant_id AND stage <> 'resident';
  END IF;

  RETURN v_stay_id;
END;
$fn$;

GRANT EXECUTE ON FUNCTION recruit_sublet_to_trial(UUID, INT, DATE, DATE, DATE, DATE) TO authenticated;
