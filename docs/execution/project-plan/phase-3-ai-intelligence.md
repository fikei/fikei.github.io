# Phase 3: AI Intelligence (IN PROGRESS)

> Back to [Project Plan](./index.md)

---

## Epic 3.1: Content Type System

**Released: 2026-01-15**

| Story | Tasks | Status |
|-------|-------|--------|
| **Rules-Based Classification (Client)** | | Complete |
| | Define BUILTIN_TYPES with domains, patterns, keywords | Complete |
| | Implement classifyByRules() | Complete |
| | Domain profile cache (client-side) | Complete |
| | Integrate into link add flow | Complete |
| **AI Classification (Server)** | | Complete |
| | Create enrich-link Edge Function | Complete |
| | Anthropic classifier (claude-3-haiku) | Complete |
| | Confidence threshold (0.7) | Complete |
| | Parse JSON response | Complete |
| **Dev Tools Integration** | | Complete |
| | "Run AI Enrichment Pipeline" button | Complete |
| | Progress toast during enrichment | Complete |
| | Display content type in admin panel | Complete |

| Story | Tasks | Status |
|-------|-------|--------|
| **Domain Profile Caching (Server)** | | Pending |
| | Create `domain_profiles` table | Pending |
| | Implement DomainProfileManager | Pending |
| | Cache single-type domains (30-day TTL) | Pending |
| | Skip API call for cached domains | Pending |
| **Classification Batching** | | Pending |
| | Implement classification queue | Pending |
| | Batch queue items (10-20 per call) | Pending |
| | Flush queue on timeout/size | Pending |

---

## Epic 3.2: Image Resolution Pipeline

**Released: 2026-01-10**

| Story | Tasks | Status |
|-------|-------|--------|
| **Client-Side Resolution** | | Complete |
| | imageQueue for background processing | Complete |
| | Platform APIs (YouTube, Vimeo, GitHub) | Complete |
| | Integrate into link add flow | Complete |
| **Server-Side Resolution** | | Complete |
| | OG image extraction (no CORS) | Complete |
| | Unsplash API search | Complete |
| | Image source tracking | Complete |
| **Manual Override** | | Pending |
| | "Edit image" button on cards | Pending |
| | Re-fetch, search, upload options | Pending |

---

## Epic 3.3: Generative Widget Ecosystem

> **Vision**: A fully automated system that autonomously determines which widgets should exist, what content populates them, how they're structured, and how they improve over time.
>
> **Reference**: [PRD: Generative Widget Ecosystem](/docs/strategy/prds/generative-widget-ecosystem.md)

### Widget Phase 0: Deterministic MVP (~95% Complete)

**Automation Level**: Very Low

| Story | Tasks | Status |
|-------|-------|--------|
| **Complete the Look Widget** | | Complete |
| | Widget registry architecture | Complete |
| | 47+ brand integrations | Complete |
| | Shopify JSON API integration | Complete |
| | HTML scraping fallback | Complete |
| | Client + server caching | Complete |
| | Per-widget refresh (isolated state) | Complete |
| | Brand validation (prevent hallucinations) | Complete |
| | JSON parsing (handle AI preamble) | Complete |
| **Style Definition Widget** | | Pending |
| | Extract style attributes from board | Pending |
| | Generate style summary | Pending |
| | Define output schema | Pending |
| **Image Pipeline Fix** | | Complete |
| | SERP API integration (reliable source) | Complete |
| | Pluggable strategy pattern | Complete |
| | Health tracking per strategy | Complete |
| | Graceful fallback chain | Complete |
| **Widget Instrumentation** | | Complete |
| | Track widget views | Complete |
| | Track product clicks | Complete |
| | Track saves to board | Pending |
| | Basic feedback collection | Complete |

### Widget Phase 1: Rule-Driven Automation (COMPLETE)

**Automation Level**: Low → Medium

| Story | Tasks | Status |
|-------|-------|--------|
| **Eligibility Engine** | | Complete |
| | Define eligibility rules (min items, category match, content quality) | Complete |
| | Widgets can fail eligibility and not render | Complete |
| | Eligibility logging (why did widget appear/not appear?) | Complete |
| **Confidence Scoring** | | Complete |
| | AI returns confidence score (0.0-1.0) with each response | Complete |
| | Configurable confidence thresholds per widget | Complete |
| | Low-confidence widgets suppressed | Complete |
| **Validation Engine** | | Complete |
| | Track what works (successful renders, user engagement) | Complete |
| | Track what fails (parse errors, low engagement) | Complete |
| | Feed validation data back into eligibility rules | Pending |
| **Widget Feedback (Enhanced)** | | In Progress |
| | What do users click? | Complete |
| | What do users dismiss? | Complete |
| | What do users save? | Pending |
| | Aggregate feedback informs confidence | Pending |

