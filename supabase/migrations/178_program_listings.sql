-- ============================================
-- Migration 178: program listings & the DJ residency
--
-- recruit_listings grows from room openings into a general program-listing
-- engine: a listing_type ('room' keeps today's behavior; 'dj_residency' is
-- the first program), public-facing criteria (title, blurb, deadline, fee,
-- Stripe payment link, capacity, slug), and a draft → open → filled/closed
-- lifecycle so programs can be staged before launch. Open program listings
-- surface on the /apply "Kind of stay" step (anon RPC below) and the chosen
-- listing lands on the applicant (listing_id — one application per cohort;
-- cohorts never open concurrently, enforced by a partial unique index).
--
-- Applicants gain the DJ question set, provisional payment tracking (weekly
-- Stripe CSV reconciliation is authoritative — see the runbook), and
-- display-only Haiku scores (recruit-score-apps): scores sort the inbox,
-- they never gate or decide.
-- PRD: docs/strategy/prds/agape-program-listings.md
-- ============================================

-- ---- recruit_listings: program columns + draft lifecycle ----

ALTER TABLE recruit_listings
  ADD COLUMN IF NOT EXISTS listing_type TEXT NOT NULL DEFAULT 'room'
    CHECK (listing_type IN ('room', 'dj_residency')),
  ADD COLUMN IF NOT EXISTS title TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS public_blurb TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS application_deadline DATE,
  ADD COLUMN IF NOT EXISTS fee_cents INT CHECK (fee_cents IS NULL OR fee_cents >= 0),
  ADD COLUMN IF NOT EXISTS payment_link TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS capacity INT NOT NULL DEFAULT 1 CHECK (capacity >= 1),
  ADD COLUMN IF NOT EXISTS public_slug TEXT UNIQUE;

ALTER TABLE recruit_listings DROP CONSTRAINT IF EXISTS recruit_listings_status_check;
ALTER TABLE recruit_listings ADD CONSTRAINT recruit_listings_status_check
  CHECK (status IN ('draft', 'open', 'filled', 'closed'));

-- Cohorts never run concurrently: at most one open program listing.
CREATE UNIQUE INDEX IF NOT EXISTS idx_recruit_listings_one_open_program
  ON recruit_listings((1)) WHERE status = 'open' AND listing_type <> 'room';
CREATE INDEX IF NOT EXISTS idx_recruit_listings_type_status
  ON recruit_listings(listing_type, status);

-- ---- recruit_applicants: listing link, DJ fields, payment, scores ----

