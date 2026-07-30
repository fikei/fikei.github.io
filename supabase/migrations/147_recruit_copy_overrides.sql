-- ============================================
-- Migration 147: edit notification copy without a deploy
--
-- Every sentence the recruiting notifications say now lives in one module
-- (_shared/recruit-copy.ts). This table overrides it, keyed on the same string,
-- so wording changes are a SQL edit rather than a code change and a deploy.
--
-- The defaults stay in the module on purpose: they are the version that ships,
-- they are reviewable in a PR, and an empty table means the system is in its
-- known-good wording. This table holds only what somebody deliberately changed.
--
-- A template is a sentence with {placeholders}. The detector supplies the
-- values; {subject} is always the thing the notification is about and renders
-- as the hyperlink into the app.
-- ============================================

CREATE TABLE IF NOT EXISTS recruit_copy (
  key TEXT PRIMARY KEY,
  template TEXT NOT NULL CHECK (btrim(template) <> ''),
  -- What the module ships, captured when the override is written, so the status
  -- view can show what was changed away from without the reader needing source.
  default_template TEXT,
  note TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  updated_by_name TEXT
);

ALTER TABLE recruit_copy ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Recruiting members read copy" ON recruit_copy;
CREATE POLICY "Recruiting members read copy" ON recruit_copy
  FOR SELECT TO authenticated USING (is_recruiting_member());

/* Set one sentence.

   p_allowed is the list of placeholders the detector actually supplies for this
   key. A template referencing anything outside it would render a literal
   "{days}" in a real notification, so it is refused here rather than discovered
   in the channel. NULL skips the check.

   Membership is required of a signed-in browser session. A session with no
   auth.uid() is the service role or the Supabase dashboard — already privileged,
   and the place bulk copy edits actually get made. */
CREATE OR REPLACE FUNCTION recruit_set_copy(
  p_key TEXT,
  p_template TEXT,
  p_allowed TEXT[] DEFAULT NULL,
  p_default TEXT DEFAULT NULL,
  p_note TEXT DEFAULT NULL
)
RETURNS TEXT
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  used TEXT[];
  unknown TEXT[];
BEGIN
  IF auth.uid() IS NOT NULL AND NOT is_recruiting_member() THEN
    RAISE EXCEPTION 'recruiting members only';
  END IF;
  IF btrim(p_template) = '' THEN
    RAISE EXCEPTION 'a notification cannot say nothing';
  END IF;

  SELECT array_agg(m[1]) INTO used
  FROM regexp_matches(p_template, '\{([a-zA-Z_]+)\}', 'g') AS m;

  IF p_allowed IS NOT NULL AND used IS NOT NULL THEN
    SELECT array_agg(u) INTO unknown
    FROM unnest(used) AS u WHERE NOT (u = ANY(p_allowed));
    IF unknown IS NOT NULL THEN
      RAISE EXCEPTION 'this notification has no %; it can use: %',
        array_to_string(unknown, ', '), array_to_string(p_allowed, ', ');
    END IF;
  END IF;

  INSERT INTO recruit_copy (key, template, default_template, note, updated_by, updated_by_name)
  VALUES (p_key, btrim(p_template), p_default, p_note, auth.uid(),
          COALESCE((SELECT display_name FROM recruit_profiles WHERE user_id = auth.uid()), 'dashboard'))
  ON CONFLICT (key) DO UPDATE SET
    template = EXCLUDED.template,
    default_template = COALESCE(EXCLUDED.default_template, recruit_copy.default_template),
    note = EXCLUDED.note,
    updated_at = NOW(),
    updated_by = auth.uid(),
    updated_by_name = EXCLUDED.updated_by_name;

  RETURN p_template;
END;
$$;

-- Put one sentence back to what the module ships.
CREATE OR REPLACE FUNCTION recruit_reset_copy(p_key TEXT)
RETURNS INT
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE n INT;
BEGIN
  IF auth.uid() IS NOT NULL AND NOT is_recruiting_member() THEN
    RAISE EXCEPTION 'recruiting members only';
  END IF;
  DELETE FROM recruit_copy WHERE key = p_key;
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END;
$$;

-- What has been changed away from the shipped wording, and by whom.
CREATE OR REPLACE VIEW recruit_copy_status AS
SELECT key, template, default_template,
       template IS DISTINCT FROM default_template AS changed,
       note, updated_by_name, updated_at
FROM recruit_copy
ORDER BY updated_at DESC;

COMMENT ON TABLE recruit_copy IS
  'Overrides for notification wording. Empty means every sentence is the version shipped in _shared/recruit-copy.ts.';
COMMENT ON COLUMN recruit_copy.template IS
  'A sentence with {placeholders}. {subject} is the thing it is about and renders as the hyperlink.';
