-- ============================================
-- Curiosity Guild — history storytelling talks (Eventbrite org page)
-- Migration 119
-- User-requested. First source in the new 'talks' category (Talks &
-- Lectures). Monthly public-talk series at the Balboa Theatre; events
-- come from the existing eventbrite-org parser, so this INSERT is the
-- whole registration — new events appear on the normal 2h scrape cron.
-- ============================================
INSERT INTO event_sources (id, name, category, type, url, region, description, enabled, source_class, notes) VALUES
  ('eb-curiosityguild', 'Curiosity Guild', 'talks', 'eventbrite-org',
   'https://www.eventbrite.com/o/curiosity-guild-120760437937', 'bay-area',
   'History storytelling talks', true, 'community',
   'User-requested; curiosityguild.org monthly series, tickets via Eventbrite org 120760437937')
ON CONFLICT (id) DO NOTHING;