ALTER TABLE recruit_applicants
  ADD COLUMN IF NOT EXISTS listing_id UUID REFERENCES recruit_listings(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS artist_name TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS mix_links TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS sound_essay TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS performance_history TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS gear_notes TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS based_in TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS payment_status TEXT
    CHECK (payment_status IS NULL OR payment_status IN ('pending', 'paid', 'failed')),
  ADD COLUMN IF NOT EXISTS payment_ref TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS paid_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS score_credentials INT CHECK (score_credentials BETWEEN 1 AND 5),
  ADD COLUMN IF NOT EXISTS score_sound INT CHECK (score_sound BETWEEN 1 AND 5),
  ADD COLUMN IF NOT EXISTS score_fit INT CHECK (score_fit BETWEEN 1 AND 5),
  ADD COLUMN IF NOT EXISTS score_logistics INT CHECK (score_logistics BETWEEN 1 AND 5),
  ADD COLUMN IF NOT EXISTS score_excitement INT CHECK (score_excitement BETWEEN 1 AND 5),
  ADD COLUMN IF NOT EXISTS score_total INT CHECK (score_total BETWEEN 5 AND 25),
  ADD COLUMN IF NOT EXISTS score_notes TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS scored_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS flag_for_review BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN recruit_applicants.listing_id IS
  'Program listing this application targets (one application per cohort). NULL = housing.';
COMMENT ON COLUMN recruit_applicants.payment_status IS
  'Provisional, self-reported on Stripe return; weekly CSV reconciliation is authoritative.';
COMMENT ON COLUMN recruit_applicants.score_total IS
  'Haiku first-pass total (5–25). Display-only: sorts the inbox, never gates or decides.';

CREATE INDEX IF NOT EXISTS idx_recruit_applicants_listing
  ON recruit_applicants(listing_id) WHERE listing_id IS NOT NULL;

-- ---- recruit_stays: program stays + set delivery ----

ALTER TABLE recruit_stays DROP CONSTRAINT IF EXISTS recruit_stays_kind_check;
ALTER TABLE recruit_stays ADD CONSTRAINT recruit_stays_kind_check
  CHECK (kind IN ('resident', 'sublet', 'candidate', 'shared', 'dj_resident'));
ALTER TABLE recruit_stays
  ADD COLUMN IF NOT EXISTS listing_id UUID REFERENCES recruit_listings(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS set_delivered_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS set_url TEXT NOT NULL DEFAULT '';

-- ---- applicant form: extend the whitelist + load/submit ----

CREATE OR REPLACE FUNCTION recruit_apply_columns()
RETURNS TEXT[]
LANGUAGE sql IMMUTABLE AS $$
  SELECT ARRAY['first_name','last_name','pronouns','phone','social','about',
               'why_agape','gifts','community','heard_from','residency','move_in','budget',
               'anything_else',
               'artist_name','mix_links','sound_essay','performance_history',
               'gear_notes','based_in'];
$$;

CREATE OR REPLACE FUNCTION recruit_apply_load()
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  uid UUID := auth.uid();
  mail TEXT := lower(COALESCE(auth.email(), ''));
  rec recruit_applicants%ROWTYPE;
  lst recruit_listings%ROWTYPE;
  listing_json JSONB := NULL;
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

  IF rec.listing_id IS NOT NULL THEN
    SELECT * INTO lst FROM recruit_listings WHERE id = rec.listing_id;
    IF lst.id IS NOT NULL THEN
      listing_json := jsonb_build_object(
        'slug', lst.public_slug, 'title', lst.title, 'status', lst.status,
        'starts_on', lst.starts_on, 'ends_on', lst.ends_on,
        'application_deadline', lst.application_deadline,
        'fee_cents', lst.fee_cents, 'payment_link', lst.payment_link
      );
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'id', rec.id,
    'email', rec.email,
    'first_name', rec.first_name, 'last_name', rec.last_name,
    'pronouns', rec.pronouns, 'phone', rec.phone, 'social', rec.social,
    'about', rec.about, 'why_agape', rec.why_agape, 'gifts', rec.gifts,
    'community', rec.community, 'anything_else', rec.anything_else,
    'heard_from', rec.heard_from, 'residency', rec.residency,
    'move_in', rec.move_in, 'budget', rec.budget,
    'artist_name', rec.artist_name, 'mix_links', rec.mix_links,
    'sound_essay', rec.sound_essay, 'performance_history', rec.performance_history,
    'gear_notes', rec.gear_notes, 'based_in', rec.based_in,
    'payment_status', rec.payment_status, 'paid_at', rec.paid_at,
    'listing', listing_json,
    'stage', rec.stage, 'is_submitted', rec.is_submitted,
    'submitted_at', rec.submitted_at, 'updated_at', rec.updated_at,
    'can_reapply', rec.stage IN ('rejected', 'archived'),
    'return_after', CASE WHEN rec.exit_reason = 'future' THEN rec.exit_until END
  );
END;
$$;

/* A program application's essay lives in sound_essay; housing's in
   why_agape. Either satisfies the submit gate. */
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
  IF btrim(rec.first_name) = '' OR btrim(rec.about) = '' OR btrim(rec.gifts) = ''
     OR (btrim(rec.why_agape) = '' AND btrim(rec.sound_essay) = '') THEN
    RAISE EXCEPTION 'name and the core questions (about you, the why question, what you''d bring) are required before submitting';
  END IF;

  UPDATE recruit_applicants
     SET is_submitted = true,
         submitted_at = CASE WHEN rec.is_submitted THEN submitted_at ELSE NOW() END,
         updated_at = NOW()
   WHERE user_id = uid;

  RETURN recruit_apply_load();
END;
$$;

-- ---- public listing surface + applicant listing/payment RPCs ----

/* The anon-safe subset of open program listings for the /apply "Kind of
   stay" step and the landing page. In practice zero or one row. */
CREATE OR REPLACE FUNCTION recruit_open_program_listings()
RETURNS JSONB
LANGUAGE sql SECURITY DEFINER SET search_path = public STABLE AS $$
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'slug', public_slug, 'title', title, 'blurb', public_blurb,
    'starts_on', starts_on, 'ends_on', ends_on,
    'application_deadline', application_deadline, 'fee_cents', fee_cents
  ) ORDER BY starts_on), '[]'::jsonb)
  FROM recruit_listings
  WHERE listing_type <> 'room' AND status = 'open'
    AND (application_deadline IS NULL OR application_deadline >= CURRENT_DATE);
$$;

/* Point the caller's application at an open program listing (or clear it
   with NULL). Same edit-lock as recruit_apply_save. */
CREATE OR REPLACE FUNCTION recruit_apply_set_listing(p_slug TEXT)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  uid UUID := auth.uid();
  rec recruit_applicants%ROWTYPE;
  lst recruit_listings%ROWTYPE;
