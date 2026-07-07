-- ============================================
-- Non-electronic music coverage: SeeTickets-WP venues
-- Migration 099
-- The Chapel and Rickshaw Stop server-render complete SeeTickets event cards
-- (re-verified 2026-07-06; the earlier JS-only verdict was wrong for these).
-- Parsed by seetickets-wp (scrape-events v1.8.0).
-- ============================================
UPDATE event_sources SET
  type = 'seetickets-wp', url = 'https://thechapelsf.com/music/', enabled = true,
  notes = 'Re-verified: SeeTickets WP widget server-renders event cards — seetickets-wp parser'
WHERE id = 'thechapel-sf';

UPDATE event_sources SET
  type = 'seetickets-wp', url = 'https://rickshawstop.com/', enabled = true,
  notes = 'Re-verified: SeeTickets WP widget server-renders event cards — seetickets-wp parser'
WHERE id = 'rickshawstop-sf';
