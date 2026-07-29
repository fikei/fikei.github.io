-- ============================================
-- Migration 138: recordings we didn't make
--
-- Calls get recorded outside the pipeline all the time — someone runs the
-- intro on tldv, or Zoom, or records to Drive. Today the only recordings the
-- app can show are ones Recall's bot captured (recall_bot_id) or ones we
-- archived to storage (recording_path). Everything else is a link pasted
-- into Discord that nobody can find two weeks later.
--
-- external_recording_url holds that link on the screening row, so the Watch
-- affordance works regardless of who did the recording. It is a LINK, not a
-- stream: tldv and friends refuse to embed cross-origin, so the UI opens it
-- in a new tab rather than pretending it can play inline.
-- ============================================

ALTER TABLE recruit_screenings
  ADD COLUMN IF NOT EXISTS external_recording_url TEXT,
  ADD COLUMN IF NOT EXISTS external_recording_source TEXT,
  ADD COLUMN IF NOT EXISTS external_recording_by_name TEXT,
  ADD COLUMN IF NOT EXISTS external_recording_at TIMESTAMPTZ;

-- Only http(s). Cheap guard against a javascript: URL reaching an href.
DO $$
BEGIN
  ALTER TABLE recruit_screenings
    ADD CONSTRAINT recruit_screenings_external_url_chk
    CHECK (external_recording_url IS NULL OR external_recording_url ~* '^https?://');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Attach a recording link to an applicant. Creates a bare screening row when
-- there's nothing to hang it on — a call that happened entirely outside the
-- app still deserves a record. Kind stays intro_call: someone bothered to
-- record it, so it was a call.
CREATE OR REPLACE FUNCTION recruit_attach_recording(
  p_applicant TEXT,
  p_url TEXT,
  p_source TEXT,
  p_name TEXT,
  p_screening UUID DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  target UUID;
BEGIN
  IF NOT is_recruiting_member() THEN
    RAISE EXCEPTION 'recruiting members only';
  END IF;
  IF p_url IS NOT NULL AND p_url !~* '^https?://' THEN
    RAISE EXCEPTION 'recording link must be an http(s) URL';
  END IF;

  target := p_screening;
  IF target IS NULL THEN
    -- Most recent call for this applicant that has no recording yet.
    SELECT id INTO target FROM recruit_screenings
      WHERE applicant_id = p_applicant
        AND kind = 'intro_call'
        AND external_recording_url IS NULL
        AND recall_bot_id IS NULL
      ORDER BY starts_at DESC LIMIT 1;
  END IF;

  IF target IS NULL THEN
    INSERT INTO recruit_screenings (applicant_id, starts_at, ends_at, status, kind, housemate_name)
      VALUES (p_applicant, NOW(), NOW(), 'completed', 'intro_call', 'recorded elsewhere')
      RETURNING id INTO target;
  END IF;

  UPDATE recruit_screenings SET
    external_recording_url = p_url,
    external_recording_source = CASE WHEN p_url IS NULL THEN NULL ELSE p_source END,
    external_recording_by_name = CASE WHEN p_url IS NULL THEN NULL ELSE p_name END,
    external_recording_at = CASE WHEN p_url IS NULL THEN NULL ELSE NOW() END
  WHERE id = target;

  RETURN target;
END;
$$;

-- Links harvested from Discord that we couldn't confidently attribute. The
-- app offers them as suggestions; a human picks the applicant. Never
-- auto-attached: a wrong recording on a profile is worse than none.
CREATE TABLE IF NOT EXISTS recruit_recording_leads (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  url TEXT NOT NULL UNIQUE,
  source TEXT,
  channel_id TEXT,
  message_id TEXT,
  posted_at TIMESTAMPTZ,
  author_name TEXT,
  context TEXT,
  suggested_applicant_id TEXT REFERENCES recruit_applicants(id) ON DELETE SET NULL,
  resolved_applicant_id TEXT REFERENCES recruit_applicants(id) ON DELETE SET NULL,
  dismissed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE recruit_recording_leads ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS recruit_recording_leads_read ON recruit_recording_leads;
CREATE POLICY recruit_recording_leads_read ON recruit_recording_leads
  FOR SELECT USING (is_recruiting_member());

DROP POLICY IF EXISTS recruit_recording_leads_write ON recruit_recording_leads;
CREATE POLICY recruit_recording_leads_write ON recruit_recording_leads
  FOR UPDATE USING (is_recruiting_member()) WITH CHECK (is_recruiting_member());

CREATE INDEX IF NOT EXISTS recruit_recording_leads_open_idx
  ON recruit_recording_leads (posted_at DESC)
  WHERE resolved_applicant_id IS NULL AND dismissed_at IS NULL;
