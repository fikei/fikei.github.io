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
| | Define template library (product-grid, style-card, simple-list, text-summary) | Complete |
| | Auto-select template based on widget config `template.name` | Complete |
| | Template versioning (each template has version field) | Complete |
| | Fallback template chain (primary → fallback → simple-list) | Complete |
| **Widget Registry as Data** | | Complete |
| | Registry loaded from config files | Complete |
| | Hot-reload via registerWidget() / unregisterWidget() / reloadWidget() | Complete |
| | Adding new widget = adding config file (no code changes) | Complete |
| | Discovery endpoint: POST { action: 'discover' } | Complete |
| | Registry summary endpoint: POST { action: 'registry' } | Complete |
| **Config-Driven Enrichment** | | Complete |
| | Enrichment triggered by widget config, not hard-coded widget ID | Complete |

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
