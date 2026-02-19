# PRD: Lookback

**Version:** 1.0
**Date:** 2026-02-19
**Status:** Draft

---

## Overview

People save things because they matter in the moment. But most saved content dies on arrival — bookmarked and forgotten, buried under the next wave of input. The gap between "I saved this" and "I used this" is where curation tools fail. ctrl.rodeo is built on the premise that **input shapes output**. Lookback is the feature that closes the loop.

Lookback is a system that resurfaces the right past pins at the right time, using a layered signal model that combines temporal patterns, interaction decay, external context, and collection intelligence. It's not a nostalgia feature — it's a utility. It answers: "What in my collection is relevant *right now*, and what have I forgotten that I shouldn't have?"

This is the golden ticket for long-term retention. The first 30 days of a curation tool are driven by the excitement of adding. Day 31+ is driven by the value of what you already have. Lookback makes the collection a living asset instead of a growing archive. It gives users a reason to open ctrl.rodeo when they have nothing to save — which is most days.

---

## Goals

1. Give users a reason to return to ctrl.rodeo daily, even when they have nothing new to save
2. Surface forgotten, stale, or newly-relevant pins at moments when they're most useful
3. Build a signal infrastructure that makes the collection smarter the longer it exists
4. Create persona-specific value: different users need different things resurfaced for different reasons
5. Establish the foundation for notifications, digests, and proactive recommendations

---

## Who This Serves

### Primary Personas

| Persona | Why Lookback Matters | Key Trigger |
|---------|---------------------|-------------|
| **The Cultural Omnivore** | Their value is in the breadth of what they've consumed. "What did I experience this year?" is a question they already ask. Lookback answers it automatically. | Anniversaries, seasonal context, annual reviews |
| **The DJ** | Tracks saved months ago resurface when building a set for a specific vibe or season. "What was I digging last summer?" is a real workflow question. | Seasonal relevance, genre drift, forgotten digs |
| **The Researcher** | Threads started but never finished. An article saved 6 months ago becomes relevant when its topic trends. Lookback connects the dots across time. | Topic resurgence, depth tracking, citation recall |
| **The Visual Collector** | Design references from past projects resurface when starting a new project with similar aesthetic needs. | Style recurrence, project kickoff, portfolio review |

### Secondary Personas

| Persona | Why Lookback Matters |
|---------|---------------------|
| **The Deep-Dive Enthusiast** | "Remember when you were obsessed with pour-over coffee?" — Lookback maps hobby phases and resurfaces expertise. |
| **The Multidisciplinary Maker** | Cross-domain connections only emerge over time. A material saved for one project becomes relevant to another 3 months later. |
| **The Sound & Scene Curator** | Album releases from saved artists, venue events near saved locations, label connections across time. |

### Jobs To Be Done

| When I... | I want to... | So I can... |
|-----------|-------------|-------------|
| Open ctrl.rodeo with nothing to save | See something interesting from my past collection | Feel like my collection is alive and worth maintaining |
| Start a new creative project | Resurface relevant references I saved months ago | Build on my own past research instead of starting from scratch |
| Notice a topic trending in my world | See my own saves related to that topic | Contribute to the conversation with things I've already curated |
| Reach a personal milestone (1 year of saving) | See a retrospective of my collection | Appreciate the breadth and evolution of my interests |
| Wonder "what was I into last [season/month/year]?" | Browse a time-filtered view of my saves | Reconnect with past interests and rediscover forgotten gems |
| Haven't opened the app in a while | Get pulled back by something relevant | Re-engage without the guilt of a neglected archive |

---

## Design Principles

| Brand Principle | Application |
|-----------------|-------------|
| **Input shapes output** | Lookback is the literal manifestation: your past input resurfaces to shape your current output. |
| **One place, whole life** | Cross-category resurfacing is the point. A listen pin and a go pin from the same trip resurface together. |
| **Show, don't decorate** | The resurfaced pins ARE the content. No wrapping, no editorial voice beyond a one-line context label. |
| **Expand with the user** | Lookback doesn't exist until you have enough history. It grows richer and more specific as the collection deepens. |
| **Organize as you go** | Lookback is passive — it works without user configuration. No "set a reminder" or "flag for later." |

