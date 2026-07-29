-- ============================================
-- Migration 140: one reviewer, three verdicts
--
-- Replaces the collective 1-5 score + veto with a single decisive review:
--   not_fit      -> Archive (an update email is owed, same as the old veto)
--   needs_input  -> stays in the Inbox, explicitly asking for another read
--   forward      -> Candidates
-- One response decides, and every verdict requires a comment.
--
-- score/veto stay on the table so old rows keep their meaning in history, but
-- nothing reads them for stage decisions any more. The CHECK constraints that
-- forced a score or a veto are dropped: a verdict row has neither.
--
-- voter_id becomes nullable alongside a new voter_email, so a review can be
-- attributed to a housemate who hasn't signed in yet (the Google Sheet import
-- lands Kate's reviews on kstoreyfisher@gmail.com; they become hers the moment
-- her Discord sign-in maps to that roster email). Same for comments.
-- ============================================

ALTER TABLE recruit_votes ADD COLUMN IF NOT EXISTS verdict TEXT;
ALTER TABLE recruit_votes DROP CONSTRAINT IF EXISTS recruit_votes_verdict_chk;
ALTER TABLE recruit_votes ADD CONSTRAINT recruit_votes_verdict_chk
  CHECK (verdict IS NULL OR verdict IN ('not_fit', 'needs_input', 'forward'));

-- A verdict carries no score and needn't be a veto; the old shape constraints
-- would reject every new row.
ALTER TABLE recruit_votes DROP CONSTRAINT IF EXISTS recruit_votes_check;   -- veto OR score IS NOT NULL
ALTER TABLE recruit_votes DROP CONSTRAINT IF EXISTS recruit_votes_check1;  -- veto => note >= 3

-- Every verdict needs a why, whichever verdict it is.
ALTER TABLE recruit_votes DROP CONSTRAINT IF EXISTS recruit_votes_note_chk;
ALTER TABLE recruit_votes ADD CONSTRAINT recruit_votes_note_chk
  CHECK (verdict IS NULL OR char_length(btrim(note)) >= 3);

-- Attribution for reviews written outside the app.
ALTER TABLE recruit_votes ALTER COLUMN voter_id DROP NOT NULL;
ALTER TABLE recruit_votes ADD COLUMN IF NOT EXISTS voter_email TEXT;
ALTER TABLE recruit_comments ALTER COLUMN user_id DROP NOT NULL;
ALTER TABLE recruit_comments ADD COLUMN IF NOT EXISTS author_email TEXT;
ALTER TABLE recruit_comments ADD COLUMN IF NOT EXISTS source TEXT;  -- 'sheet' for imports

-- UNIQUE (applicant_id, voter_id) can't hold an imported row (null voter_id),
-- so key those on the email too — one review per housemate either way. Not a
-- partial index: ON CONFLICT can only infer a plain one, and a null
-- voter_email never collides in Postgres anyway.
CREATE UNIQUE INDEX IF NOT EXISTS recruit_votes_applicant_email_key
  ON recruit_votes (applicant_id, voter_email);

-- Legacy rows keep their meaning: a veto was archival, a score of 4-5 was a
-- pass, anything else was still a question.
UPDATE recruit_votes SET verdict =
  CASE WHEN veto THEN 'not_fit'
       WHEN score >= 4 THEN 'forward'
       ELSE 'needs_input' END
  WHERE verdict IS NULL;

-- Service-role imports bypass RLS; the client policies stay as they are (a
-- housemate may only write their own review, keyed on voter_id = auth.uid()),
-- so an imported row can't be edited from the app until its owner signs in.
-- Reads are unchanged: any recruiting member sees every review.

-- ---- Stage machine: the most recent decisive verdict wins ----
-- Recency, not first-past-the-post: re-reviewing someone is how you change
-- your mind, and 'needs_input' deliberately decides nothing.
CREATE OR REPLACE FUNCTION recruit_recompute_stage() RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  aid TEXT := COALESCE(NEW.applicant_id, OLD.applicant_id);
  cur TEXT;
  decisive TEXT;
  next_stage TEXT;
BEGIN
  SELECT stage INTO cur FROM recruit_applicants WHERE id = aid;
  IF cur IS NULL OR cur = 'archived' THEN RETURN NULL; END IF;

  SELECT verdict INTO decisive FROM recruit_votes
    WHERE applicant_id = aid AND verdict IN ('not_fit', 'forward')
    ORDER BY COALESCE(updated_at, created_at) DESC
    LIMIT 1;

  IF decisive = 'not_fit' THEN next_stage := 'rejected';
  ELSIF decisive = 'forward' THEN next_stage := 'candidate';
  ELSE next_stage := 'review';
  END IF;

  UPDATE recruit_applicants SET stage = next_stage
    WHERE id = aid AND stage IS DISTINCT FROM next_stage;
  RETURN NULL;
END;
$$;

-- The thresholds described a group vote that no longer exists.
DELETE FROM recruit_settings WHERE key IN ('vote_min_count', 'vote_pass_avg');
