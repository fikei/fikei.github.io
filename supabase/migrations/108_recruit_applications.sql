-- ============================================
-- Agape recruiting: applicants, shared decisions, house comments
-- Migration 108
--
-- Moves the /applications viewer (formerly recruit.ctrl.rodeo's encrypted
-- static blob) server-side. Access is gated on membership in the Agape
-- Discord's Recruiting Society channel, verified by the discord-membership
-- edge function (v1.1.0) which now also writes is_recruiting_member.
--
-- 1. user_discord_membership.is_recruiting_member — channel-level gate,
--    written only by the edge function (service role).
-- 2. recruit_applicants — one row per application form response. Loaded by
--    an import; only recruiting members can read. No client writes.
-- 3. recruit_decisions — one shared house decision per applicant
--    (outreach / hold / pass, hold carries a reason). Any recruiting
--    member can set or clear it; the row records who decided.
-- 4. recruit_comments — internal per-user notes on a case. Authors write
--    their own; all recruiting members read.
-- ============================================

ALTER TABLE user_discord_membership
  ADD COLUMN IF NOT EXISTS is_recruiting_member BOOLEAN NOT NULL DEFAULT false;

-- Pre-v1.1.0 cache rows never computed the channel gate; age them out so the
-- next status call re-verifies instead of serving a stale false for 7 days.
UPDATE user_discord_membership SET verified_at = '1970-01-01' WHERE NOT is_recruiting_member;

CREATE OR REPLACE FUNCTION is_recruiting_member()
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM user_discord_membership m
    WHERE m.user_id = auth.uid() AND m.is_recruiting_member
  );
$$;

CREATE TABLE IF NOT EXISTS recruit_applicants (
  id TEXT PRIMARY KEY,                -- slugged name + submission timestamp
  submitted_at TIMESTAMPTZ NOT NULL,
  first_name TEXT NOT NULL,
  last_name TEXT NOT NULL DEFAULT '',
  pronouns TEXT DEFAULT '',
  email TEXT NOT NULL,
  social TEXT DEFAULT '',
  about TEXT DEFAULT '',
  why_agape TEXT DEFAULT '',
  gifts TEXT DEFAULT '',
  heard_from TEXT DEFAULT '',
  residency TEXT DEFAULT '',
  move_in TEXT DEFAULT '',
  budget TEXT DEFAULT ''
);

CREATE TABLE IF NOT EXISTS recruit_decisions (
  applicant_id TEXT PRIMARY KEY REFERENCES recruit_applicants(id) ON DELETE CASCADE,
  decision TEXT NOT NULL CHECK (decision IN ('outreach', 'hold', 'pass')),
  hold_reason TEXT CHECK (hold_reason IN ('fit', 'timing', 'needs')),
  decided_by UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  decided_by_name TEXT,
  decided_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS recruit_comments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  applicant_id TEXT NOT NULL REFERENCES recruit_applicants(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  author_name TEXT,
  body TEXT NOT NULL CHECK (char_length(body) BETWEEN 1 AND 4000),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_recruit_comments_applicant
  ON recruit_comments(applicant_id, created_at);

ALTER TABLE recruit_applicants ENABLE ROW LEVEL SECURITY;
ALTER TABLE recruit_decisions ENABLE ROW LEVEL SECURITY;
ALTER TABLE recruit_comments ENABLE ROW LEVEL SECURITY;

-- Applicants: read-only for recruiting members (imports use service role).
CREATE POLICY "Recruiting members read applicants" ON recruit_applicants
  FOR SELECT TO authenticated USING (is_recruiting_member());

-- Decisions: shared house state — any recruiting member reads/sets/clears.
CREATE POLICY "Recruiting members read decisions" ON recruit_decisions
  FOR SELECT TO authenticated USING (is_recruiting_member());
CREATE POLICY "Recruiting members insert decisions" ON recruit_decisions
  FOR INSERT TO authenticated
  WITH CHECK (is_recruiting_member() AND decided_by = auth.uid());
CREATE POLICY "Recruiting members update decisions" ON recruit_decisions
  FOR UPDATE TO authenticated
  USING (is_recruiting_member())
  WITH CHECK (is_recruiting_member() AND decided_by = auth.uid());
CREATE POLICY "Recruiting members delete decisions" ON recruit_decisions
  FOR DELETE TO authenticated USING (is_recruiting_member());

-- Comments: everyone in the channel reads; authors own their writes.
CREATE POLICY "Recruiting members read comments" ON recruit_comments
  FOR SELECT TO authenticated USING (is_recruiting_member());
CREATE POLICY "Recruiting members write own comments" ON recruit_comments
  FOR INSERT TO authenticated
  WITH CHECK (is_recruiting_member() AND user_id = auth.uid());
CREATE POLICY "Authors delete own comments" ON recruit_comments
  FOR DELETE TO authenticated
  USING (is_recruiting_member() AND user_id = auth.uid());