### Widget Phase 2: Config-Generated Widgets (COMPLETE)

**Automation Level**: Medium → High
**Started**: 2026-02-05
**Completed**: 2026-02-05

| Story | Tasks | Status |
|-------|-------|--------|
| **Widget Definition Schema** | | Complete |
| | Define TypeScript schema for widget definitions | Complete |
| | Eligibility rules as config (not code) | Complete |
| | Generation config (model, prompt template, constraints) | Complete |
| | Enrichment config (strategies, timeout, fallback) | Complete |
| | Rendering config (zone, template, fallback) | Complete |
| | Refactor index.ts to use config registry | Complete |
| **Category-Agnostic Matching** | | Complete |
| | Remove hard-coded category logic from eligibility | Complete |
| | Category rules now in config files | Complete |
| | Widgets match ANY category meeting criteria | Complete |
| | Same system supports multiple categories without branching | Complete |
| | Discovery endpoint returns eligible widgets for any category | Complete |
| | Frontend delegates category matching to server config | Complete |
| **Template Selection Engine** | | Complete |
| | Define template library (grid-split, hero-card, list, text-block) | Complete |
| | Auto-select template based on widget config `template.name` | Complete |
| | Template versioning (each template has version field) | Complete |
| | Fallback template chain (primary → fallback → list) | Complete |
| **Widget Registry as Data** | | Complete |
| | Registry loaded from config files | Complete |
| | Hot-reload via registerWidget() / unregisterWidget() / reloadWidget() | Complete |
| | Adding new widget = adding config file (no code changes) | Complete |
| | Discovery endpoint: POST { action: 'discover' } | Complete |
| | Registry summary endpoint: POST { action: 'registry' } | Complete |
| **Config-Driven Enrichment** | | Complete |
| | Enrichment triggered by widget config, not hard-coded widget ID | Complete |

### Widget Phase 2.5: Rules-Based Widget Catalog (Pending)

**Automation Level**: Medium → High
**Reference**: [PRD: AI Widgets](/docs/strategy/prds/ai-widgets.md)

> 40 use-case-driven widgets, built from a shared component system (17 components, 11 body layouts). Rollout in tiers by trigger complexity.

#### Prerequisites & Blockers

| Blocker | Impact | Status | Resolution |
|---------|--------|--------|------------|
| **Fix handleQuickAdd cache key** | All action widgets silently fail | Pending | Align getCacheKey with cache storage (1 line) |
| **Verify `created_at` in schema** | 5 time-based widgets can't evaluate triggers | Pending | Check Supabase items table |
| **Add `last_interacted_at` column** | 4 staleness widgets blocked | Pending | Schema migration + click/view tracking |
| **Extend category enum** | 7 widgets use new categories (gift, spend, make, listen, learn, events, work) | Pending | Update filter bar + category mapping |
| **No sub-type classifier** | Can't distinguish garment type, cuisine, genre (5 widgets) | Pending | Extend Epic 3.1 content-type system |
| **Cross-category query pattern** | 5 cross-category widgets need items across all categories | Pending | Update discovery endpoint to accept multiple categories |
| **Inference eligibility is expensive** | 5 widgets need AI to determine if they should render | Deferred | Two-pass system (Phase 6) |
| **External API keys (TMDB, link-check)** | 2 widgets need external services | Deferred | Add API keys to edge function env |

#### Data Source Status

| Data | Available? | Used by |
|------|-----------|---------|
| title, url, domain, image | ✅ Yes | All 40 widgets |
| category | ✅ Yes | All 40 widgets |
| created_at | ❓ Verify | 5 time-based widgets |
| last_interacted_at | ❌ Missing | 4 staleness widgets |
| price | ❌ AI-inferred | 3 widgets (unreliable) |
| sub-type (garment/cuisine/genre) | ❌ Missing | 5 widgets |
| geographic location | ❌ AI-inferred | 2 widgets |
| release dates | ❌ External API | 1 widget |

**7 widgets can ship immediately with existing data**: #1, 4, 6, 26, 34, 35, 36

#### Design System Components

