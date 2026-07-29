-- 135: capability links for recordings.
-- Discord recording posts used to carry Recall's presigned URL, which dies
-- within hours. They now point at /applications/watch/?t=<share_token>, a
-- page that plays the archived copy without a sign-in — the token IS the
-- credential, so it must be unguessable (32 random bytes, hex) and revocable
-- (set share_token = NULL to kill every link that was ever shared).
ALTER TABLE recruit_screenings ADD COLUMN IF NOT EXISTS share_token TEXT;
ALTER TABLE recruit_recorded_events ADD COLUMN IF NOT EXISTS share_token TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS recruit_screenings_share_token_idx
  ON recruit_screenings (share_token) WHERE share_token IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS recruit_recorded_events_share_token_idx
  ON recruit_recorded_events (share_token) WHERE share_token IS NOT NULL;

-- Backfill anything already recorded so old calls get shareable links too.
UPDATE recruit_screenings
  SET share_token = encode(gen_random_bytes(32), 'hex')
  WHERE share_token IS NULL AND recall_bot_id IS NOT NULL;
UPDATE recruit_recorded_events
  SET share_token = encode(gen_random_bytes(32), 'hex')
  WHERE share_token IS NULL AND recall_bot_id IS NOT NULL;
