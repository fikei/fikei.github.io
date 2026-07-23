-- Migration 130: "happening now" announcements. One live post per call,
-- stamped so the 15-min tick never announces twice.
ALTER TABLE recruit_screenings ADD COLUMN IF NOT EXISTS live_posted_at TIMESTAMPTZ;
ALTER TABLE recruit_recorded_events ADD COLUMN IF NOT EXISTS live_posted_at TIMESTAMPTZ;
