-- ============================================
-- Event Sources Registry + Cross-Source Dedup + Maintenance
-- Migration 088
--
-- 1. event_sources: DB registry of scrape sources (replaces hardcoded
--    STOCK_SOURCES in scrape-events/sources.ts and events/index.html —
--    both keep a hardcoded fallback). Adding a source of an existing
--    parser type becomes an INSERT, no deploy.
-- 2. events.canonical_key: source-agnostic dedup key so the same event
--    scraped from two sources can be merged in the UI.
-- 3. run_events_maintenance(): single RPC bundling the cleanup functions
--    that existed but were never invoked (called by scrape-events at the
--    end of every run).
-- ============================================

-- 1. Source registry
CREATE TABLE IF NOT EXISTS event_sources (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  category TEXT NOT NULL,        -- music|film|tech|social|art|...
  type TEXT NOT NULL,            -- parser type: html|ra|screenslate|garysguide|ical|json|rss|...
  url TEXT NOT NULL,
  region TEXT NOT NULL,          -- bay-area|los-angeles|new-york|seattle|...
  description TEXT NOT NULL DEFAULT '',
  enabled BOOLEAN NOT NULL DEFAULT true,
  notes TEXT,                    -- e.g. reason a source is disabled
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE event_sources ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Public read access"
  ON event_sources FOR SELECT
  USING (true);

CREATE POLICY "Service role full access"
  ON event_sources FOR ALL
  USING (auth.role() = 'service_role');

CREATE OR REPLACE FUNCTION update_event_sources_timestamp()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER event_sources_updated_at
  BEFORE UPDATE ON event_sources
  FOR EACH ROW EXECUTE FUNCTION update_event_sources_timestamp();

-- Seed: the 9 live stock sources
INSERT INTO event_sources (id, name, category, type, url, region, description, enabled) VALUES
  ('19hz-bayarea', '19hz', 'music', 'html', 'https://19hz.info/eventlisting_BayArea.php', 'bay-area', 'Electronic music & nightlife', true),
  ('ra-bayarea', 'Resident Advisor SF', 'music', 'ra', 'https://ra.co/events/us/sanfrancisco', 'bay-area', 'Electronic music events', true),
  ('screenslate-sf', 'Screen Slate', 'film', 'screenslate', 'https://www.screenslate.com/listings', 'bay-area', 'Repertory & arthouse cinema', true),
  ('19hz-losangeles', '19hz Los Angeles', 'music', 'html', 'https://19hz.info/eventlisting_LosAngeles.php', 'los-angeles', 'Electronic music & nightlife', true),
  ('screenslate-nyc', 'Screen Slate', 'film', 'screenslate', 'https://www.screenslate.com/listings', 'new-york', 'Repertory & arthouse cinema', true),
  ('19hz-seattle', '19hz Seattle', 'music', 'html', 'https://19hz.info/eventlisting_Seattle.php', 'seattle', 'Electronic music & nightlife', true),
  ('garysguide-sf', 'Gary''s Guide SF', 'tech', 'garysguide', 'https://www.garysguide.com/events?region=sf', 'bay-area', 'Tech & startup events', true),
  ('luma-sf', 'Luma SF', 'social', 'ical', 'https://api2.luma.com/ics/get?entity=discover&id=discplace-BDj7GNbGlsF7Cka', 'bay-area', 'What''s happening in San Francisco', true),
  ('garysguide-nyc', 'Gary''s Guide NYC', 'tech', 'garysguide', 'https://www.garysguide.com/events?region=nyc', 'new-york', 'Tech & startup events', true)
ON CONFLICT (id) DO NOTHING;

-- Seed: removed sources, kept disabled so the removal reason is data, not a code comment
INSERT INTO event_sources (id, name, category, type, url, region, description, enabled, notes) VALUES
  ('19hz-newyork', '19hz New York', 'music', 'html', 'https://19hz.info/eventlisting_NewYork.php', 'new-york', 'Electronic music & nightlife', false, '404 — page does not exist'),
  ('sf-punchline', 'Punch Line SF', 'comedy', 'html', 'https://www.punchlinecomedyclub.com/shows', 'bay-area', 'Comedy club', false, 'Next.js SPA, event data in RSC JSON hydration — needs headless browser'),
  ('cobbs-sf', 'Cobb''s Comedy Club', 'comedy', 'html', 'https://www.cobbscomedy.com/shows', 'bay-area', 'Comedy club', false, 'Next.js SPA, same as Punch Line — needs headless browser'),
  ('citylights-sf', 'City Lights', 'literary', 'html', 'https://citylights.com/events/', 'bay-area', 'Bookstore events', false, 'Sucuri WAF JS challenge blocks server-side fetch'),
  ('audium-sf', 'Audium', 'music', 'html', 'https://www.audium.org/', 'bay-area', 'Sound theater', false, 'WordPress ai1ec calendar plugin, JS-rendered — needs headless browser'),
  ('sfdesignweek', 'SF Design Week', 'design', 'html', 'https://sfdesignweek.org/events/', 'bay-area', 'Design events', false, 'No events until April 2026; Tribe Events plugin when live')
ON CONFLICT (id) DO NOTHING;

-- 2. Cross-source dedup key: SHA256(date|name|venue), source-agnostic.
-- Normalization must match cache-events generateCanonicalKey(): lowercase,
-- trim, collapse whitespace. (JS additionally strips diacritics; accented
-- rows converge on the next scrape when cache-events rewrites the key.)
ALTER TABLE events ADD COLUMN IF NOT EXISTS canonical_key TEXT;
CREATE INDEX IF NOT EXISTS idx_events_canonical ON events(canonical_key);

UPDATE events SET canonical_key = encode(sha256(convert_to(
  date::text || '|' ||
  lower(regexp_replace(trim(name), '\s+', ' ', 'g')) || '|' ||
  lower(regexp_replace(trim(venue), '\s+', ' ', 'g')),
'UTF8')), 'hex')
WHERE canonical_key IS NULL;

-- 3. Maintenance RPC: bundles the never-invoked cleanup functions.
-- Called by scrape-events at the end of each run (every 2h).
CREATE OR REPLACE FUNCTION run_events_maintenance()
RETURNS JSONB AS $$
DECLARE
  stale_events INTEGER;
  stale_discord INTEGER;
  old_runs INTEGER;
BEGIN
  DELETE FROM events WHERE date < CURRENT_DATE - INTERVAL '7 days';
  GET DIAGNOSTICS stale_events = ROW_COUNT;

  DELETE FROM discord_event_cache WHERE expires_at < NOW() - INTERVAL '7 days';
  GET DIAGNOSTICS stale_discord = ROW_COUNT;

  DELETE FROM scrape_runs WHERE started_at < NOW() - INTERVAL '90 days';
  GET DIAGNOSTICS old_runs = ROW_COUNT;

  RETURN jsonb_build_object(
    'stale_events', stale_events,
    'stale_discord', stale_discord,
    'old_runs', old_runs
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- One-time cleanup: source_health rows for sources no longer in the registry
DELETE FROM source_health
WHERE source_id NOT IN (SELECT id FROM event_sources);
