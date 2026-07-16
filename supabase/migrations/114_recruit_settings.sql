-- ============================================
-- Migration 114: house-wide recruiting preferences
--
-- Small key/value store for global recruiting preferences — first key:
-- open_to_couples. Read/write by any recruiting member; recruit-match reads
-- it server-side to steer suggestions and flags.
-- ============================================

CREATE TABLE IF NOT EXISTS recruit_settings (
  key TEXT PRIMARY KEY,
  value JSONB NOT NULL,
  updated_by_name TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE recruit_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Recruiting members read settings" ON recruit_settings
  FOR SELECT TO authenticated USING (is_recruiting_member());
CREATE POLICY "Recruiting members write settings" ON recruit_settings
  FOR ALL TO authenticated
  USING (is_recruiting_member()) WITH CHECK (is_recruiting_member());

INSERT INTO recruit_settings (key, value) VALUES ('open_to_couples', 'true'::jsonb)
  ON CONFLICT (key) DO NOTHING;
