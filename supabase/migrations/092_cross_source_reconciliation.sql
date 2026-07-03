-- ============================================
-- Cross-source canonical-key reconciliation (19hz <-> RA duplicate healing)
-- Migrations 092 + 093 (093 = fixed-point iteration + Luma 'Venue' placeholder
-- exclusion; this file contains the final combined state)
--
-- Two sources list the same club night under different titles (RA: headliner/
-- promoter title; 19hz: full lineup). Same date + same normalized venue +
-- one of three name rules => unify canonical_key so the client merges rows:
--   1. full-name containment (contained side >= 6 chars)
--   2. first segment (before ':' or ',') of one appears in the other
--   3. word-token Jaccard overlap >= 0.6
-- Venue guards: normalized venue >= 3 chars and not a placeholder
-- (tba/tbd/sf/oakland/various/online/venue — 'venue' is Luma's hidden-address
-- placeholder and welds unrelated events).
-- Runs at the end of every scrape via run_events_maintenance(). Iterates to a
-- fixed point (max 5 rounds) because a single pass isn't transitive.
-- First live run merged 57 duplicate pairs.
-- ============================================

CREATE OR REPLACE FUNCTION normalize_event_name(t TEXT) RETURNS TEXT AS $$
  SELECT trim(regexp_replace(regexp_replace(lower(replace(coalesce(t,''), ' w/ ', ' with ')), '[^a-z0-9 ]', ' ', 'g'), '\s+', ' ', 'g'));
$$ LANGUAGE sql IMMUTABLE;

CREATE OR REPLACE FUNCTION event_first_segment(t TEXT) RETURNS TEXT AS $$
  SELECT normalize_event_name(
    CASE WHEN position(':' in coalesce(t,'')) > 0 THEN split_part(t, ':', 1)
         WHEN position(',' in coalesce(t,'')) > 0 THEN split_part(t, ',', 1)
         ELSE t END);
$$ LANGUAGE sql IMMUTABLE;

CREATE OR REPLACE FUNCTION reconcile_canonical_keys() RETURNS INTEGER AS $$
DECLARE
  pair RECORD;
  merged INTEGER := 0;
  round_merged INTEGER;
  rounds INTEGER := 0;
  na TEXT; nb TEXT; fa TEXT; fb TEXT;
  ta TEXT[]; tb TEXT[];
  icount INTEGER; ucount INTEGER;
  changed INTEGER;
  is_match BOOLEAN;
BEGIN
  LOOP
    round_merged := 0;
    rounds := rounds + 1;
    FOR pair IN
      SELECT e1.canonical_key AS k1, e2.canonical_key AS k2, e1.name AS n1, e2.name AS n2
      FROM events e1
      JOIN events e2
        ON e1.date = e2.date
       AND e1.source_id <> e2.source_id
       AND e1.canonical_key < e2.canonical_key
       AND lower(regexp_replace(e1.venue, '[^a-zA-Z0-9]', '', 'g')) = lower(regexp_replace(e2.venue, '[^a-zA-Z0-9]', '', 'g'))
      WHERE length(regexp_replace(e1.venue, '[^a-zA-Z0-9]', '', 'g')) >= 3
        AND lower(regexp_replace(e1.venue, '[^a-zA-Z0-9]', '', 'g'))
            NOT IN ('tba','tbd','sanfrancisco','oakland','various','online','venue')
    LOOP
      na := normalize_event_name(pair.n1);
      nb := normalize_event_name(pair.n2);
      fa := event_first_segment(pair.n1);
      fb := event_first_segment(pair.n2);
      is_match := false;

      IF (length(na) >= 6 AND position(na in nb) > 0) OR (length(nb) >= 6 AND position(nb in na) > 0) THEN
        is_match := true;
      END IF;

      IF NOT is_match THEN
        IF (length(fa) >= 4 AND position(fa in nb) > 0) OR (length(fb) >= 4 AND position(fb in na) > 0)
           OR fa = nb OR fb = na THEN
          is_match := true;
        END IF;
      END IF;

      IF NOT is_match THEN
        ta := ARRAY(SELECT DISTINCT x FROM unnest(string_to_array(na, ' ')) x WHERE length(x) > 0);
        tb := ARRAY(SELECT DISTINCT x FROM unnest(string_to_array(nb, ' ')) x WHERE length(x) > 0);
        IF cardinality(ta) > 0 AND cardinality(tb) > 0 THEN
          SELECT count(*) INTO icount FROM unnest(ta) x WHERE x = ANY(tb);
          ucount := cardinality(ta) + cardinality(tb) - icount;
          IF ucount > 0 AND icount::float / ucount >= 0.6 THEN
            is_match := true;
          END IF;
        END IF;
      END IF;

      IF is_match THEN
        UPDATE events SET canonical_key = pair.k1 WHERE canonical_key = pair.k2;
        GET DIAGNOSTICS changed = ROW_COUNT;
        IF changed > 0 THEN
          round_merged := round_merged + 1;
        END IF;
      END IF;
    END LOOP;
    merged := merged + round_merged;
    EXIT WHEN round_merged = 0 OR rounds >= 5;
  END LOOP;
  RETURN merged;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Wire into post-scrape maintenance
CREATE OR REPLACE FUNCTION run_events_maintenance()
RETURNS JSONB AS $$
DECLARE
  stale_events INTEGER;
  stale_discord INTEGER;
  old_runs INTEGER;
  reconciled INTEGER;
BEGIN
  DELETE FROM events WHERE date < CURRENT_DATE - INTERVAL '60 days';
  GET DIAGNOSTICS stale_events = ROW_COUNT;

  DELETE FROM discord_event_cache WHERE expires_at < NOW() - INTERVAL '7 days';
  GET DIAGNOSTICS stale_discord = ROW_COUNT;

  DELETE FROM scrape_runs WHERE started_at < NOW() - INTERVAL '90 days';
  GET DIAGNOSTICS old_runs = ROW_COUNT;

  reconciled := reconcile_canonical_keys();

  RETURN jsonb_build_object(
    'stale_events', stale_events,
    'stale_discord', stale_discord,
    'old_runs', old_runs,
    'reconciled', reconciled
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Internet Archive: real Eventbrite org id found (17912681148); enable.
UPDATE event_sources
SET url = 'https://www.eventbrite.com/o/internet-archive-17912681148',
    type = 'eventbrite-org', enabled = true,
    notes = 'Agape signal: 4 events — enabled via eventbrite-org parser'
WHERE id = 'internetarchive-sf';
