-- ============================================
-- Migration 142b: an escalation is not a house post
--
-- Reusing members_at as the delivery stamp for audience='oncall' made the log
-- claim that an on-call escalation had gone to the channel the whole house
-- reads. That is exactly the kind of lie a log must not tell, so escalations
-- get their own column.
-- ============================================

ALTER TABLE recruit_notifications ADD COLUMN IF NOT EXISTS escalated_at TIMESTAMPTZ;

COMMENT ON COLUMN recruit_notifications.escalated_at IS
  'Posted to #recruiting-automation for audience=oncall. Distinct from members_at.';

UPDATE recruit_notifications
  SET escalated_at = members_at, members_at = NULL
  WHERE audience = 'oncall' AND members_at IS NOT NULL AND escalated_at IS NULL;

DROP INDEX IF EXISTS idx_recruit_notifications_pending_members;
CREATE INDEX IF NOT EXISTS idx_recruit_notifications_pending_members
  ON recruit_notifications (lane, due_at)
  WHERE members_at IS NULL AND escalated_at IS NULL AND NOT muted;
