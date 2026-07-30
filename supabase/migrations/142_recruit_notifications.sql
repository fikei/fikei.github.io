-- ============================================
-- Migration 142: the notification ledger
--
-- Today six functions each own their own notification: their own dedupe
-- column, their own hard-coded channel, their own volume rule. Nothing can
-- answer "what did we send this week" or "did anyone ever get back to her",
-- because there is no record of a notification anywhere — only the side
-- effect of having sent one.
--
-- recruit_notifications makes the notification itself a row. Written by the
-- detect pass BEFORE anything is delivered, so:
--
--   * the row's existence IS the log entry — the in-app Activity view and
--     #recruiting-automation both just read this table;
--   * every delivery is a stamp on it (log_at / members_at / dm_at), so a
--     muted kind still leaves a complete record with no stamps;
--   * dedupe_key UNIQUE + ON CONFLICT DO NOTHING replaces six bespoke
--     *_reminded_at columns with one idiom.
--
-- Double-notify is deliberate: the claim post asks someone to take a call,
-- the digest line tells the house she replied, the log entry is the record it
-- happened. Suppressing the second because the first fired is how the house
-- ends up unable to reconstruct what it did.
--
-- On-call is not a person: the members of #recruiting-automation are on-call,
-- so audience 'oncall' resolves to an @here in that channel and there is no
-- user id to configure or keep current.
-- ============================================

CREATE TABLE IF NOT EXISTS recruit_notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  kind TEXT NOT NULL,                       -- 'review_stalled', 'reply_reschedule', ...
  subject_type TEXT NOT NULL CHECK (subject_type IN ('applicant', 'listing', 'stay', 'house')),
  subject_id TEXT,                          -- applicant id (text) or uuid::text; null for house-wide
  subject_label TEXT NOT NULL DEFAULT '',   -- "Maya", "Priest", denormalised so the log reads without joins

  -- Who it is for. 'house' = members channel (batched by lane); 'oncall' =
  -- @here in #recruiting-automation; 'person' = a DM to recipient_id, used
  -- only where ownership is real (the claimer of a scheduled call).
  audience TEXT NOT NULL DEFAULT 'house' CHECK (audience IN ('house', 'oncall', 'person')),
  recipient_id TEXT,                        -- discord user id when audience='person'

  -- Members-channel timing only. The log is never batched or delayed.
  lane TEXT NOT NULL DEFAULT 'daily' CHECK (lane IN ('now', 'daily', 'weekly')),

  dedupe_key TEXT NOT NULL UNIQUE,          -- '<kind>:<subject_id>[:<step>]'
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,  -- { title, body, section, links: [{label,url}] }

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),   -- == entered the log
  due_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),       -- eligible to broadcast from
  log_at TIMESTAMPTZ,                              -- posted to #recruiting-automation
  members_at TIMESTAMPTZ,                          -- posted to the members channel
  -- An escalation is NOT a members-channel post: audience='oncall' means an
  -- @here in #recruiting-automation. Its own column, so the log never claims a
  -- delivery that didn't happen.
  escalated_at TIMESTAMPTZ,
  dm_at TIMESTAMPTZ,                               -- delivered as a DM
  digest_id UUID,                                  -- which digest embed carried it
  muted BOOLEAN NOT NULL DEFAULT FALSE,            -- suppressed from the members channel; still logged
  acked_at TIMESTAMPTZ,                            -- resolved in-app
  acked_by UUID REFERENCES auth.users(id) ON DELETE SET NULL
);

-- The log view: newest first, no predicate. This is the Activity view's query.
CREATE INDEX IF NOT EXISTS idx_recruit_notifications_log
  ON recruit_notifications (created_at DESC);
-- "everything that ever happened to Maya".
CREATE INDEX IF NOT EXISTS idx_recruit_notifications_subject
  ON recruit_notifications (subject_type, subject_id, created_at DESC);
