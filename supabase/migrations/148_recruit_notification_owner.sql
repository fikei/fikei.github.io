-- ============================================
-- Migration 148: who owns the thing a notification is about
--
-- Most notifications describe something with a person already attached — the
-- housemate taking a call, the reviewer who asked for a second read, whoever
-- created a listing. Until now that person appeared only inside the sentence,
-- if the template happened to mention them, so the log could not answer "what is
-- Kate on the hook for" and a task with a clear owner read as nobody's.
--
-- owner_name is denormalised on purpose: it is what the sentence said at the
-- time. Resolving it live would rename a past notification when somebody changes
-- their display name, and the log is a record of what was said.
--
-- Unowned stays the common case and is not a defect — "nobody has reviewed this"
-- is precisely a notification with no owner, and that is the point of it.
-- ============================================

ALTER TABLE recruit_notifications
  ADD COLUMN IF NOT EXISTS owner_name TEXT,
  ADD COLUMN IF NOT EXISTS owner_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL;

COMMENT ON COLUMN recruit_notifications.owner_name IS
  'The housemate on the hook for this, when one is known — the screener, the asker, the creator. NULL means nobody owns it yet, which is itself often the news.';

-- "What is on my plate" — the query the column exists for.
CREATE INDEX IF NOT EXISTS idx_recruit_notifications_owner
  ON recruit_notifications (owner_user_id, created_at DESC)
  WHERE owner_user_id IS NOT NULL AND acked_at IS NULL;
