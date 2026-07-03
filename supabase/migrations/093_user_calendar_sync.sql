-- Migration 093: User Google Calendar Sync (ctrl.events)
-- Per-user Google Calendar connection + sync settings for /events.
-- Bookmarked and Agape-recommended events are mirrored into a dedicated
-- "ctrl.events" Google calendar by the gcal-sync edge function.
-- Token columns are written only by the edge function (service role);
-- RLS lets users read their own sync status but never the token columns
-- are exposed to the UI (client selects only non-token columns).

CREATE TABLE user_calendar_sync (
  user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  google_access_token TEXT,
  google_refresh_token TEXT,
  google_expires_at TIMESTAMPTZ,
  google_calendar_id TEXT,                     -- id of the "ctrl.events" calendar once created
  sync_enabled BOOLEAN NOT NULL DEFAULT false,
  sync_bookmarked BOOLEAN NOT NULL DEFAULT true,   -- mirror bookmarked ("interested") events
  sync_agape BOOLEAN NOT NULL DEFAULT true,        -- mirror Agape-recommended events
  timezone TEXT DEFAULT 'America/Los_Angeles',
  last_synced_at TIMESTAMPTZ,
  last_sync_result JSONB,                      -- {pushed, updated, deleted, errors} from last run
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE OR REPLACE FUNCTION update_user_calendar_sync_timestamp()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_user_calendar_sync_updated
  BEFORE UPDATE ON user_calendar_sync
  FOR EACH ROW EXECUTE FUNCTION update_user_calendar_sync_timestamp();

-- RLS: owner can read own row (client reads status/settings columns only);
-- all writes go through the gcal-sync edge function using the service role,
-- so no INSERT/UPDATE policies for authenticated users — tokens stay server-managed.
ALTER TABLE user_calendar_sync ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can read own calendar sync"
  ON user_calendar_sync FOR SELECT
  USING (auth.uid() = user_id);
