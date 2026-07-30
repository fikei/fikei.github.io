-- ============================================
-- Migration 144: what an inbound reply is actually about
--
-- "An applicant replied" is a fact with nine different consequences. A
-- reschedule an hour before a call and a question about whether the room is
-- furnished do not deserve the same line in the same digest, and today they are
-- indistinguishable: both are a dot on a row.
--
-- Intent is nearly free. recruit-gmail's scan already runs Haiku over every
-- inbound reply body to pull availability windows, so this is four more fields
-- on a call that was happening anyway — no new pass, no new cost, no new
-- latency.
--
-- intent drives routing; intents keeps everything the reply was doing, because
-- a message that offers times AND asks about parking is both and the digest
-- should be able to say so. intent_summary is the ask in the applicant's own
-- words, which is what a notification prints — never the raw snippet.
-- ============================================

ALTER TABLE recruit_emails
  ADD COLUMN IF NOT EXISTS intent TEXT,
  ADD COLUMN IF NOT EXISTS intents TEXT[],
  ADD COLUMN IF NOT EXISTS intent_confidence REAL,
  ADD COLUMN IF NOT EXISTS intent_summary TEXT,
  ADD COLUMN IF NOT EXISTS intent_at TIMESTAMPTZ;

ALTER TABLE recruit_emails DROP CONSTRAINT IF EXISTS recruit_emails_intent_chk;
ALTER TABLE recruit_emails ADD CONSTRAINT recruit_emails_intent_chk
  CHECK (intent IS NULL OR intent IN (
    'availability', 'reschedule', 'plans_changed', 'withdrawing',
    'post_acceptance', 'question', 'info_provided', 'nudge', 'unclear'));

-- The scan's "what still needs classifying" query.
CREATE INDEX IF NOT EXISTS idx_recruit_emails_unclassified
  ON recruit_emails (sent_at DESC)
  WHERE direction = 'in' AND intent IS NULL;

COMMENT ON COLUMN recruit_emails.intent IS
  'Primary intent — drives which lane the notification takes. Below the confidence floor this is ''unclear'' and a human reads the thread.';
COMMENT ON COLUMN recruit_emails.intents IS
  'Every intent the reply carries. The primary one routes; the rest shape the copy.';
COMMENT ON COLUMN recruit_emails.intent_summary IS
  'The ask in the applicant''s own words, one line. This is what notifications print.';

/* Shadow mode. The four consequential intents are muted, so they are
   classified, recorded, and visible in #recruiting-automation while never
   reaching the house — a misrouted "sorry, still deciding" as a withdrawal
   would otherwise push someone to archive a live candidate. Unmuting is a
   settings edit once the confidence distribution has been read against real
   replies. */
UPDATE recruit_settings
  SET value = '["reply_reschedule","reply_withdrawing","reply_plans_changed","reply_post_acceptance"]'::jsonb
  WHERE key = 'notify_muted';
