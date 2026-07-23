-- Migration 127: Recall.ai recording bot tracking on recruit_screenings.
-- recall_bot_id set at schedule time (bot joins the Meet as "Agape Notetaker");
-- the 15-min recruit-discord tick harvests finished recordings, summarizes the
-- transcript, posts to #recruiting-interviews, and stamps recording_posted_at.
ALTER TABLE recruit_screenings
  ADD COLUMN IF NOT EXISTS recall_bot_id TEXT,
  ADD COLUMN IF NOT EXISTS recall_status TEXT,
  ADD COLUMN IF NOT EXISTS recording_summary TEXT,
  ADD COLUMN IF NOT EXISTS recording_posted_at TIMESTAMPTZ;