---

## The Signal Model

Lookback's intelligence comes from layering multiple signal types. No single signal is sufficient — the power is in combining them to surface the *right* pin at the *right* moment.

### Signal Layer 1: Temporal

Signals derived from when pins were saved and how time has passed.

| Signal | Description | Data Source | Strength |
|--------|-------------|-------------|----------|
| **Anniversary** | "You saved this 1 year ago today" | `created_at` | High — emotional resonance, proven by Apple Photos/Facebook memories |
| **Seasonal match** | "Last winter you saved these" | `created_at` month + category heuristics | High — seasonal interests recur (winter fashion, summer travel, holiday recipes) |
| **Recency decay** | Pins not interacted with in 30/60/90 days | `last_interacted_at` vs now | Medium — staleness is a signal but not always actionable |
| **Burst detection** | "You saved 8 architecture links in March 2025" | `created_at` clustering analysis | Medium — identifies interest phases worth revisiting |
| **Day-of-week patterns** | "You save music on Fridays" | `created_at` day-of-week distribution | Low — useful for notification timing, not content selection |

### Signal Layer 2: Interaction

Signals derived from how (or whether) the user has engaged with pins after saving them.

| Signal | Description | Data Source | Strength |
|--------|-------------|-------------|----------|
| **Never clicked** | Saved but never opened the original URL | `last_interacted_at IS NULL` | High — the "saved and forgot" pattern, core use case |
| **Consumption gap** | `watched = false` on a watch pin, `read = false` on a read pin | `watched`, `read` booleans | High — explicit unfinished business |
| **Interaction cliff** | Was frequently accessed, then dropped off | `interaction_log` frequency analysis | Medium — abandoned interest or completed interest? Context-dependent. |
| **Widget engagement** | User engaged with a widget about this pin/category | `widget_events` (future) | Low (until instrumentation ships) |

### Signal Layer 3: External Context

Signals derived from the world outside the user's collection. This is where Lookback gets powerful — and differentiated.

| Signal | Description | Data Source | Implementation |
|--------|-------------|-------------|----------------|
| **Dead link detection** | The URL returns 404/5xx | HTTP HEAD check on saved URLs | Periodic background job (weekly). Resurface with "this link may be dead — archive or find alternative?" |
| **Price change** | Product pin's price dropped or item back in stock | Periodic scrape of product pages | Phase 2+. Requires `pin_price_history` table. High-value for product-heavy collectors. |
| **Creator activity** | An artist/creator you saved has new work | RSS/API monitoring of saved domains | Phase 2+. Start with YouTube (subscriptions), expand to Bandcamp, personal sites. |
| **Cultural moment** | A topic related to your saves is trending | Trending topics API (Google Trends, X/Twitter trending) cross-referenced with pin categories/keywords | Phase 3. Requires keyword extraction from pins. "Brutalism is trending — you saved 12 brutalist links." |
| **Seasonal commerce** | Fashion seasons, holiday periods, back-to-school | Calendar-based rules + category matching | Phase 1. Simple rules: Nov-Dec → resurface `eat` recipes and `go` gift guides. |
| **Geographic proximity** | User is near a saved location (restaurant, store, venue) | Device location (opt-in) cross-referenced with pin URLs containing addresses | Phase 3. Mobile-only. Requires location extraction from pins. |
| **Release calendar** | A saved show has a new season, a saved book author has a new release | TMDB API (shows), Open Library (books), MusicBrainz (albums) | Phase 2. Leverages existing enrichment metadata. |

### Signal Layer 4: Collection Intelligence

Signals derived from analyzing the collection itself — patterns, gaps, and relationships.

