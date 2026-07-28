-- 133: attach out-of-band recordings to applicants.
-- recruit_recorded_events rows are calendar-swept calls with no applicant
-- match. applicant_id records a manual link (recruit-gmail link-recording);
-- unmatched_notified_at stamps the one-time "couldn't match this call" DM
-- so the cron never nags twice.
ALTER TABLE recruit_recorded_events
  ADD COLUMN IF NOT EXISTS applicant_id TEXT REFERENCES recruit_applicants(id),
  ADD COLUMN IF NOT EXISTS unmatched_notified_at TIMESTAMPTZ;
