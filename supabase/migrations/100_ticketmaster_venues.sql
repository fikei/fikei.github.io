-- ============================================
-- Ticketmaster Discovery API venue sources
-- Migration 100
-- Official API (TICKETMASTER_API_KEY secret), venue-scoped via tm://<venueId>
-- source URLs, parsed by 'ticketmaster' (scrape-events v1.9.0). Fills the
-- non-electronic music gap: LiveNation/AXS rooms whose sites block scraping.
-- ============================================
INSERT INTO event_sources (id, name, category, type, url, region, description, enabled, source_class, notes) VALUES
  ('tm-fillmore', 'The Fillmore', 'music', 'ticketmaster', 'tm://KovZpZAE6eeA', 'bay-area', 'The Fillmore (Ticketmaster)', true, 'venue', 'TM Discovery API'),
  ('tm-warfield', 'The Warfield', 'music', 'ticketmaster', 'tm://KovZpZAJe6lA', 'bay-area', 'The Warfield (Ticketmaster)', true, 'venue', 'TM Discovery API'),
  ('tm-masonic', 'The Masonic', 'music', 'ticketmaster', 'tm://KovZpZAJ6nlA', 'bay-area', 'The Masonic (Ticketmaster)', true, 'venue', 'TM Discovery API'),
  ('tm-independent', 'The Independent', 'music', 'ticketmaster', 'tm://KovZpZAAl7AA', 'bay-area', 'The Independent (Ticketmaster)', true, 'venue', 'TM Discovery API; own site 403s'),
  ('tm-castro', 'Castro Theatre', 'music', 'ticketmaster', 'tm://KovZpaF_me', 'bay-area', 'Castro Theatre (Ticketmaster)', true, 'venue', 'TM Discovery API; APE bookings'),
  ('tm-gamh', 'Great American Music Hall', 'music', 'ticketmaster', 'tm://KovZpZAJk7aA', 'bay-area', 'Great American Music Hall (Ticketmaster)', true, 'venue', 'TM Discovery API'),
  ('tm-regency', 'The Regency Ballroom', 'music', 'ticketmaster', 'tm://KovZpZAEet6A', 'bay-area', 'The Regency Ballroom (Ticketmaster)', true, 'venue', 'TM Discovery API')
ON CONFLICT (id) DO NOTHING;
