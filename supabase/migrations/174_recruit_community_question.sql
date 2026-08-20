-- ============================================
-- Migration 174: "What's important to you in community?"
--
-- Fourth essay on /apply (v1.6.0), its own column like anything_else.
-- Also: the three core essays (about / why_agape / gifts) became required
-- on the form, so recruit_apply_submit enforces the same server-side.
-- ============================================

ALTER TABLE recruit_applicants ADD COLUMN IF NOT EXISTS community TEXT NOT NULL DEFAULT '';

CREATE OR REPLACE FUNCTION recruit_apply_columns()
RETURNS TEXT[]
LANGUAGE sql IMMUTABLE AS $$
  SELECT ARRAY['first_name','last_name','pronouns','phone','social','about',
               'why_agape','gifts','heard_from','residency','move_in','budget',
               'anything_else','community'];
$$;

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
    'anything_else', rec.anything_else, 'community', rec.community,
    'stage', rec.stage, 'is_submitted', rec.is_submitted,
    'submitted_at', rec.submitted_at, 'updated_at', rec.updated_at,
    'can_reapply', rec.stage IN ('rejected', 'archived'),
    'return_after', CASE WHEN rec.exit_reason = 'future' THEN rec.exit_until END
  );
END;
$$;

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
  IF btrim(rec.first_name) = '' OR btrim(rec.why_agape) = ''
     OR btrim(rec.about) = '' OR btrim(rec.gifts) = '' THEN
    RAISE EXCEPTION 'name and the three core questions (about you, why Agape, what you''d bring) are required before submitting';
  END IF;

  UPDATE recruit_applicants
     SET is_submitted = true,
         submitted_at = CASE WHEN rec.is_submitted THEN submitted_at ELSE NOW() END,
         updated_at = NOW()
   WHERE user_id = uid;

  RETURN recruit_apply_load();
END;
$$;
