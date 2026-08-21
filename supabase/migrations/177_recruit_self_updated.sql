-- ============================================
-- Migration 177: who touched the application row — them, or us?
--
-- "Ian updated his application" must mean IAN did. recruit_applicants is
-- written by the applicant (the /apply RPCs run under their own auth.uid())
-- and by recruiters and service-role automation. updated_at can't tell those
-- apart, so the application_updated notification would fire when a recruiter
-- tidied a phone number.
--
-- self_updated_at is stamped by a trigger only when the writer IS the row's
-- own user — auth.uid() inside a SECURITY DEFINER function is still the
-- caller, so the /apply save/submit/reapply paths stamp it and nothing else
-- does (recruiters have a different uid; service-role has none).
-- ============================================

ALTER TABLE recruit_applicants
  ADD COLUMN IF NOT EXISTS self_updated_at TIMESTAMPTZ;

COMMENT ON COLUMN recruit_applicants.self_updated_at IS
  'Last write made by the applicant''s own session (/apply). Feeds the application_updated notification; recruiter/automation writes never stamp it.';

CREATE OR REPLACE FUNCTION recruit_stamp_self_update()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF NEW.user_id IS NOT NULL AND NEW.user_id = auth.uid() THEN
    NEW.self_updated_at := NOW();
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS recruit_applicants_self_update ON recruit_applicants;
CREATE TRIGGER recruit_applicants_self_update
  BEFORE UPDATE ON recruit_applicants
  FOR EACH ROW EXECUTE FUNCTION recruit_stamp_self_update();
