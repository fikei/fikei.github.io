-- ============================================
-- Migration 170: native application form (/apply)
--
-- The application moves off Google Forms onto ctrl.rodeo/apply. Applicants
-- sign in with an email OTP, so each application gains an owner: user_id
-- links the row to auth.users, and prior Google Form applicants adopt their
-- existing row the first time they sign in with the same (verified) email.
--
-- recruit_applicants stays client-read-only for recruiting members; the
-- applicant themselves never touches the table directly. All applicant
-- access goes through three SECURITY DEFINER RPCs that expose only the form
-- columns — a row-level policy would leak internal columns (exit_note,
-- exit_by_name, move_in_from…) to the person being discussed.
--
-- Editing locks when the funnel moves past review: recruit_apply_save
-- rejects on stage != 'review', so the lock holds server-side even if the
-- form UI is bypassed.
-- ============================================

ALTER TABLE recruit_applicants
  ADD COLUMN IF NOT EXISTS user_id UUID UNIQUE REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS is_submitted BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'sheet'
    CHECK (source IN ('sheet', 'native', 'manual'));

-- Everything already in the table arrived complete (sheet ingest or manual
-- add) — only native drafts are ever un-submitted.
UPDATE recruit_applicants SET is_submitted = true WHERE NOT is_submitted;

CREATE INDEX IF NOT EXISTS idx_recruit_applicants_user_id
  ON recruit_applicants(user_id) WHERE user_id IS NOT NULL;

-- The columns an applicant may read and write. Kept in one place so the
-- three RPCs below can never drift apart on what "form fields" means.
CREATE OR REPLACE FUNCTION recruit_apply_columns()
RETURNS TEXT[]
LANGUAGE sql IMMUTABLE AS $$
  SELECT ARRAY['first_name','last_name','pronouns','phone','social','about',
               'why_agape','gifts','heard_from','residency','move_in','budget'];
$$;

/* The caller's own application. Claims an unclaimed row matching their
   verified email on first sign-in (the Google Form era left rows with no
   user_id), creates a fresh draft when they have never applied, and
   otherwise returns what they already have. Only form columns plus the
   status the applicant is entitled to see. */
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
    -- Claim the row this email already has, if any. The email arrived via a
    -- verified OTP, so ownership is proven.
    UPDATE recruit_applicants SET user_id = uid
      WHERE lower(email) = mail AND user_id IS NULL
      RETURNING * INTO rec;
  END IF;

  IF rec.id IS NULL THEN
    RETURN NULL; -- no application yet; the form starts fresh
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
    'submitted_at', rec.submitted_at, 'updated_at', rec.updated_at
  );
END;
$$;

/* Save form fields. Creates the row on first save (a draft: stage review,
   is_submitted false), updates it afterwards. Only whitelisted columns move;
   locked once the funnel has moved past review. */
CREATE OR REPLACE FUNCTION recruit_apply_save(p_fields JSONB)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  uid UUID := auth.uid();
  mail TEXT := lower(COALESCE(auth.email(), ''));
  rec recruit_applicants%ROWTYPE;
  col TEXT;
  base TEXT;
  new_id TEXT;
  n INT := 1;
BEGIN
  IF uid IS NULL OR mail = '' THEN
    RAISE EXCEPTION 'sign in first';
  END IF;
  IF p_fields IS NULL OR jsonb_typeof(p_fields) <> 'object' THEN
    RAISE EXCEPTION 'fields must be an object';
  END IF;

  SELECT * INTO rec FROM recruit_applicants WHERE user_id = uid LIMIT 1;
  IF rec.id IS NULL THEN
    -- Same claim as recruit_apply_load, for a save that arrives first.
    UPDATE recruit_applicants SET user_id = uid
      WHERE lower(email) = mail AND user_id IS NULL
      RETURNING * INTO rec;
  END IF;

  IF rec.id IS NOT NULL AND rec.stage <> 'review' THEN
    RAISE EXCEPTION 'application is locked (stage %)', rec.stage;
  END IF;

  IF rec.id IS NULL THEN
    -- First save: mint the id the same way the ingest does — a name slug,
    -- numbered when a name genuinely repeats.
    base := left(regexp_replace(regexp_replace(
      lower(btrim(COALESCE(p_fields->>'first_name', '') || ' ' || COALESCE(p_fields->>'last_name', ''))),
      '[^a-z0-9[:space:]-]', '', 'g'), '[[:space:]]+', '-', 'g'), 48);
    IF base = '' THEN base := 'applicant'; END IF;
    new_id := base;
    WHILE EXISTS (SELECT 1 FROM recruit_applicants WHERE id = new_id) LOOP
      n := n + 1;
      new_id := base || '-' || n;
    END LOOP;
    INSERT INTO recruit_applicants (id, submitted_at, first_name, email, user_id, is_submitted, source, stage, updated_at)
      VALUES (new_id, NOW(), COALESCE(btrim(p_fields->>'first_name'), ''), mail, uid, false, 'native', 'review', NOW())
      RETURNING * INTO rec;
  END IF;

  FOREACH col IN ARRAY recruit_apply_columns() LOOP
    IF p_fields ? col THEN
      EXECUTE format('UPDATE recruit_applicants SET %I = $1 WHERE user_id = $2',
                     col)
        USING left(btrim(COALESCE(p_fields->>col, '')), 4000), uid;
    END IF;
  END LOOP;
  UPDATE recruit_applicants SET updated_at = NOW() WHERE user_id = uid;

  RETURN recruit_apply_load();
END;
$$;

/* Final submit: the draft becomes a real application in the Inbox. Requires
   the fields a triage row cannot exist without. Safe to call again after
   later edits — it just refreshes updated_at. */
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
         submitted_at = COALESCE(submitted_at, NOW()),
         updated_at = NOW()
   WHERE user_id = uid;

  RETURN recruit_apply_load();
END;
$$;

GRANT EXECUTE ON FUNCTION recruit_apply_load() TO authenticated;
GRANT EXECUTE ON FUNCTION recruit_apply_save(JSONB) TO authenticated;
GRANT EXECUTE ON FUNCTION recruit_apply_submit() TO authenticated;
