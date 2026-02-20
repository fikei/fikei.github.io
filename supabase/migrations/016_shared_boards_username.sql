-- Add hide_widgets and owner_username columns to shared_boards
-- hide_widgets: controls widget visibility on shared view
-- owner_username: display username on shared board (synced from auth user_metadata)

ALTER TABLE shared_boards
ADD COLUMN IF NOT EXISTS hide_widgets BOOLEAN DEFAULT false;

ALTER TABLE shared_boards
ADD COLUMN IF NOT EXISTS owner_username TEXT;

COMMENT ON COLUMN shared_boards.hide_widgets IS 'Whether to hide AI widgets on the shared board view';
COMMENT ON COLUMN shared_boards.owner_username IS 'Username of the board owner for display on shared view';
