-- Migration 128: mirror the claim post into #recruiting-society.
-- Claim cards post in both channels; either copy is claimable and both are
-- edited on claim/update. Mirror ids track the second message.
ALTER TABLE recruit_claim_posts
  ADD COLUMN IF NOT EXISTS mirror_message_id TEXT,
  ADD COLUMN IF NOT EXISTS mirror_channel_id TEXT;
