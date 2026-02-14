-- Music Metadata + Watched State
-- Adds music JSONB column for listen category items
-- Adds watched boolean for watch category items

ALTER TABLE links ADD COLUMN IF NOT EXISTS music JSONB DEFAULT NULL;
ALTER TABLE links ADD COLUMN IF NOT EXISTS watched BOOLEAN DEFAULT FALSE;

COMMENT ON COLUMN links.music IS 'Structured music metadata: trackTitle, artist, albumTitle, genre, duration, bpm, key, platform, platformId';
COMMENT ON COLUMN links.watched IS 'Whether the user has watched this item (watch category)';
