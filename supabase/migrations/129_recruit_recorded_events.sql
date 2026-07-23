-- Migration 129: record ALL Meets hosted by the shared account.
-- The recruit-discord tick sweeps the shared Google calendar; any upcoming
-- Meet-bearing event organized by live.at.agapesf gets an Agape Notes bot.
-- Events tied to an applicant live in recruit_screenings; everything else
-- (manually created calls) is tracked here.
CREATE TABLE IF NOT EXISTS recruit_recorded_events (
  gcal_event_id TEXT PRIMARY KEY,
  title TEXT,
  starts_at TIMESTAMPTZ NOT NULL,
  ends_at TIMESTAMPTZ,
  meet_link TEXT,
  recall_bot_id TEXT,
  recall_status TEXT,
  recording_summary TEXT,
  recording_posted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE recruit_recorded_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Recruiting members read recorded events" ON recruit_recorded_events
  FOR SELECT TO authenticated USING (is_recruiting_member());
