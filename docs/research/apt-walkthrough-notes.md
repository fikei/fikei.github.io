# apt walkthrough — captured Q&A + language style notes

Walked https://www.tryapt.ai/quiz end-to-end as Ian Fike (Head of Product, healthtech/civic-tech, Toronto). Used to extract apt's question intents, ordering, reflection style, and language so we can apply the same texture to `/job/onboarding`. 20+ turns captured.

---

## Verbatim turn log

### Turn 1 — Goal
- **AI greeting:** *👋Hi!*
- **AI question:** *What are you here for — job search, career change, or just exploring?*
- **My answer:** Job search — looking for a Head of Product role at a civic-tech or public-benefit startup.

### Turn 2 — Current employment status
- **AI reflection:** *That's a really purpose-driven direction — sounds like you want your work to have real-world impact.*
- **AI question:** *Are you currently working somewhere, or in between roles right now?*
- **My answer:** Currently founding a small AI tooling company, but actively interviewing for the right product role.

### Turn 3 — Energy management
- **AI reflection:** *That mix of building something yourself while exploring impact roles says you're pretty driven and comfortable with ambiguity.*
- **AI question:** *When you've had a long week, do you usually recharge by being around people or by having time to yourself?*
- **My answer:** Definitely time to myself — long walk or a stretch of deep work with no Slack.

### Turn 4 — Interests (work + free time)
- **AI reflection:** *That makes sense — sounds like you're someone who needs quiet to reset and think clearly.*
- **AI question:** *What kinds of things do you naturally find yourself enjoying, either in your work or just in your free time?*
- **My answer:** Building things from scratch with a small team. Cycling. Reading about how cities work.

### Turn 5 — Operator instinct (I skipped)
- **AI reflection:** *I like that mix — building + systems thinking + cities is a very specific kind of curiosity.*
- **AI question:** *When you're working with a team, do you ever find yourself going out of your way to support people or keep things running smoothly, even if it's not technically your role?*
- **My answer:** (skipped — apt rendered "I'd prefer to skip this one." as a user turn)

### Turn 6 — Education (after skip pivot)
- **AI reflection:** *Got it — we can switch gears.*
- **AI question:** *Quick one: what's your educational background?*

### Turn 7 — Curiosity / research depth
- **AI reflection:** *You strike me as someone who likes really understanding things deeply before acting.*
- **AI question:** *When you get curious about something, do you tend to go down long solo rabbit holes researching it?*

### Turn 8 — Career horizon (5-10y)
- **AI reflection:** *That depth-first approach really fits with the kind of systems you're drawn to — you don't just skim, you internalize.*
- **AI question:** *Looking a bit ahead, what would you love your career to look like in, say, 5–10 years if things go right?*

### Turn 9 — Energy: novelty vs. depth in free time
- **AI reflection:** *That desire to build something quietly essential — something people rely on — really fits your style.*
- **AI question:** *When you have free time with no obligations, do you usually like to explore something new and stimulating, or settle into something familiar and absorbing?*

### Turn 10 — Aspirational role (zero-constraint frame)
- **AI reflection:** *That balance tracks — you know how to match your energy instead of forcing it.*
- **AI question:** *If there were zero constraints — no hiring filters, no practicality — what's a role or job you'd be genuinely excited to try just for the sake of it?*

### Turn 11 — Operator/fixer instinct
- **AI reflection:** *I can see how that "invisible but essential" pull shows up in you.*
- **AI question:** *When something isn't quite right — messy system, unclear logic, sloppy execution — do you feel a strong urge to fix it even if it's not your responsibility?*

### Turn 12 — Education (revisited, single block)
- **AI question:** *You seem like someone who's built a lot of your thinking independently, not just through formal paths. What's your educational background?*

### Turn 13 — Risk style / decision pace
- **AI reflection:** *That path makes a lot of sense for you — learning by doing in real systems rather than staying in theory.*
- **AI question:** *When you're heading into something uncertain or high-stakes, do you tend to double-check everything and think through risks ahead of time, or just move and figure it out as you go?*

### Turn 14 — Past-role energizers vs. drainers
- **AI reflection:** *That balance is powerful — you're not reckless, but you don't let perfection slow momentum either.*
- **AI question:** *Thinking about your past roles, what parts of the job have you genuinely enjoyed vs. the parts that drained or frustrated you?*

### Turn 15 — Group communication style
- **AI reflection:** *That all lines up — you light up with meaningful creation and get drained by performative work.*
- **AI question:** *In group settings, do you tend to speak up and try to persuade people in the moment, or hang back and share your thinking more selectively (like in 1:1s or writing)?*

### Turn 16 — Compensation
- **AI reflection:** *That tracks — you're more precise than loud, and you pick your moments.*
- **AI question:** *As you think about your next role, what kind of compensation range would feel right for you?*

### Turn 17 — Hands-on vs. conceptual
- **AI question (combined block):** *You seem very systems-and-ideas oriented, but I'm curious how that shows up physically — do you enjoy working with your hands at all, like building, fixing, or being outdoors, or do you mostly prefer staying in the conceptual/design layer?*

