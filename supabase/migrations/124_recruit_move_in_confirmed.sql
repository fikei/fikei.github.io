-- ============================================
-- Migration 124: recruiter-confirmed move-in window
--
-- What an applicant typed in the form is often vague; after emailing them a
-- recruiter learns the real dates. This adds a structured, attributed
-- confirmed window on the applicant. When set, the client uses it instead of
-- the parsed free text everywhere dates matter (row sublines, filters, and
-- listing auto-placement qualification).
--
-- Writes go through an RPC (recruit_applicants stays client-read-only,
-- same pattern as recruit_set_stage). Passing a NULL start clears it.
-- ============================================

ALTER TABLE recruit_applicants
  ADD COLUMN IF NOT EXISTS move_in_from DATE,
  ADD COLUMN IF NOT EXISTS move_in_to DATE,
  ADD COLUMN IF NOT EXISTS move_in_set_by_name TEXT,
  ADD COLUMN IF NOT EXISTS move_in_set_at TIMESTAMPTZ;

CREATE OR REPLACE FUNCTION recruit_set_move_in(p_applicant TEXT, p_from DATE, p_to DATE, p_name TEXT)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT is_recruiting_member() THEN
    RAISE EXCEPTION 'recruiting members only';
  END IF;
  IF p_from IS NULL AND p_to IS NOT NULL THEN
    RAISE EXCEPTION 'a through-date needs a start date';
  END IF;
  IF p_to IS NOT NULL AND p_to < p_from THEN
    RAISE EXCEPTION 'through-date is before the start date';
  END IF;
  UPDATE recruit_applicants SET
    move_in_from = p_from,
    move_in_to = p_to,
    move_in_set_by_name = CASE WHEN p_from IS NULL THEN NULL ELSE p_name END,
    move_in_set_at = CASE WHEN p_from IS NULL THEN NULL ELSE NOW() END
  WHERE id = p_applicant;
END;
$$;
