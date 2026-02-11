-- Migration: 010_discord_event_cache
-- Server-side cache for Discord event extraction results.
-- Cache is refreshed by cron (GitHub Actions) every 4 hours.

CREATE TABLE discord_event_cache (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  guild_id TEXT NOT NULL,
  channel_id TEXT NOT NULL,
  events JSONB NOT NULL DEFAULT '[]'::jsonb,
  meta JSONB DEFAULT '{}'::jsonb,
  last_message_id TEXT,
  fetched_at TIMESTAMPTZ DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL,
  UNIQUE(guild_id, channel_id)
);

CREATE INDEX idx_discord_cache_lookup ON discord_event_cache(guild_id, channel_id);
CREATE INDEX idx_discord_cache_expires ON discord_event_cache(expires_at);

ALTER TABLE discord_event_cache ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow public read" ON discord_event_cache
  FOR SELECT USING (true);

CREATE POLICY "Allow service role insert/update" ON discord_event_cache
  FOR ALL USING (auth.role() = 'service_role');
