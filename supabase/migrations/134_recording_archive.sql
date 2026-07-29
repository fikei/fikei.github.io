-- 134: permanent recording archive.
-- Recall.ai purges bot media after ~7 days and its download links are
-- short-lived presigned URLs. Archive every finished video into the private
-- recruit-recordings storage bucket; recording_path points at the copy.
INSERT INTO storage.buckets (id, name, public)
VALUES ('recruit-recordings', 'recruit-recordings', false)
ON CONFLICT (id) DO NOTHING;

ALTER TABLE recruit_screenings ADD COLUMN IF NOT EXISTS recording_path TEXT;
ALTER TABLE recruit_recorded_events ADD COLUMN IF NOT EXISTS recording_path TEXT;
