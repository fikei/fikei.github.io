-- Add expanded_cards and link_order columns to shared_boards
-- Stores the board owner's card expansion state and link order at time of sharing

ALTER TABLE shared_boards
ADD COLUMN IF NOT EXISTS expanded_cards JSONB DEFAULT '{}';

ALTER TABLE shared_boards
ADD COLUMN IF NOT EXISTS link_order TEXT[] DEFAULT '{}';

-- Comments for documentation
COMMENT ON COLUMN shared_boards.expanded_cards IS 'Card expansion states (id -> medium|large) set by owner when sharing';
COMMENT ON COLUMN shared_boards.link_order IS 'Order of link IDs as set by owner when sharing';
