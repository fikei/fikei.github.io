-- Board metadata persistence — stores user-created board properties
-- (isUserBoard, displayName, prompt, createdAt, pinned) as a JSONB blob
-- Mirrors the expanded_cards pattern: one row per user, JSONB payload

CREATE TABLE IF NOT EXISTS board_metadata (
  user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  metadata JSONB NOT NULL DEFAULT '{}',
  updated_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE board_metadata ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage own board metadata"
  ON board_metadata FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

COMMENT ON TABLE board_metadata IS 'Persists user-created board properties (name, prompt, pinned state) so they survive page reload and cross-device sync';
COMMENT ON COLUMN board_metadata.metadata IS 'JSONB: { "board-slug": { isUserBoard, displayName, prompt, createdAt, pinned } }';
