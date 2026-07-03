-- ============================================
-- Source Architecture: classes, visibility, canonical URL, Agape curation
-- Migration 089
--
-- Implements Phase 1 + 2 of docs/playground/events/strategy/prd-event-source-architecture.md:
-- 1. event_sources.source_class + demoted: the 4-class source taxonomy
-- 2. events.visibility: visibility-by-corroboration (private rows hidden from anon)
-- 3. events.canonical_url / recommended_by / posted_by: URL-first dedup + curation fields
-- 4. RLS: public read restricted to visibility='public'; anon write removed
--    (the pipeline writes via service role; the client is read-only since v1.9)
-- 5. Registry rows: discord-agape-events (curation) + Wave 2 venue backlog (disabled)
-- 6. agape_coverage view: corroboration-rate metric
-- ============================================

-- 1. Source taxonomy
ALTER TABLE event_sources
  ADD COLUMN IF NOT EXISTS source_class TEXT NOT NULL DEFAULT 'discovery'
    CHECK (source_class IN ('venue','community','discovery','public-ticketing','private-ticketing','curation')),
  ADD COLUMN IF NOT EXISTS demoted BOOLEAN NOT NULL DEFAULT false;

UPDATE event_sources SET source_class = 'public-ticketing' WHERE id = 'ra-bayarea';
UPDATE event_sources SET source_class = 'discovery'
  WHERE id IN ('19hz-bayarea','19hz-losangeles','19hz-seattle','19hz-newyork',
               'screenslate-sf','screenslate-nyc','garysguide-sf','garysguide-nyc','luma-sf');
UPDATE event_sources SET source_class = 'venue'
  WHERE id IN ('sf-punchline','cobbs-sf','citylights-sf','audium-sf');

-- The Agape Discord channel: the curation layer. Its events are always private;
-- its recommendation signal upgrades demoted-feed events to public (PRD §2.1/§3).
INSERT INTO event_sources (id, name, category, type, url, region, description, enabled, source_class) VALUES
  ('discord-agape-events', 'Agape #events', 'social', 'discord',
   'discord://952961396121931838/952974850476085308', 'bay-area',
   'Agape community #events channel (curation feed)', true, 'curation')
ON CONFLICT (id) DO UPDATE SET source_class = 'curation', type = 'discord';

-- 2. Event visibility + curation + canonical URL
ALTER TABLE events
  ADD COLUMN IF NOT EXISTS visibility TEXT NOT NULL DEFAULT 'public'
    CHECK (visibility IN ('public','private')),
  ADD COLUMN IF NOT EXISTS canonical_url TEXT,
  ADD COLUMN IF NOT EXISTS recommended_by TEXT[],
  ADD COLUMN IF NOT EXISTS posted_by TEXT;

CREATE INDEX IF NOT EXISTS idx_events_canonical_url ON events(canonical_url) WHERE canonical_url IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_events_visibility ON events(visibility) WHERE visibility = 'private';

-- 3. RLS: anon/public sees only public rows; private rows (Agape-only events,
-- demoted-feed events pending corroboration) require service role. Anon write
-- policies are removed — only the service-role pipeline writes events.
DROP POLICY IF EXISTS "Public read access" ON events;
CREATE POLICY "Public read access" ON events FOR SELECT USING (visibility = 'public');
DROP POLICY IF EXISTS "Anon insert access" ON events;
DROP POLICY IF EXISTS "Anon update access" ON events;

