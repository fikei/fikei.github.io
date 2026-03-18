-- ============================================================
-- 037_instagram_takeout_source.sql
-- Adds 'instagram_takeout' as a source type for secondary_signals
-- Instagram saved/liked posts are intent signals but not repeated
-- consumption — lower weight than Spotify (saves vs. listens).
-- Weight hierarchy: pin=1.0 > youtube_api=0.6 > youtube_takeout=0.35 > spotify=0.3 > instagram_takeout=0.25
-- ============================================================

-- Expand source CHECK on secondary_signals
ALTER TABLE secondary_signals DROP CONSTRAINT IF EXISTS secondary_signals_source_check;
ALTER TABLE secondary_signals ADD CONSTRAINT secondary_signals_source_check
  CHECK (source IN ('spotify', 'youtube_takeout', 'youtube_api', 'instagram_takeout'));

-- Expand source CHECK on import_jobs
ALTER TABLE import_jobs DROP CONSTRAINT IF EXISTS import_jobs_source_check;
ALTER TABLE import_jobs ADD CONSTRAINT import_jobs_source_check
  CHECK (source IN ('spotify', 'youtube_takeout', 'youtube_api', 'instagram_takeout'));
