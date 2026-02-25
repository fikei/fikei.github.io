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
| **Platform-Specific Previews** | | Complete |
| | GitHub link preview with stars + language badge | Complete |
| **Server-Side Resolution** | | Complete |
| | OG image extraction (no CORS) | Complete |
| | Unsplash API search | Complete |
| | Image source tracking | Complete |
| **Manual Override** | | Superseded |
| | ~~"Edit image" button on cards~~ | Superseded → Epic 3.5 Story 6 |
| | ~~Re-fetch, search, upload options~~ | Superseded → Epic 3.5 Story 6 |

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

### Widget Phase 2.5a: Design System Transition ⚡ HIGH PRIORITY

**Automation Level**: Medium → High
**Status**: In Progress
**Reference**: [Design System Validation Pipeline PRD](/docs/strategy/prds/design-system-validation-pipeline.md), [Variant Audit Project Plan](/docs/playground/systemic/project-plan-variant-audit.md)

> Complete the transition from legacy `widget-*` classes to the design system's `w-*` classes. This is the prerequisite for all Phase 2.5b work — until this is done, new widgets can't be validated and the design system can't enforce conformance.

#### Design System Data Layer

| Story | Tasks | Status |
|-------|-------|--------|
| **Design System Manifest** | | Complete |
| | Build `scripts/parse-design-system.js` (CSS → manifest.json) | Complete |
| | Parse tokens.css: 27 colors (dark), 10 light overrides, 22 typography, 10 spacing, 10 animation, 14 layout | Complete |
| | Parse components.css: 25 component classes with modifiers and states | Complete |
| | Parse widgets.css: 10 atoms, 8 molecules, 15 sizes, 10 body modifiers, 4 container breakpoints | Complete |
| | Generate `design-system/manifest.json` — committed to repo for drift detection | Complete |
| **Template Registry** | | Complete |
| | Create `design-system/template-registry.json` with 10 canonical templates | Complete |
| | Map each template: body modifier, valid sizes, required atoms, sample fixture | Complete |
| | Map Boards templates to design system equivalents (boardsTemplateMap) | Complete |
| | Track implementation status per template (legacy, partial, not-implemented) | Complete |
| | Coverage summary: 6 implemented (legacy classes), 4 not-implemented | Complete |
| **Self-Scan in Systemic** | | Complete |
| | `app.js:loadLocalDesignSystem()` fetches manifest + registry | Complete |
| | Transforms into Systemic viewer/QA format with components, variants, tokens | Complete |
| | "Load Local System" card in My Systems view | Complete |
| | Template previews rendered with actual `w-*` class markup | Complete |

#### Template Migration (Legacy → w-* Classes)

> Boards currently renders widgets using `widget-complete`, `widget-spectrum__axis`, etc. These must migrate to the design system's `w-shell`, `w-body--spectrum`, `w-axis` classes.

| Story | Tasks | Status |
|-------|-------|--------|
| **Migrate existing template renderers** | | Complete |
| | `hero-card` → verdict: replace `widget-style__*` classes with `w-headline`, `w-tag-group`, `w-badge` | Complete |
| | `list` → list: replace `widget-complete__body` divs with `w-body--list > w-row*` | Complete |
| | `spectrum` → spectrum: replace `widget-spectrum__*` classes with `w-axis`, `w-text--label` | Complete |
| | `grid-split` → split: replace `widget-complete__body` grid with `w-body > w-items + w-divider` | Complete |
| | `text-block` → narrative: replace inline styles with `w-body--narrative > w-text--prose` | Complete |
| | `quick-add` → suggestion: replace `widget-quickadd__*` classes with `w-body--suggestion > w-img + w-headline + w-action-bar` | Complete |
| | `stat-row` → stats: replace `widget-statrow__*` classes with `w-stat` molecules + `w-body--stats` modifier | Complete |
| | Remove legacy `widget-complete__header` → use `w-header > w-header__left + w-header__controls` | Complete |
| | Remove legacy `widget-complete__body` → use `w-body` with body modifier class | Complete |
| | Remove legacy `widget-complete__badge` → use `w-badge` | Complete |
| | Add `renderWidgetHeader()` shared helper (DRY) | Complete |
| | Add token bridge in Boards `:root` for DS token compatibility | Complete |
| | Import `design-system/widgets.css` in Boards `<head>` | Complete |
| **Update WIDGET_TEMPLATES object** | | Complete |
| | Render functions output `w-*` class HTML instead of `widget-*` classes | Complete |
| | Template keys preserved (grid-split, hero-card, etc.) for backward compatibility | Complete |
| | Loading states migrated to `w-shell > w-body--loading > w-loader` | Complete |
| **Design system extensions for migration** | | Complete |
| | Add `w-items` atom (flex-wrap container for item cards) | Complete |
| | Add `w-item` atom (fixed-width item card with hover lift + shadow) | Complete |
| | Add `w-body--stats` body modifier (stat-row layout) | Complete |
| | Add `w-divider__label` for labeled dividers | Complete |
| | Update `w-axis__marker` to 10px circle (matches legacy visual) | Complete |
| | Update `w-header` spacing to use margin-bottom (matches legacy) | Complete |
| | Update `w-body--suggestion` to horizontal layout by default | Complete |
| | Container query: `w-body--suggestion` stacks vertically < 280px | Complete |
| | Container query: `w-item` responsive sizing at breakpoints | Complete |
| **Add missing template renderers** | | Pending |
| | Implement comparison renderer (w-option × 2 + w-divider--labeled) | Complete |
| | Implement choices renderer (w-option × N) | Complete |
| | Implement checklist renderer (w-row + w-checkbox × N + w-stat) | Complete |
| | Implement grouped renderer (w-section × N with w-row × N) | Complete |
| **Verify migration** | | In Progress |
| | All 7 existing widget types render with new w-* classes | Complete |
| | Visual diff: compare before/after screenshots at each valid size | Pending |
| | Existing widget configs still resolve to correct templates | Complete |
| **Clean up legacy CSS** | | Complete |
| | Remove dead `widget-complete__*` CSS from Boards inline styles | Complete |
| | Remove dead `widget-style__*` CSS from Boards inline styles | Complete |
| | Remove dead `widget-spectrum__*` CSS from Boards inline styles | Complete |
| | Remove dead `widget-statrow__*` CSS from Boards inline styles | Complete |
| | Remove dead `widget-quickadd__*` CSS from Boards inline styles | Complete |
| | Remove dead `widget-outfit__*`, `widget-empty*`, `widget--loading*` CSS | Complete |
| **Widget feature flag** | | Complete |
| | Gate all widget rendering behind `boards_widget_ds` localStorage flag | Complete |
| | Default OFF, persist once enabled via `window.enableWidgetDS()` | Complete |
| | Guard at top of `generateWidgets()`, hide hero/footer sections when off | Complete |
| **Edge-case fixtures** | | Complete |
| | Add `edgeCases` array to all 10 templates in template-registry.json | Complete |
| | Covers: empty data, single item, overflow, long text, missing fields | Complete |

