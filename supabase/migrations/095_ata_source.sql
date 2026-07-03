-- ============================================
-- ATA (Artists' Television Access) venue source
-- Migration 095
-- User-requested; parsed by the 'ata' parser (scrape-events v1.6.0):
-- server-rendered WordPress month calendar at atasite.org/calendar.
-- ============================================
INSERT INTO event_sources (id, name, category, type, url, region, description, enabled, source_class, notes) VALUES
  ('ata-sf', 'ATA', 'film', 'ata', 'https://www.atasite.org/calendar', 'bay-area', 'Artists'' Television Access — underground film & experimental art', true, 'venue', 'Agape signal: 1 event in channel history; user-requested')
ON CONFLICT (id) DO NOTHING;
