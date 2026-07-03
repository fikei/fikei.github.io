-- ============================================
-- One-off user-submitted events source (add-event edge function)
-- Migration 094
--
-- enabled=false: the scraper never dispatches it (type 'manual' has no
-- parser); the client adds it to users' source lists so its rows render.
-- Class 'curation' => private by default; add-event overrides per URL
-- (public ticketing/venue pages => public, Partiful/secretparty/forms =>
-- private), passed through cache-events' per-event visibility override.
-- ============================================
INSERT INTO event_sources (id, name, category, type, url, region, description, enabled, source_class, notes) VALUES
  ('user-submitted', 'Community adds', 'social', 'manual', 'manual://add-event', 'bay-area',
   'One-off events added by users via web link', false, 'curation',
   'Written by the add-event function; enabled=false keeps it out of the scrape loop')
ON CONFLICT (id) DO NOTHING;
