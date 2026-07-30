-- ============================================
-- Migration 153: replies to a notification become house notes
--
-- A notification about a new applicant is exactly the moment somebody knows
-- something — "I met her at the climbing gym", "he's a friend of Sam's". That
-- knowledge currently dies in the channel: contributing it means opening the app
-- and retyping it, so mostly nobody does, and the review happens without the one
-- useful thing anybody knew.
--
-- So the bot reads replies to its own messages and files them against the
-- applicant. Two pieces are needed:
--
--   1. discord_message_id on the notification, so a reply can be traced back to
--      what it was replying to. Without it there is nothing to match against.
--   2. recruit_notification_replies, the idempotency record — the tick re-reads
--      the same channel every 15 minutes and must not file a reply twice.
--
-- The reply lands in recruit_comments, the same table the in-app House notes box
-- writes to, so it appears everywhere notes already appear rather than in a
-- parallel store nobody reads.
-- ============================================

ALTER TABLE recruit_notifications
  ADD COLUMN IF NOT EXISTS discord_message_id TEXT;

COMMENT ON COLUMN recruit_notifications.discord_message_id IS
  'The message the log post created, so replies to it can be traced back to this notification.';

CREATE INDEX IF NOT EXISTS idx_recruit_notifications_message
  ON recruit_notifications (discord_message_id)
  WHERE discord_message_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS recruit_notification_replies (
  -- Discord's message id is the natural key: unique, it is what we read from the
  -- channel, and as a primary key it makes double-filing impossible rather than
  -- merely unlikely.
  discord_message_id TEXT PRIMARY KEY,
  notification_id UUID REFERENCES recruit_notifications(id) ON DELETE SET NULL,
  applicant_id TEXT REFERENCES recruit_applicants(id) ON DELETE CASCADE,
  author_discord_id TEXT,
  author_name TEXT,
  body TEXT NOT NULL,
  -- The house note this became, if it became one. NULL means it was read and
  -- deliberately not filed (no applicant to attach it to, or an empty body).
  comment_id UUID REFERENCES recruit_comments(id) ON DELETE SET NULL,
  filed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE recruit_notification_replies ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Recruiting members read notification replies" ON recruit_notification_replies;
CREATE POLICY "Recruiting members read notification replies" ON recruit_notification_replies
  FOR SELECT TO authenticated USING (is_recruiting_member());

CREATE INDEX IF NOT EXISTS idx_recruit_notification_replies_applicant
  ON recruit_notification_replies (applicant_id, filed_at DESC);

COMMENT ON TABLE recruit_notification_replies IS
  'Discord replies to notification posts, filed as house notes. Keyed on the Discord message id so the 15-minute tick cannot file one twice.';
