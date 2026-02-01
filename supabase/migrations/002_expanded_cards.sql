-- Add expanded_cards column to shared_boards
-- Stores the board owner's card expansion state at time of sharing

ALTER TABLE shared_boards
ADD COLUMN IF NOT EXISTS expanded_cards JSONB DEFAULT '{}';

-- Comment for documentation
COMMENT ON COLUMN shared_boards.expanded_cards IS 'Card expansion states (id -> medium|large) set by owner when sharing';
