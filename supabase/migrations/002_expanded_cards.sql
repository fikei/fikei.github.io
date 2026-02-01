-- Add expanded_cards, link_order, and owner_email columns to shared_boards
-- Stores the board owner's card expansion state, link order, and email at time of sharing

ALTER TABLE shared_boards
ADD COLUMN IF NOT EXISTS expanded_cards JSONB DEFAULT '{}';

ALTER TABLE shared_boards
ADD COLUMN IF NOT EXISTS link_order TEXT[] DEFAULT '{}';

ALTER TABLE shared_boards
ADD COLUMN IF NOT EXISTS owner_email TEXT;

-- Comments for documentation
COMMENT ON COLUMN shared_boards.expanded_cards IS 'Card expansion states (id -> medium|large) set by owner when sharing';
COMMENT ON COLUMN shared_boards.link_order IS 'Order of link IDs as set by owner when sharing';
COMMENT ON COLUMN shared_boards.owner_email IS 'Email of the board owner for display on shared view';