### Turn 18 — Non-negotiables
- **AI reflection:** *It sounds like you know exactly the kind of environments where you do your best work.*
- **AI question:** *When you picture your next role, what are the 2-3 things that would feel non-negotiable for you to say yes?*

### Turn 19 — Decision style (logic vs. people)
- **AI question (combined block):** *You clearly care about building things that work well for people — when you have to make a tough call, do you lean more on what feels right for the people involved, or on what seems most logically sound even if it's a bit uncomfortable?*

### Turn 20 — Email capture
- **AI reflection:** *Feels like you've got a really clear sense of what matters to you — it's been fun getting a window into how you think.*
- **AI question:** *What's your email so I can send you your results?*
- *Disclosure:* "By providing your email you agree to receive emails from Apt. This may include your quiz results, job opening alerts, offers and updates."

### Turn 21 — Resilience / rumination (continues past email)
- **AI question (combined block):** *You've got a pretty intense internal standard and you think deeply about your decisions — when something goes wrong or feels off, does it tend to stick with you and loop in your head, or are you able to shake it off pretty quickly?*

---

## Question intent map → our data fields

| # | Apt intent (verbatim where strong) | Our data field | In our current flow? |
|---|---|---|---|
| 1 | *"What are you here for — job search, career change, or just exploring?"* | `targeting.intent` (categorical) | ✗ — we assume job search |
| 2 | *"Are you currently working somewhere, or in between roles right now?"* | `identity.currentRole.state` (employed / between / founding) | partial via resume |
| 3 | *"…recharge by being around people or by having time to yourself?"* | `values_seed.cultureKeywords` (introvert/extrovert dimension) | indirectly via q2 |
| 4 | *"What kinds of things do you naturally find yourself enjoying…?"* | `values_seed.missionKeywords`, `bundle.values` | partially (resume bundle) |
| 5 | *"…going out of your way to support people or keep things running smoothly, even if it's not technically your role?"* | `capability.arcTags` (operator) | ✗ |
| 6 / 12 | *"What's your educational background?"* | `capability.education[]` | ✗ — only from resume |
| 7 | *"When you get curious about something, do you tend to go down long solo rabbit holes…?"* | `values_seed.cultureKeywords` (research-led, deep work) | ✗ |
| 8 | *"…what would you love your career to look like in, say, 5–10 years if things go right?"* | `targeting.northStar` | partially (q1) |
| 9 | *"…explore something new and stimulating, or settle into something familiar and absorbing?"* | `values_seed.cultureKeywords` (novelty / depth) | ✗ |
| 10 | *"If there were zero constraints — no hiring filters, no practicality — what's a role…"* | `targeting.dreamRoles[]`, `targeting.targetSectors[]` (aspirational) | partially (q5) |
| 11 | *"…feel a strong urge to fix it even if it's not your responsibility?"* | `capability.arcTags` (fixer/operator), values | ✗ |
| 13 | *"…double-check everything and think through risks ahead of time, or just move and figure it out as you go?"* | `values_seed.cultureKeywords` (deliberate / move-fast) | ✗ |
| 14 | *"…what parts of the job have you genuinely enjoyed vs. the parts that drained or frustrated you?"* | `values_seed.cultureKeywords`, `values_seed.antiCulture` | partially (q2, q4) |
| 15 | *"…speak up and try to persuade people in the moment, or hang back and share your thinking more selectively?"* | `values_seed.cultureKeywords` (synchronous / written-first / async) | ✗ |
| 16 | *"…what kind of compensation range would feel right for you?"* | `preferences.compFloor`, `preferences.compTarget` | Stage 4 slider |
| 17 | *"…working with your hands at all, like building, fixing, or being outdoors, or do you mostly prefer staying in the conceptual/design layer?"* | `capability.arcTags` (hands-on / conceptual / fieldwork) | ✗ |
| 18 | *"…what are the 2-3 things that would feel non-negotiable for you to say yes?"* | `targeting.hardYes[]` | partially (q5 + Stage 4 toggles) |
| 19 | *"…do you lean more on what feels right for the people involved, or on what seems most logically sound even if it's a bit uncomfortable?"* | `values_seed.cultureKeywords` (analytical / empathetic) | ✗ |
| 20 | *"What's your email so I can send you your results?"* | `identity.email` (auth trigger) | via sign-in modal |
| 21 | *"…does it tend to stick with you and loop in your head, or are you able to shake it off pretty quickly?"* | `values_seed.cultureKeywords` (resilience / rumination) | ✗ |

### Major gaps in our flow
- **Intent framing** (Q1) — we assume the user is here to find a job. Apt asks why.
- **Personality dimensions** (Qs 3, 7, 9, 13, 15, 17, 19, 21) — we capture *zero* of these directly. Apt captures eight.
- **Education** (Q6/12) — we rely on resume parse; missing if user skipped upload.
- **Operator/fixer instinct** (Qs 5, 11) — surfaces a critical Fit signal (arcTag).
- **Aspirational zero-constraint role** (Q10) — gives us their *real* targeting before they self-edit.
- **Comp positioning** — apt asks it conversationally (Q16); we have it as a Stage 4 slider, which feels transactional.