-- The dispatcher's three drain queries.
CREATE INDEX IF NOT EXISTS idx_recruit_notifications_pending_log
  ON recruit_notifications (created_at) WHERE log_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_recruit_notifications_pending_members
  ON recruit_notifications (lane, due_at)
  WHERE members_at IS NULL AND escalated_at IS NULL AND NOT muted;
-- Rail badges.
CREATE INDEX IF NOT EXISTS idx_recruit_notifications_open
  ON recruit_notifications (subject_type, kind) WHERE acked_at IS NULL;

ALTER TABLE recruit_notifications ENABLE ROW LEVEL SECURITY;

-- Members read the whole log — that is the point of it. Writes are
-- service-role (the dispatcher) except acking, which goes through the RPC
-- below so a client can never invent or edit a notification.
CREATE POLICY "Recruiting members read notifications" ON recruit_notifications
  FOR SELECT TO authenticated USING (is_recruiting_member());

-- Acking resolves a notification without deleting it: the log keeps the entry
-- and gains the fact that it was handled, and the next digest stops asking.
CREATE OR REPLACE FUNCTION recruit_ack_notification(p_id UUID)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF NOT is_recruiting_member() THEN
    RAISE EXCEPTION 'recruiting members only';
  END IF;
  UPDATE recruit_notifications
    SET acked_at = NOW(), acked_by = auth.uid()
    WHERE id = p_id AND acked_at IS NULL;
END;
$$;

-- Ack every open notification of a kind for a subject. The rails call this
-- when the underlying thing is dealt with — reviewing an applicant clears
-- their review_stalled, opening a listing clears its draft nudges — so the
-- digest never asks for something already done.
CREATE OR REPLACE FUNCTION recruit_ack_subject(p_subject_type TEXT, p_subject_id TEXT, p_kinds TEXT[] DEFAULT NULL)
RETURNS INT
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE n INT;
BEGIN
  IF NOT is_recruiting_member() THEN
    RAISE EXCEPTION 'recruiting members only';
  END IF;
  UPDATE recruit_notifications
    SET acked_at = NOW(), acked_by = auth.uid()
    WHERE subject_type = p_subject_type AND subject_id = p_subject_id
      AND acked_at IS NULL
      AND (p_kinds IS NULL OR kind = ANY(p_kinds));
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END;
$$;

-- Settings. Cadence and mutes are config, not deploys: a notification that
-- turns out to be noise is switched off here, and its log entries keep being
-- written either way.
INSERT INTO recruit_settings (key, value) VALUES
  ('notify_digest_hour', '8'::jsonb),
  ('notify_enabled', 'true'::jsonb),
  -- Automation-only to start: every notification, escalation, and digest goes
  -- to #recruiting-automation and nothing reaches the channel the whole house
  -- reads until the detectors have proven themselves against real data. Lanes
  -- and audiences still work as designed, so this is a destination switch, not
  -- a feature flag.
  ('notify_house_posts', 'false'::jsonb),
  -- Reply intents ship in shadow mode: classified, logged, and visible in
  -- #recruiting-automation, but not broadcast to the house until the
  -- confidence distribution has been read against real replies. Opening the
  -- lane is an edit here, not a deploy.
  ('notify_muted', '["reply_reschedule","reply_withdrawing","reply_plans_changed","reply_post_acceptance"]'::jsonb)
ON CONFLICT (key) DO NOTHING;

COMMENT ON TABLE recruit_notifications IS
  'Every recruiting notification, as a row. Written before delivery, so the table is the running log and the *_at columns are deliveries. Retained forever.';
COMMENT ON COLUMN recruit_notifications.muted IS
  'Suppressed from the members channel by notify_muted. Still logged — muting never loses information.';
COMMENT ON COLUMN recruit_notifications.audience IS
  'house = members channel; oncall = @here in #recruiting-automation (its membership IS the on-call roster); person = DM, only where ownership is real.';