| Story | Tasks | Status |
|-------|-------|--------|
| **Widget Component System** | | Pending |
| | Define 6 atoms: w-text, w-badge, w-bar, w-icon-btn, w-divider, w-checkbox | Pending |
| | Define 7 molecules: w-headline, w-tag-group, w-stat, w-row, w-axis, w-option, w-section | Pending |
| | Define 11 body layout modifiers (verdict, list, stats, spectrum, split, narrative, comparison, choices, checklist, suggestion, grouped) | Pending |
| | Define w-shell, w-header, w-body, w-footer structure | Pending |
| | Write CSS for all components using design tokens | Pending |
| | Migrate existing widget-complete to w-shell | Pending |
| **Template Render Functions** | | Pending |
| | Implement verdict renderer (w-headline + w-tag-group) | Pending |
| | Implement list renderer (w-row × N) | Pending |
| | Implement stats renderer (w-stat × N) | Pending |
| | Implement spectrum renderer (w-axis × N) | Pending |
| | Implement split renderer (w-column × 2 with w-row × N) | Pending |
| | Implement narrative renderer (w-text--prose) | Pending |
| | Implement comparison renderer (w-option × 2 + w-divider--labeled) | Pending |
| | Implement choices renderer (w-option × N) | Pending |
| | Implement checklist renderer (w-row + w-checkbox × N + w-stat) | Pending |
| | Implement suggestion renderer (w-row featured + w-btn) | Pending |
| | Implement grouped renderer (w-section × N with w-row × N) | Pending |

#### Tier 1: First Widget Per Original Category (8 widgets)

Simple triggers — item count + category filter. Client-side evaluation only.

