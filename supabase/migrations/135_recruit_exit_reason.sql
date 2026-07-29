-- ============================================
-- Migration 135: why someone left a listing
--
-- "Pass" used to collapse three different outcomes into one destructive
-- action that always archived AND queued a rejection email. They're
-- distinct facts and the house needs to tell them apart:
--
--   listing      removed from THIS listing only — still a candidate elsewhere
--   future       right person, wrong time — comes back on exit_until
--   opted_out    they withdrew — archived, no update email owed
--   not_a_fit    our no — archived, update email owed (today's 'pass')
--
-- Only 'future' uses exit_until: the client's auto-return sweep filters on
-- it, so it has to be a real DATE rather than a note. The other three leave
-- it NULL.
--
-- 'listing' is deliberately NOT recorded here — it's per-listing, and
-- recruit_listing_candidates.status already holds that tombstone. This
-- column answers "why are they out of the funnel", not "which room".
--
-- Writes go through an RPC (recruit_applicants stays client-read-only, same
-- pattern as recruit_set_stage / recruit_set_move_in). Passing a NULL reason
-- clears the exit — that's the Undo path.
-- ============================================

ALTER TABLE recruit_applicants
  ADD COLUMN IF NOT EXISTS exit_reason TEXT,
  ADD COLUMN IF NOT EXISTS exit_until DATE,
  ADD COLUMN IF NOT EXISTS exit_note TEXT,
  ADD COLUMN IF NOT EXISTS exit_by_name TEXT,
  ADD COLUMN IF NOT EXISTS exit_at TIMESTAMPTZ;

DO $$
BEGIN
  ALTER TABLE recruit_applicants
    ADD CONSTRAINT recruit_applicants_exit_reason_chk
    CHECK (exit_reason IS NULL OR exit_reason IN ('future', 'opted_out', 'not_a_fit'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- A return date only means something for 'future'.
DO $$
BEGIN
  ALTER TABLE recruit_applicants
    ADD CONSTRAINT recruit_applicants_exit_until_chk
    CHECK (exit_until IS NULL OR exit_reason = 'future');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Partial index: the auto-return sweep asks "who's due back?" on every load.
CREATE INDEX IF NOT EXISTS recruit_applicants_exit_until_idx
  ON recruit_applicants (exit_until)
  WHERE exit_reason = 'future';

CREATE OR REPLACE FUNCTION recruit_set_exit(
  p_applicant TEXT,
  p_reason TEXT,
  p_until DATE,
  p_note TEXT,
  p_name TEXT
)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT is_recruiting_member() THEN
    RAISE EXCEPTION 'recruiting members only';
  END IF;
  IF p_reason IS NOT NULL AND p_reason NOT IN ('future', 'opted_out', 'not_a_fit') THEN
    RAISE EXCEPTION 'unknown exit reason %', p_reason;
  END IF;
  IF p_until IS NOT NULL AND p_reason IS DISTINCT FROM 'future' THEN
    RAISE EXCEPTION 'only a future-fit exit carries a return date';
  END IF;
  IF p_reason = 'future' AND p_until IS NULL THEN
    RAISE EXCEPTION 'a future-fit exit needs a return date';
  END IF;

  UPDATE recruit_applicants SET
    exit_reason  = p_reason,
    exit_until   = p_until,
    exit_note    = CASE WHEN p_reason IS NULL THEN NULL ELSE p_note END,
    exit_by_name = CASE WHEN p_reason IS NULL THEN NULL ELSE p_name END,
    exit_at      = CASE WHEN p_reason IS NULL THEN NULL ELSE NOW() END
  WHERE id = p_applicant;
END;
$$;

-- Backfill from the two verbs that came before this sheet:
--   'pass' + reason 'dropped-out'  → they withdrew        → opted_out
--   'pass' + anything else         → our no               → not_a_fit
-- The dropped-out carve-out matters: those people chose to leave, and
-- relabelling them 'not a fit' would misattribute the decision to the house.
-- Historical rows keep their attribution; update-email state is untouched.
UPDATE recruit_applicants a
  SET exit_reason = CASE WHEN d.reason = 'dropped-out' THEN 'opted_out' ELSE 'not_a_fit' END,
      exit_by_name = d.decided_by_name,
      exit_at = d.decided_at
  FROM recruit_decisions d
  WHERE d.applicant_id = a.id
    AND d.decision = 'pass'
    AND a.stage IN ('rejected', 'archived')
    AND a.exit_reason IS NULL;
