-- ============================================
-- Venue-category rule
-- Migration 098
--
-- A venue-class source's category applies to events at that venue regardless
-- of which feed delivered them: Gray Area events arriving via RA/19hz are
-- art, not music — the venue defines the program. Runs in
-- run_events_maintenance() after every scrape, so feed/AI drift self-heals.
-- Matching: exact normalized venue equality, or word-boundary containment
-- for names >= 5 chars (avoids 'ATA' matching inside unrelated venues).
-- ============================================

CREATE OR REPLACE FUNCTION apply_venue_categories() RETURNS INTEGER AS $$
DECLARE
  total INTEGER := 0;
  changed INTEGER;
  src RECORD;
BEGIN
  FOR src IN
    SELECT id, name, category FROM event_sources WHERE source_class = 'venue'
  LOOP
    UPDATE events e SET content_type = src.category
    WHERE e.content_type IS DISTINCT FROM src.category
      AND (
        lower(trim(e.venue)) = lower(trim(src.name))
        OR (length(src.name) >= 5
            AND e.venue ~* ('\m' || regexp_replace(src.name, '([^a-zA-Z0-9 ])', '\\\1', 'g') || '\M'))
      );
    GET DIAGNOSTICS changed = ROW_COUNT;
    total := total + changed;
  END LOOP;
  RETURN total;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION run_events_maintenance()
RETURNS JSONB AS $$
DECLARE
  stale_events INTEGER;
  stale_discord INTEGER;
  old_runs INTEGER;
  reconciled INTEGER;
  venue_categorized INTEGER;
BEGIN
  DELETE FROM events WHERE date < CURRENT_DATE - INTERVAL '60 days';
  GET DIAGNOSTICS stale_events = ROW_COUNT;

  DELETE FROM discord_event_cache WHERE expires_at < NOW() - INTERVAL '7 days';
  GET DIAGNOSTICS stale_discord = ROW_COUNT;

  DELETE FROM scrape_runs WHERE started_at < NOW() - INTERVAL '90 days';
  GET DIAGNOSTICS old_runs = ROW_COUNT;

  reconciled := reconcile_canonical_keys();
  venue_categorized := apply_venue_categories();

  RETURN jsonb_build_object(
    'stale_events', stale_events,
    'stale_discord', stale_discord,
    'old_runs', old_runs,
    'reconciled', reconciled,
    'venue_categorized', venue_categorized
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
