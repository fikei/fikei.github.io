-- ============================================
-- tiat (the intersection of art & technology) — Luma community calendar
-- Migration 097
-- User-requested explicit tracking (luma.com/tiat). Fills the art-category
-- coverage gap the Agape historical analysis identified. iCal via the
-- existing ical parser; calendar id cal-twiOosdGMMY66DI.
-- ============================================
INSERT INTO event_sources (id, name, category, type, url, region, description, enabled, source_class, notes) VALUES
  ('luma-tiat', 'tiat', 'art', 'ical',
   'https://api2.luma.com/ics/get?entity=calendar&id=cal-twiOosdGMMY66DI', 'bay-area',
   'tiat — the intersection of art & technology (Luma calendar)', true, 'community',
   'User-requested; Luma calendar cal-twiOosdGMMY66DI (luma.com/tiat)')
ON CONFLICT (id) DO NOTHING;
