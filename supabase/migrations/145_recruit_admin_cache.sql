-- 145: cache the admin verdict on the membership row so it can be *absent*.
--
-- Migration 144 put admin in recruit_admins, which RLS reads. But the
-- membership path only re-verifies against Discord when its cache goes stale,
-- and a missing recruit_admins row is indistinguishable from "checked, not an
-- admin" — so after 144 nobody became an admin until their cache expired,
-- which is up to REVERIFY_DAYS of house-wide settings being read-only for
-- everyone.
--
-- A nullable column fixes it: NULL means "never resolved", which the function
-- treats as stale and re-verifies once. recruit_admins stays the only thing
-- RLS trusts; this is a freshness marker, not an authority.
ALTER TABLE user_discord_membership
  ADD COLUMN IF NOT EXISTS is_recruiting_admin BOOLEAN;

COMMENT ON COLUMN user_discord_membership.is_recruiting_admin IS
  'Cached #recruiting-automation access. NULL = never checked (forces a re-verify). Authority for RLS is recruit_admins.';
