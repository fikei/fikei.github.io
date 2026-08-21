-- ============================================
-- Migration 175: step back from a booking before move-in
--
-- The accept flow's undo. Plans change before move-in day; until now the only
-- way back was hand-surgery across three tables (delete the stay, reopen the
-- listing, resurrect placements) — exactly the half-applied risk the accept
-- RPC (168) exists to prevent, so the way back is one RPC too.
--
-- What it restores, and what it deliberately does not:
--   * The stay is DELETED, not ended — a booking stepped back from before it
--     started never happened. (An ended trial is recorded history; this isn't.)
--   * The room's filled listing reopens.
--   * The person goes back INTO that listing as a candidate — their tombstone
--     there was written by the accept RPC, not by a recruiter's "never here
--     again", so flipping it back is honest.
--   * Every other tombstone stays: those ARE recruiter removals. Everyone
--     else who qualifies comes back via the auto-placement sweep the moment
--     the listing is open again — "back unless explicitly closed" for free.
--   * The yes decision and stage 'candidate' stand — stepping back from the
--     ROOM is not a change of heart about the PERSON; the Remove sheet is.
-- ============================================

CREATE OR REPLACE FUNCTION recruit_unbook_stay(p_stay_id UUID)
RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $fn$
DECLARE
  v recruit_stays%ROWTYPE;
  v_listing recruit_listings%ROWTYPE;
BEGIN
  IF NOT is_recruiting_member() THEN
    RAISE EXCEPTION 'recruiting members only';
  END IF;

  SELECT * INTO v FROM recruit_stays WHERE id = p_stay_id;
  IF v.id IS NULL THEN
    RAISE EXCEPTION 'no such stay %', p_stay_id;
  END IF;
  IF v.kind NOT IN ('candidate', 'sublet') OR v.applicant_id IS NULL THEN
    RAISE EXCEPTION 'only a booked trial or sublet with an application behind it can be stepped back';
  END IF;
  IF v.starts_on < CURRENT_DATE THEN
    RAISE EXCEPTION 'their stay already started (%) — end it from the stay form instead', v.starts_on;
  END IF;

  -- The listing the booking filled: the room's most recently filled one.
  SELECT * INTO v_listing FROM recruit_listings
   WHERE room_id = v.room_id AND status = 'filled'
   ORDER BY created_at DESC LIMIT 1;

  IF v_listing.id IS NOT NULL THEN
    UPDATE recruit_listings SET status = 'open' WHERE id = v_listing.id;
    -- Back into the shortlist. Their tombstone here was the accept RPC's,
    -- so it flips back; 'manual' keeps the sweep from pruning them if their
    -- dates don't strictly qualify — the house already said yes once.
    UPDATE recruit_listing_candidates
       SET status = 'active', source = 'manual', updated_at = NOW()
     WHERE applicant_id = v.applicant_id AND listing_id = v_listing.id;
    IF NOT FOUND THEN
      INSERT INTO recruit_listing_candidates (applicant_id, listing_id, source, status)
      VALUES (v.applicant_id, v_listing.id, 'manual', 'active')
      ON CONFLICT (applicant_id, listing_id)
        DO UPDATE SET status = 'active', source = 'manual', updated_at = NOW();
    END IF;
  END IF;

  -- The day-of draft, if the detector already wrote one, dies with the stay.
  DELETE FROM recruit_email_drafts
   WHERE applicant_id = v.applicant_id AND kind = 'movein_day';

  DELETE FROM recruit_stays WHERE id = v.id;

  RETURN v_listing.id;
END;
$fn$;

GRANT EXECUTE ON FUNCTION recruit_unbook_stay(UUID) TO authenticated;
