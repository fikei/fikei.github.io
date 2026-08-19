-- ============================================
-- Migration 168: the accept flow — decision to booked room in one step
--
-- Until now "yes — accept" wrote a decision row and stopped. Actually filling
-- the room took three disconnected manual steps in Occupancy: a free-text
-- stay form that never linked applicant_id (the exact drift migration 141
-- complained about), a separate "mark filled" on the listing, and remembering
-- to do both. listing_filled_no_stay exists purely to nag about the halves
-- coming apart.
--
-- recruit_accept_applicant is the missing bridge: one transaction that books
-- the accepted applicant into the listing's room. It creates the stay LINKED
-- to the application (trial for resident-track listings, sublet otherwise),
-- marks the listing filled, tombstones their placements, and normalizes the
-- applicant's stage. All of it, or none of it — same contract as
-- recruit_promote_stay, which stays the door from trial to residency.
-- ============================================

CREATE OR REPLACE FUNCTION recruit_accept_applicant(
  p_applicant TEXT,
  p_listing UUID,
  p_starts_on DATE DEFAULT NULL,
  p_ends_on DATE DEFAULT NULL,
  p_checkin_on DATE DEFAULT NULL,
  p_decision_on DATE DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $fn$
DECLARE
  v_l recruit_listings%ROWTYPE;
  v_name TEXT;
  v_kind TEXT;
  v_start DATE;
  v_end DATE;
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

  SELECT * INTO v_l FROM recruit_listings WHERE id = p_listing;
  IF v_l.id IS NULL THEN
    RAISE EXCEPTION 'no such listing %', p_listing;
  END IF;
  IF v_l.status <> 'open' THEN
    RAISE EXCEPTION 'that listing is % — reopen it first', v_l.status;
  END IF;

  -- One person, one live stay. A double-book is always a mistake here; the
  -- occupancy drawer is the place to edit a stay that already exists.
  IF EXISTS (
    SELECT 1 FROM recruit_stays
     WHERE applicant_id = p_applicant AND kind <> 'shared'
       AND (ends_on IS NULL OR ends_on >= CURRENT_DATE)
  ) THEN
    RAISE EXCEPTION 'they already have a live stay on the calendar';
  END IF;

  -- Resident-track listings book as a trial (the residency itself comes
  -- later, through recruit_promote_stay); sublet listings book as the sublet.
  v_kind := CASE WHEN v_l.kind = 'resident' THEN 'candidate' ELSE 'sublet' END;
  v_start := COALESCE(p_starts_on, GREATEST(v_l.starts_on, CURRENT_DATE));
  v_end := COALESCE(p_ends_on, v_l.ends_on);
  IF v_end IS NOT NULL AND v_end < v_start THEN
    RAISE EXCEPTION 'the stay would end (%) before it starts (%)', v_end, v_start;
  END IF;

  INSERT INTO recruit_stays (room_id, occupant, kind, starts_on, ends_on,
                             applicant_id, checkin_on, decision_on)
  VALUES (v_l.room_id, v_name, v_kind, v_start, v_end, p_applicant,
          CASE WHEN v_kind = 'candidate' THEN p_checkin_on END,
          CASE WHEN v_kind = 'candidate' THEN p_decision_on END)
  RETURNING id INTO v_stay_id;

  UPDATE recruit_listings SET status = 'filled' WHERE id = v_l.id;

  -- Booked people leave the placement board. Tombstoned, not deleted — the
  -- tombstones are what stop the auto-sweep re-adding them.
  UPDATE recruit_listing_candidates
     SET status = 'removed', updated_at = NOW()
   WHERE applicant_id = p_applicant AND status = 'active';

  -- Booking implies the funnel said yes: normalize a stray stage or exit so
  -- the record can't read "saved for future" while they're on the calendar.
  UPDATE recruit_applicants
     SET stage = 'candidate', exit_reason = NULL, exit_until = NULL
   WHERE id = p_applicant AND stage <> 'resident';

  RETURN v_stay_id;
END;
$fn$;

GRANT EXECUTE ON FUNCTION recruit_accept_applicant(TEXT, UUID, DATE, DATE, DATE, DATE) TO authenticated;
