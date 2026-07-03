-- ============================================
-- Wave 2/3 feed-verification results (research pass, 2026-07-03)
-- Migration 096
--
-- Verified all 13 disabled venue/community sources. Enabled the two with
-- server-readable feeds; recorded JS-only findings on the rest so nobody
-- re-verifies blind. 11 venues need a headless-browser scrape path (future).
-- ============================================

UPDATE event_sources SET
  type = 'bottomofthehill', url = 'https://bottomofthehill.com/RSS.xml', enabled = true,
  notes = 'Verified: FeedForAll RSS, date in item title — dedicated parser'
WHERE id = 'bottomofthehill-sf';

UPDATE event_sources SET
  type = 'ical', url = 'https://api2.luma.com/ics/get?entity=calendar&id=cal-Sl7q1nHTRXQzjP2', enabled = true,
  notes = 'Verified: Luma calendar iCal (cal-Sl7q1nHTRXQzjP2)'
WHERE id = 'frontiertower-sf';

UPDATE event_sources SET notes = 'Verified 2026-07-03: JS-only (WordPress+Elementor) — needs headless' WHERE id = 'grayarea-sf';
UPDATE event_sources SET notes = 'Verified 2026-07-03: JS-only (Squarespace; /upcoming 404) — needs headless' WHERE id = 'thelab-sf';
UPDATE event_sources SET notes = 'Verified 2026-07-03: JS-only — needs headless' WHERE id = 'sfsymphony';
UPDATE event_sources SET notes = 'Verified 2026-07-03: JS-only (Drupal) — needs headless' WHERE id = 'exploratorium-sf';
UPDATE event_sources SET notes = 'Verified 2026-07-03: JS-only, no JSON-LD in initial HTML — needs headless' WHERE id = 'sfmoma-events';
UPDATE event_sources SET notes = 'Verified 2026-07-03: JS-only (SeeTickets plugin) — needs headless' WHERE id = 'thechapel-sf';
UPDATE event_sources SET notes = 'Verified 2026-07-03: JS-only; events on thelostchurch.org ticketing — needs headless' WHERE id = 'thelostchurch-sf';
UPDATE event_sources SET notes = 'Verified 2026-07-03: JS-only — needs headless' WHERE id = 'odc-sf';
UPDATE event_sources SET notes = 'Verified 2026-07-03: JS-only (Ticketweb tw-events plugin) — needs headless' WHERE id = 'brickandmortar-sf';
UPDATE event_sources SET notes = 'Verified 2026-07-03: JS-only (SeeTickets plugin) — needs headless' WHERE id = 'rickshawstop-sf';
UPDATE event_sources SET notes = 'Verified 2026-07-03: MediaWiki category page, unstructured dates — low value, skip' WHERE id = 'noisebridge-sf';
