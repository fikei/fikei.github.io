-- ============================================
-- Migration 172: re-apply clears the fields that age
--
-- Stay type, move-in date, and budget are answers about a moment in time —
-- on a re-application months later they are stale by definition, and a
-- prefilled stale answer gets rubber-stamped. Clearing them forces a fresh
-- answer as the applicant walks the form again (all three are required
-- questions); essays and contact details stay prefilled.
-- ============================================

CREATE OR REPLACE FUNCTION recruit_apply_reapply()
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  uid UUID := auth.uid();
  rec recruit_applicants%ROWTYPE;
  story TEXT;
BEGIN
  IF uid IS NULL THEN
    RAISE EXCEPTION 'sign in first';
  END IF;
  SELECT * INTO rec FROM recruit_applicants WHERE user_id = uid LIMIT 1;
  IF rec.id IS NULL THEN
    RAISE EXCEPTION 'no application to reopen';
  END IF;
  IF rec.stage NOT IN ('rejected', 'archived') THEN
    RAISE EXCEPTION 'application is % — nothing to reopen', rec.stage;
  END IF;

  story := 'Re-applied via /apply. Previous application was ' || rec.stage
    || COALESCE(' on ' || to_char(rec.exit_at, 'Mon FMDD, YYYY'), '')
    || COALESCE(' (' || NULLIF(rec.exit_reason, '') || ')', '')
    || COALESCE(' — ' || NULLIF(rec.exit_note, ''), '')
    || COALESCE('. Decided by ' || NULLIF(rec.exit_by_name, ''), '')
    || '. Prior stay type was "' || COALESCE(NULLIF(rec.residency, ''), '—')
    || '", move-in "' || COALESCE(NULLIF(rec.move_in, ''), '—')
    || '", budget "' || COALESCE(NULLIF(rec.budget, ''), '—')
    || '". Prior votes and decision were cleared for a fresh review; comments below are from the earlier round.';
  INSERT INTO recruit_comments (applicant_id, author_name, body, created_at)
    VALUES (rec.id, 'System', left(story, 4000), NOW());

  DELETE FROM recruit_votes WHERE applicant_id = rec.id;
  DELETE FROM recruit_decision_votes WHERE applicant_id = rec.id;
  DELETE FROM recruit_decisions WHERE applicant_id = rec.id;

  UPDATE recruit_applicants
     SET stage = 'review',
         is_submitted = false,
         -- Time-sensitive answers reset; the form makes them required again.
         residency = '', move_in = '', budget = '',
         exit_reason = NULL, exit_until = NULL, exit_note = '',
         exit_by_name = NULL, exit_at = NULL,
         update_email_sent_at = NULL, update_email_skipped_at = NULL,
         updated_at = NOW()
   WHERE user_id = uid;

  RETURN recruit_apply_load();
END;
$$;