| Signal | Description | Data Source | Strength |
|--------|-------------|-------------|----------|
| **Taste drift** | "You used to save a lot of X, now you save Y" | Category distribution over time | Medium — interesting for reflection, not always actionable |
| **Cross-category connection** | "This restaurant is in the same neighborhood as that hotel you saved" | Semantic/geographic similarity across pins | High — the "one place, whole life" principle in action |
| **Collection milestone** | "You've saved 100 pins" / "Your collection is 1 year old" | Count + time thresholds | Medium — gamification-adjacent, but genuine markers |
| **Depth vs. breadth** | "You have 50 wear pins but only 2 eat pins" | Category distribution analysis | Low — interesting but not urgently actionable |
| **Emerging theme** | 3+ recent saves share a topic not captured by category | AI clustering of recent pin titles/descriptions | High — surfaces nascent interests before they're obvious |

---

## Signal Prioritization Framework

Not all signals should fire at once. Lookback needs a scoring model to rank which pins to surface on a given day.

### Composite Score

```
lookback_score = (
  temporal_weight   × temporal_signal   +
  interaction_weight × interaction_signal +
  external_weight   × external_signal   +
  collection_weight × collection_signal
) × recency_decay_modifier × category_diversity_bonus
```

**Weights (initial, tunable):**

| Weight | Value | Rationale |
|--------|-------|-----------|
| `temporal_weight` | 0.30 | Time-based signals are reliable and emotionally resonant |
| `interaction_weight` | 0.35 | "Never clicked" and "never watched" are the strongest engagement signals |
| `external_weight` | 0.25 | External context is high-value but noisy — weight grows as data quality improves |
| `collection_weight` | 0.10 | Collection intelligence is insightful but low-urgency |

**Modifiers:**

- `recency_decay_modifier`: Pins resurfaced recently get dampened (exponential decay, half-life 14 days). Prevents the same pin from appearing every day.
- `category_diversity_bonus`: If the day's lookback set is all one category, boost pins from underrepresented categories. Reflects "one place, whole life."

### Daily Budget

- **3-5 pins per day** — enough to be interesting, not enough to overwhelm
- At least 2 different categories represented
- At least 1 pin with an external signal (when available)
- Never more than 1 "dead link" pin per day (negative signals are draining)

---

## Surfaces

Lookback is not one screen — it's a system that manifests across multiple surfaces, each with different depth.

### Surface 1: Lookback Card (Main Board)

**Where:** Top of the board grid, above pins. Appears on page load.

```
┌─────────────────────────────────────────────┐
│  LOOKBACK                                   │
│                                             │
│  ┌─────────┐ ┌─────────┐ ┌─────────┐       │
│  │ [image] │ │ [image] │ │ [image] │       │
│  │         │ │         │ │         │       │
│  │ Title   │ │ Title   │ │ Title   │       │
│  │ 1y ago  │ │ unwatched│ │ trending│       │
│  └─────────┘ └─────────┘ └─────────┘       │
│                                             │
│  [See all →]                    [Dismiss]   │
└─────────────────────────────────────────────┘
```

**Behavior:**

- Shows 3 pins as mini-cards with image, title, and a one-line context label (the signal that triggered resurfacing)
- Tapping a pin opens it (link click) or expands it (card expand)
- "See all" opens the full Lookback view
- "Dismiss" hides for 24 hours
- Rotates daily — new set each day
- Only appears if there are 3+ qualifying pins

**Context labels** (one per pin, from highest-priority signal):

| Signal | Label |
|--------|-------|
| Anniversary | "Saved 1 year ago" |
| Seasonal | "From last winter" |
| Never clicked | "Never opened" |
| Consumption gap | "Still unwatched" / "Still unread" |
| Dead link | "Link may be dead" |
| Burst | "Part of your architecture phase" |
| Trending | "Trending right now" |
| Price drop | "Price dropped" |
| New release | "New season available" |
| Milestone | "Your 100th save" |

### Surface 2: Lookback View (Full Page)

**Where:** Dedicated view, accessible from nav and "See all" on the card.