#### Config-Driven AI Prompts

> `generate-widget` edge function reads from template registry instead of hardcoded prompt text. The AI generates HTML that conforms to the design system.

| Story | Tasks | Status |
|-------|-------|--------|
| **Read template registry in edge function** | | Complete |
| | Create `config/design-system.ts` with embedded template definitions and class allowlist | Complete |
| | `buildDesignSystemPrompt()` — body modifiers, required/optional atoms, valid sizes, structure | Complete |
| | `resolveTemplate()` — maps Boards template names to DS template definitions | Complete |
| | Inject template constraints into prompt per widget type (between brand + confidence sections) | Complete |
| **Constrained HTML output** | | Complete |
| | AI system prompt specifies allowed classes from manifest allowlist (130+ classes) | Complete |
| | `validateWidgetHtml()` — extracts all `w-*` classes and checks against allowlist | Complete |
| | `sanitizeWidgetHtml()` — strips unknown `w-*` classes, preserves non-w-* classes | Complete |
| | Validation runs automatically when AI response contains `content.html` field | Complete |
| | Reject and retry if AI outputs non-conforming HTML | Pending |
| **Template-specific prompts** | | Complete |
| | Each widget config's `rendering.template` resolves to DS template via `boardsTemplateMap` | Complete |
| | Prompt includes only the atoms/molecules relevant to that template | Complete |
| | Valid sizes from registry included in prompt constraints | Complete |
| | Discovery endpoint returns `designSystem` object with template mapping per widget | Complete |

#### Validation Pipeline (CI Gate)

> Automated conformance checking on every PR. See [Design System Validation Pipeline PRD](/docs/strategy/prds/design-system-validation-pipeline.md) for full spec.

| Story | Tasks | Status |
|-------|-------|--------|
| **Manifest drift detection** | | Pending |
| | CI runs `parse-design-system.js`, diffs against committed `manifest.json` | Pending |
| | Fail PR if manifest changed without being regenerated | Pending |
| | Annotate PR with token/component changes | Pending |
| **Template validation** | | Pending |
| | Build `scripts/validate-widgets.js` with rule engine | Pending |
| | Rules: unknown-class, missing-shell, missing-body-modifier, wrong-structure | Pending |
| | Output `audit.json` with pass/warn/fail per template × size | Pending |
| | GitHub Action posts check summary | Pending |
| **Systemic QA integration** | | Pending |
| | `VariantAudit.importValidationReport(audit.json)` maps results to stoplights | Pending |
| | "Import from CI" button in QA toolbar | Pending |
| | Coverage stats in QA header | Pending |

#### Concerns & Mitigations

