-- ============================================
-- Migration 171: re-apply path for closed applications
--
-- A rejected or archived applicant can reopen their own application from
-- /apply. One row per email stays the model: re-applying reopens the SAME
-- row rather than minting a twin (which would fight the ingest dedupe and
-- confuse the Gmail matcher).
--
-- What "reopen" means:
--   1. The prior outcome is snapshotted into a recruit_comment, so the house
--      keeps the story even though the machinery resets.
--   2. Votes, the shared decision, decision votes, and exit_* fields clear —
--      a stale veto would otherwise re-reject them the moment anyone votes.
--   3. stage -> 'review', is_submitted -> false: they walk the form again
--      (prefilled) and resubmit. Until then the row is a hidden draft.
--   4. The rejection-email bookkeeping clears, so a future decision sends a
--      fresh notification instead of being swallowed by the old timestamps.
--
-- recruit_apply_submit also changes: a draft crossing into submitted stamps
-- a fresh submitted_at, so a re-application sorts as new in the Inbox.
-- ============================================

/* Reopen the caller's own closed application. */
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

  -- The prior outcome, preserved as a house note before the reset.
  story := 'Re-applied via /apply. Previous application was ' || rec.stage
    || COALESCE(' on ' || to_char(rec.exit_at, 'Mon FMDD, YYYY'), '')
    || COALESCE(' (' || NULLIF(rec.exit_reason, '') || ')', '')
    || COALESCE(' — ' || NULLIF(rec.exit_note, ''), '')
    || COALESCE('. Decided by ' || NULLIF(rec.exit_by_name, ''), '')
    || '. Prior votes and decision were cleared for a fresh review; comments below are from the earlier round.';
  INSERT INTO recruit_comments (applicant_id, author_name, body, created_at)
    VALUES (rec.id, 'System', left(story, 4000), NOW());

  DELETE FROM recruit_votes WHERE applicant_id = rec.id;
  DELETE FROM recruit_decision_votes WHERE applicant_id = rec.id;
  DELETE FROM recruit_decisions WHERE applicant_id = rec.id;

  UPDATE recruit_applicants
     SET stage = 'review',
         is_submitted = false,
         exit_reason = NULL, exit_until = NULL, exit_note = '',
         exit_by_name = NULL, exit_at = NULL,
         update_email_sent_at = NULL, update_email_skipped_at = NULL,
         updated_at = NOW()
   WHERE user_id = uid;

  RETURN recruit_apply_load();
END;
$$;

GRANT EXECUTE ON FUNCTION recruit_apply_reapply() TO authenticated;

/* Resubmission stamps a fresh submitted_at: only a draft crossing into
   submitted takes NOW(); edits to an already-submitted application keep the
   original date (that is what updated_at is for). */
CREATE OR REPLACE FUNCTION recruit_apply_submit()
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  uid UUID := auth.uid();
  rec recruit_applicants%ROWTYPE;
BEGIN
  IF uid IS NULL THEN
    RAISE EXCEPTION 'sign in first';
  END IF;
  SELECT * INTO rec FROM recruit_applicants WHERE user_id = uid LIMIT 1;
  IF rec.id IS NULL THEN
    RAISE EXCEPTION 'nothing to submit — save the form first';
  END IF;
  IF rec.stage <> 'review' THEN
    RAISE EXCEPTION 'application is locked (stage %)', rec.stage;
  END IF;
  IF btrim(rec.first_name) = '' OR btrim(rec.why_agape) = '' THEN
    RAISE EXCEPTION 'name and "why Agape" are required before submitting';
  END IF;

  UPDATE recruit_applicants
     SET is_submitted = true,
         submitted_at = CASE WHEN rec.is_submitted THEN submitted_at ELSE NOW() END,
         updated_at = NOW()
   WHERE user_id = uid;

  RETURN recruit_apply_load();
END;
$$;

/* recruit_apply_load grows two fields the locked view needs: can_reapply,
   and return_after (exit_until, only when the house said "check back
   later" — other exit reasons stay private). */
CREATE OR REPLACE FUNCTION recruit_apply_load()
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  uid UUID := auth.uid();
  mail TEXT := lower(COALESCE(auth.email(), ''));
  rec recruit_applicants%ROWTYPE;
BEGIN
  IF uid IS NULL OR mail = '' THEN
    RAISE EXCEPTION 'sign in first';
  END IF;

  SELECT * INTO rec FROM recruit_applicants WHERE user_id = uid LIMIT 1;
  IF rec.id IS NULL THEN
    UPDATE recruit_applicants SET user_id = uid
      WHERE lower(email) = mail AND user_id IS NULL
      RETURNING * INTO rec;
  END IF;

  IF rec.id IS NULL THEN
    RETURN NULL;
  END IF;

  RETURN jsonb_build_object(
    'id', rec.id,
    'email', rec.email,
    'first_name', rec.first_name, 'last_name', rec.last_name,
    'pronouns', rec.pronouns, 'phone', rec.phone, 'social', rec.social,
    'about', rec.about, 'why_agape', rec.why_agape, 'gifts', rec.gifts,
    'heard_from', rec.heard_from, 'residency', rec.residency,
    'move_in', rec.move_in, 'budget', rec.budget,
    'stage', rec.stage, 'is_submitted', rec.is_submitted,
    'submitted_at', rec.submitted_at, 'updated_at', rec.updated_at,
    'can_reapply', rec.stage IN ('rejected', 'archived'),
    'return_after', CASE WHEN rec.exit_reason = 'future' THEN rec.exit_until END
  );
END;
$$;
