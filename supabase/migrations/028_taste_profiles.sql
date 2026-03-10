-- Taste Profiles Cache
-- Stores complete computed taste map results (clusters + edges + insights)
-- so returning visits skip both clustering and LLM calls.
-- Keyed by deterministic pin-set hash (sorted pin IDs, djb2).

CREATE TABLE IF NOT EXISTS taste_profiles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  pin_hash TEXT NOT NULL,
  pin_count INTEGER NOT NULL,
  clusters JSONB NOT NULL,
  edges JSONB NOT NULL,
  insights JSONB NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, pin_hash)
);

CREATE INDEX IF NOT EXISTS idx_taste_profiles_user ON taste_profiles(user_id);

ALTER TABLE taste_profiles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can read own taste profiles" ON taste_profiles;
CREATE POLICY "Users can read own taste profiles"
  ON taste_profiles FOR SELECT USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can insert own taste profiles" ON taste_profiles;
CREATE POLICY "Users can insert own taste profiles"
  ON taste_profiles FOR INSERT WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can delete own taste profiles" ON taste_profiles;
CREATE POLICY "Users can delete own taste profiles"
  ON taste_profiles FOR DELETE USING (auth.uid() = user_id);
