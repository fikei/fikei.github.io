-- Migration 125: residents' Google Group email on recruit_profiles.
-- CC'd on Agape Intro Call intro emails and preferred as the GCal invite
-- address; the ctrl.rodeo login email is the fallback when unset.
ALTER TABLE recruit_profiles ADD COLUMN IF NOT EXISTS group_email TEXT;
