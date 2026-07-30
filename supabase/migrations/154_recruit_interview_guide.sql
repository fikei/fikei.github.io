-- ============================================
-- Migration 154: the interview guide, sent to whoever takes the call
--
-- A housemate claims a screening and gets a calendar invite and a Meet link —
-- and no indication of what the house actually wants to learn. So every call is
-- improvised, the questions differ by screener, and the write-ups are hard to
-- compare because they answer different things.
--
-- The guide lives in settings rather than in the function so it can be rewritten
-- without a deploy — it is the kind of text that gets edited after every second
-- call for a while. Same reasoning as recruit_copy.
--
-- It is deliberately a starting point, not a script. The house is judging "would
-- you live with them", which is a conversation, and a screener reading questions
-- off a list will get worse answers than one who has read the shape of it and
-- then talks like a person.
--
-- interview_guide_url points at the canonical version when one lives elsewhere
-- (a Notion page, say); the DM links it under the inline text.
-- ============================================

INSERT INTO recruit_settings (key, value) VALUES
  ('interview_guide_url', '""'::jsonb),
  ('interview_guide', to_jsonb($guide$**Before (2 min)** — skim their application and pick one thing to ask about. Referring to something they wrote is the fastest way to make this feel like a conversation rather than a screening.

**Open (5 min)** — who they are, what brought them to SF, what they're looking for in a house. Let them talk; you're listening for whether they're choosing *this* house or any room.

**The core (15 min)** — you're answering one question: would you live with them?

• What does living well with people look like to you?
• Tell me about a household you loved being part of. What made it work?
• When something's off with a housemate — dishes, noise, money — how do you handle it?
• What would you want to start or host here?
• What's your week actually like? Work hours, travel, guests, sleep.
• What have you found hard about co-living?

**Their questions (5 min)** — what they ask tells you what they care about. Be honest about the house, including the parts that are work.

**Close (3 min)** — tell them what happens next and roughly when. Nobody should leave a call not knowing whether to expect an answer.

**After** — write it up while it's fresh. Reply to the notification in #recruiting-automation and it lands on their profile as a house note.$guide$::text))
ON CONFLICT (key) DO NOTHING;
