-- ============================================
-- Greenlit Eventbrite organizers with Agape-channel signal
-- Migration 090
--
-- PRD event-source-architecture §8.4 (resolved): source class is assigned
-- per-source, not per-platform. Eventbrite *search* stays a demoted discovery
-- feed, but organizer pages with community signal are class venue/community.
-- Signal = appearances in the Agape #events history (2022-2026 analysis).
-- Scraped via the eventbrite-org parser (scrape-events v1.5.0).
-- ============================================

INSERT INTO event_sources (id, name, category, type, url, region, description, enabled, source_class, notes) VALUES
  ('eb-publicworks', 'Public Works', 'music', 'eventbrite-org', 'https://www.eventbrite.com/o/public-works-17405142071', 'bay-area', 'Public Works SF (Eventbrite org)', true, 'venue', 'Agape signal: 6 events'),
  ('eb-mannys', 'Manny''s', 'social', 'eventbrite-org', 'https://www.eventbrite.com/o/mannys-15114280512', 'bay-area', 'Manny''s civic events space (Eventbrite org)', true, 'venue', 'Agape signal: 3 events'),
  ('eb-hoodslam', 'Hoodslam', 'theater', 'eventbrite-org', 'https://www.eventbrite.com/o/hoodslam-15110219281', 'bay-area', 'Hoodslam wrestling/theater (Eventbrite org)', true, 'community', 'Agape signal: 3 events + org link posted directly'),
  ('eb-thecentersf', 'The Center SF', 'wellness', 'eventbrite-org', 'https://www.eventbrite.com/o/the-center-sf-3493443113', 'bay-area', 'The Center SF community & wellness (Eventbrite org)', true, 'community', 'Agape signal: 2 events'),
  ('eb-envelop', 'Envelop SF', 'music', 'eventbrite-org', 'https://www.eventbrite.com/o/envelop-17478025710', 'bay-area', 'Envelop spatial audio venue (Eventbrite org)', true, 'venue', 'Agape signal: 2 events')
ON CONFLICT (id) DO NOTHING;

-- Internet Archive was in the Wave 2 backlog pointing at its Eventbrite org
-- page with a placeholder 'html' type — the new parser handles it; enable.
UPDATE event_sources
SET type = 'eventbrite-org', enabled = true,
    notes = 'Agape signal: 4 events — enabled via eventbrite-org parser'
WHERE id = 'internetarchive-sf';

-- Post-verification adjustments (live-tested):
-- internetarchive-sf: guessed org id 404s — disabled pending real /o/ id lookup.
UPDATE event_sources
SET enabled = false,
    notes = 'Eventbrite org id unknown (guessed id 404s) — find real /o/ id from an IA event page, then re-enable'
WHERE id = 'internetarchive-sf';

-- Flux Vertical Theatre: org page was posted directly in the Agape channel.
INSERT INTO event_sources (id, name, category, type, url, region, description, enabled, source_class, notes) VALUES
  ('eb-fluxvertical', 'Flux Vertical Theatre', 'theater', 'eventbrite-org', 'https://www.eventbrite.com/o/16887986144', 'bay-area', 'Flux Vertical Theatre (Eventbrite org)', true, 'community', 'Agape signal: org page posted directly in channel')
ON CONFLICT (id) DO NOTHING;