| Concern | Impact | Fix | Status |
|---------|--------|-----|--------|
| **Legacy class gap** — Boards outputs `widget-*` classes, validation checks `w-*` classes | Validation can't validate current production widgets | Template migration (above) closes the gap. All 7 renderers + 3 loading states now output `w-*` classes. Legacy CSS is dead code pending cleanup. | **Resolved** |
| **Manifest/registry sync** — `manifest.json` is generated, `template-registry.json` is manual. Body modifiers can drift apart. | A new `w-body--*` modifier added to CSS but missing from registry goes undetected | Add CI check: run `parse-design-system.js`, diff body modifier keys against registry template keys, fail on mismatch | Pending |
| **`stat-row` has no design system equivalent** — exists in Boards but has no `w-body--stats` modifier in widgets.css | Template registry maps it to `null`. Can't validate or render through design system. | Resolved: added `w-body--stats` modifier to widgets.css. Template registry updated: `stat-row` → `stats`, `boardsTemplateMap` updated, coverage moved to `migrated`. | **Resolved** |
| **Static fixture data** — sample fixtures in template-registry.json are hand-written, may miss edge cases | Visual QA catches empty/overflow cases but fixtures don't exercise them automatically | Extend each fixture in template-registry.json to include `fixture` (happy path) + `edgeCases` (empty data, long text, missing fields). QA view renders both. | Pending |
| **No runtime enforcement** — manifest is build-time only, widget renderer doesn't check it | A widget could render non-conforming HTML if AI hallucinates classes | Intentional: no runtime latency cost. Enforcement is at prompt time (constrained output) + CI time (validation pipeline). Add server-side allowlist check as fallback. | Pending |
| **Container query validation** — 4 breakpoints affect layout at runtime, headless DOM can't verify visually | Structural validation catches class issues but not visual overflow/truncation | Phase 1: structural validation only. Phase 2: screenshot-based visual regression using html2canvas (tracked in Variant Audit project plan Phase 6). | Deferred |

| Story | Tasks | Status |
|-------|-------|--------|
| **Resolve stat-row template gap** | | Complete |
| | ~~Option A: Add `w-body--stats` to widgets.css with `w-stat` flex grid layout~~ | **Complete (Option A chosen)** |
| | ~~Option B: Deprecate stat-row~~ | N/A |
| | Update template-registry.json with chosen approach | Complete |
| | Update boardsTemplateMap to reflect decision | Complete |
| **Add edge-case fixtures to template registry** | | Complete |
| | Add `edgeCases` array to each template in template-registry.json | Complete |
| | Edge cases: empty items array, single item, 20+ items (overflow), very long text, missing optional fields | Complete |
| | QA view renders edge-case fixtures alongside happy-path fixtures | Pending |
| **Manifest/registry sync CI check** | | Pending |
| | Script: parse manifest body modifiers, compare to registry template keys | Pending |
| | Fail CI if any modifier exists in manifest but not registry (or vice versa) | Pending |
| | Add to `design-system-validation.yml` workflow | Pending |
| **Server-side class allowlist fallback** | | Complete |
| | In `generate-widget` edge function, after AI returns HTML, scan for `w-*` classes | Complete |
| | Compare against 130+ class allowlist in `config/design-system.ts` | Complete |
| | Strip unknown classes via `sanitizeWidgetHtml()` before returning to client | Complete |
| | Log violations to console + include in `meta.validation` response | Complete |
| **Improve parser auto-detection** | | Pending |
| | Remove hardcoded atom/molecule/structure lists from `parse-design-system.js` | Pending |
| | Auto-detect category from CSS comment section headers (`/* ATOMS */`, `/* MOLECULES */`) | Pending |
| | Eliminates need to manually update parser when adding new `w-*` classes | Pending |

---

### Widget Phase 2.5b: Rules-Based Widget Catalog (Pending)

**Automation Level**: Medium → High
**Reference**: [PRD: AI Widgets](/docs/strategy/prds/ai-widgets.md)
**Prerequisite**: Phase 2.5a (Design System Transition) must be complete — widget renderers must output `w-*` classes before new widgets are built on them.

> 40 use-case-driven widgets, built from a shared component system (17 components, 11 body layouts). Rollout in tiers by trigger complexity.

#### Prerequisites & Blockers

| Blocker | Impact | Status | Resolution |
|---------|--------|--------|------------|
| **Design System Transition (Phase 2.5a)** | All new widgets must use w-* classes | In Progress | Template migration **complete** (7/7 renderers). Config-driven prompts + validation pipeline still pending. |
| **Fix handleQuickAdd cache key** | All action widgets silently fail | Pending | Align getCacheKey with cache storage (1 line) |
| **Verify `created_at` in schema** | 5 time-based widgets can't evaluate triggers | Pending | Check Supabase items table |
| **Add `last_interacted_at` column** | 4 staleness widgets blocked | Pending | Schema migration + click/view tracking |
| **Dynamic AI categories** | 7 widgets need new categories + 5 need sub-types (12 total) | Pending | AI-inferred categories + tags[] on save; filter bar renders dynamically |
| **No sub-type classifier** | Can't distinguish garment type, cuisine, genre (5 widgets) | Pending | Solved by tags[] from dynamic AI categories |
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

**8 widgets can ship immediately with existing data**: #1, 4, 6, 26, 34, 35, 36, 41
**Priority widgets**: #40 (AI-inferred dates, ship now), #41 (existing data, ship now)

#### Design System Components

> **Note**: Component CSS is already written in `design-system/widgets.css` and cataloged in `design-system/manifest.json`. The tasks below track adoption into Boards template renderers.