-- 4. Wave 2 venue-calendar backlog (PRD §5). Disabled pending feed verification;
-- enabling one = verify feed type/URL, set type, flip enabled. No deploy needed.
INSERT INTO event_sources (id, name, category, type, url, region, description, enabled, source_class, notes) VALUES
  ('grayarea-sf', 'Gray Area', 'art', 'html', 'https://grayarea.org/events/', 'bay-area', 'Art & technology events', false, 'venue', 'Wave 2 backlog — verify feed type'),
  ('internetarchive-sf', 'Internet Archive', 'tech', 'html', 'https://www.eventbrite.com/o/internet-archive-16483604818', 'bay-area', 'Internet Archive events (Eventbrite org page)', false, 'venue', 'Wave 2 backlog — Eventbrite org page (class venue per PRD §8.4)'),
  ('thelab-sf', 'The Lab', 'art', 'html', 'https://www.thelab.org/upcoming', 'bay-area', 'Experimental art & performance', false, 'venue', 'Wave 2 backlog — verify feed type'),
  ('sfsymphony', 'SF Symphony', 'music', 'html', 'https://www.sfsymphony.org/Buy-Tickets/Calendar', 'bay-area', 'Symphony calendar', false, 'venue', 'Wave 2 backlog — verify feed type'),
  ('exploratorium-sf', 'Exploratorium After Dark', 'social', 'html', 'https://www.exploratorium.edu/visit/calendar', 'bay-area', 'After Dark & museum events', false, 'venue', 'Wave 2 backlog — verify feed type'),
  ('sfmoma-events', 'SFMOMA', 'art', 'sfmoma', 'https://www.sfmoma.org/events/', 'bay-area', 'Museum events', false, 'venue', 'Wave 2 backlog — sfmoma parser exists but disabled; re-verify'),
  ('thechapel-sf', 'The Chapel', 'music', 'html', 'https://thechapelsf.com/music/', 'bay-area', 'Live music venue', false, 'venue', 'Wave 2 backlog — verify feed type'),
  ('thelostchurch-sf', 'The Lost Church', 'music', 'html', 'https://www.thelostchurch.com/', 'bay-area', 'Intimate live performance', false, 'venue', 'Wave 2 backlog — Salesforce-sites ticketing, may need headless'),
  ('odc-sf', 'ODC Dance', 'theater', 'html', 'https://odc.dance/performances', 'bay-area', 'Dance performances', false, 'venue', 'Wave 2 backlog — verify feed type'),
  ('bottomofthehill-sf', 'Bottom of the Hill', 'music', 'html', 'https://www.bottomofthehill.com/calendar.html', 'bay-area', 'Live music venue', false, 'venue', 'Wave 2 backlog — static HTML calendar, good candidate'),
  ('brickandmortar-sf', 'Brick & Mortar Music Hall', 'music', 'html', 'https://www.brickandmortarmusic.com/', 'bay-area', 'Live music venue', false, 'venue', 'Wave 2 backlog — verify feed type'),
  ('rickshawstop-sf', 'Rickshaw Stop', 'music', 'html', 'https://rickshawstop.com/', 'bay-area', 'Live music venue', false, 'venue', 'Wave 2 backlog — verify feed type'),
  ('noisebridge-sf', 'Noisebridge', 'tech', 'ical', 'https://www.noisebridge.net/wiki/Category:Events', 'bay-area', 'Hackerspace events', false, 'community', 'Wave 3 — wiki calendar, verify iCal availability'),
  ('frontiertower-sf', 'Frontier Tower', 'tech', 'ical', 'https://lu.ma/frontiertower', 'bay-area', 'Frontier Tower community events (Luma org)', false, 'community', 'Wave 3 — Luma org page, verify iCal entity id')
ON CONFLICT (id) DO NOTHING;

-- 5. Coverage metric (PRD Phase 2): corroboration rate of Agape events.
-- security_invoker so anon callers see it through events RLS (i.e., not at all
-- for private rows); intended consumer is the service role / dashboards.
CREATE OR REPLACE VIEW agape_coverage WITH (security_invoker = on) AS
SELECT
  COUNT(*) AS agape_events,
  COUNT(*) FILTER (WHERE corroborated) AS corroborated,
  ROUND(100.0 * COUNT(*) FILTER (WHERE corroborated) / NULLIF(COUNT(*), 0), 1) AS corroboration_pct
FROM (
  SELECT a.id,
    EXISTS (
      SELECT 1 FROM events p
      WHERE p.source_id <> a.source_id
        AND p.visibility = 'public'
        AND (p.canonical_key = a.canonical_key
             OR (p.canonical_url IS NOT NULL AND p.canonical_url = a.canonical_url))
    ) AS corroborated
  FROM events a
  WHERE a.source_id = 'discord-agape-events'
) sub;
