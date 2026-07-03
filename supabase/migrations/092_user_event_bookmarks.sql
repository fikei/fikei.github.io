-- Migration 092: User Event Bookmarks
-- Lets a signed-in user flag an event as "interested" (bookmark icon in /events).
-- Stores a snapshot of the event so bookmarks survive cache expiry / source removal.
-- Google Calendar sync (ctrl.events) reads these rows; dedupe there uses
-- extendedProperties.private.eventKey on the Google side, not stored ids.

CREATE TABLE user_event_bookmarks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  event_key TEXT NOT NULL,                          -- canonical_key || event_key || source|url (client-computed)
  event JSONB NOT NULL DEFAULT '{}'::jsonb,         -- snapshot {name, date, endDate, time, venue, address, city, url, source, ...}
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(user_id, event_key)
);

CREATE INDEX idx_user_event_bookmarks_user ON user_event_bookmarks(user_id);

-- RLS: users can only read/write their own bookmarks
ALTER TABLE user_event_bookmarks ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can read own bookmarks"
  ON user_event_bookmarks FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own bookmarks"
  ON user_event_bookmarks FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own bookmarks"
  ON user_event_bookmarks FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete own bookmarks"
  ON user_event_bookmarks FOR DELETE
  USING (auth.uid() = user_id);
