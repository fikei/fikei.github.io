-- ============================================
-- Migration 117: applicant availability + screening calls
--
-- Applicants reply to outreach with availability ranges; recruit-gmail
-- extracts structured windows from inbound mail (AI) into
-- recruit_availability. A housemate picks a concrete slot in the app and
-- recruit-gmail creates a Google Calendar event on the shared account
-- inviting both — recorded in recruit_screenings.
-- ============================================

CREATE TABLE IF NOT EXISTS recruit_availability (
  applicant_id TEXT PRIMARY KEY REFERENCES recruit_applicants(id) ON DELETE CASCADE,
  windows JSONB NOT NULL DEFAULT '[]',   -- [{date:'YYYY-MM-DD', start:'HH:MM', end:'HH:MM'}]
  source_gmail_id TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE recruit_availability ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Recruiting members read availability" ON recruit_availability
  FOR SELECT TO authenticated USING (is_recruiting_member());
-- writes via recruit-gmail (service role).

CREATE TABLE IF NOT EXISTS recruit_screenings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  applicant_id TEXT NOT NULL REFERENCES recruit_applicants(id) ON DELETE CASCADE,
  housemate_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  housemate_name TEXT,
  housemate_email TEXT,
  starts_at TIMESTAMPTZ NOT NULL,
  ends_at TIMESTAMPTZ NOT NULL,
  gcal_event_id TEXT,
  meet_link TEXT,
  status TEXT NOT NULL DEFAULT 'scheduled' CHECK (status IN ('scheduled', 'completed', 'cancelled')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_recruit_screenings_applicant ON recruit_screenings(applicant_id, starts_at DESC);
ALTER TABLE recruit_screenings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Recruiting members read screenings" ON recruit_screenings
  FOR SELECT TO authenticated USING (is_recruiting_member());
CREATE POLICY "Recruiting members update screening status" ON recruit_screenings
  FOR UPDATE TO authenticated
  USING (is_recruiting_member()) WITH CHECK (is_recruiting_member());
-- inserts via recruit-gmail (service role) after the calendar event exists.