BEGIN
  IF uid IS NULL THEN
    RAISE EXCEPTION 'sign in first';
  END IF;
  SELECT * INTO rec FROM recruit_applicants WHERE user_id = uid LIMIT 1;
  IF rec.id IS NULL THEN
    RAISE EXCEPTION 'save the form first';
  END IF;
  IF rec.stage <> 'review' THEN
    RAISE EXCEPTION 'application is locked (stage %)', rec.stage;
  END IF;

  IF p_slug IS NULL OR btrim(p_slug) = '' THEN
    UPDATE recruit_applicants SET listing_id = NULL, updated_at = NOW() WHERE user_id = uid;
    RETURN recruit_apply_load();
  END IF;

  SELECT * INTO lst FROM recruit_listings
   WHERE public_slug = lower(btrim(p_slug)) AND listing_type <> 'room' AND status = 'open';
  IF lst.id IS NULL THEN
    RAISE EXCEPTION 'that listing is not open';
  END IF;

  UPDATE recruit_applicants SET listing_id = lst.id, updated_at = NOW() WHERE user_id = uid;
  RETURN recruit_apply_load();
END;
$$;

/* Stripe return marks the fee provisionally paid; the weekly reconciliation
   (Stripe CSV → payment_ref) is the authoritative record. */
CREATE OR REPLACE FUNCTION recruit_apply_mark_paid()
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  uid UUID := auth.uid();
BEGIN
  IF uid IS NULL THEN
    RAISE EXCEPTION 'sign in first';
  END IF;
  UPDATE recruit_applicants
     SET payment_status = 'paid', paid_at = COALESCE(paid_at, NOW()), updated_at = NOW()
   WHERE user_id = uid AND listing_id IS NOT NULL;
  RETURN recruit_apply_load();
END;
$$;

GRANT EXECUTE ON FUNCTION recruit_open_program_listings() TO anon, authenticated;
GRANT EXECUTE ON FUNCTION recruit_apply_set_listing(TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION recruit_apply_mark_paid() TO authenticated;

-- ---- promotion: candidate → program resident ----

CREATE OR REPLACE FUNCTION recruit_promote_program_resident(
  p_applicant_id TEXT,
  p_room_id INT DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  rec recruit_applicants%ROWTYPE;
  lst recruit_listings%ROWTYPE;
  v_stay_id UUID;
  v_filled INT;
BEGIN
  IF NOT is_recruiting_member() THEN
    RAISE EXCEPTION 'recruiting members only';
  END IF;
  SELECT * INTO rec FROM recruit_applicants WHERE id = p_applicant_id;
  IF rec.id IS NULL THEN
    RAISE EXCEPTION 'no such applicant';
  END IF;
  IF rec.listing_id IS NULL THEN
    RAISE EXCEPTION 'applicant has no program listing';
  END IF;
  IF rec.stage NOT IN ('review', 'candidate') THEN
    RAISE EXCEPTION 'applicant stage is % — already placed or closed', rec.stage;
  END IF;
  SELECT * INTO lst FROM recruit_listings WHERE id = rec.listing_id;

  INSERT INTO recruit_stays (room_id, occupant, kind, starts_on, ends_on, listing_id, notes)
  VALUES (
    COALESCE(p_room_id, lst.room_id),
    COALESCE(NULLIF(btrim(rec.artist_name), ''), btrim(rec.first_name || ' ' || rec.last_name)),
    'dj_resident', lst.starts_on, lst.ends_on, lst.id,
    'applicant: ' || rec.id
  )
  RETURNING id INTO v_stay_id;

  UPDATE recruit_applicants SET stage = 'resident' WHERE id = rec.id;

  SELECT COUNT(*) INTO v_filled FROM recruit_stays
   WHERE listing_id = lst.id AND kind = 'dj_resident';
  IF v_filled >= lst.capacity THEN
    UPDATE recruit_listings SET status = 'filled' WHERE id = lst.id;
  END IF;

  RETURN v_stay_id;
END;
$$;

GRANT EXECUTE ON FUNCTION recruit_promote_program_resident(TEXT, INT) TO authenticated;

-- ---- seed: the 2-month test residency, as a draft ----
-- Dates are placeholders — the listing editor sets the real window before
-- the listing opens. Pegged to the priest room when one exists by name.

DO $$
DECLARE
  v_room_id INT;
BEGIN
  SELECT id INTO v_room_id FROM recruit_rooms WHERE name ILIKE '%priest%' LIMIT 1;
  IF v_room_id IS NULL THEN
    RAISE NOTICE 'no priest room found — skipping DJ listing seed';
    RETURN;
  END IF;
  IF EXISTS (SELECT 1 FROM recruit_listings WHERE public_slug = 'dj-residency') THEN
    RETURN;
  END IF;
  INSERT INTO recruit_listings
    (room_id, kind, listing_type, status, source, starts_on, ends_on,
     title, public_blurb, application_deadline, fee_cents, capacity, public_slug)
  VALUES
    (v_room_id, 'sublet', 'dj_residency', 'draft', 'manual',
     DATE '2026-10-01', DATE '2026-11-30',
     'DJ Residency',
     'Two months of room & board in a 16-person Victorian in the Mission. Neptune sound system, Pioneer decks, a basement listening room — and before you leave, a one-hour filmed set. $20 residency application fee funds the program.',
     DATE '2026-09-15', 2000, 1, 'dj-residency');
END $$;
