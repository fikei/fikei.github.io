# Phase 12: Lookback (Pending)

> Back to [Project Plan](./index.md)
>
> **Reference**: [PRD: Lookback](/docs/strategy/prds/lookback.md)
>
> **Vision**: A system that resurfaces the right past pins at the right time — using temporal patterns, interaction signals, external context, and collection intelligence. Lookback transforms a static archive into a living asset and gives users a reason to open ctrl.rodeo on days when they have nothing new to save.
>
> **Why a new phase**: Lookback is a three-phase rollout with its own data model prerequisites and conceptually distinct purpose (retention/re-engagement vs. Phase 3's capture/classification focus). It absorbs the backlog's "Taste & Pattern Intelligence" section.

---

## Prerequisites (Before Any Lookback Work)

These tasks must be complete before Epic 12.1 can begin.

| Story | Tasks | Status |
|-------|-------|--------|
| **Interaction Tracking Schema** | | Complete |
| | Write migration `017_lookback_prerequisites.sql` | Complete |
| | Add `last_interacted_at TIMESTAMPTZ DEFAULT NULL` to `links` table | Complete |
| | Add index `idx_links_last_interacted` on `(user_id, last_interacted_at)` | Complete |
| | Create `pin_interactions` table: `id UUID PK`, `user_id UUID`, `link_id UUID`, `interaction_type TEXT`, `created_at TIMESTAMPTZ` | Complete |
| | Add index `idx_pin_interactions_link` on `(link_id)` | Complete |
| | Add index `idx_pin_interactions_user_date` on `(user_id, created_at DESC)` | Complete |
| | Enable RLS on `pin_interactions`; policy: `FOR ALL USING (auth.uid() = user_id)` | Complete |
| | Run migration against Boards Supabase project | Blocked |
| | Update `database-schema.md` via `/arch` | Pending |
| **Client-Side Interaction Tracking** | | Complete |
| | Instrument `click` event: fires when user opens a pin URL (new tab) | Complete |
| | Instrument `expand` event: fires when user expands a pin card | Complete |
| | Instrument `share` event: fires when user shares a pin or board | Complete |
| | On each interaction: update `links[id].last_interacted_at = now` in localStorage | Complete |
| | On each interaction: async insert into `pin_interactions` via Supabase (non-blocking) | Complete |
| | Verify tracking overhead < 10ms per event | Pending |
| | Note: `lookback_view` and `lookback_dismiss` types added in Epic 12.1 | Pending |

---

## Epic 12.1: Lookback MVP — Temporal + Interaction Signals

> **Surfaces**: Lookback Card (main board), Time Machine (basic browse)
> **Signals**: Anniversary, seasonal match, never clicked, consumption gap, staleness
> **Scoring**: Client-side only — zero infrastructure cost
> **Personas**: All (these signals apply universally)

### Story 1: Client-Side Lookback Scoring Engine

<!-- Shipped: computeLookbackScore() with 6 signals (anniversary, seasonal, never-clicked, consumption gap, staleness, recency decay) in boards/index.html -->

| Story | Tasks | Status |
|-------|-------|--------|
| **computeLookbackScore() function** | | Complete |
| | Implement `computeLookbackScore(pin, now)` — returns `{ score, signals }` | Complete |
| | Anniversary signal: match month-day within 3-day window, pin 300+ days old, score += 0.9 | Complete |
| | Seasonal match: compare saved season to current season, pin 180+ days old, score += 0.5 | Complete |
| | Never clicked: `last_interacted_at IS NULL` and pin 7+ days old, score += 0.7 | Complete |
| | Consumption gap — watch: `category === 'watch' && !pin.watched`, score += 0.6 | Complete |
| | Consumption gap — read: `category === 'read' && !pin.read`, score += 0.6 | Complete |
| | Staleness bonus: pin > 90 days old with no interaction, score += min(0.3, age_days/1000) | Complete |
| | `getSeason(date)` helper: returns 'winter', 'spring', 'summer', 'fall' from month | Complete |
| **Lookback selection algorithm** | | Complete |
| | `getDailyLookback(links, today)` — scores all pins, selects qualifying set | Complete |
| | Activation gate: return empty if user has < 20 pins OR collection < 30 days old | Complete |
| | Recency decay: pins surfaced in last 14 days get score * 0.5^(days_ago/14) | Complete |
| | Category diversity bonus: if top 5 are all same category, boost underrepresented categories | Complete |
| | Select top 3-5 pins by composite score | Complete |
| | Daily budget: max 1 consumption gap pin per day | Complete |
| | Cache daily set in localStorage with `lookback_date` key (avoid recomputation on re-render) | Complete |
| | Invalidate cache if user adds new pin or calendar day changes | Complete |
| **Lookback interaction events** | | Pending |
| | Instrument `lookback_view` event: user views a surfaced pin via Lookback | Pending |
| | Instrument `lookback_dismiss` event: user dismisses the Lookback card | Pending |

### Story 2: Lookback Card Component (Main Board)

<!-- Shipped: renderLookbackCard(), daily cache, 24h dismiss, mini-cards in boards/index.html -->

| Story | Tasks | Status |
|-------|-------|--------|
| **Lookback card layout** | | Complete |
| | Render at top of board grid, above pins, below filter bar | Complete |
| | "LOOKBACK" label (small caps, muted) | Complete |
| | 3 mini-cards: image, title (truncated 2 lines), context label | Complete |
| | Context labels per signal: "Saved 1 year ago", "Never opened", "Still unwatched", etc. | Complete |
| | "See all" link — opens Lookback view | Complete |
| | "Dismiss" button (X) — hides for 24 hours | Complete |
| **Lookback card behavior** | | Complete |
| | Only render if `getDailyLookback()` returns 3+ pins | Complete |
| | Tapping mini-card: open pin URL or expand card | Complete |
| | Dismissal: set `lookback_dismissed_at` in localStorage, suppress 24 hours | Complete |
| | New set each day: cache resets at midnight (user local time) | Complete |
| | Only show when `currentFilter === 'all'` (not in category-filtered views) | Complete |

### Story 3: Time Machine View

| Story | Tasks | Status |
|-------|-------|--------|
| **Time Machine entry point** | | Pending |
| | Accessible from Lookback card "See all" and from Lookback nav | Pending |
| | Activation: 10+ pins AND collection 14+ days old | Pending |
| **Time period filters** | | Pending |
| | Year tabs: one per year present in collection | Pending |
| | Season filters: Winter, Spring, Summer, Fall (by month) | Pending |
| | Category filter: reuse existing 9-category chips | Pending |
| | Filters compose with AND logic | Pending |
| **Time Machine grid** | | Pending |
| | Render filtered pins in standard board grid (reuse card components) | Pending |
| | Sort: `created_at` descending within filtered set | Pending |
| | Count: "12 pins from Summer 2025" above grid | Pending |
| | Empty state: "No pins from [filter combination]" | Pending |
| **Navigation** | | Pending |
| | URL hash routing: `#lookback/time-machine?year=2025&season=summer` | Pending |
| | Back button returns to Lookback card or board grid | Pending |

### Story 4: Lookback View Shell

| Story | Tasks | Status |
|-------|-------|--------|
| **Lookback view layout** | | Pending |
| | "LOOKBACK" header with back-to-board navigation | Pending |
| | "Today" section: featured large card (highest score) + 2-3 supporting mini-cards | Pending |
| | "Time Machine" section below Today (from Story 3) | Pending |
| | Empty state: "Come back tomorrow" if daily budget exhausted | Pending |
| **Today section — featured card** | | Pending |
| | Full image, title, domain, multi-signal context sentence | Pending |
| | Action buttons: "Open link", "Re-categorize", "Archive" | Pending |
| | Supporting mini-cards below featured card | Pending |
| **Nav integration** | | Pending |
| | Lookback accessible from dedicated nav icon or filter item | Pending |
| | Deep link: `#lookback` opens Lookback view | Pending |

### Story 5: Phase 1 Testing

| Story | Tasks | Status |
|-------|-------|--------|
| **Functional testing** | | Pending |
| | Test scoring: verify anniversary window, seasonal match, staleness decay | Pending |
| | Test daily budget: verify max 5 pins, max 1 consumption gap | Pending |
| | Test cache: same set on reload within day, new set after midnight | Pending |
| | Test thresholds: no card for <20 pins or <30 day collections | Pending |
| | Test Time Machine: 10+ pin threshold, filter composition | Pending |
| | Test dismissal: 24-hour suppression, new set overrides next day | Pending |
| **Performance verification** | | Pending |
| | `computeLookbackScore()` runs < 200ms for 1,000 pins | Pending |
| | Interaction tracking overhead < 10ms per event | Pending |
| | Lookback card renders < 500ms after board load | Pending |

---

## Epic 12.2: External Context + Full Lookback View

> **New signals**: Dead link detection, release calendar, creator activity, seasonal commerce
> **New surfaces**: Full Lookback View (This Week, Monthly Review, Collection Timeline), weekly digest
> **Scoring**: Edge function with external data
> **Personas**: The DJ (new releases), The Visual Collector (price drops), The Researcher (dead links)
>
> **Absorbs backlog**: "Monthly digest widget", "Collection timeline", "Streaming availability notifications" (#61)

### Story 1: Lookback Edge Function

| Story | Tasks | Status |
|-------|-------|--------|
| **Create `lookback` edge function** | | Pending |
| | Create `supabase/functions/lookback/index.ts` with action router | Pending |
| | Action: `score` — accepts `{ user_id, limit, exclude_ids[] }`, returns ranked pins with signals | Pending |
| | Action: `monthly-review` — accepts `{ user_id, month }`, returns AI-generated summary | Pending |
| | Action: `check-dead-links` — accepts `{ user_id }`, runs HEAD checks, updates `link_status` | Pending |
| | Migrate client-side scoring to edge function (temporal + interaction server-side) | Pending |
| | Client falls back to client-side scoring if edge function unavailable | Pending |

### Story 2: Dead Link Detection

| Story | Tasks | Status |
|-------|-------|--------|
| **Schema for link health** | | Pending |
| | Write migration `018_lookback_external.sql` | Pending |
| | Add `link_status TEXT DEFAULT 'alive'` to `links` ('alive', 'dead', 'redirect', 'unknown') | Pending |
| | Add `link_checked_at TIMESTAMPTZ DEFAULT NULL` to `links` | Pending |
| | Run migration against Boards Supabase project | Blocked |
| **Dead link checker** | | Pending |
| | HTTP HEAD requests to pin URLs with 5-second timeout | Pending |
| | Mark `link_status = 'dead'` for 404, 410, 5xx | Pending |
| | Mark `link_status = 'redirect'` for 301/302 with different final domain | Pending |
| | Rate limit: max 100 URLs per user per run | Pending |
| | Prioritize oldest-checked pins (`link_checked_at ASC NULLS FIRST`) | Pending |
| | Respect `Retry-After` headers | Pending |
| | Cache results 7 days: skip recently-checked pins | Pending |
| **Scheduled execution** | | Pending |
| | GitHub Actions workflow: run `check-dead-links` weekly (Sunday midnight) | Pending |
| | Log results: checked count, newly dead count, errors | Pending |
| **Dead link as Lookback signal** | | Pending |
| | Score boost for `link_status = 'dead'`, label "Link may be dead" | Pending |
| | Max 1 dead link pin per daily budget | Pending |

### Story 3: Release Calendar Integration

| Story | Tasks | Status |
|-------|-------|--------|
| **TMDB for watch pins** | | Pending |
| | Query TMDB API for upcoming seasons/episodes on `category = 'watch'` pins | Pending |
| | Fuzzy title match (0.8+ similarity) | Pending |
| | Lookback signal: release within 30 days → "New season available" | Pending |
| **Open Library for read pins** | | Pending |
| | Query Open Library for author's latest work on `category = 'read'` pins with book metadata | Pending |
| | Lookback signal: new release within 60 days → "New book from this author" | Pending |
| **YouTube creator activity** | | Pending |
| | Check latest upload on YouTube channels for follow/listen pins | Pending |
| | Lookback signal: new upload within 7 days → "Just posted something new" | Pending |
| | YouTube Data API v3 key required (add to edge function secrets) | Pending |
| **Seasonal commerce rules** | | Pending |
| | Calendar-based rules: month ranges → category boosts | Pending |
| | Nov-Dec: boost eat recipes + go gift guides; Jun-Aug: boost wear + go travel | Pending |
| | Pure calendar logic — no external API | Pending |

### Story 4: Full Lookback View — Additional Sections

| Story | Tasks | Status |
|-------|-------|--------|
| **"This Week" section** | | Pending |
| | Show pins surfaced earlier this week, not acted on (not clicked, not dismissed) | Pending |
| | Max 4 pins | Pending |
| | Disappears if all were acted on | Pending |
| **Monthly Review section** | | Pending |
| | Claude Haiku generates 2-3 sentence summary of month's saving activity | Pending |
| | Input: category counts, new categories, total pins, milestones | Pending |
| | Cache per month; regenerate only if pin count changes by 3+ | Pending |
| | Fallback: simple stats ("You saved 23 pins across 6 categories") | Pending |
| **Collection Timeline section** | | Pending |
| | Visual timeline of saves by month — bar chart or sparkline (CSS/SVG, no library) | Pending |
| | Filterable by category | Pending |
| | Tapping a month bar filters Time Machine to that month | Pending |

### Story 5: Weekly Digest Email

| Story | Tasks | Status |
|-------|-------|--------|
| **Email infrastructure** | | Pending |
| | Select email provider (Resend recommended) | Pending |
| | Add `RESEND_API_KEY` to Ops Supabase function secrets | Blocked |
| | Create `send-digest` edge function in Ops project | Pending |
| **Digest content** | | Pending |
| | Top 3 lookback pins by composite score for the week | Pending |
| | Pin title, domain, context label, age | Pending |
| | Footer: week's save count, most-saved category | Pending |
| | Deep link: "Open Lookback" → `#lookback` | Pending |
| **Digest scheduling** | | Pending |
| | GitHub Actions workflow: weekly (Monday 9am) | Pending |
| | Only send if 30+ pins AND collection 60+ days old AND 3+ qualifying pins | Pending |
| | Unsubscribe link in footer (set preference on user profile) | Pending |

### Story 6: Phase 2 Testing

| Story | Tasks | Status |
|-------|-------|--------|
| **Edge function testing** | | Pending |
| | Test `lookback` edge function `score` action with real data | Pending |
| | Test dead link checker: mock 404 responses, verify status update | Pending |
| | Test TMDB integration: fuzzy matching, signal generation | Pending |
| | Test monthly review: verify <3 sentences, verify caching | Pending |
| **Digest testing** | | Pending |
| | Send test digest, verify formatting | Pending |
| | Verify unsubscribe works | Pending |
| | Verify threshold logic (no digest for small/new collections) | Pending |
| **Deployment** | | Pending |
| | Deploy `lookback` edge function to Boards project | Pending |
| | Deploy `send-digest` edge function to Ops project | Pending |

---

## Epic 12.3: Collection Intelligence + Re-engagement

> **New signals**: Cross-category connections, taste drift, emerging themes, trending topics
> **New surfaces**: Re-engagement push notification, smart grouping
> **Scoring**: AI-powered (Claude Haiku for theme extraction)
> **Personas**: The Cultural Omnivore (taste drift), The Multidisciplinary Maker (cross-category), The Researcher (trending)
>
> **Absorbs backlog**: "Taste profile", "You save a lot of X insights", "Trend detection", "Cross-category connections"

### Story 1: Taste Profile

| Story | Tasks | Status |
|-------|-------|--------|
| **Taste profile computation** | | Pending |
| | `computeTasteProfile(links)` — returns `{ topCategories, topDomains, topContentTypes, saveVelocity, mostActivePeriod }` | Pending |
| | Top categories: distribution as percentages, ranked | Pending |
| | Top domains: most frequently saved (top 5) | Pending |
| | Save velocity: pins per week (4-week average vs. prior 4-week) | Pending |
| | Most active period: time-of-day and day-of-week distributions | Pending |
| **"Your taste at a glance" surface** | | Pending |
| | Section in Lookback View with top 3 insights in plain language | Pending |
| | Refresh weekly (cached in localStorage) | Pending |

### Story 2: Trend Detection and Emerging Themes

| Story | Tasks | Status |
|-------|-------|--------|
| **Burst detection** | | Pending |
| | Analyze `created_at` clustering: 3+ pins in 2-week window with similar category/domain | Pending |
| | Label: "Your architecture phase, March 2025 (8 pins)" | Pending |
| | Surface as markers on collection timeline | Pending |
| **Emerging theme detection** | | Pending |
| | Claude Haiku: send last 30 days of pin titles/domains, ask for themes beyond existing categories | Pending |
| | Output: `{ theme, pin_count, confidence, sample_pins }` | Pending |
| | Surface: "Emerging in your collection: [theme]" | Pending |
| | Minimum: 3+ pins, confidence > 0.7 | Pending |
| | Compute monthly, cache — one Haiku call per user per month | Pending |
| **Trending topic matching** | | Pending |
| | Query Google Trends or X trending topics daily | Pending |
| | Cross-reference against pin titles/descriptions/domains | Pending |
| | Signal: "Trending right now" label, max 1 per daily budget | Pending |
| | Degrade gracefully if API unavailable | Pending |

### Story 3: Cross-Category Connections

| Story | Tasks | Status |
|-------|-------|--------|
| **Semantic similarity** | | Pending |
| | Claude Haiku: identify thematic connections across categories | Pending |
| | Input: pin titles, descriptions, domains across categories | Pending |
| | Output: `{ pin_a_id, pin_b_id, connection_type, reason }` | Pending |
| | Compute monthly, cache | Pending |
| **Connection surface** | | Pending |
| | Lookback signal: "These pins connect across categories" — surface pair with reason | Pending |
| | "Connections" subsection in Lookback View | Pending |
| | Minimum: confidence > 0.75 | Pending |

### Story 3a: Taste-Graph Enhanced Event Recommendations

<!-- Reference: PRD at docs/strategy/prds/event-connections.md -->

| Story | Tasks | Status |
|-------|-------|--------|
| **Server: TasteContext in recommend-events** | | Complete |
| | Add `TasteContext`, `TasteCluster`, `TasteBridge` types to `recommend-events` | Complete |
| | Extend `EventProfile` with optional `tasteContext` field | Complete |
| | Inject taste identities, bridges, motifs into AI ranking prompt | Complete |
| | Add taste-aware rule to prompt RULES block | Complete |
| | Trim `topCategories` from 5→3 to offset token budget | Complete |
| | Version bump to 1.1.0 | Complete |
| **Client: taste pipeline in Boards** | | Complete |
| | `buildClustersFromLinks()` — group pins by category, extract topTokens | Complete |
| | `loadTasteContext()` — call taste-graph with 6h localStorage cache | Complete |
| | Wire into `loadEventsForYouWidget()` — attach tasteContext to profile | Complete |
| **Client: taste pipeline in Events** | | Complete |
| | Duplicate `buildClustersFromLinks` + `loadTasteContext` in events/index.html | Complete |
| | Wire into `loadRecommendedEvents()` — attach tasteContext to profile | Complete |

### Story 4: Taste Drift

| Story | Tasks | Status |
|-------|-------|--------|
| **Taste drift computation** | | Pending |
| | Compare category distribution: last 90 days vs. prior 90 days | Pending |
| | Detect categories that grew or shrank by 10%+ | Pending |
| | Summary: "You're saving more [listen] and less [watch] lately" | Pending |
| **Taste drift surface** | | Pending |
| | Add to "Your taste at a glance" section | Pending |
| | Only surface when 10%+ shift in at least one category | Pending |

### Story 5: Re-engagement Push Notification

| Story | Tasks | Status |
|-------|-------|--------|
| **Push notification prerequisite** | | Blocked |
| | FCM/APNs setup required (existing blocker) | Blocked |
| **Re-engagement trigger** | | Pending |
| | Trigger: user inactive 14+ days | Pending |
| | Select pin: highest composite lookback score | Pending |
| | Cadence: max 1 nudge per 30 days per user | Pending |
| | Only for opted-in users | Pending |
| **Measurement** | | Pending |
| | Track: app open within 48 hours of nudge | Pending |
| | Target: 15% conversion rate | Pending |

### Story 6: Smart Grouping

| Story | Tasks | Status |
|-------|-------|--------|
| **Group by signal type** | | Pending |
| | Group Today's pins: "Anniversaries", "Unfinished business", "New from creators", "Trending" | Pending |
| | Group headers when 2+ pins share signal type | Pending |
| | Ungrouped pins render without header | Pending |
| **Group actions** | | Pending |
| | "Open all" — open all URLs in group in new tabs | Pending |
| | "Dismiss group" — dismiss all pins in group for 48 hours | Pending |

### Story 7: Phase 3 Testing

| Story | Tasks | Status |
|-------|-------|--------|
| **AI signal testing** | | Pending |
| | Test emerging themes: quality of Haiku output on real boards | Pending |
| | Test cross-category: at least 1 meaningful connection per 50-pin collection | Pending |
| | Test trending topics: graceful degradation when API unavailable | Pending |
| | Test taste drift: accurate period comparison | Pending |
| **Cost verification** | | Pending |
| | Monthly review + emerging theme + cross-category: combined ≤ 2 Haiku calls per user per month | Pending |
| | Total Claude cost at 1,000 users: verify < $10/month | Pending |
| | Trending API cost: verify < $10/month at 1,000 users | Pending |