```
┌─────────────────────────────────────────────┐
│  LOOKBACK                                   │
│                                             │
│  Today                                      │
│  ┌─────────────────────────────────────────┐│
│  │ [Full review card — pin + context]      ││
│  │ "You saved this 1 year ago today.       ││
│  │  It's a video you never watched."       ││
│  │ [Open link]  [Re-categorize]  [Archive] ││
│  └─────────────────────────────────────────┘│
│  ┌──────────┐ ┌──────────┐ ┌──────────┐    │
│  │ pin 2    │ │ pin 3    │ │ pin 4    │    │
│  └──────────┘ └──────────┘ └──────────┘    │
│                                             │
│  This Week                                  │
│  ┌──────────┐ ┌──────────┐                  │
│  │ earlier  │ │ earlier  │                  │
│  └──────────┘ └──────────┘                  │
│                                             │
│  Your [Month] in Review                     │
│  "You saved 23 pins across 6 categories.   │
│   Most-saved: wear (9). New interest:      │
│   ceramics (3 pins, first time)."          │
│                                             │
│  Time Machine                               │
│  [2026] [2025] [Winter] [Summer] [All]     │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐    │
│  │ filtered │ │ pins     │ │ here     │    │
│  └──────────┘ └──────────┘ └──────────┘    │
└─────────────────────────────────────────────┘
```

**Sections:**

1. **Today** — The day's 3-5 lookback pins, with the highest-scored pin featured large
2. **This Week** — Pins surfaced earlier this week that weren't acted on (gives a second chance)
3. **Monthly Review** — AI-generated 2-3 sentence summary of the month's saving activity (category distribution, new interests, milestones). Generated once per month, cached.
4. **Time Machine** — Filterable browse of the full collection by time period. Year tabs, season filters, category filters. This is the "your year in review" and "what was I into last summer" interface.

### Surface 3: Digest (Push/Email — Phase 2)

**Where:** Outside the app. Weekly email or push notification.

```
Subject: Your week in ctrl.rodeo

3 pins worth revisiting:
- [Title] — saved 6 months ago, never opened
- [Title] — the artist just released a new album
- [Title] — this link may be dead

+ You saved 8 new pins this week (most: listen)

[Open Lookback →]
```

**Behavior:**

- Weekly cadence (configurable: daily/weekly/off)
- Top 3 lookback pins by composite score
- Brief collection activity summary
- Deep link to Lookback view
- Only sent if there are 3+ qualifying pins that week
- Unsubscribe respected, re-engagement nudge after 30 days of no opens

### Surface 4: Re-engagement Nudge (Phase 3)

**Where:** Push notification for users who haven't opened the app in 14+ days.

```
"You saved a restaurant in Lisbon 3 months ago.
Still planning that trip?"
```

**Behavior:**

- Triggers after 14 days of inactivity
- Uses the single highest-scored lookback pin
- Personal, specific — references actual content, not generic "come back!"
- Maximum 1 nudge per 30-day period
- Only for users who opted into notifications
- Measured by re-engagement rate (did they open the app within 48 hours?)

---

## Technical Architecture

### Interaction Tracking (Prerequisite)

Before Lookback can use interaction signals, the system needs to track engagement:

```sql
-- New column on links table
ALTER TABLE links ADD COLUMN last_interacted_at TIMESTAMPTZ DEFAULT NULL;

-- Interaction log for richer analysis
CREATE TABLE pin_interactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users NOT NULL,
  link_id UUID REFERENCES links NOT NULL,
  interaction_type TEXT NOT NULL, -- 'click', 'expand', 'share', 'lookback_view', 'lookback_dismiss'
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_pin_interactions_link ON pin_interactions(link_id);
CREATE INDEX idx_pin_interactions_user_date ON pin_interactions(user_id, created_at DESC);

-- RLS
ALTER TABLE pin_interactions ENABLE ROW LEVEL SECURITY;
CREATE POLICY pin_interactions_user ON pin_interactions
  FOR ALL USING (auth.uid() = user_id);
```

**Client-side tracking:**

- `click`: User clicks the pin's URL (opens in new tab)
- `expand`: User expands a card to see details
- `share`: User shares a pin or board
- `lookback_view`: User views a pin via Lookback
- `lookback_dismiss`: User dismisses a lookback suggestion

On each interaction, update `links.last_interacted_at = NOW()` and insert into `pin_interactions`.

