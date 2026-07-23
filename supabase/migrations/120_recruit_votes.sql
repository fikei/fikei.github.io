-- ============================================
-- Migration 120: application-review voting + applicant stage machine
--
-- Restructures review from one shared decision into collective voting:
-- 3+ recruiting members score each applicant 1–5 ("would you live with
-- them?"); a single veto rejects. Thresholds live in recruit_settings so
-- the house can tune them without a deploy.
--
-- 1. recruit_applicants.stage — the funnel position, recomputed server-side
--    by a trigger on votes (single source of truth; clients never write it
--    directly, they call recruit_set_stage for manual overrides).
--      review    — gathering votes (the old Inbox)
--      candidate — passed review; waiting for / attached to a listing
--      rejected  — vetoed, voted down, or auto-flagged; owes an update
--                  email (queued surface lands in a later migration)
--      archived  — closed out with nothing owed (historical imports,
--                  manual archive)
-- 2. recruit_votes — one row per (applicant, voter). Veto is explicit and
--    separate from the 1–5 scale, and requires a note.
-- 3. Threshold settings + trigger + recruit_set_stage RPC.
-- 4. Backfill: existing shared decisions map onto stages
--    (outreach/hold → candidate, pass → archived — no email owed for
--    historical passes).
-- ============================================

ALTER TABLE recruit_applicants
  ADD COLUMN IF NOT EXISTS stage TEXT NOT NULL DEFAULT 'review'
  CHECK (stage IN ('review', 'candidate', 'rejected', 'archived'));
CREATE INDEX IF NOT EXISTS idx_recruit_applicants_stage ON recruit_applicants(stage);

CREATE TABLE IF NOT EXISTS recruit_votes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  applicant_id TEXT NOT NULL REFERENCES recruit_applicants(id) ON DELETE CASCADE,
  voter_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  voter_name TEXT,
  score SMALLINT CHECK (score BETWEEN 1 AND 5),
  veto BOOLEAN NOT NULL DEFAULT false,
  note TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (applicant_id, voter_id),
  CHECK (veto OR score IS NOT NULL),           -- a non-veto vote needs a score
  CHECK (NOT veto OR char_length(note) >= 3)   -- a veto needs a why
);
CREATE INDEX IF NOT EXISTS idx_recruit_votes_applicant ON recruit_votes(applicant_id);

ALTER TABLE recruit_votes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Recruiting members read votes" ON recruit_votes
  FOR SELECT TO authenticated USING (is_recruiting_member());
CREATE POLICY "Recruiting members insert own vote" ON recruit_votes
  FOR INSERT TO authenticated
  WITH CHECK (is_recruiting_member() AND voter_id = auth.uid());
CREATE POLICY "Recruiting members update own vote" ON recruit_votes
  FOR UPDATE TO authenticated
  USING (is_recruiting_member() AND voter_id = auth.uid())
  WITH CHECK (is_recruiting_member() AND voter_id = auth.uid());
CREATE POLICY "Recruiting members delete own vote" ON recruit_votes
  FOR DELETE TO authenticated
  USING (is_recruiting_member() AND voter_id = auth.uid());

INSERT INTO recruit_settings (key, value) VALUES
  ('vote_min_count', '3'::jsonb),
  ('vote_pass_avg', '3.5'::jsonb)
  ON CONFLICT (key) DO NOTHING;

-- Stage recompute — fires on any vote write. A veto rejects immediately
-- (auto-archive per house rule); enough passing votes promote to candidate;
-- otherwise the applicant stays in review. Manual 'archived' is never
-- overridden by vote math.
CREATE OR REPLACE FUNCTION recruit_recompute_stage()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  aid TEXT := COALESCE(NEW.applicant_id, OLD.applicant_id);
  cur TEXT;
  min_count NUMERIC;
  pass_avg NUMERIC;
  n_scores INT;
  avg_score NUMERIC;
  any_veto BOOLEAN;
  next_stage TEXT;
BEGIN
  SELECT stage INTO cur FROM recruit_applicants WHERE id = aid;
  IF cur IS NULL OR cur = 'archived' THEN RETURN NULL; END IF;

  SELECT COALESCE((value #>> '{}')::numeric, 3) INTO min_count FROM recruit_settings WHERE key = 'vote_min_count';
  SELECT COALESCE((value #>> '{}')::numeric, 3.5) INTO pass_avg FROM recruit_settings WHERE key = 'vote_pass_avg';
  min_count := COALESCE(min_count, 3);
  pass_avg := COALESCE(pass_avg, 3.5);

  SELECT COUNT(*) FILTER (WHERE NOT veto AND score IS NOT NULL),
         AVG(score) FILTER (WHERE NOT veto),
         COALESCE(BOOL_OR(veto), false)
    INTO n_scores, avg_score, any_veto
    FROM recruit_votes WHERE applicant_id = aid;

  IF any_veto THEN next_stage := 'rejected';
  ELSIF n_scores >= min_count AND avg_score >= pass_avg THEN next_stage := 'candidate';
  ELSE next_stage := 'review';
  END IF;

  UPDATE recruit_applicants SET stage = next_stage
    WHERE id = aid AND stage IS DISTINCT FROM next_stage;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_recruit_votes_stage ON recruit_votes;
CREATE TRIGGER trg_recruit_votes_stage
  AFTER INSERT OR UPDATE OR DELETE ON recruit_votes
  FOR EACH ROW EXECUTE FUNCTION recruit_recompute_stage();

-- Manual overrides (auto-flag disqualifiers, reopen from archive) go through
-- this RPC — recruit_applicants itself stays read-only to clients.
CREATE OR REPLACE FUNCTION recruit_set_stage(p_applicant TEXT, p_stage TEXT)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT is_recruiting_member() THEN
    RAISE EXCEPTION 'recruiting members only';
  END IF;
  IF p_stage NOT IN ('review', 'candidate', 'rejected', 'archived') THEN
    RAISE EXCEPTION 'unknown stage %', p_stage;
  END IF;
  UPDATE recruit_applicants SET stage = p_stage WHERE id = p_applicant;
END;
$$;

-- Backfill from the single-decision era. Historical passes owe no email.
UPDATE recruit_applicants a SET stage = CASE d.decision
    WHEN 'outreach' THEN 'candidate'
    WHEN 'hold' THEN 'candidate'
    ELSE 'archived'
  END
  FROM recruit_decisions d
  WHERE d.applicant_id = a.id AND a.stage = 'review';
