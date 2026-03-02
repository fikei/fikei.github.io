-- Migration 022: Extension capture columns
-- Adds source tracking, text selection capture, and device identification
-- for the enhanced Rodeo browser extension (Phase 1)

-- Capture source: how the pin was created
-- Values: 'explicit' (default/toolbar), 'context_menu', 'text_selection', 'bookmarklet'
ALTER TABLE links ADD COLUMN IF NOT EXISTS source TEXT DEFAULT 'explicit';

-- User-highlighted text when pin was created via text selection
ALTER TABLE links ADD COLUMN IF NOT EXISTS selected_text TEXT;

-- Stable per-device identifier from chrome.storage.local
ALTER TABLE links ADD COLUMN IF NOT EXISTS device_id TEXT;
