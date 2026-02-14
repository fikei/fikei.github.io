-- Watch Metadata System
-- Adds structured video/film metadata storage for watch category items

ALTER TABLE links ADD COLUMN IF NOT EXISTS video JSONB DEFAULT NULL;

COMMENT ON COLUMN links.video IS 'Structured video/film metadata: title, type, creator, year, runtime, genre, platform, platformId, rating, contentFormat, seriesInfo, summary, streamingServices';
