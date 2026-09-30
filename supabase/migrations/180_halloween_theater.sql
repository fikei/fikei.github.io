-- ============================================
-- 180: Halloween theater run of show — shared state
-- ============================================
-- One row per event (id = 'xv-2026') holding the whole theater schedule as
-- JSON (the same shape /halloween/theater.html keeps in localStorage).
--   * Anyone with the link can read (the page is public, noindex).
--   * Only verified Agape Discord members can insert/update
--     (user_discord_membership.is_agape_member, written by the
--     discord-membership edge function — migration 099).
--   * version is a compare-and-set counter: the client updates
--     WHERE version = <what it loaded>, so a stale tab can't overwrite a
--     newer save; the trigger bumps it and stamps who/when.
-- Additive only: no drops.

CREATE TABLE IF NOT EXISTS halloween_theater (
  id TEXT PRIMARY KEY,
  doc JSONB NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  updated_by_name TEXT
);

ALTER TABLE halloween_theater ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION is_agape_member()
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM user_discord_membership m
    WHERE m.user_id = auth.uid() AND m.is_agape_member
  );
$$;

CREATE POLICY "Anyone reads halloween theater" ON halloween_theater
  FOR SELECT TO anon, authenticated USING (true);

CREATE POLICY "Agape members insert halloween theater" ON halloween_theater
  FOR INSERT TO authenticated WITH CHECK (is_agape_member());

CREATE POLICY "Agape members update halloween theater" ON halloween_theater
  FOR UPDATE TO authenticated
  USING (is_agape_member())
  WITH CHECK (is_agape_member());

-- Stamp who/when and bump the version server-side so clients can't fake them.
CREATE OR REPLACE FUNCTION halloween_theater_stamp()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at := NOW();
  NEW.updated_by := auth.uid();
  IF TG_OP = 'UPDATE' THEN
    NEW.version := OLD.version + 1;
  ELSE
    NEW.version := 1;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS halloween_theater_stamp ON halloween_theater;
CREATE TRIGGER halloween_theater_stamp
  BEFORE INSERT OR UPDATE ON halloween_theater
  FOR EACH ROW EXECUTE FUNCTION halloween_theater_stamp();

-- Live updates for other open tabs.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'halloween_theater'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE halloween_theater;
  END IF;
END $$;
