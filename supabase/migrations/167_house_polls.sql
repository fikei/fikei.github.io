-- ============================================
-- Migration 167: House polls (Agape massage day)
--
-- One row per person per poll. answers is free-form jsonb:
--   { name, dates: { "2026-10-07": "can"|"maybe"|"no" }, first, second, slots: { "9": "can", ... } }
-- The row person = '__meta' carries poll settings, e.g. { chosen_date: "2026-11-07" },
-- which flips the page at /agape/massage/ from the date vote to the in-day slot grid.
-- No login: anon may read and write, but only rows of the polls listed below.
-- ============================================

CREATE TABLE IF NOT EXISTS house_polls (
  poll_id    TEXT NOT NULL,
  person     TEXT NOT NULL CHECK (char_length(person) BETWEEN 1 AND 60),
  answers    JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (poll_id, person)
);

ALTER TABLE house_polls ENABLE ROW LEVEL SECURITY;

CREATE POLICY "House polls: anon read" ON house_polls
  FOR SELECT TO anon, authenticated USING (poll_id = 'massage-2026');
CREATE POLICY "House polls: anon insert" ON house_polls
  FOR INSERT TO anon, authenticated WITH CHECK (poll_id = 'massage-2026');
CREATE POLICY "House polls: anon update" ON house_polls
  FOR UPDATE TO anon, authenticated
  USING (poll_id = 'massage-2026') WITH CHECK (poll_id = 'massage-2026');

GRANT SELECT, INSERT, UPDATE ON house_polls TO anon, authenticated;

-- Live updates on the page (it also polls every 15 s, so this is optional).
ALTER PUBLICATION supabase_realtime ADD TABLE house_polls;
