-- Book Metadata System
-- Adds structured book metadata storage and read-state tracking

ALTER TABLE links ADD COLUMN IF NOT EXISTS book JSONB DEFAULT NULL;
ALTER TABLE links ADD COLUMN IF NOT EXISTS read BOOLEAN DEFAULT FALSE;
