-- ============================================
-- Migration 143: profile events in the same ledger
--
-- Each profile gets an Activity tab: everything that ever happened to this
-- person, in order. Most of it already exists as notifications, keyed on
-- (subject_type, subject_id) — but the things a housemate DOES in the app
-- (wrote a verdict, sent an email, confirmed a move-in window, placed them on
-- a listing) were never recorded anywhere a person could read.
--
-- Those belong in the same table, not a second one: a profile's history is one
-- story, and splitting "things we told the house" from "things we did" would
-- mean two queries, two orderings, and two chances to disagree.
--
-- What separates them is only who needs to hear about it, which is already the
-- audience column. So: audience 'none' — recorded, never delivered anywhere.
-- Not the same as muted (which still posts to #recruiting-automation): a
-- profile event is history, not news.
-- ============================================

ALTER TABLE recruit_notifications DROP CONSTRAINT IF EXISTS recruit_notifications_audience_check;
ALTER TABLE recruit_notifications ADD CONSTRAINT recruit_notifications_audience_check
  CHECK (audience IN ('house', 'oncall', 'person', 'none'));

COMMENT ON COLUMN recruit_notifications.audience IS
  'house = members channel; oncall = #recruiting-automation escalation (its membership IS the on-call roster); person = DM, only where ownership is real; none = a profile event — recorded in the log and never delivered.';

/* Append a profile event. Called by the client at the moment the thing
   happens, because only the client knows the actor and the intent — the
   dispatcher can see that a verdict row exists but not that Kate just wrote it.

   SECURITY DEFINER so members can append without write access to the table
   itself: audience is forced to 'none' and the delivery stamps are filled in
   immediately, so a client can never manufacture something that posts to
   Discord.

   dedupe_key carries a timestamp because these are events, not conditions —
   two emails to the same person are two entries, and the log should show both. */
CREATE OR REPLACE FUNCTION recruit_log_event(
  p_kind TEXT,
  p_subject_type TEXT,
  p_subject_id TEXT,
  p_subject_label TEXT,
  p_sentence TEXT,
  p_body TEXT DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE new_id UUID;
BEGIN
  IF NOT is_recruiting_member() THEN
    RAISE EXCEPTION 'recruiting members only';
  END IF;
  IF p_subject_type NOT IN ('applicant', 'listing', 'stay', 'house') THEN
    RAISE EXCEPTION 'unknown subject_type %', p_subject_type;
  END IF;

  INSERT INTO recruit_notifications
    (kind, subject_type, subject_id, subject_label, audience, lane, dedupe_key, payload,
     -- Delivered nowhere, by construction: stamped as handled so no lane, digest,
     -- or log drain will ever pick it up, whatever future code is added.
     log_at, members_at, acked_at, acked_by)
  VALUES
    (p_kind, p_subject_type, p_subject_id, COALESCE(p_subject_label, ''), 'none', 'daily',
     'event:' || p_kind || ':' || COALESCE(p_subject_id, 'house') || ':' ||
       extract(epoch FROM clock_timestamp())::bigint || ':' || substr(md5(random()::text), 1, 6),
     jsonb_build_object('sentence', p_sentence, 'title', COALESCE(p_subject_label, ''))
       || CASE WHEN p_body IS NULL OR p_body = '' THEN '{}'::jsonb
               ELSE jsonb_build_object('body', p_body) END,
     NOW(), NOW(), NOW(), auth.uid())
  RETURNING id INTO new_id;

  RETURN new_id;
END;
$$;

-- The profile tab's query: one subject, newest first.
CREATE INDEX IF NOT EXISTS idx_recruit_notifications_profile
  ON recruit_notifications (subject_type, subject_id, created_at DESC);