| Story | Tasks | Status |
|-------|-------|--------|
| **Widget Component System** | | Complete |
| | ~~Define 6 atoms: w-text, w-badge, w-bar, w-icon-btn, w-divider, w-checkbox~~ | Complete (in widgets.css) |
| | ~~Define 7 molecules: w-headline, w-tag-group, w-stat, w-row, w-axis, w-option, w-section~~ | Complete (in widgets.css) |
| | ~~Define 11 body layout modifiers~~ | Complete (in widgets.css) |
| | ~~Define w-shell, w-header, w-body, w-footer structure~~ | Complete (in widgets.css) |
| | ~~Write CSS for all components using design tokens~~ | Complete (in widgets.css) |
| | ~~Migrate existing widget-complete to w-shell~~ | Complete (completed in Phase 2.5a) |
| **Template Render Functions** | | Complete |
| | ~~Implement verdict renderer~~ | Complete (Phase 2.5a migration) |
| | ~~Implement list renderer~~ | Complete (Phase 2.5a migration) |
| | ~~Implement stats renderer~~ | Complete (Phase 2.5a migration) |
| | ~~Implement spectrum renderer~~ | Complete (Phase 2.5a migration) |
| | ~~Implement split renderer~~ | Complete (Phase 2.5a migration) |
| | ~~Implement narrative renderer~~ | Complete (Phase 2.5a migration) |
| | ~~Implement comparison renderer~~ | Complete (Phase 2.5a) |
| | ~~Implement choices renderer~~ | Complete (Phase 2.5a) |
| | ~~Implement checklist renderer~~ | Complete (Phase 2.5a) |
| | ~~Implement suggestion renderer~~ | Complete (Phase 2.5a migration) |
| | ~~Implement grouped renderer~~ | Complete (Phase 2.5a) |

#### Dynamic AI-Evaluated Categories

