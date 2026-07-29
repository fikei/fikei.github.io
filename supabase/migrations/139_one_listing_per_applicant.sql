-- ============================================
-- Migration 139: an applicant belongs to exactly one listing
--
-- Until now a candidate was auto-placed into EVERY open listing they
-- qualified for, so the same person appeared under three rooms and three
-- different housemates could each think they were handling them. Shortlists
-- stopped meaning anything.
--
-- One active placement per applicant, enforced in the database rather than
-- by convention — the client, the auto-sweep, and drag-and-drop all write
-- here, and only an index catches every path.
--
-- Reconciling the existing duplicates, in order:
--   1. a manual placement beats an auto one — a recruiter chose it
--   2. otherwise the listing whose start date is closest to the applicant's
--      confirmed move-in (the actual fit)
--   3. otherwise the earliest-starting listing, then the lowest id, so the
--      outcome is stable rather than whatever the planner returned first
--
-- Losers are deleted, not tombstoned: 'removed' means "a recruiter said
-- never again here", and these were placed by a sweep, not by a person.
-- ============================================

WITH ranked AS (
  SELECT
    c.id,
    c.applicant_id,
    ROW_NUMBER() OVER (
      PARTITION BY c.applicant_id
      ORDER BY
        (c.source = 'manual') DESC,
        ABS(EXTRACT(EPOCH FROM (l.starts_on::timestamp - COALESCE(a.move_in_from, l.starts_on)::timestamp))) ASC,
        l.starts_on ASC,
        c.id ASC
    ) AS rn
  FROM recruit_listing_candidates c
  JOIN recruit_listings l ON l.id = c.listing_id
  JOIN recruit_applicants a ON a.id = c.applicant_id
  WHERE c.status = 'active'
)
DELETE FROM recruit_listing_candidates
  WHERE id IN (SELECT id FROM ranked WHERE rn > 1);

-- The guarantee. Tombstones are exempt: a person can be 'removed' from many
-- listings over time, they just can't be ACTIVE in more than one.
CREATE UNIQUE INDEX IF NOT EXISTS recruit_listing_candidates_one_active_idx
  ON recruit_listing_candidates (applicant_id)
  WHERE status = 'active';