### Lookback Score Computation

**Option A: Client-side (Phase 1)** — Compute scores in the browser from localStorage data. Fast, offline-capable, but limited to temporal and interaction signals.

**Option B: Edge function (Phase 2+)** — Supabase edge function computes scores server-side with access to external signals (dead link checks, price changes, trending topics). Returns a ranked list of lookback pins.

```typescript
// POST /functions/v1/lookback
// Request: { user_id, limit: 5, exclude_ids: [...] }
// Response: { pins: [{ link_id, score, signals: [{ type, label, weight }] }] }
```

**Phase 1 client-side scoring:**

```javascript
function computeLookbackScore(pin, now) {
  let score = 0;
  const signals = [];
  const age = now - new Date(pin.created_at).getTime();
  const daysSinceSave = age / (24 * 60 * 60 * 1000);

  // Anniversary (within 3-day window)
  const savedDate = new Date(pin.created_at);
  const todayMD = `${now.getMonth()}-${now.getDate()}`;
  const savedMD = `${savedDate.getMonth()}-${savedDate.getDate()}`;
  if (todayMD === savedMD && daysSinceSave > 300) {
    score += 0.9;
    signals.push({ type: 'anniversary', label: `Saved ${Math.round(daysSinceSave/365)} year(s) ago` });
  }

  // Seasonal match
  const savedSeason = getSeason(savedDate);
  const currentSeason = getSeason(now);
  if (savedSeason === currentSeason && daysSinceSave > 180) {
    score += 0.5;
    signals.push({ type: 'seasonal', label: `From last ${savedSeason}` });
  }

  // Never interacted
  if (!pin.last_interacted_at && daysSinceSave > 7) {
    score += 0.7;
    signals.push({ type: 'never_clicked', label: 'Never opened' });
  }

  // Consumption gap
  if (pin.category === 'watch' && !pin.watched) {
    score += 0.6;
    signals.push({ type: 'unwatched', label: 'Still unwatched' });
  }
  if (pin.category === 'read' && !pin.read) {
    score += 0.6;
    signals.push({ type: 'unread', label: 'Still unread' });
  }

  // Staleness bonus (older forgotten pins get boosted)
  if (daysSinceSave > 90 && !pin.last_interacted_at) {
    score += Math.min(0.3, daysSinceSave / 1000);
    signals.push({ type: 'stale', label: 'Forgotten save' });
  }

  return { score, signals };
}
```

### Dead Link Detection (Phase 2)

```typescript
// Scheduled edge function — runs weekly
// POST /functions/v1/check-dead-links
// Iterates user's links, sends HEAD requests, marks dead ones

ALTER TABLE links ADD COLUMN link_status TEXT DEFAULT 'alive';
-- 'alive', 'dead', 'redirect', 'unknown'
ALTER TABLE links ADD COLUMN link_checked_at TIMESTAMPTZ;
```

**Rate limiting:** Max 100 URLs per user per run. Prioritize oldest-checked links. Respect `Retry-After` headers. Cache results for 7 days.

### Monthly Review Generation (Phase 2)

```typescript
// POST /functions/v1/lookback
// { action: "monthly-review", user_id, month: "2026-02" }
// Uses Claude Haiku to generate a 2-3 sentence summary
// Prompt includes: category counts, new categories, total pins, notable patterns
// Cached for the month — regenerated only if pin count changes significantly
```

---

## Phasing

### Phase 1: Temporal + Interaction (MVP)

**Prerequisites:** `last_interacted_at` column, client-side interaction tracking

**Signals:** Anniversary, seasonal match, never clicked, consumption gap, staleness

**Surfaces:** Lookback Card (main board), Time Machine (basic year/season filter)

**Scoring:** Client-side only

**Personas served:** All — these signals work for every user type

### Phase 2: External Context + Digest

**New signals:** Dead link detection, price tracking (products), release calendar (TMDB, Open Library), creator activity (YouTube)

**New surfaces:** Full Lookback View with monthly review, weekly digest (email)

**Scoring:** Edge function with external data

