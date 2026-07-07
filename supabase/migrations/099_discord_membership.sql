-- ============================================
-- Discord membership gating for Agape recommendations
-- Migration 099
--
-- 1. user_discord_membership: caches whether a Supabase user's linked
--    Discord account is a member of the Agape server. Written only by
--    the discord-membership edge function (service role); users read
--    their own row.
-- 2. Replaces migration 091's blanket "Authenticated read all events"
--    policy: private rows from the Agape curation feed now require
--    verified Agape membership. Other private rows (demoted feeds,
--    user-submitted) keep the any-authenticated-user behavior, so
--    there is no regression for existing signed-in users.
--    Public rows remain covered by 089's "Public read access" policy,
--    which applies to all roles (policies OR together).
-- ============================================

CREATE TABLE IF NOT EXISTS user_discord_membership (
  user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  discord_user_id TEXT NOT NULL,
  discord_username TEXT,
  is_agape_member BOOLEAN NOT NULL DEFAULT false,
  verified_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE user_discord_membership ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users read own discord membership" ON user_discord_membership
  FOR SELECT TO authenticated USING (auth.uid() = user_id);
-- No insert/update/delete policies: writes go through the
-- discord-membership edge function with the service role.

DROP POLICY IF EXISTS "Authenticated read all events" ON events;

CREATE POLICY "Authenticated read non-agape events" ON events
  FOR SELECT TO authenticated
  USING (source_id IS DISTINCT FROM 'discord-agape-events');

CREATE POLICY "Agape members read agape events" ON events
  FOR SELECT TO authenticated
  USING (
    source_id = 'discord-agape-events'
    AND EXISTS (
      SELECT 1 FROM user_discord_membership m
      WHERE m.user_id = auth.uid() AND m.is_agape_member
    )
  );
