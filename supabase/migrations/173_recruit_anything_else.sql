-- ============================================
-- Migration 173: "Anything else we should know?" + both-tracks stay type
--
-- 1. anything_else — the form's closing catch-all question. Own column so
--    it never muddies the three essays; shown on the triage profile.
-- 2. residency can now hold both tracks with per-track context, composed by
--    the form as a readable string:
--      "Full-time resident — from October | Short-term (sublet) — 3 months"
--    No schema change needed (TEXT already), but recruit_apply_columns and
--    recruit_apply_load grow the new column.
-- ============================================

ALTER TABLE recruit_applicants ADD COLUMN IF NOT EXISTS anything_else TEXT NOT NULL DEFAULT '';

CREATE OR REPLACE FUNCTION recruit_apply_columns()
RETURNS TEXT[]
LANGUAGE sql IMMUTABLE AS $$
  SELECT ARRAY['first_name','last_name','pronouns','phone','social','about',
               'why_agape','gifts','heard_from','residency','move_in','budget',
               'anything_else'];
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
    'anything_else', rec.anything_else,
    'stage', rec.stage, 'is_submitted', rec.is_submitted,
    'submitted_at', rec.submitted_at, 'updated_at', rec.updated_at,
    'can_reapply', rec.stage IN ('rejected', 'archived'),
    'return_after', CASE WHEN rec.exit_reason = 'future' THEN rec.exit_until END
  );
END;
$$;