**Personas served:** The DJ (new releases), The Visual Collector (price drops), The Researcher (dead links)

### Phase 3: Collection Intelligence + Re-engagement

**New signals:** Cross-category connections, taste drift, emerging themes, trending topic matching, geographic proximity

**New surfaces:** Re-engagement nudge (push notification), smart grouping in Lookback View

**Scoring:** AI-powered analysis (Claude Haiku for theme extraction, cross-reference)

**Personas served:** The Cultural Omnivore (taste drift), The Multidisciplinary Maker (cross-category), The Researcher (trending topics)

---

## Retention Mechanics by Persona

This section maps how Lookback specifically drives retention for each segment — because a generic "memories" feature won't work. Different people need different things resurfaced.

| Persona | Retention Driver | Lookback Mechanic | Frequency |
|---------|-----------------|-------------------|-----------|
| **The DJ** | "What was I digging last summer?" — seasonal set building | Seasonal filter + burst detection ("your techno phase, June 2025") | Weekly — when planning sets |
| **The Visual Collector** | "I need references for this new project" — past research is future ammo | Cross-category connections + keyword matching to current saves | On-demand — triggered by new saves |
| **The Cultural Omnivore** | "What did I experience this year?" — reflection and sharing | Annual/monthly review + collection timeline | Monthly — digest cadence |
| **The Researcher** | "This topic I saved about is in the news" — relevance resurgence | Trending topic matching + "never opened" flags | Daily — when topics trend |
| **The Deep-Dive Enthusiast** | "Remember when I was obsessed with X?" — interest archaeology | Burst detection + taste drift visualization | Monthly — hobby phase reflection |
| **The Multidisciplinary Maker** | "That material I found for Project A works for Project B" — cross-pollination | Cross-category connections + semantic similarity | On-demand — during active projects |
| **The Sound & Scene Curator** | "This artist released something new" — creator following | Release calendar monitoring + creator activity | Real-time — as releases happen |

---

## Non-Functional Requirements

| Requirement | Target |
|-------------|--------|
| Lookback card load time | < 500ms (client-side scoring in Phase 1) |
| Score computation for 1,000 pins | < 200ms client-side |
| Dead link check latency | < 5s per URL (HEAD request with timeout) |
| Monthly review generation | < 3s (Claude Haiku) |
| Digest email delivery | Within 1 hour of scheduled time |
| Lookback card freshness | New set daily (midnight user-local-time) |
| Interaction tracking overhead | < 10ms per event (async, non-blocking) |

---

## Privacy & Data Handling

| Data | Storage | Retention | Access |
|------|---------|-----------|--------|
| Pin interaction events | `pin_interactions` table, Supabase | 1 year | User only (RLS) |
| Lookback scores | Computed, not stored (Phase 1). Cached 24h (Phase 2+) | 24 hours | User only |
| Dead link status | `links.link_status` column | Updated weekly | User only (RLS) |
| Monthly reviews | Cached in edge function response store | 30 days | User only |
| Location data (Phase 3) | Never stored — used transiently for proximity matching | Session only | Not transmitted to server |
| Digest email address | Supabase auth | Account lifetime | System + user |

---

## Cost Model

| Component | Per-User Cost | At 1,000 Users |
|-----------|--------------|----------------|
| Client-side scoring (Phase 1) | $0 | $0 |
| Dead link checks (100 URLs/week) | ~$0.001 (compute) | $1/week |
| Monthly review (Claude Haiku) | ~$0.002/month | $2/month |
| Digest email (SendGrid/Resend) | ~$0.001/email | $4/month (weekly) |
| TMDB/Open Library API | Free tier | $0 |
| Trending topics API | ~$0.01/day | $10/month |

**Total Phase 1:** $0 (all client-side)
**Total Phase 2:** ~$7/month at 1,000 users
**Total Phase 3:** ~$17/month at 1,000 users

---

## Future Considerations

