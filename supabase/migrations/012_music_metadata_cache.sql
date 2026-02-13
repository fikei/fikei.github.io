-- Music Metadata Cache
-- Caches enrichment results from MusicBrainz, GetSongBPM, Last.fm
-- Keyed by normalized "artist:track" to avoid duplicate API calls

CREATE TABLE IF NOT EXISTS music_metadata_cache (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lookup_key TEXT UNIQUE NOT NULL,
  artist TEXT NOT NULL,
  track TEXT NOT NULL,
  metadata JSONB NOT NULL,
  cached_at TIMESTAMPTZ DEFAULT NOW(),
  hit_count INTEGER DEFAULT 1,
  last_hit_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_music_cache_lookup ON music_metadata_cache(lookup_key);
CREATE INDEX IF NOT EXISTS idx_music_cache_cached_at ON music_metadata_cache(cached_at);

ALTER TABLE music_metadata_cache ENABLE ROW LEVEL SECURITY;

-- Readable by anyone with anon key (cache is shared)
CREATE POLICY "Music cache readable by all"
  ON music_metadata_cache FOR SELECT USING (true);

-- Service role can write (edge function uses service key)
CREATE POLICY "Service role can write music cache"
  ON music_metadata_cache FOR ALL
  USING (auth.role() = 'service_role');