| Story | Tasks | Status |
|-------|-------|--------|
| **AI Category Assignment** | | In Progress |
| | Extend `enrich-link` to return `{ category, tags[] }` instead of `{ category }` | Pending |
| | Add `tags` column (text array) to links table | Complete |
| | `computeLinkTags(link)` — client-side tag computation from existing metadata (genres, categories, domains) | Complete |
| | GIN index `idx_links_tags` on `links.tags` for fast tag queries | Complete |
| | Run migration `020_link_tags.sql` against Boards Supabase project | Blocked |
| | AI assigns primary category + secondary tags on link save | Pending |
| | Fallback: user confirms/overrides if AI confidence < threshold | Pending |
| **Dynamic Filter Bar** | | Pending |
| | Render filter bar from `SELECT DISTINCT category FROM items` | Pending |
| | Remove hard-coded category list from frontend | Pending |
| | New categories auto-appear when user saves items the AI classifies differently | Pending |
| **Widget Eligibility on Tags** | | Pending |
| | Update discovery endpoint to match on `tags[]` as well as `category` | Pending |
| | Sub-type widgets (#13, 23, 28, 31, 32) use tags for garment/cuisine/genre matching | Pending |
| | Cross-category widgets use `category: 'all'` or multi-category query | Pending |

#### Priority Widgets (Build First)

User-validated high-value widgets. Ship before standard tier rollout.

| Story | Tasks | Status |
|-------|-------|--------|
| **watch: Upcoming Releases (#40)** | | Pending |
| | Server config: watch-deadline.ts (list template, 2+ watch items) | Pending |
| | AI prompt: identify shows/movies, infer upcoming seasons/releases from titles | Pending |
| | Frontend WIDGET_REGISTRY entry | Pending |
| | List body layout with w-row × N (release date + urgency indicator) | Pending |
| | Phase 1: AI-inferred dates (ship now), Phase 2: TMDB API (later) | Pending |
| **all: More Like Your Board (#41)** | | In Progress |
| | Server config: discover-more.ts (suggestion template, 3+ items in any category) | Complete |
| | AI prompt: analyze saved items, recommend 1 new item with reasoning | Complete |
| | Category-specific title variants (8 category-aware titles) | Pending |
| | Frontend WIDGET_REGISTRY entry | Complete |
| | Suggestion body layout (quick-add template) | Complete |
| | Differentiation from "Add more pins" (trigger threshold, tone, placement) | Pending |
| **Deploy & Test Priority Widgets** | | Pending |
| | Test #40 with real watch items — verify AI release date inference quality | Pending |
| | Test #41 across 3+ categories — verify recommendation relevance | Pending |
| | Verify coexistence with empty state "Add pins" CTA | Pending |

#### Tier 1: First Widget Per Original Category (8 widgets)

Simple triggers — item count + category filter. Client-side evaluation only.

| Story | Tasks | Status |
|-------|-------|--------|
| **eat: Decide (#1)** | | Complete |
| | Server config: eat-decide.ts (choices template, 3+ eat items) | Complete |
| | AI prompt: given restaurant names, pick 1 with reasoning | Complete |
| | Frontend WIDGET_REGISTRY entry | Complete |
| | Choices body layout with w-option × 2-3 | Complete |
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
| **use: Compare (#26)** | | Complete |
| | Server config: use-compare.ts (comparison template, 1+ use item) | Complete |
| | AI prompt: identify tool category, suggest competitor with differentiator | Complete |
| | Frontend WIDGET_REGISTRY entry | Complete |
| | Comparison body layout with w-option × 2 + w-divider--labeled | Complete |
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
| **watch: Mood (#28)** | | Complete |
| | Server config + frontend entry (spectrum, 4+ watch items) | Complete |
| | Display mood tags from TMDB keywords/genres in watch cards | Complete |
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

---

## Epic 3.5: Image Intelligence System (Pending)

> **Vision**: A configurable, AI-powered image pipeline that can search, edit, and generate images independently from metadata enrichment — with automation rules that adapt to content type and category.
>
> **Supersedes**: Epic 3.2 "Manual Override" story, Backlog "AI image generation for missing thumbnails"

### Story 1: Partial Metadata Resilience

The enrichment pipeline today handles partial results implicitly but doesn't track or retry what's missing. Formalize partial enrichment so each field (title, description, image, classification) is independently trackable and retryable.

| Task | Status |
|------|--------|
| Add `enrichment_status` field to pin model: `{ title: 'done', image: 'pending', classification: 'failed' }` | Pending |
| Process currently-ignored client→server params (`forceRefresh`, `currentImage`, `skipIfHasImage`) in enrich-link | Pending |
| Re-queue for missing fields only: if classification succeeds but image fails, retry image alone | Pending |
| Surface enrichment completeness in admin panel (pins with missing metadata count) | Pending |
| Batch re-enrichment action: "Enrich all pins missing images" in admin | Pending |

### Story 2: Independent Image Pipeline

Decouple image resolution from the broader enrichment call so images can be resolved, edited, or generated on their own schedule.

| Task | Status |
|------|--------|
| Create `resolve-image` edge function — accepts `{ url, title, content_type, category, strategy_override? }` | Pending |
| Extract image strategy logic from `enrich-link` into shared `image-strategies` module | Pending |
| `enrich-link` calls shared module (no duplication) | Pending |
| Client can call `resolve-image` independently (e.g., from image editor UI) | Pending |
| `resolve-image` returns `{ image_url, image_source, strategy_used, alternatives[] }` — multiple candidates, not just first match | Pending |
| Return ranked alternatives so the user or automation can pick the best | Pending |

### Story 3: Image Strategy Rules Engine

Replace hardcoded strategy arrays with a configurable rules engine. Each content type × category combination gets its own priority chain of strategies, including the new AI strategies.

| Task | Status |
|------|--------|
| Define `ImageStrategyConfig` schema: `{ content_type, category?, strategies: [{ type, priority, params }] }` | Pending |
| Migrate existing hardcoded strategy map to config format | Pending |
| Add new strategy types: `ai_edit`, `ai_generate` alongside existing `scrape`, `search`, `platform`, `favicon`, `template` | Pending |
| Rule evaluation: try strategies in priority order, stop on first success (or collect alternatives) | Pending |
| Configurable stop conditions: "stop on first" vs "collect top 3" vs "always try AI" | Pending |
| Per-category overrides: e.g., `wear` category → prioritize product photos, `read` category → prioritize article headers | Pending |
| Per-content-type overrides: e.g., `video` → always use platform thumbnail, `product` → prefer Shopify → SERP → AI generate | Pending |
| Store strategy configs in database (`image_strategy_configs` table) for runtime editing | Pending |
| Admin UI for viewing and editing strategy priority rules | Pending |

### Story 4: AI Image Editing

Prompt-driven editing of existing pin images — background removal, style transfer, crop, enhance, recolor. Uses a generative AI image model.

| Task | Status |
|------|--------|
| Evaluate AI image editing providers (Stability AI, DALL-E edit, Replicate) | Pending |
| Create `edit-image` edge function — accepts `{ image_url, prompt, edit_type }` | Pending |
| Supported edit types: `remove_background`, `enhance`, `crop_smart`, `style_transfer`, `recolor`, `freeform_prompt` | Pending |
| Upload source image to provider, receive edited image | Pending |
| Store edited image in Supabase Storage bucket (`pin-images/edited/`) | Pending |
| Before/after preview in the UI before applying | Pending |
| Preserve original image URL — edits create a new asset, original is recoverable | Pending |
| Cost tracking per edit operation (log to `image_edit_log` table) | Pending |

### Story 5: AI Image Generation

Generate new images when no good source image exists — for note pins, abstract concepts, or when all search strategies fail.

| Task | Status |
|------|--------|
| Evaluate AI image generation providers (DALL-E 3, Stability AI SDXL, Replicate) | Pending |
| Create generation prompt builder: `{ title, description, category, content_type }` → image prompt | Pending |
| Category-aware style guidance: `wear` → product photography style, `eat` → food photography, `read` → editorial illustration | Pending |
| Store generated images in Supabase Storage bucket (`pin-images/generated/`) | Pending |
| Tag with `image_source: 'ai_generated'` for transparency | Pending |
| Generation as a strategy in the rules engine — triggered when higher-priority strategies fail | Pending |
| User-initiated generation: "Generate an image for this pin" action | Pending |
| Cost guardrails: daily generation budget per user, skip generation for low-value pins | Pending |

### Story 6: Prompt-Driven Image Editor UI

Replace "Refresh Image" button with a full image management interface. Users get control over how their pin images look.

| Task | Status |
|------|--------|
| Replace "Refresh Image" menu item with "Edit Image" that opens image editor panel | Pending |
| Image editor panel with tabs: **Search** / **Edit** / **Generate** / **Upload** | Pending |
| **Search tab**: Re-run image resolution, show alternatives grid, click to select | Pending |
| **Edit tab**: Prompt input + edit type selector, before/after preview, apply button | Pending |
| **Generate tab**: Auto-generated prompt from pin metadata, editable, preview before applying | Pending |
| **Upload tab**: Drag-and-drop or file picker for custom image | Pending |
| Image history: show previous images for this pin, one-click revert | Pending |
| Keyboard shortcut: `i` on selected pin opens image editor | Pending |

---

## Epic 3.6: Categorization Cleanup (Pending)

> **Vision**: A persistent utility queue that surfaces pins with low-confidence AI categorization or missing metadata, lets users fast-correct them, and feeds corrections back into the classification system. Not a widget — a drain-to-zero task queue with a badge count.
>
> **Reference**: [PRD: Categorization Cleanup](/docs/strategy/prds/categorization-cleanup.md)
>
> **Prerequisite**: Requires `confidence` and `type_confidence` fields from Epic 3.1. Requires `image_scores` from Phase 10.

### Story 1: Schema Migration

<!-- Shipped: 016_categorization_cleanup.sql adds user_reviewed_at column + index -->

| Story | Tasks | Status |
|-------|-------|--------|
| **Schema: user_reviewed_at** | | Complete |
| | Write migration `016_categorization_cleanup.sql`: add `user_reviewed_at TIMESTAMPTZ DEFAULT NULL` to `links` table | Complete |
| | Add index `idx_links_user_reviewed` on `(user_id, user_reviewed_at)` for queue query performance | Complete |
| | Run migration against Boards Supabase project | Blocked |
| | Update `database-schema.md` to document new column | Pending |

### Story 2: Cleanup Queue — Client-Side Computation

<!-- Shipped: computeAdaptiveThreshold(), getCleanupQueue() with 7 criteria, priority sort, 25-item cap in boards/index.html -->

| Story | Tasks | Status |
|-------|-------|--------|
| **Adaptive threshold computation** | | Complete |
| | Implement `computeAdaptiveThreshold(links)`: 25th percentile of confidence distribution, floor 0.50, ceiling 0.80 | Complete |
| | Cache threshold per session (recompute on page load, not per render) | Complete |
| **getCleanupQueue() function** | | Complete |
| | Implement `getCleanupQueue(links)` — filter by: confidence < adaptive threshold, uncategorized, type_confidence < 0.50, missing image (null or composite < 0.15), enrichment_failed, missing structured metadata (watch w/o video, listen w/o music, read w/o book) | Complete |
| | Exclude pins where `user_reviewed_at` is set | Complete |
| | Priority sort: uncategorized (0), confidence < threshold (1), type_confidence < 0.50 (2), everything else (3) | Complete |
| | Secondary sort: `created_at` descending within each priority tier | Complete |
| | Cap queue at 25 items | Complete |
| | Feature activation gate: return empty queue if user has fewer than 10 pins total | Complete |
| **Queue badge count** | | Pending |
| | Compute badge count from `getCleanupQueue()` result length | Pending |
| | Render badge on cleanup nav item (count, max display "25+") | Pending |
| | Refresh badge on page load and after each review action | Pending |

### Story 3: Cleanup View — Navigation Entry Point

<!-- Shipped: "⚑ Review (N)" pill in renderFilters(), click handler enters cleanup view in boards/index.html -->

| Story | Tasks | Status |
|-------|-------|--------|
| **Cleanup nav item** | | Complete |
| | Add cleanup entry to `renderFilters()` after existing category pills | Complete |
| | Show only if queue has 3+ items | Complete |
| | Active state styling consistent with other filter pills | Complete |
| | Tapping nav item activates cleanup view (replaces grid with cleanup UI) | Complete |
| **Cleanup view shell** | | Pending |
| | Empty state: "All clear" messaging with return-to-board CTA | Pending |
| | Header: "Review (N)" with count decrementing as items are resolved | Pending |
| | Exit cleanup: back button or tapping any category nav returns to board grid | Pending |

### Story 4: Review Card UI

<!-- Shipped: renderCleanupView() with hero image, inline edit, category chips, confirm/skip/delete, handleCleanupAction() in boards/index.html -->

| Story | Tasks | Status |
|-------|-------|--------|
| **Review card layout** | | Complete |
| | Full-width hero image (or placeholder with "No image" label if missing) | Complete |
| | Inline-editable title field (tap to edit, tap away to save) | Complete |
| | Inline-editable description field (collapsed to 2 lines, expandable) | Complete |
| | Domain label below title | Complete |
| | "AI says: [category] (N%)" context line | Complete |
| | 9 category chips (horizontally scrollable) with AI suggestion pre-selected | Complete |
| | Three action buttons: Confirm (primary), Skip (secondary), Delete (destructive) | Complete |
| **Review card behavior** | | Complete |
| | Confirm: apply current state, set `user_reviewed_at`, slide card out, show next | Complete |
| | Skip: move pin to end of queue, excluded from current session | Complete |
| | Delete: remove pin with undo toast (3-second window) | Complete |
| | Progress indicator: "3 of 12" counter | Complete |
| | Keyboard shortcuts: `c` confirm, `s` skip, `d` delete (desktop) | Complete |
| **Re-fetch image action** | | Pending |
| | Show "Re-fetch image" button on cards with missing/poor image | Pending |
| | Calls existing image resolution pipeline, updates card inline | Pending |

### Story 5: Inline Queue Banner

| Story | Tasks | Status |
|-------|-------|--------|
| **Banner component** | | Pending |
| | Render banner at top of board grid when cleanup queue has 3+ items | Pending |
| | Content: "[flag icon] N pins need review" with "Review now" CTA | Pending |
| | Tapping CTA activates cleanup view | Pending |
| | Dismiss button hides banner for current session | Pending |
| **Banner suppression logic** | | Pending |
| | Track `cleanup_banner_dismissed_at` in localStorage | Pending |
| | Suppress if dismissed within 24 hours AND no new queue items since dismissal | Pending |
| | Re-show if new pins added and queue grew after dismissal | Pending |

### Story 6: Batch Actions

| Story | Tasks | Status |
|-------|-------|--------|
| **Multi-select mode** | | Pending |
| | Long-press on review card enters multi-select mode | Pending |
| | Checkbox on each card, tap to toggle selection | Pending |
| | Selection count in floating action bar | Pending |
| | "Done" button exits multi-select | Pending |
| **Batch operations** | | Pending |
| | "Move to category" — category picker, applies to all selected | Pending |
| | "Delete" — confirmation dialog with count, bulk delete with undo | Pending |
| | "Re-enrich" — re-trigger server enrichment for selected pins | Pending |
| | After batch: deselect all, update queue and badge count | Pending |

### Story 7: Feedback Loop

| Story | Tasks | Status |
|-------|-------|--------|
| **On confirm / re-categorize** | | Pending |
| | Update pin `category`, set `confidence` to 1.0 (user-confirmed) | Pending |
| | Set `user_reviewed_at` to current timestamp | Pending |
| | Write `classification_log` entry: `user_override = true`, original + corrected category, original confidence | Pending |
| | Sync changes to Supabase | Pending |
| **Domain profile boosting** | | Pending |
| | On correction: call `updateDomainProfile(domain, correctedCategory)` | Pending |
| | Increment corrected-category count in `domain_profiles` | Pending |
| | At 3+ overrides to same category for a domain: boost cached confidence | Pending |
| **On title / description edit** | | Pending |
| | Update `title`/`description` in localStorage and sync to Supabase | Pending |
| | If content type derived from title keywords, re-evaluate `content_type` client-side | Pending |

### Story 8: Testing & Polish

| Story | Tasks | Status |
|-------|-------|--------|
| **Functional testing** | | Pending |
| | Test queue computation: various confidence levels, verify sorting and cap | Pending |
| | Test adaptive threshold: verify percentile computation, floor, ceiling | Pending |
| | Test review card: confirm, skip, delete flows with localStorage and Supabase sync | Pending |
| | Test batch operations: multi-select, category move, bulk delete | Pending |
| | Test feedback loop: verify `classification_log` entries and `domain_profiles` updates | Pending |
| | Test banner: appearance at 3+ items, dismissal, 24-hour suppression | Pending |
| **Edge cases** | | Pending |
| | Queue with 0 items: no nav badge, no banner, empty state in cleanup view | Pending |
| | Queue with 1-2 items: no banner, nav badge appears, cleanup view works | Pending |
| | User reviews all items: badge disappears, "All clear" state shown | Pending |
| | Offline: queue computed from localStorage, sync queued for reconnection | Pending |
| | Undo delete: 3-second toast, pin restored to queue on undo | Pending |
| | Feature gate: verify no UI appears below 10 pins | Pending |

---

## Epic 3.7: Create a Board MVP (In Progress)

> **Vision**: User-initiated board creation with AI-powered library suggestions. Users declare intent ("I want a board for X") and the system surfaces matching pins from their library and the internet.
>
> **Reference**: [PRD: Create a Board](/docs/strategy/prds/create-a-board.md)

### Story 1: Infrastructure — Tags + Board Metadata

<!-- Shipped: 019_board_metadata.sql, 020_link_tags.sql, computeLinkTags(), saveBoardMetadata(), expanded GENRE_NORMALIZE in boards/index.html (PR #143) -->

| Story | Tasks | Status |
|-------|-------|--------|
| **Unified tags column on links** | | In Progress |
| | Write migration `020_link_tags.sql`: add `tags TEXT[] DEFAULT '{}'` to `links` table | Complete |
| | Add GIN index `idx_links_tags` on `(user_id, tags)` for fast tag-based queries | Complete |
| | Implement `computeLinkTags(link)` — derives tags from genre, category, domain, content type metadata | Complete |
| | Populate `tags` on link load from localStorage (`loadLinks()`) | Complete |
| | Run migration `020_link_tags.sql` against Boards Supabase project | Blocked |
| | Persist computed tags to Supabase on link save (sync layer) | Pending |
| **Board metadata persistence** | | In Progress |
| | Write migration `019_board_metadata.sql`: `board_metadata` table (`user_id`, `slug`, `display_name`, `prompt`, `user_created`, `created_at`) | Complete |
| | RLS policies: `FOR ALL USING (auth.uid() = user_id)` | Complete |
| | Implement `saveBoardMetadata(slug, metadata)` — upserts to Supabase | Complete |
| | Run migration `019_board_metadata.sql` against Boards Supabase project | Blocked |
| | Load board metadata from Supabase on auth (`loadBoardMetadata()`) | Pending |
| **GENRE_NORMALIZE expansion** | | Complete |
| | Expand video genre synonyms: 19 entries (anime, documentary, sitcom, etc.) | Complete |
| | Expand music genre synonyms: 22 entries (house, techno, ambient, jazz, etc.) | Complete |

### Story 2: Board Creation Flow

| Story | Tasks | Status |
|-------|-------|--------|
| **`[+]` button in category navigation** | | Pending |
| | Add `[+]` token after last category pill in `renderFilters()` | Pending |
| | Tapping opens "Create Board" modal | Pending |
| **Create Board modal** | | Pending |
| | Name field (required, 1–50 chars, uniqueness check) | Pending |
| | Prompt field (optional, up to 200 chars) | Pending |
| | Name collision detection with existing AI categories | Pending |
| | On submit: derive slug (lowercase, hyphens, strip special chars), create board in categories object | Pending |
| | `user_created`, `display_name`, `prompt`, `created_at` fields on category metadata | Pending |
| | Save to Supabase via `saveBoardMetadata()` | Pending |
| **`✦` creator indicator in filter bar** | | Pending |
| | Render `✦` prefix on `filter-token--user-created` tokens | Pending |
| | User-created boards sorted after AI categories, ordered by created_at | Pending |
| | Empty user-created boards remain visible in nav (unlike AI categories) | Pending |

### Story 3: Library Suggestions (TF-IDF Ranking)

<!-- Shipped: PinRanker module (TF-IDF vector-space ranking, corpus IDF from all links, per-link TF, cosine similarity) in boards/index.html (PR #143) -->

| Story | Tasks | Status |
|-------|-------|--------|
| **PinRanker module (TF-IDF vector-space)** | | Complete |
| | `PinRanker` class: `buildCorpus(links)` computes IDF weights across full link collection | Complete |
| | `scoreLink(link, queryTerms)` — TF × IDF cosine similarity, title/description/tag field weighting | Complete |
| | `rank(links, boardName, boardPrompt)` — returns links sorted by relevance score, threshold 0.1 | Complete |
| | Domain match bonus: exact domain mention in board name/prompt | Complete |
| | Category affinity bonus: board prompt references category keyword | Complete |
| | Recency boost: pins added in last 30 days +0.1 | Complete |
| | Replace broken substring matching (`suggestFromLibrary` v1) with `PinRanker` | Complete |
| **Library suggestion UI** | | Pending |
| | "From your library" section renders below empty board grid | Pending |
| | Horizontal scrollable row or responsive grid, up to 20 suggestions | Pending |
| | Pin card with image, title, domain, and `[Add]` button | Pending |
| | `[Add]` moves pin to board (updates category field), removes from suggestion row | Pending |
| | `[Add All (N)]` bulk move with confirmation dialog | Pending |
| | Hide section once board has 5+ pins (seeded threshold) | Pending |
| | "No matching pins in your library yet." empty state | Pending |

### Story 4: Internet Suggestions (AI-Powered)

| Story | Tasks | Status |
|-------|-------|--------|
| **`suggest-for-board` edge function** | | Pending |
| | Create new edge function (or extend `generate-widget`) | Pending |
| | Accept `{ board_name, prompt, exclude_domains[], count }` | Pending |
| | Claude Haiku generates 6–12 relevant URLs with title, description, image | Pending |
| | Return structured suggestions array | Pending |
| **Internet suggestion UI** | | Pending |
| | "From the internet" section below library suggestions | Pending |
| | Same pin card layout with `[Add]` button | Pending |
| | `[Add]` creates new pin via enrichment pipeline (`enrich-link`) | Pending |
| | `[Add All]` bulk add with enrichment, confirmation dialog | Pending |
| | `[Refresh]` button, rate-limited to 3 refreshes per board per session | Pending |
| | Session cache (`sessionStorage`) 1-hour TTL per board | Pending |
| | "Add a description to get smarter suggestions." fallback when no prompt | Pending |
| | Duplicate check against user's full library before showing suggestions | Pending |

### Story 5: Sharing Integration

| Story | Tasks | Status |
|-------|-------|--------|
| **Hide suggestions on shared boards** | | Pending |
| | Library and internet suggestion sections invisible to shared board viewers | Pending |
| | `✦` creator indicator visible on shared boards (shows board origin, not a tool) | Pending |
| | Collaborative board views also hide suggestions | Pending |