1. **Shared Lookback** — "Here's what we were both into last year" for collaborative board members. Social reminiscing.
2. **Lookback as content** — Export your monthly/annual review as a shareable page. The Cultural Omnivore persona explicitly wants this.
3. **AI journaling** — "Based on what you saved this month, here's what seems to be on your mind." Claude generates a reflective paragraph. High emotional value, low utility.
4. **Lookback-driven collections** — Auto-generate smart boards from Lookback patterns ("Your Architecture Phase", "Summer 2025 Travel"). Read-only, always up to date.
5. **Predictive surfacing** — Instead of "here's what you saved," flip to "here's what you'll probably want to save next" based on patterns. The line between Lookback and recommendation blurs.
6. **Platform integrations** — Import watch history from Netflix, listen history from Spotify, reading list from Kindle. Lookback becomes "your whole cultural life" not just "your ctrl.rodeo saves."

---

## Open Questions

1. **Signal cold start** — Lookback needs history to work. What's the minimum collection size/age before Lookback activates? 20 pins? 30 days? Should there be a "preview" mode that shows what Lookback will do once you have enough data?
2. **Negative signals** — Should Lookback ever surface a pin the user explicitly dismissed? Current design says no (14-day decay). But what about pins dismissed 6 months ago? Relevance can change.
3. **Emotional tone** — "On this day" features can surface painful memories (a restaurant from a past relationship, a trip that got cancelled). Should there be a "hide this memory" option that permanently suppresses a pin from Lookback?
4. **Scoring transparency** — Should users see WHY a pin was surfaced ("Because you never opened it" / "Because it's trending")? Current design shows context labels. But should the composite score be visible to power users?
5. **Cannibalization** — Does Lookback compete with the existing widget system? Widgets like Archaeologist (#20) and Persuade (#3) overlap with Lookback signals. Should those widgets be retired in favor of Lookback, or should they coexist?
6. **External API reliability** — Dead link checking, price monitoring, and release calendar all depend on external APIs. What's the degradation strategy when they fail? Fall back to temporal signals only?
7. **Notification permission** — Digests and re-engagement nudges require email/push permission. How aggressive should the opt-in prompt be? Should it be tied to a milestone ("You have 50 pins — want weekly lookback emails?")?

---

## Success Metrics

| Metric | Target | How Measured |
|--------|--------|-------------|
| DAU/MAU ratio improvement | +15% within 3 months of launch | Analytics — daily active / monthly active |
| Lookback card engagement | 40% of daily visitors interact with the card | Click/expand events on lookback pins |
| Return visits driven by Lookback | 20% of sessions start from a digest/notification deep link | Referrer tracking on Lookback view |
| Pin re-engagement | 30% of lookback-surfaced pins get clicked through | `pin_interactions` where source = 'lookback' |
| Collection longevity | 50% of users with 6+ month collections are monthly active | Cohort analysis — retention by collection age |
| Digest open rate | 35% (industry avg for personal tools is ~25%) | Email analytics |
| Re-engagement nudge conversion | 15% open app within 48 hours of nudge | Push notification + session tracking |
| "Never opened" resolution | 25% of "never opened" pins get clicked after Lookback surfaces them | `last_interacted_at` transitions from NULL |

---

## Related Documents

- [PRD: Boards MVP](./boards-mvp.md) — Core pin data model and categorization system
- [PRD: AI Widgets](./ai-widgets.md) — Widget system including staleness and time-based widgets (Phase 4-5)
- [PRD: Widget Instrumentation](./widget-instrumentation.md) — Engagement tracking architecture (future signal source)
- [AI Widget System](../../infrastructure/technical-design/ai-widget-system.md) — Widget generation architecture
- [User Personas](../../ux/personas.md) — Full persona definitions with JTBD
- [Brand Positioning](../brand-positioning.md) — Brand principles and voice
- [Database Schema](../../infrastructure/technical-design/database-schema.md) — Current data model
- [Taste & Pattern Surfacing](../../ux/widgets/taste-patterns.md) — Related planned features (monthly digest, collection timeline)
- [Cross-Category Features](../../ux/boards/cross-category.md) — Dynamic collections concept
- [Backlog](../../execution/project-plan/backlog.md) — Related backlog items (#57 recently viewed tracking, taste profile, trend detection)