| Story | Tasks | Status |
|-------|-------|--------|
| **eat: Decide (#1)** | | Pending |
| | Server config: eat-decide.ts (pick-one template, 3+ eat items) | Pending |
| | AI prompt: given restaurant names, pick 1 with reasoning | Pending |
| | Frontend WIDGET_REGISTRY entry | Pending |
| | Choices body layout with w-option × 2-3 | Pending |
| **home: Ladder (#36)** | | Pending |
| | Server config: home-ladder.ts (list template, 1+ home item) | Pending |
| | AI prompt: infer item type, suggest budget/mid/splurge alternatives | Pending |
| | Frontend WIDGET_REGISTRY entry | Pending |
| | List body layout with w-row × 3 (tier indicators) | Pending |
| **watch: Deadline (#40)** | | Pending |
| | Server config: watch-deadline.ts (list template, 2+ watch items) | Pending |
| | AI prompt: identify shows, infer upcoming seasons/sequels | Pending |
| | Frontend WIDGET_REGISTRY entry | Pending |
| | List body layout with w-row × N (urgency color indicators) | Pending |
| **use: Compare (#26)** | | Pending |
| | Server config: use-compare.ts (swap template, 1+ use item) | Pending |
| | AI prompt: identify tool category, suggest competitor with differentiator | Pending |
| | Frontend WIDGET_REGISTRY entry | Pending |
| | Comparison body layout with w-option × 2 + w-divider--labeled | Pending |
| **go: Sequence (#6)** | | Pending |
| | Server config: go-sequence.ts (list template, 3+ go items) | Pending |
| | AI prompt: given destinations, suggest optimal route order with durations | Pending |
| | Frontend WIDGET_REGISTRY entry | Pending |
| | List body layout with w-row × N (step number indicators) | Pending |
| **follow: Proxy (#34)** | | Pending |
| | Server config: follow-proxy.ts (text-block template, 3+ follow items) | Pending |
| | AI prompt: infer creator relationships and influence chains | Pending |
| | Frontend WIDGET_REGISTRY entry | Pending |
| | Narrative body layout with w-text--prose (indented hierarchy) | Pending |
| **read: Backlog (#16)** | | Pending |
| | Server config: read-backlog.ts (stat-row template, 5+ read items) | Pending |
| | AI prompt: estimate read times from titles, calculate backlog depth | Pending |
| | Frontend WIDGET_REGISTRY entry | Pending |
| | Stats body layout with w-stat × 3 | Pending |
| **Deploy & Test Tier 1** | | Pending |
| | Deploy updated edge function with 7 new widget configs | Pending |
| | Test each widget with real board data | Pending |
| | Verify discovery endpoint returns new widgets | Pending |

#### Tier 2: Second Widget + New Categories (16 widgets)

| Story | Tasks | Status |
|-------|-------|--------|
| **eat: Portion (#32)** | | Pending |
| | Server config + frontend entry (stat-row, 4+ eat items) | Pending |
| **eat: Substitute (#35)** | | Pending |
| | Server config + frontend entry (swap, 1+ eat item) | Pending |
| **home: Gap Analysis (#2)** | | Pending |
| | Server config + frontend entry (grid-split, 5+ home items) | Pending |
| **watch: Mood (#28)** | | Pending |
| | Server config + frontend entry (spectrum, 4+ watch items) | Pending |
| **use: Gap Analysis (#5)** | | Pending |
| | Server config + frontend entry (quick-add, 3+ use items) | Pending |
| **wear: Redundancy (#13)** | | Pending |
| | Server config + frontend entry (stat-row, 3+ same type) | Pending |
| **wear: Remix (#23)** | | Pending |
| | Server config + frontend entry (pick-one, 4+ items, 2+ types) | Pending |
| **read: Synthesize (#4)** | | Pending |
| | Server config + frontend entry (text-block, 4+ read items) | Pending |
| **read: Translate (#22)** | | Pending |
| | Server config + frontend entry (grid-split, 4+ articles) | Pending |
| **follow: Audit (#24)** | | Pending |
| | Server config + frontend entry (spectrum, 3+ same-niche) | Pending |
| **go: Cluster (#39)** | | Pending |
| | Server config + frontend entry (hero-card, 3+ same-area) | Pending |
| **learn: Dependency Map (#12)** | | Pending |
| | Server config + frontend entry (list, 3+ learning saves) | Pending |
| **listen: Curator (#11)** | | Pending |
| | Server config + frontend entry (list, 5+ music/podcast) | Pending |
| **events: Collision (#14)** | | Pending |
| | Server config + frontend entry (list, 2+ events) | Pending |
| **make: Assemble (#10)** | | Pending |
| | Server config + frontend entry (commit-list, 4+ project items) | Pending |
| **gift: Assign (#7)** | | Pending |
| | Server config + frontend entry (grid-split, 5+ items + 2+ people) | Pending |

#### Tier 3: Prove Action Templates (4 widgets)

| Story | Tasks | Status |
|-------|-------|--------|
| **Action: Gap Analysis quick-add (#5)** | | Pending |
| | Wire handleQuickAdd: add item → grid update → re-generate | Pending |
| | Fix cache key mismatch bug | Pending |
| | Verify: added item appears in grid, next widget excludes it | Pending |
| **Action: Compare swap (#26)** | | Pending |
| | Wire swap action: save alternative → replaces original | Pending |
| | Verify: alternative persists, widget reflects change | Pending |
| **Action: Substitute swap (#35)** | | Pending |
| | Wire swap action: save substitute → both visible | Pending |
| **Action: Negotiate checklist (#21)** | | Pending |
| | Wire checkbox toggle: running total updates | Pending |
| | Verify: check/uncheck ripples through budget total | Pending |

#### Time-Based Widgets (5 widgets)

Requires `created_at` timestamp on items.

| Story | Tasks | Status |
|-------|-------|--------|
| **Verify created_at exists in data model** | | Pending |
| | Check Supabase schema for timestamp field | Pending |
| | Add migration if missing | Pending |
| **all: Behavior (#15)** | | Pending |
| | Server config + frontend entry (spectrum, time: 10+ saves, 2+ months) | Pending |
| **all: Predict (#19)** | | Pending |
| | Server config + frontend entry (hero-card, time: 15+ saves) | Pending |
| **read: Pace (#27)** | | Pending |
| | Server config + frontend entry (stat-row, time: 5+ in 14 days) | Pending |
| **learn: Graduate (#30)** | | Pending |
| | Server config + frontend entry (list, time: 3+ same topic, 2+ months) | Pending |
| **all: Drift (#37)** | | Pending |
| | Server config + frontend entry (spectrum, time: 10+ saves, 3+ months) | Pending |

#### Staleness Widgets (4 widgets)

Requires `last_interacted_at` field — new data to store.

| Story | Tasks | Status |
|-------|-------|--------|
| **Add interaction tracking** | | Pending |
| | Add `last_interacted_at` column to items table | Pending |
| | Update on link click, widget view, board visit | Pending |
| **watch: Persuade (#3)** | | Pending |
| | Server config + frontend entry (hero-card, stale: 14+ days) | Pending |
| **follow: Decay (#8)** | | Pending |
| | Server config + frontend entry (list, stale: 30+ days) | Pending |
| **all: Archaeologist (#20)** | | Pending |
| | Server config + frontend entry (hero-card, stale: 60+ days) | Pending |
| **all: Expire (#25)** | | Pending |
| | Server config + frontend entry (stat-row, 10+ stale: 30+ days) | Pending |

#### Cross-Category & Inference Widgets (9 widgets)

| Story | Tasks | Status |
|-------|-------|--------|
| **spend: Calculate (#9)** | | Pending |
| | Cross-category trigger: 5+ price-inferrable items | Pending |
| **home+wear: Bridge (#29)** | | Pending |
| | Cross-category trigger: 3+ in each category | Pending |
| **all: Ritual (#33)** | | Pending |
| | Cross-category trigger: items across 3+ categories | Pending |
| **all: Contradict (#38)** | | Pending |
| | Cross-category + inference: opposing themes | Pending |
| **home: Conflict (#17)** | | Pending |
| | Inference trigger: conflicting style detection | Pending |
| **work: Pattern Reveal (#18)** | | Pending |
| | Inference trigger: job/company pattern in saves | Pending |
| **wear: Season (#31)** | | Pending |
| | Inference trigger: seasonal skew detection | Pending |
| **home: Gap Analysis (#2) — enhanced** | | Pending |
| | Inference trigger: same inferred style (upgrade from Tier 2 count trigger) | Pending |
| **use: Gap Analysis (#5) — enhanced** | | Pending |
| | Inference trigger: same inferred workflow (upgrade from Tier 2 count trigger) | Pending |

---

### Widget Phase 3: Self-Selecting Widgets (Pending)

**Automation Level**: High

| Story | Tasks | Status |
|-------|-------|--------|
| **Widget Candidate Generation** | | Pending |
| | System proposes N candidate widgets for any board | Pending |
| | Candidates evaluated in parallel | Pending |
| | Candidates scored before rendering | Pending |
| **Ranking System** | | Pending |
| | Score = confidence × relevance × novelty | Pending |
| | Relevance based on board content analysis | Pending |
| | Novelty prevents showing same widget repeatedly | Pending |
| **Slot Allocation** | | Pending |
| | Define widget slots per zone (hero: 1, inline: 3, footer: 2) | Pending |
| | Only top-ranked widgets fill slots | Pending |
| | Empty slots = meaningful signal (no good widgets) | Pending |
| **A/B Testing Framework** | | Pending |
| | Split traffic between widget selection strategies | Pending |
| | Track engagement metrics per variant | Pending |
| | Statistical significance calculation | Pending |
| | Automatic winner selection | Pending |

### Widget Phase 4: Self-Optimizing System (Pending)

**Automation Level**: Full

| Story | Tasks | Status |
|-------|-------|--------|
| **Engagement Tracking** | | Pending |
| | Clicks, saves, dismissals per widget | Pending |
| | Time-on-widget metrics | Pending |
| | Conversion tracking (suggestion → purchase) | Pending |
| **Automated Threshold Tuning** | | Pending |
| | Confidence thresholds adjust based on outcomes | Pending |
| | Eligibility rules tighten/loosen automatically | Pending |
| | Learning rate controls for stability | Pending |
| **Widget Lifecycle Management** | | Pending |
| | States: emerging → stable → deprecated | Pending |
| | Poor-performing widgets degrade gracefully | Pending |
| | Strong widget patterns reinforce themselves | Pending |
| | New widget forms can emerge within constraints | Pending |
| **Anomaly Detection** | | Pending |
| | Detect sudden performance drops | Pending |
| | Auto-disable failing widgets | Pending |
| | Alert on unusual patterns | Pending |
| | Self-healing when issues resolve | Pending |

---

## Epic 3.4: AI Pin Generation (Pending)

| Story | Tasks | Status |
|-------|-------|--------|
| **Search-Based Pin Generation** | | Pending |
| | Search input modal with query field | Pending |
| | AI-powered web search for relevant content | Pending |
| | Preview search results before adding | Pending |
| | Bulk add from search results | Pending |
| | AI auto-categorization on add | Pending |
| **Category-Based Generation** | | Pending |
| | "Suggest pins for this category" action | Pending |
| | AI analyzes existing category content | Pending |
| | Generate complementary suggestions | Pending |
| | Source from curated databases/APIs | Pending |
| | One-click add suggested pins | Pending |
| **Prompt-Based Generation** | | Pending |
| | Free-form prompt input field | Pending |
| | AI interprets intent and finds content | Pending |
| | Natural language queries ("find minimalist furniture") | Pending |
| | Generate pins matching prompt criteria | Pending |
| | Refine results with follow-up prompts | Pending |
| **Content-Based Generation** | | Pending |
| | "More like this" action on any pin | Pending |
| | AI finds similar content across web | Pending |
| | Style/aesthetic matching algorithm | Pending |
| | Generate variations based on pin attributes | Pending |