---

## Apt's language style (what to copy)

### Reflection patterns
1. **Name a trait, don't echo content.** *"You strike me as someone who likes really understanding things deeply…"* — they label the user, not the answer.
2. **Distill into a phrase, then quote it back later.** First they call it "invisible but essential" → next turn references *that "invisible but essential" pull*. Powerful sense of being read.
3. **Use the user's own words back.** Lifts a phrase verbatim and wraps it in quote marks.
4. **Add light POV.** *"I like that mix…"* / *"That balance is powerful…"* — opinionated but warm. The AI has a perspective.
5. **Distillation, not summary.** *"building + systems thinking + cities is a very specific kind of curiosity."* — formula: `[3 things] is a very specific kind of [noun]`.

### Sentence templates we can imitate
- *"That's a [trait] direction — sounds like [interpretation]."*
- *"That [observation] really fits with [pattern] — [reframe]."*
- *"You strike me as someone who [trait]. When [scenario], do you [option A] or [option B]?"*
- *"That [past answer] makes a lot of sense for you — [worldview frame]."*
- *"I like that mix — [3-element distillation] is a very specific kind of [noun]."*
- *"That [observation] tracks — [pattern observation]."*

### Question framing tricks
- **Lower the horizon.** *"in, say, 5-10 years if things go right…"* — the "say" and "if things go right" hedges make speculation easier.
- **Hypothetical framing.** *"If there were zero constraints — no hiring filters, no practicality — what's a role…"* — lowers performance pressure on ambitious answers.
- **A-or-B with both validated.** *"…in the moment, or hang back and share your thinking more selectively (like in 1:1s or writing)?"* — both options described in their best light.
- **"Quick one:"** as a labeled pacing change before a structured fact question (education, comp).
- **Pivot acks.** *"Got it — we can switch gears."* after a skip.
- **Defining options inline.** *"…stimulating, or settle into something familiar and absorbing?"* — both ends defined so user can pick or hybrid.

### Voice rules
- Sentence case. Em-dashes for connection. No emoji in reflections (the 👋 is greeting-only).
- Lowercase fragments OK ("Quick one:", "Got it —").
- 1-3 sentences per turn. Question is usually the last sentence.
- Warm, observational, slightly opinionated. Never corporate ("Great answer!", "Thanks for sharing").
- They name the user's pattern by turn 3 ("comfortable with ambiguity") and *keep building on it* — every subsequent reflection references the model so far.

### Structural patterns
- **AI turn = 1-2 paragraphs.** Usually two: reflection (1-2 sentences) + question (1 sentence). Sometimes collapses to one paragraph when the reflection-and-question are tightly linked.
- **User turn = outlined card.** Bubble only on user side.
- **Skip is a chat turn.** Click renders *"I'd prefer to skip this one."* as the user message.
- **Edu/comp = "Quick one:" pivots.** Structured-fact questions get a labeled tone shift.

---

## Concrete adoption plan

### Immediate (this PR)
1. **Add 3-5 follow-up questions to drive profile completion**, picked from apt's most valuable intents:
   - **Intent** (apt Q1) → `targeting.intent`
   - **Energy/recharge** (apt Q3) → `values_seed.cultureKeywords` introvert/extrovert
   - **Risk pace** (apt Q13) → `values_seed.cultureKeywords` deliberate vs. move-fast
   - **Non-negotiables** (apt Q18) → `targeting.hardYes[]`
   - **Aspirational zero-constraint** (apt Q10) — optional 5th — `targeting.dreamRoles[]`

2. **Style our extract prompt to apt's voice** — bake in the reflection patterns + templates above (already partially done; sharpen the distillation pattern and the "quote-it-back-later" trick).

3. **User-turn bubble.** We currently show user as right-aligned plain text. Apt uses an outlined card. Restore the subtle border on user turns to match.

### Later
- **Education** — ask conversationally if resume parse came up empty.
- **Comp** — consider moving from Stage 4 slider into the chat for first-time users; keep slider for re-tune.
- **Personality dimensions beyond cultureKeywords** — add structured tags per personality axis (energy, risk, comm style, hands-on, resilience) so Fit scoring can reason about them.
- **"Continue past sign-in."** Apt's email isn't a wall. After finalize, our chat could re-open with deeper personality questions that don't gate the dashboard.

---

## Two open decisions

1. **How many questions total?** Apt asks 20+ before email-capture and continues after. We currently ask 5 hard, then collect structured chips at Stage 4. Right number is probably 8–12 — enough for a real psychological read, short enough that motivated users finish in under 10 min.

2. **Order:** apt opens with goal ("Why are you here") → status → personality → facts. We open with mission. Apt's gentler — should we adopt their warm-up sequence (goal → status → personality → facts) and bury our heavier `q1_mission` deeper in the conversation, after we've earned trust?
