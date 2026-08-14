-- ============================================
-- Migration 166: manual applicant entry
--
-- Not everyone comes through the application form — referrals, friends of
-- the house, people met at dinners. recruit_applicants is read-only to
-- clients (imports use the service role), so adding someone by hand needs
-- its own RPC, same pattern as recruit_set_stage.
--
-- The id follows the ingest scheme: "jane-doe", numbered "-2", "-3" when a
-- name genuinely repeats. Dedupe is by email — adding an address already in
-- the funnel raises, naming the existing row, rather than minting a twin.
-- ============================================

CREATE OR REPLACE FUNCTION recruit_add_applicant(
  p_first TEXT,
  p_email TEXT,
  p_last TEXT DEFAULT '',
  p_stage TEXT DEFAULT 'review',
  p_residency TEXT DEFAULT '',
  p_move_in TEXT DEFAULT '',
  p_budget TEXT DEFAULT '',
  p_source TEXT DEFAULT '',
  p_about TEXT DEFAULT ''
)
RETURNS TEXT
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  base TEXT;
  new_id TEXT;
  n INT := 1;
  existing TEXT;
BEGIN
  IF NOT is_recruiting_member() THEN
    RAISE EXCEPTION 'recruiting members only';
  END IF;
  -- Manual entries land in the funnel proper: the review inbox, or straight
  -- to candidate when the house already knows them. Never into an exit stage.
  IF p_stage NOT IN ('review', 'candidate') THEN
    RAISE EXCEPTION 'unknown stage %', p_stage;
  END IF;
  IF btrim(COALESCE(p_first, '')) = '' THEN
    RAISE EXCEPTION 'a first name is required';
  END IF;
  IF COALESCE(p_email, '') !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' THEN
    RAISE EXCEPTION 'a valid email is required';
  END IF;

  SELECT id INTO existing FROM recruit_applicants
    WHERE lower(email) = lower(btrim(p_email)) LIMIT 1;
  IF existing IS NOT NULL THEN
    RAISE EXCEPTION 'already in the funnel as "%"', existing;
  END IF;

  base := left(regexp_replace(regexp_replace(
    lower(btrim(p_first || ' ' || COALESCE(p_last, ''))),
    '[^a-z0-9[:space:]-]', '', 'g'), '[[:space:]]+', '-', 'g'), 48);
  IF base = '' THEN base := 'applicant'; END IF;
  new_id := base;
  WHILE EXISTS (SELECT 1 FROM recruit_applicants WHERE id = new_id) LOOP
    n := n + 1;
    new_id := base || '-' || n;
  END LOOP;

  INSERT INTO recruit_applicants
    (id, submitted_at, first_name, last_name, email,
     residency, move_in, budget, heard_from, about, stage)
  VALUES
    (new_id, NOW(), btrim(p_first), btrim(COALESCE(p_last, '')), btrim(p_email),
     COALESCE(p_residency, ''), COALESCE(p_move_in, ''), COALESCE(p_budget, ''),
     COALESCE(p_source, ''), COALESCE(p_about, ''), p_stage);

  RETURN new_id;
END;
$$;
