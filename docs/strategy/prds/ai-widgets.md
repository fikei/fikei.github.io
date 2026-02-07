# PRD: AI Widgets

**Date**: 2026-02-06
**Status**: Active
**Owner**: Ian

---

## Problem

Users save links to boards across 8 categories (home, wear, watch, use, eat, go, follow, read). The collection grows, but the app doesn't help users *understand* what they've saved or *do* anything with it. Items sit in a grid. There's no synthesis, no insight, no action.

## Goal

AI widgets turn a passive collection into an active experience. Each widget answers one question the user didn't know they had — and earns its existence by being more useful than the blank space it replaces.

---

## Content Reality

### What a user actually has

Each item on a board is a link with:
- **title** — product name, article headline, restaurant name
- **url** — where it lives
- **image** — hero image (sometimes missing)
- **description** — optional, often empty
- **category** — one of: home, wear, watch, use, eat, go, follow, read
- **domain** — where it came from (nike.com, nytimes.com, etc.)

### What a user does NOT have
- Prices (unless in the title)
- Ratings or reviews
- Structured metadata (color, size, material)
- Intent (are they buying? browsing? comparing?)

### Implication
Widgets must work with **titles, URLs, domains, and images**. Anything beyond that is AI inference — and must be labeled as such.

---

## Categories & What Users Curate

### Current (static, user-selected)

| Category | What they save | Example items |
|----------|---------------|---------------|
| **wear** | Clothing, shoes, accessories | Nike Dunk, Reigning Champ hoodie |
| **home** | Furniture, decor, housewares | CB2 sofa, Hay lamp |
| **watch** | Movies, shows, docs | Letterboxd link, Netflix title |
| **use** | Tools, apps, gadgets | Notion, Arc browser, Dyson |
| **eat** | Restaurants, recipes, ingredients | Resy link, NYT Cooking recipe |
| **go** | Destinations, stays, experiences | Airbnb, Google Maps pin |
| **follow** | People, accounts, creators | Instagram, Twitter, Substack |
| **read** | Books, articles, newsletters | Amazon book, Pocket article |

### Future: Dynamic AI-Evaluated Categories

The 8 static categories are a starting constraint, not the end state. The widget catalog already demands 9 new categories (gift, spend, make, listen, learn, events, work, all, cross). Rather than extending the enum indefinitely, **categories should become AI-inferred from content**.

**How it works**:
1. User saves a link. AI analyzes title + URL + domain
2. AI assigns a **primary category** (from known set OR a new emergent one)
3. AI also assigns **secondary tags** — finer-grained labels (e.g., "Italian restaurant", "sci-fi show", "running shoe")
4. Filter bar renders dynamically from whatever categories exist in the user's collection
5. Widget eligibility evaluates against AI-assigned categories and tags, not a hard-coded enum

**What this unlocks**:
- No more "category not in filter bar" blocker — any category the AI assigns automatically appears
- Sub-type classification (#13, 23, 28, 31, 32) becomes a natural output of the same pipeline
- Cross-category widgets work because items can have multiple tags
- Users who save niche content (e.g., "plants", "vinyl", "board games") get categories that fit their collection, not our predefined list

**Requirements**:
- Extend `enrich-link` edge function to return `{ category, tags[] }` instead of just `{ category }`
- Add `tags` column to items table (text array)
- Update filter bar to render from `SELECT DISTINCT category FROM items`
- Update widget eligibility to match on tags as well as category
- Fallback: if AI confidence is low, let user pick from existing + "other"

**Migration path**:
- Phase 1: Keep static 8 categories, add `tags[]` as supplementary data
- Phase 2: AI suggests category on save, user confirms (with override)
- Phase 3: Filter bar fully dynamic, renders whatever categories exist

---

## Widget Principles

1. **Content first** — What data do we actually have? Design the widget around it.
2. **One question per widget** — Each widget answers exactly one question. No dashboards.
3. **Earn existence** — If the widget isn't more useful than blank space, suppress it.
4. **Label inference** — If the AI is guessing, say so. "AI" badge is required.
5. **Base component** — Every widget is built from a design system component, not custom HTML.
6. **No dead ends** — Every widget offers an action: refresh, visit, add, dismiss.

---

## Process: How a Widget Gets Built

```
1. CONTENT     What data exists for this category?
     |         (titles, domains, images, item count)
     v
2. QUESTION    What's the one question users would ask?
     |         ("What's missing?" / "What's my vibe?" / "What should I try next?")
     v
3. COMPONENT   What's the simplest base component that answers it?
     |         (Pick from design system: card, list, meter, tag group, etc.)
     v
4. DESIGN      Sub-components, layout, and copy
     |         - What goes inside the base component?
     |         - What's the hierarchy? (headline → detail → action)
     |         - What does the copy say? (labels, empty states, loading text)
     |         - Wireframe the layout at actual size
     v
5. BUILD       Connect data sources
     |         - AI prompt → JSON schema (what shape does the AI return?)
     |         - Map JSON fields → sub-components
     |         - Fallbacks for missing/low-quality data
     |         - Server config (eligibility rules, confidence threshold)
     v
6. VALIDATE    Does it earn existence?
               (Confidence check, user feedback, suppression rules)
```

### Design layer in detail

The design step is where the widget gets real. For each widget:

**Sub-components** — What elements appear inside the base component?
- Headline text (e.g., "Minimal Modern")
- Supporting text (e.g., "Based on 12 items")
- Tags/pills (e.g., trait words)
- Images (user's items? AI suggestions? neither?)
- Action buttons (refresh, visit, add, dismiss)

**Layout** — How are sub-components arranged?
- Vertical stack? Horizontal split? Grid?
- What's the visual hierarchy? What's biggest?
- How does it respond on mobile?

**Copy** — What does the widget actually say?
- Widget title (appears in header)
- Loading state text ("Analyzing your collection...")
- Empty state text ("Save 3+ items to unlock insights")
- Error state text ("Couldn't generate — try refreshing")
- AI attribution ("Based on your 12 saved items")

**Wireframe** — Sketch at actual width before writing any code.

---

## Phase 1: What Exists Today (Wear Only)

### Widget: Complete the Look
- **Question**: "What's missing from this outfit?"
- **Content used**: Item titles, images, domains, garment category inference
- **Component**: Grid-split — user's items (left) + AI suggestions (right)
- **Action**: Shop Now → (links to brand site)
- **Status**: Shipped, working

### Widget: Style Summary
- **Question**: "What's my aesthetic?"
- **Content used**: Item titles, brand inference
- **Component**: Hero card — label + sublabel + trait tags
- **Action**: Refresh for new analysis
- **Status**: Shipped, working

### What's NOT working
- Both widgets are wear-only
- Item filtering hard-codes `category === 'wear'`
- No widgets exist for the other 7 categories
- Template/config infrastructure was built (7 templates, 5 configs) but 3 new widgets have never been seen by a user

---

## Phase 2: Fix What's Broken

Before adding anything new, fix the existing experience:

| Task | Why |
|------|-----|
| Make item filtering category-agnostic | Widgets can't work for non-wear categories |
| Wire `--grid-split` CSS class properly | Grid-split body layout broke when we refactored base CSS |
| Fix `handleQuickAdd` cache key mismatch | Quick-add button silently fails |
| Test Complete the Look + Style Summary end-to-end | Verify existing widgets still work after all the refactoring |

---

## Phase 3: Rules-Based Widgets (Simple Triggers)

Widgets that fire on **item count + category filter only**. No timestamps, no interaction tracking, no AI eligibility checks. All triggers can be evaluated client-side from the `links[]` array.

### Priority: High-Value Widgets (Build First)

These two widgets are user-validated priorities. Build and ship before the standard tier rollout.

#### Widget #40: Upcoming Releases (watch: Deadline)

**Question**: "Upcoming releases from your saves"
**Why priority**: High user excitement. Direct, time-sensitive value — tells you when something you care about is coming.

| | Detail |
|---|--------|
| **Trigger** | 2+ watch items |
| **Template** | list |
| **Data** | title, domain + AI-inferred release dates (fallback to TMDB later) |
| **Title** | "Upcoming releases for you" |
| **Body** | List of saved shows/movies with inferred or known upcoming seasons/sequels, sorted by release proximity |
| **Row format** | Show title + "Season N — Expected Q2 2026" status + external link icon |
| **Actions** | Visit link, dismiss item |
| **Loading text** | "Checking your watchlist..." |
| **Grid sizes** | sm (1x1, compact 2-3 items), med (2x1, full list), tall (1x2, full list + images) |

**Phase 1 (ship now)**: AI infers release dates from show titles and domain context. Won't be perfectly accurate but gives directional value with "AI" badge.
**Phase 2 (later)**: Add TMDB API integration for verified release dates. Replace AI inference where API data exists.

#### Widget #41: More Like Your Board (all: Discover)

**Question**: "More like your board"
**Why priority**: Universal — works across every category. Proactive discovery is the highest-value AI feature.

| | Detail |
|---|--------|
| **Trigger** | 3+ items in any single category |
| **Template** | suggestion |
| **Data** | title, domain, category (existing data — can ship immediately) |
| **Title** | Category-specific (see variants below) |
| **Body** | 2-3 AI-recommended items with reasoning, each with title + source + why-you'd-like-it blurb |
| **Row format** | Recommendation title + source domain + one-line reason |
| **Actions** | Visit link, save to board, dismiss |
| **Loading text** | "Finding things you'd love..." |
| **Grid sizes** | sm (1x1, single recommendation), med (2x1, 2-3 recs), tall (1x2, recs + reasoning), lg (2x2, recs + images + full reasoning) |

**Category-specific titles:**

| Category | Widget title | Prompt flavor |
|----------|-------------|---------------|
| eat | "Restaurants you'd love" | Similar cuisine, vibe, price point |
| home | "Pieces that fit your space" | Same aesthetic, complementary items |
| watch | "Shows cut from the same cloth" | Similar genre, tone, pacing |
| read | "Your next great read" | Same topic depth, writing style |
| use | "Tools you're missing" | Same workflow, complementary features |
| wear | "Brands on your wavelength" | Same aesthetic, price tier, style |
| follow | "Creators in your orbit" | Same niche, cross-pollination |
| go | "Places that match your taste" | Same vibe, region, experience type |
| all (fallback) | "More like your board" | General pattern matching |

**Differentiating from "Add more pins":**

| | Add more pins | More like your board |
|---|---|---|
| **Intent** | Gap-filling ("you have few items") | Enrichment ("based on your taste") |
| **Trigger** | Low item count / empty state | 3+ items (enough for pattern) |
| **Content** | Generic prompt to paste a URL | Specific named recommendations with reasoning |
| **Action** | Opens paste/search UI | Direct links to explore + one-tap save |
| **Tone** | Utility ("add content") | Discovery ("you'd love this") |
| **Placement** | Empty state / CTA | Widget card alongside existing content |

**How it changes per category**: The AI prompt shifts focus based on category context. For `eat`, it weighs cuisine similarity and neighborhood proximity. For `watch`, it weighs genre and tone. For `use`, it looks at workflow complementarity. The widget shell stays the same — the AI response drives the variance.

**How it competes with "Add more pins"**: It doesn't — they serve different moments. "Add pins" activates when the board feels empty (explicit user action). "Discover" activates when the board has enough signal for the AI to infer taste (proactive suggestion). They can coexist: empty state shows "Add pins", populated state shows "More like your board."

---

### Tier 1: One widget per original category (8 categories)

Each gets its first widget. Prioritize templates already built.

| Category | # | Job | Question | Trigger | Shape | Notes |
|----------|---|-----|----------|---------|-------|-------|
| wear | — | (existing) | "What's my aesthetic?" | 3+ wear items | hero-card | Style Summary — shipped |
| eat | 1 | Decide | "Pick one for tonight" | 3+ eat items | pick-one | New template needed |
| home | 36 | Ladder | "Good / better / best" | 1+ home item | list | Built template |
| watch | 40 | Deadline | "Upcoming from your saves" | 2+ watch items | list | Built template |
| use | 26 | Compare | "Considered the alternative?" | 1+ use item | swap | New template needed |
| go | 6 | Sequence | "Route these into a trip" | 3+ go items | list | Built template |
| follow | 34 | Proxy | "The influence chain" | 3+ follow creators | text-block | Built template |
| read | 16 | Backlog | "How long to read all this?" | 5+ read items | stat-row | Built template |

**Why these over the Phase 3 identity widgets**: The old Phase 3 mapped 6/8 categories to hero-card identity reflection ("What's my vibe?"). These are more divergent — each category gets a different job and shape. Identity widgets become one option, not the default.

### Tier 2: Second widget per category + new categories

After Tier 1 is validated, add a second widget to each original category and first widgets for new categories.

| Category | # | Job | Question | Trigger | Shape |
|----------|---|-----|----------|---------|-------|
| eat | 32 | Portion | "Your cuisine diversity" | 4+ eat items | stat-row |
| eat | 35 | Substitute | "Same vibe, different diet" | 1+ eat item | swap |
| home | 2 | Gap Analysis | "What's missing?" | 5+ home items | grid-split |
| watch | 28 | Mood | "Emotional arc of your watchlist" | 4+ watch items | spectrum |
| use | 5 | Gap Analysis | "Hole in your workflow" | 3+ use items | quick-add |
| wear | 13 | Redundancy | "You already own three of these" | 3+ same garment type | stat-row |
| wear | 23 | Remix | "Unexpected pairings" | 4+ items, 2+ types | pick-one |
| read | 4 | Synthesize | "The hidden thread" | 4+ read items | text-block |
| read | 22 | Translate | "International angle missing" | 4+ same-language articles | grid-split |
| follow | 24 | Audit | "Feed redundancy" | 3+ same-niche creators | spectrum |
| go | 39 | Cluster | "Orbiting a neighborhood" | 3+ same-area places | hero-card |
| learn | 12 | Dependency Map | "What to learn first" | 3+ learning saves | list |
| listen | 11 | Curator | "Build a listening session" | 5+ music/podcast saves | list |
| events | 14 | Collision | "These dates conflict" | 2+ events | list |
| make | 10 | Assemble | "Project plan from saves" | 4+ project items | commit-list |
| gift | 7 | Assign | "Who gets what?" | 5+ items + 2+ in follow | grid-split |

### Tier 3: Action-first widgets

Prove action templates work end-to-end before scaling.

| Priority | # | Job | Question | Template | Test |
|----------|---|-----|----------|----------|------|
| First | 5 | Gap Analysis (use) | "Hole in your workflow" | quick-add | Add item → appears in grid |
| Second | 26 | Compare (use) | "Considered the alternative?" | swap | Save alt → replaces original |
| Third | 35 | Substitute (eat) | "Same vibe, different diet" | swap | Save substitute → both visible |
| Fourth | 21 | Negotiate (eat) | "Dining week on budget" | commit-list | Check/uncheck → total updates |

**Success criteria**: User completes the action → item persists → next widget generation reflects the change.

---

## Phase 4: Time-Based Widgets

Require `created_at` timestamp on items. No new UI infrastructure, just date math in eligibility checks.

| # | Category | Job | Question | Trigger | Shape |
|---|----------|-----|----------|---------|-------|
| 15 | all | Behavior | "Saving pattern this month" | 10+ saves across 2+ months | spectrum |
| 19 | all | Predict | "What you'll save next" | 15+ saves with category trend | hero-card |
| 27 | read | Pace | "Saving faster than reading" | 5+ saves in last 14 days | stat-row |
| 30 | learn | Graduate | "Skill level is climbing" | 3+ topic saves across 2+ months | list |
| 37 | all | Drift | "How your taste is evolving" | 10+ saves across 3+ months | spectrum |

**Prerequisite**: Items must store `created_at` or `saved_at`. Check if this already exists in the data model.

---

## Phase 5: Staleness Widgets

Require interaction tracking — "last viewed" or "last clicked" per item. New data to store.

| # | Category | Job | Question | Trigger | Shape |
|---|----------|-----|----------|---------|-------|
| 3 | watch | Persuade | "Why press play on this?" | 3+ saves stale 14+ days | hero-card |
| 8 | follow | Decay | "Who are you ignoring?" | any creator stale 30+ days | list |
| 20 | all | Archaeologist | "Oldest forgotten save" | any item stale 60+ days | hero-card |
| 25 | all | Expire | "These links are dead" | 10+ saves stale 30+ days | stat-row |

**Prerequisite**: Add `last_interacted_at` field to items table. Update on link click, widget view, or board visit.

---

## Phase 6: Cross-Category & Inference Widgets

The most complex triggers. Require either cross-category evaluation or AI-driven eligibility.

### Cross-category (evaluate across boundaries)

| # | Category | Job | Question | Trigger | Shape |
|---|----------|-----|----------|---------|-------|
| 9 | spend | Calculate | "Wishlist total" | 5+ price-inferrable items across categories | stat-row |
| 29 | home + wear | Bridge | "Spaces match your clothes?" | 3+ in home AND 3+ in wear | hero-card |
| 33 | all | Ritual | "Bundle into daily routine" | items across 3+ categories | bundle |
| 38 | all | Contradict | "Saying two different things" | opposing themes across categories | text-block |

### Inference-based (AI determines eligibility)

| # | Category | Job | Question | Trigger | Shape |
|---|----------|-----|----------|---------|-------|
| 2 | home | Gap Analysis | "What's missing from this room?" | 5+ items, same inferred style | grid-split |
| 5 | use | Gap Analysis | "Hole in your workflow" | 3+ tools, same inferred workflow | quick-add |
| 17 | home | Conflict | "These styles clash" | 3+ items, conflicting inferred styles | hero-card |
| 18 | work | Pattern Reveal | "The job you're circling" | 5+ job/company/tool saves | hero-card |
| 31 | wear | Season | "Seasonal blind spot" | 5+ items skewed to 1-2 seasons | spectrum |

**Note**: Widgets #2 and #5 appear in both Tier 2 (rules-based) and here. Tier 2 uses a simplified count trigger; Phase 6 adds the AI eligibility layer for higher confidence.

---

## Widget Design System

All 40 widgets are built from a shared set of nestable, generic components. No widget gets custom HTML. Every visual element maps to a named component with defined behavior.

### Design Principles

1. **Composition over templates** — Templates are arrangements of generic components, not custom layouts
2. **Every component has one job** — `w-stat` shows a number. `w-row` shows an item. No dual-purpose components
3. **Nest, don't fork** — A checklist row is `w-row` with a `w-checkbox` inside it, not a new `w-row--checkable` component
4. **Shell is constant** — Every widget has the same outer structure. Only the body varies
5. **Actions are always in the footer** — No buttons floating in the body. Footer owns all CTAs

### Component Hierarchy

```
w-shell ─────────────────────────── Every widget
├── w-header ────────────────────── Fixed structure, never varies
│   ├── w-title                     Widget name ("Cuisine Balance")
│   ├── w-badge                     "AI" pill
│   └── w-controls
│       ├── w-icon-btn (refresh)    ⟳
│       └── w-icon-btn (dismiss)    ✕
│
├── w-body ──────────────────────── Layout set by modifier class
│   └── (body content — see layouts below)
│
└── w-footer ────────────────────── Always present
    └── w-action-bar
        └── w-btn × N              Primary + secondary actions
```

### Atoms (6 components)

Smallest visual units. Cannot be broken down further.

| Atom | Purpose | Variants | Used in |
|------|---------|----------|---------|
| `w-text` | Any text element | `--display` (24px, serif), `--title` (12px, uppercase), `--meta` (10px, muted), `--value` (18px, mono), `--label` (10px, uppercase, muted), `--note` (10px, italic, muted), `--prose` (12px, normal case) | All 40 |
| `w-badge` | Small tag pill | `--default` (outline), `--filled` (inverted), `--accent` (highlight) | 8 verdict, 2 choices |
| `w-bar` | Horizontal fill | `--full` (100% width container), `--inline` (fits in row). Fill via `style="--fill: 67%"` | 6 spectrum, 6 stats |
| `w-icon-btn` | Icon-only button | `--refresh` (⟳), `--dismiss` (✕), `--check` (✓), `--expand` (▼) | All 40 (header) |
| `w-divider` | Separator line | `--horizontal`, `--vertical`, `--labeled` (text in middle, e.g. "vs") | 3 split, 2 comparison, 2 checklist |
| `w-checkbox` | Checkable control | `--checked`, `--unchecked` | 2 checklist |

```html
<!-- Atom examples -->
<span class="w-text w-text--display">Minimal Modern</span>
<span class="w-text w-text--meta">Based on 12 items</span>
<span class="w-badge">Clean lines</span>
<span class="w-badge w-badge--filled">67%</span>
<div class="w-bar" style="--fill: 67%"></div>
<button class="w-icon-btn w-icon-btn--refresh">⟳</button>
<div class="w-divider"></div>
<div class="w-divider w-divider--labeled">vs</div>
<label class="w-checkbox"><input type="checkbox"> Item</label>
```

### Molecules (7 components)

Atoms composed into recognizable patterns.

#### `w-headline`
Title + optional subtitle + optional attribution. Used in verdict body layouts.

```html
<div class="w-headline">
  <span class="w-text w-text--display">Split Personality</span>
  <span class="w-text w-text--meta">Home vs. Wardrobe aesthetic</span>
</div>
```
**Used by**: 8 verdict widgets (#3, 17, 18, 19, 20, 29, 39 + all hero-card)

#### `w-tag-group`
Row of badges. Wraps on overflow.

```html
<div class="w-tag-group">
  <span class="w-badge">Monochrome</span>
  <span class="w-badge">Texture</span>
  <span class="w-badge">Clean lines</span>
</div>
```
**Used by**: 8 verdict widgets, standalone in several list/stat widgets

#### `w-stat`
Large value + label + optional bar. The numeric building block.

```html
<div class="w-stat">
  <span class="w-text w-text--value">47</span>
  <span class="w-text w-text--label">Backlog</span>
  <div class="w-bar" style="--fill: 80%"></div>
</div>
```
**Used by**: 6 stat widgets (#9, 13, 16, 25, 27, 32), checklist totals (#10, 21)

#### `w-row`
A single item in a list. Icon/indicator + content + optional trailing action. The most reused molecule.

```html
<div class="w-row">
  <span class="w-row__indicator">🔴</span>
  <div class="w-row__content">
    <span class="w-text w-text--title">White Lotus S3</span>
    <span class="w-text w-text--meta">3 days away</span>
  </div>
  <button class="w-icon-btn w-icon-btn--expand">→</button>
</div>
```
**Used by**: 8 list widgets, 3 split widgets (inside columns), 2 checklist, 1 suggestion, 1 grouped

#### `w-axis`
A labeled horizontal bar for spectrum visualizations. Left label + bar + right label + optional note.

```html
<div class="w-axis">
  <span class="w-text w-text--label">Light</span>
  <div class="w-bar" style="--fill: 60%"></div>
  <span class="w-text w-text--label">Heavy</span>
  <span class="w-text w-text--note">You're 60% toward heavy</span>
</div>
```
**Used by**: 6 spectrum widgets (#15, 24, 28, 31, 37)

#### `w-option`
A selectable card for choice/comparison layouts. Title + meta + description + optional action.

```html
<div class="w-option">
  <span class="w-text w-text--title">Floral skirt + Hiking boots</span>
  <span class="w-text w-text--meta">"Rugged Feminine"</span>
  <button class="w-btn w-btn--sm">I'd wear this</button>
</div>
```
**Used by**: 2 pick-one (#1, 23), 2 swap (#26, 35)

#### `w-section`
A labeled group of rows. Section header + child rows. For grouped/bundled layouts.

```html
<div class="w-section">
  <span class="w-text w-text--label">☀️ Morning</span>
  <div class="w-row">...</div>
  <div class="w-row">...</div>
</div>
```
**Used by**: 1 bundle (#33), can be reused in any list that needs grouping

### Body Layouts (11 types)

Each is a modifier on `w-body` that determines how molecules are arranged inside it. Every template maps to exactly one layout.

#### `w-body--verdict` → hero-card template (8 widgets)

```
┌─────────────────────────────┐
│                             │
│   w-headline                │
│     w-text--display         │
│     w-text--meta            │
│                             │
│   w-tag-group               │
│     w-badge × N             │
│                             │
└─────────────────────────────┘
```

Widgets: #3 Persuade, #17 Conflict, #18 Pattern Reveal, #19 Predict, #20 Archaeologist, #29 Bridge, #39 Cluster

#### `w-body--list` → list template (8 widgets)

```
┌─────────────────────────────┐
│ w-row                       │
│   indicator | title | meta  │
│ w-row                       │
│   indicator | title | meta  │
│ w-row                       │
│   indicator | title | meta  │
└─────────────────────────────┘
```

Widgets: #6 Sequence, #8 Decay, #11 Curator, #12 Dependency Map, #14 Collision, #30 Graduate, #36 Ladder, #40 Deadline

#### `w-body--stats` → stat-row template (6 widgets)

```
┌─────────────────────────────┐
│  w-stat    w-stat    w-stat │
│   47        3/wk     15wk  │
│  backlog   reading  behind  │
│  ████░░    ██░░░░   ████░░ │
└─────────────────────────────┘
```

Widgets: #9 Calculate, #13 Redundancy, #16 Backlog, #25 Expire, #27 Pace, #32 Portion

#### `w-body--spectrum` → spectrum template (6 widgets)

```
┌─────────────────────────────┐
│ w-axis                      │
│   Spring ████░░░░░░  40%    │
│ w-axis                      │
│   Summer ██████████  100%   │
│ w-axis                      │
│   Fall   ██░░░░░░░░  20%   │
└─────────────────────────────┘
```

Widgets: #15 Behavior, #24 Audit, #28 Mood, #31 Season, #37 Drift

#### `w-body--split` → grid-split template (3 widgets)

```
┌──────────────┬──────────────┐
│ w-column     │ w-column     │
│  w-text--lbl │  w-text--lbl │
│  w-row       │  w-row       │
│  w-row       │  w-row       │
│  w-row       │  w-row       │
└──────────────┴──────────────┘
```

Widgets: #2 Gap Analysis, #7 Assign, #22 Translate

#### `w-body--narrative` → text-block template (3 widgets)

```
┌─────────────────────────────┐
│ w-text--prose               │
│                             │
│ Paragraph of insight text   │
│ with inline emphasis and    │
│ indented hierarchy.         │
│                             │
│   └→ sub-point              │
│       └→ deeper point       │
└─────────────────────────────┘
```

Widgets: #4 Synthesize, #34 Proxy, #38 Contradict

#### `w-body--comparison` → swap template (2 widgets)

```
┌────────────┐     ┌────────────┐
│ w-option   │     │ w-option   │
│  title     │ vs  │  title     │
│  meta      │     │  meta      │
│  [action]  │     │  [action]  │
└────────────┘     └────────────┘
  w-divider--labeled
```

Widgets: #26 Compare, #35 Substitute

#### `w-body--choices` → pick-one template (2 widgets)

```
┌─────────────────────────────┐
│ w-option (A)                │
│   title + description       │
│   [Select]                  │
│ ─────────────────────────── │
│ w-option (B)                │
│   title + description       │
│   [Select]                  │
└─────────────────────────────┘
```

Widgets: #1 Decide, #23 Remix

#### `w-body--checklist` → commit-list template (2 widgets)

```
┌─────────────────────────────┐
│ w-row + w-checkbox          │
│   ☑ Mon: Tacos El Gordo $15│
│ w-row + w-checkbox          │
│   ☑ Wed: Sugarfish     $45 │
│ w-row + w-checkbox          │
│   ☐ Fri: Bestia        $65 │
│ w-divider                   │
│ w-stat (total: $60 / $150) │
└─────────────────────────────┘
```

Widgets: #10 Assemble, #21 Negotiate

#### `w-body--suggestion` → quick-add template (1 widget)

```
┌─────────────────────────────┐
│ w-row (featured, larger)    │
│   Title                     │
│   Brand · $price            │
│   w-text--note (reason)     │
└─────────────────────────────┘
```

Widget: #5 Gap Analysis (use)

#### `w-body--grouped` → bundle template (1 widget)

```
┌─────────────────────────────┐
│ w-section (☀️ Morning)      │
│   w-row: Morning Brew       │
│   w-row: Huberman podcast   │
│                             │
│ w-section (🌙 Evening)      │
│   w-row: Letterboxd pick    │
│   w-row: Substack digest    │
└─────────────────────────────┘
```

Widget: #33 Ritual

### Full Component Count

| Layer | Components | Description |
|-------|-----------|-------------|
| Shell | 1 | `w-shell` (constant wrapper) |
| Structure | 3 | `w-header`, `w-body`, `w-footer` |
| Atoms | 6 | `w-text`, `w-badge`, `w-bar`, `w-icon-btn`, `w-divider`, `w-checkbox` |
| Molecules | 7 | `w-headline`, `w-tag-group`, `w-stat`, `w-row`, `w-axis`, `w-option`, `w-section` |
| Layouts | 11 | Body layout modifiers |
| **Total** | **28** | 17 unique components + 11 layout modifiers |

### Widget → Component Mapping

Every widget fully described as a component composition.

| # | Widget | Layout | Body contains |
|---|--------|--------|---------------|
| 1 | Decide | choices | `w-option × 2-3` each with `w-text--title` + `w-text--meta` + `w-btn` |
| 2 | Gap Analysis (home) | split | `w-column × 2`, left has `w-row × N` (user items), right has `w-row × N` (suggestions) |
| 3 | Persuade | verdict | `w-headline` (`--display`: pitch text, `--meta`: show title) + `w-tag-group` (genre tags) |
| 4 | Synthesize | narrative | `w-text--prose` with indented hierarchy showing thread across articles |
| 5 | Gap Analysis (use) | suggestion | `w-row` (featured) with `w-text--title` + `w-text--meta` + `w-text--note` (reason) |
| 6 | Sequence | list | `w-row × N` with `w-row__indicator` (step number) + title (destination) + meta (duration) |
| 7 | Assign | split | `w-column` (items) + `w-column` (people), rows connected by assignment |
| 8 | Decay | list | `w-row × N` with `w-row__indicator` (⚠️/🔴 urgency) + title (creator) + meta (days since) |
| 9 | Calculate | stats | `w-stat × 3`: total value, item count, avg price. Optional `w-bar` per stat |
| 10 | Assemble | checklist | `w-row × N` each with `w-checkbox` + title (task) + meta (source item), `w-stat` (completion %) |
| 11 | Curator | list | `w-row × N` with `w-row__indicator` (energy emoji) + title (track/pod) + meta (duration) |
| 12 | Dependency Map | list | `w-row × N` with `w-row__indicator` (→ chain) + title (topic) + meta (prerequisite) |
| 13 | Redundancy | stats | `w-stat × 3-4`: per garment type (e.g., "3 hoodies", "2 white tees", "4 sneakers") |
| 14 | Collision | list | `w-row × N` with `w-row__indicator` (⚠️) + title (event) + meta (conflicting date) |
| 15 | Behavior | spectrum | `w-axis × 4-6`: one per category, bar fill = save density, note = trend direction |
| 16 | Backlog | stats | `w-stat × 3`: total items, estimated read time, weeks behind |
| 17 | Conflict | verdict | `w-headline` (`--display`: "Style Clash", `--meta`: explanation) + `w-tag-group` (clashing traits) |
| 18 | Pattern Reveal | verdict | `w-headline` (`--display`: job title inference, `--meta`: evidence) + `w-tag-group` (signals) |
| 19 | Predict | verdict | `w-headline` (`--display`: predicted next save, `--meta`: confidence) + `w-tag-group` (pattern) |
| 20 | Archaeologist | verdict | `w-headline` (`--display`: item title, `--meta`: "Saved 90 days ago") + `w-tag-group` (why forgotten) |
| 21 | Negotiate | checklist | `w-row × N` each with `w-checkbox` + title (restaurant) + meta (est. price), `w-stat` (running total / budget) |
| 22 | Translate | split | `w-column` (your sources) + `w-column` (international, each `w-row__indicator` = flag emoji) |
| 23 | Remix | choices | `w-option × 2`: each shows pairing label + `w-text--meta` (style name) + "I'd wear this" btn |
| 24 | Audit | spectrum | `w-axis × N`: one per topic, dots/fills show creator overlap, note = creator names |
| 25 | Expire | stats | `w-stat × 3`: alive count, dead count, moved count. Below: `w-row × N` (dead links) |
| 26 | Compare | comparison | `w-option` (your tool) + `w-divider--labeled` ("vs") + `w-option` (alternative) |
| 27 | Pace | stats | `w-stat × 3`: save rate, read rate, backlog size. Below: `w-text--note` (weeks behind) |
| 28 | Mood | spectrum | `w-axis × 1`: "Light → Heavy" with items plotted as fill, note = dominant genre |
| 29 | Bridge | verdict | `w-headline` (`--display`: coherence label, `--meta`: home vs wear) + `w-tag-group` (overlap/tension) |
| 30 | Graduate | list | `w-row × N` with `w-row__indicator` (✓/→/○ progression) + title (skill level) + meta (save count + date range) |
| 31 | Season | spectrum | `w-axis × 4`: Spring/Summer/Fall/Winter, bar fill = save density |
| 32 | Portion | stats | `w-stat × N` per cuisine: value = percentage, label = cuisine name, `w-bar` = proportion |
| 33 | Ritual | grouped | `w-section × 2-3` (Morning/Afternoon/Evening), each containing `w-row × N` (items with category badge) |
| 34 | Proxy | narrative | `w-text--prose` with indented tree showing influence chain (Creator A → B → C) |
| 35 | Substitute | comparison | `w-option` (original) + `w-divider--labeled` ("vibes as") + `w-option` (alt), shared `w-text--note` (common traits) |
| 36 | Ladder | list | `w-row × 3` with `w-row__indicator` (tier: $/$$/$$) + title (product) + meta (price + differentiator) |
| 37 | Drift | spectrum | `w-axis × N` per category: dual bars (then vs now), note = direction of change |
| 38 | Contradict | narrative | `w-text--prose` with setup → reveal → reaction structure. Two `w-badge` inline (contradicting themes) |
| 39 | Cluster | verdict | `w-headline` (`--display`: neighborhood name, `--meta`: item count + radius) + `w-tag-group` (item types) |
| 40 | Deadline | list | `w-row × N` with `w-row__indicator` (🔴/🟡/⚪ urgency color) + title (show) + meta (days remaining) |

### Reuse Frequency

Components ranked by how many of the 40 widgets use them:

| Component | Widgets | % of 40 |
|-----------|---------|---------|
| `w-shell` | 40 | 100% |
| `w-header` | 40 | 100% |
| `w-footer` + `w-action-bar` | 40 | 100% |
| `w-text` | 40 | 100% |
| `w-btn` | 40 | 100% |
| `w-icon-btn` | 40 | 100% |
| `w-row` | 24 | 60% |
| `w-badge` | 10 | 25% |
| `w-stat` | 10 | 25% |
| `w-bar` | 12 | 30% |
| `w-headline` | 8 | 20% |
| `w-tag-group` | 8 | 20% |
| `w-axis` | 6 | 15% |
| `w-option` | 4 | 10% |
| `w-divider` | 7 | 18% |
| `w-checkbox` | 2 | 5% |
| `w-section` | 1 | 3% |

### CSS Architecture

Components use BEM naming consistent with the existing design system. All widget components use design tokens from `tokens.css`.

```css
/* Shell (constant) */
.w-shell { }
.w-header { display: flex; align-items: center; gap: var(--space-2); padding: var(--space-2) 0; }
.w-body { border: var(--border-thin) solid var(--border-subtle); background: var(--bg-surface); padding: var(--space-4); }
.w-footer { padding: var(--space-2) 0; }

/* Body layout modifiers */
.w-body--verdict { text-align: center; }
.w-body--list { display: flex; flex-direction: column; gap: var(--space-2); }
.w-body--stats { display: flex; justify-content: space-around; text-align: center; }
.w-body--spectrum { display: flex; flex-direction: column; gap: var(--space-3); }
.w-body--split { display: grid; grid-template-columns: 1fr auto 1fr; }
.w-body--narrative { }
.w-body--comparison { display: grid; grid-template-columns: 1fr auto 1fr; align-items: start; }
.w-body--choices { display: flex; flex-direction: column; gap: var(--space-3); }
.w-body--checklist { display: flex; flex-direction: column; gap: var(--space-2); }
.w-body--suggestion { }
.w-body--grouped { display: flex; flex-direction: column; gap: var(--space-4); }

/* Atoms */
.w-text { font-family: var(--font-primary); }
.w-text--display { font-family: var(--font-serif); font-size: var(--text-3xl); }
.w-text--title { font-size: var(--text-lg); text-transform: uppercase; letter-spacing: var(--tracking-wide); }
.w-text--meta { font-size: var(--text-xs); color: var(--fg-muted); }
.w-text--value { font-size: var(--text-2xl); font-family: var(--font-primary); }
.w-text--label { font-size: var(--text-xs); text-transform: uppercase; color: var(--fg-muted); letter-spacing: var(--tracking-wider); }
.w-text--note { font-size: var(--text-xs); font-style: italic; color: var(--fg-muted); }
.w-text--prose { font-size: var(--text-lg); line-height: var(--leading-relaxed); }

.w-badge { /* extends .token from design system */ }
.w-bar { height: 4px; background: var(--border-subtle); }
.w-bar__fill { height: 100%; background: var(--fg); width: var(--fill); }
.w-divider { border-top: var(--border-thin) solid var(--border-subtle); }
.w-divider--vertical { border-left: var(--border-thin) solid var(--border-subtle); border-top: none; }
.w-divider--labeled { /* text centered in divider line */ }
.w-checkbox { /* styled checkbox */ }

/* Molecules */
.w-headline { display: flex; flex-direction: column; gap: var(--space-2); }
.w-tag-group { display: flex; flex-wrap: wrap; gap: var(--space-1); }
.w-stat { display: flex; flex-direction: column; align-items: center; gap: var(--space-1); }
.w-row { display: flex; align-items: center; gap: var(--space-3); }
.w-row__indicator { flex-shrink: 0; width: 20px; text-align: center; }
.w-row__content { flex: 1; min-width: 0; }
.w-axis { display: grid; grid-template-columns: auto 1fr auto; gap: var(--space-2); align-items: center; }
.w-option { border: var(--border-thin) solid var(--border-subtle); padding: var(--space-3); }
.w-section { display: flex; flex-direction: column; gap: var(--space-2); }
.w-action-bar { display: flex; gap: var(--space-2); }
```

### Migration from `widget-complete`

The existing `widget-complete` maps directly to the new system:

| Old | New | Notes |
|-----|-----|-------|
| `.widget-complete` | `.w-shell` | Same wrapper |
| `.widget-complete__header` | `.w-header` | Same structure |
| `.widget-complete__header-left` | (removed) | Flex handles alignment |
| `.widget-complete__title` | `.w-title` → `w-text--label` | Uses atom |
| `.widget-complete__badge` | `.w-badge` | Uses atom |
| `.widget-complete__refresh-btn` | `.w-icon-btn--refresh` | Uses atom |
| `.widget-complete__body` | `.w-body` + layout modifier | Body always has a layout |
| `.widget-complete__body--grid-split` | `.w-body--split` | Named for content, not CSS |
| `.widget-style__label` | `.w-text--display` | Generic atom |
| `.widget-style__sublabel` | `.w-text--meta` | Generic atom |
| `.widget-style__trait` | `.w-badge` | Generic atom |
| `.widget-style__traits` | `.w-tag-group` | Generic molecule |

---

## Widget Catalog: 40 Use Cases

Every widget has a **job** (what it does), a **trigger** (when it appears), and a **shape** (which template renders it). Triggers are the eligibility rules that determine when a widget earns its screen space.

### Trigger Legend

| Symbol | Meaning |
|--------|---------|
| `n+ items` | Minimum item count in category |
| `n+ types` | Items span multiple sub-types (garment, cuisine, genre, etc.) |
| `cross:` | Requires items in multiple categories |
| `time:` | Requires save history over a time period |
| `stale:` | Items saved N+ days ago with no interaction |

---

### Working Table

| # | Category | Job | Question | Trigger | Shape | Data Sources |
|---|----------|-----|----------|---------|-------|-------------|
| 1 | eat | Decide | "Pick one restaurant for tonight" | 3+ restaurants saved | pick-one | title, domain |
| 2 | home | Gap Analysis | "What's missing from this room?" | 5+ items in same inferred style | grid-split | title, domain, image |
| 3 | watch | Persuade | "Why should I press play on this?" | 3+ saves stale: 14+ days | hero-card | title, domain, **last_interacted_at** |
| 4 | read | Synthesize | "What's the hidden thread?" | 4+ articles in same inferred topic | text-block | title, url, domain |
| 5 | use | Gap Analysis | "What's the hole in your workflow?" | 3+ tools in same inferred workflow | quick-add | title, domain |
| 6 | go | Sequence | "Route these into a trip" | 3+ destinations in same region | list | title, url, domain |
| 7 | gift | Assign | "Who gets what?" | 5+ items + 2+ people in follow | grid-split | title, domain, follow items |
| 8 | follow | Decay | "Who are you ignoring?" | stale: 30+ days on any followed creator | list | title, domain, **last_interacted_at** |
| 9 | spend (cross) | Calculate | "What's your wishlist total?" | cross: 5+ items with price-inferrable titles | stat-row | title (price inference), domain |
| 10 | make | Assemble | "Build a project plan from your saves" | 4+ items that form a project (tools + materials) | commit-list | title, url, domain |
| 11 | listen | Curator | "Build a listening session arc" | 5+ music/podcast saves | list | title, domain |
| 12 | learn | Dependency Map | "What do you need to learn first?" | 3+ learning resources in same topic | list | title, url, domain |
| 13 | wear | Redundancy | "You already own three of these" | 3+ items in same garment type | stat-row | title, domain, **sub-type** |
| 14 | events | Collision | "These dates conflict" | 2+ events with overlapping dates | list | title (date inference) |
| 15 | all | Behavior | "Your saving pattern this month" | time: 10+ saves across 2+ months | spectrum | title, category, **created_at** |
| 16 | read | Backlog | "How long to read all of this?" | 5+ unread articles | stat-row | title, domain, **article length** |
| 17 | home | Conflict | "These styles clash" | 3+ items from conflicting inferred styles | hero-card | title, domain |
| 18 | work | Pattern Reveal | "The job you're circling" | 5+ job/company/tool saves | hero-card | title, domain |
| 19 | all | Predict | "What you'll save next" | time: 15+ saves with clear category trend | hero-card | title, category, **created_at** |
| 20 | all | Archaeologist | "Your oldest forgotten save" | stale: 60+ days, no interaction | hero-card | title, url, **last_interacted_at** |
| 21 | eat | Negotiate | "Build a dining week on budget" | 3+ restaurants with price-inferrable names | commit-list | title, domain, **budget input** |
| 22 | read | Translate | "The international angle you're missing" | 4+ articles from same-language sources | grid-split | title, url, domain |
| 23 | wear | Remix | "Unexpected outfit pairings" | 4+ items across 2+ garment types | pick-one | title, domain, **sub-type** |
| 24 | follow | Audit | "Your feed has redundancy" | 3+ creators in same inferred niche | spectrum | title, domain |
| 25 | all | Expire | "These links are dead" | 10+ saves stale: 30+ days | stat-row | url, **link health**, **last_interacted_at** |
| 26 | use | Compare | "Have you considered the alternative?" | 1+ tool saved with known competitors | swap | title, domain |
| 27 | read | Pace | "You're saving faster than reading" | time: 5+ saves in last 14 days | stat-row | title, **created_at**, **article length** |
| 28 | watch | Mood | "Your watchlist emotional arc" | 4+ titles with inferrable genre | spectrum | title, domain, **genre sub-type** |
| 29 | home + wear (cross) | Bridge | "Do your spaces match your clothes?" | cross: 3+ items in home AND 3+ in wear | hero-card | title, domain (both categories) |
| 30 | learn | Graduate | "Your skill level is climbing" | time: 3+ saves in same topic across 2+ months | list | title, domain, **created_at** |
| 31 | wear | Season | "You have a seasonal blind spot" | 5+ items skewed to 1-2 seasons | spectrum | title, domain, **seasonal sub-type** |
| 32 | eat | Portion | "Your cuisine diversity" | 4+ restaurants with inferrable cuisine type | stat-row | title, domain, **cuisine sub-type** |
| 33 | all (cross) | Ritual | "Bundle saves into a daily routine" | cross: items across 3+ categories | bundle | title, domain, category |
| 34 | follow | Proxy | "The influence chain you're in" | 3+ creators in same domain | text-block | title, domain |
| 35 | eat | Substitute | "Same vibe, different diet" | 1+ restaurant saved | swap | title, domain |
| 36 | home | Ladder | "Good / better / best" | 1+ item with price-inferrable title | list | title, domain |
| 37 | all | Drift | "How your taste is evolving" | time: 10+ saves across 3+ months | spectrum | title, category, **created_at** |
| 38 | all (cross) | Contradict | "You're saying two different things" | cross: items from opposing themes detected | text-block | title, category, domain |
| 39 | go | Cluster | "You're orbiting a neighborhood" | 3+ places in same inferred city/area | hero-card | title, url, domain, **geo inference** |
| 40 | watch | Deadline | "Upcoming releases from your saves" | 2+ TV shows saved with active/upcoming seasons | list | title, domain, **release dates (TMDB)** |
| 41 | all | Discover | "More like your board" | 3+ items in any single category | suggestion | title, domain, category |

---

### Category Coverage Summary

| Category | Widget Count | Jobs |
|----------|-------------|------|
| **eat** | 5 | Decide, Negotiate, Portion, Substitute, (cross: Ritual) |
| **home** | 4 | Gap Analysis, Conflict, Ladder, (cross: Bridge) |
| **watch** | 4 | Persuade, Mood, Deadline, (cross: Ritual) |
| **read** | 5 | Synthesize, Backlog, Translate, Pace, (cross: Ritual) |
| **use** | 3 | Gap Analysis, Compare, (cross: Ritual) |
| **go** | 2 | Sequence, Cluster |
| **wear** | 4 | Redundancy, Remix, Season, (cross: Bridge) |
| **follow** | 3 | Decay, Audit, Proxy |
| **learn** | 2 | Dependency Map, Graduate |
| **listen** | 1 | Curator |
| **work** | 1 | Pattern Reveal |
| **events** | 1 | Collision |
| **gift** | 1 | Assign |
| **make** | 1 | Assemble |
| **spend** | 1 | Calculate |
| **all / cross** | 8 | Behavior, Predict, Archaeologist, Expire, Drift, Ritual, Contradict, **Discover** |

### Template Usage Summary

| Template | Widget Count | Notes |
|----------|-------------|-------|
| hero-card | 8 | Identity reflection, single-verdict widgets |
| list | 8 | Sequential, ranked, or time-ordered content |
| stat-row | 6 | Numeric dashboards, proportions, counts |
| spectrum | 6 | Proportional, mood, density, drift visualizations |
| grid-split | 3 | Side-by-side comparison |
| text-block | 3 | Narrative insights, influence chains |
| swap | 2 | A/B direct comparison |
| pick-one | 2 | Binary choice with feedback loop |
| commit-list | 2 | Accumulator lists with running totals |
| quick-add | 1 | Single suggestion with add action |
| suggestion | 1 | AI recommendations with reasoning (#41 Discover) |
| bundle | 1 | Grouped items as a set |

---

### Trigger Implementation Notes

**Simple triggers** (item count + category filter):
- Widgets 1–6, 8, 11–14, 16, 21, 23, 26, 30, 32, 34–36, 39–40
- Can be evaluated client-side from `links[]` array

**Time-based triggers** (require save date comparison):
- Widgets 15, 19, 27, 30, 37
- Need `created_at` or `saved_at` timestamp on items

**Staleness triggers** (require last-interaction tracking):
- Widgets 3, 8, 20, 25
- Need interaction history or "last viewed" timestamp (not currently stored)

**Cross-category triggers** (require items in multiple categories):
- Widgets 7, 9, 29, 33, 38
- Must evaluate across category boundaries

**Inference triggers** (require AI to determine eligibility):
- Widgets 2, 5, 17, 18, 24, 28, 31, 38
- Style clash detection, workflow inference, niche detection
- More expensive — may need server-side eligibility check

---

## Data Gaps & Technical Blockers

Every widget depends on data. Some data exists, some can be inferred by AI, some doesn't exist at all. This section maps what's missing.

### Data Source Matrix

| Data needed | Status | Widgets affected | Resolution |
|-------------|--------|-----------------|------------|
| **title, url, domain, image** | ✅ Available | All 40 | Existing item schema |
| **category** | ✅ Available | All 40 | Existing field (8 values) |
| **description** | ⚠️ Often empty | #4, 34, 38 (narrative) | AI infers from title + domain |
| **created_at / saved_at** | ❓ Verify | #15, 19, 27, 30, 37 (5 widgets) | Check Supabase schema; add migration if missing |
| **last_interacted_at** | ❌ Missing | #3, 8, 20, 25 (4 widgets) | New column + client-side event tracking |
| **price** | ❌ Missing | #9, 21, 36 (3 widgets) | AI infers from title/domain; unreliable |
| **sub-type classification** | ❌ Missing | #13, 23, 28, 31, 32 (5 widgets) | Garment type, cuisine, genre — need classification pipeline |
| **geographic location** | ❌ Missing | #6, 39 (2 widgets) | AI infers from title/domain; no structured geo field |
| **person/creator entity** | ❌ Missing | #7, 34 (2 widgets) | No person model; AI guesses from follow items |
| **release dates** | ❌ Missing | #40 (1 widget) | Requires external API (TMDB, etc.) |
| **link health (alive/dead)** | ❌ Missing | #25 (1 widget) | Requires HTTP HEAD checks on saved URLs |
| **article length / read time** | ❌ Missing | #16, 27 (2 widgets) | Requires fetching article metadata or estimating from domain |
| **event dates** | ❌ Missing | #14 (1 widget) | No date field on items; AI infers from title |
| **new categories in UI** | ❌ Missing | #7, 9, 10, 11, 12, 14, 18 (7 widgets) | gift, spend, make, listen, learn, events, work not in filter bar |

### Technical Blockers

| Blocker | Impact | Widgets blocked | Resolution | Priority |
|---------|--------|----------------|------------|----------|
| **No sub-type classifier** | Can't distinguish hoodie from sneaker, comedy from thriller, Italian from Thai | #13, 23, 28, 31, 32 | Solved by dynamic AI categories: `tags[]` array provides sub-type (see "Dynamic AI-Evaluated Categories") | High — blocks 5 widgets |
| **No cross-category query** | Current eligibility filters by single category; cross-category widgets need all items | #7, 9, 29, 33, 38 | Update discovery endpoint to accept `category: 'all'` or `categories: [...]` | Medium — blocks 5 widgets |
| **No interaction tracking** | Can't measure staleness without `last_interacted_at` | #3, 8, 20, 25 | Schema migration + click/view tracking integration | Medium — blocks 4 widgets |
| **Inference-based eligibility is expensive** | AI call needed BEFORE generation to determine if widget should render (e.g., "do these styles clash?") | #2, 5, 17, 24, 31 | Two-pass system: lightweight inference → eligibility → full generation | Low — defer to Phase 6 |
| **New categories not in data model** | 7 new categories (gift, spend, make, listen, learn, events, work) don't exist in category enum or filter UI | #7, 9, 10, 11, 12, 14, 18 | Dynamic AI categories: AI assigns category on save, filter bar renders dynamically (see "Dynamic AI-Evaluated Categories") | High — blocks 7 widgets |
| **External API dependency** | Deadline (#40) needs TMDB; Expire (#25) needs link-checking infra | #25, 40 | Add API keys to edge function env; build link-checker cron job | Low — defer |
| **Budget input** | Negotiate (#21) optimizes against a budget, but no way for user to set one | #21 | Add budget parameter to widget config or prompt user inline | Low — defer |
| **handleQuickAdd cache key bug** | Action widgets that use quick-add template will silently fail | #5 | Fix: align getCacheKey call with cache storage key (include refresh counter) | High — blocks action Tier 3 |

### What Can Ship Without Any New Data

These widgets use ONLY title + url + domain + category (data that already exists):

| # | Widget | Why it works with existing data |
|---|--------|-------------------------------|
| 1 | Decide (eat) | AI picks from restaurant names |
| 4 | Synthesize (read) | AI finds thread across article titles |
| 6 | Sequence (go) | AI routes from destination names |
| 26 | Compare (use) | AI identifies tool category from title + domain |
| 34 | Proxy (follow) | AI infers relationships from creator names/platforms |
| 35 | Substitute (eat) | AI infers vibe from restaurant name + domain |
| 36 | Ladder (home) | AI infers product type + suggests price tiers |
| 41 | Discover (all) | AI recommends similar items from saved titles + domains |

**These 8 widgets can ship immediately** — no schema changes, no new APIs, no new data. Just AI prompt + existing item data.

**Priority order**: #40 (Upcoming Releases) and #41 (More Like Your Board) ship first — user-validated high-value widgets.

### What Needs One Prerequisite

| Prerequisite | Widgets unlocked | Effort |
|-------------|-----------------|--------|
| Verify `created_at` exists | #15, 19, 27, 30, 37 (5 widgets) | Check schema — likely already there |
| Add `last_interacted_at` | #3, 8, 20, 25 (4 widgets) | Schema migration + 3 event hooks |
| Extend category enum | #7, 9, 10, 11, 12, 14, 18 (7 widgets) | Filter bar update + category mapping |
| Fix handleQuickAdd cache bug | #5 + all action widgets (4 widgets) | 1 line fix in boards/index.html |

---

## What We're NOT Building (Yet)

- Widget marketplace or discovery UI
- User-created custom widgets
- Real-time collaborative widgets
- External API integrations (TMDB, link-checking) — noted in catalog but deferred
- Sub-type classification pipeline — needed for 5 widgets but requires extending Epic 3.1
- Budget input mechanism — needed for Negotiate widget only

---

## Success Metrics

| Metric | Target |
|--------|--------|
| Widget renders without error | 100% of page loads where items ≥ minItems |
| Suppression rate (low confidence) | < 20% |
| User clicks refresh | > 0 per session (engagement signal) |
| Categories with working widget | 8 of 8 |

---

## Technical Notes

### What's already built (keep)
- Template selection engine (`WIDGET_TEMPLATES` + `renderWidgetWithTemplate`)
- Server-side eligibility engine (`config/registry.ts`)
- Discovery endpoint (server-driven widget selection with local fallback)
- Confidence scoring + suppression
- Widget instrumentation (view/click/refresh/dismiss tracking)
- Hot-reload registry

### What's already built (validate before using)
- `spectrum` template — built, never rendered
- `stat-row` template — built, never rendered
- `quick-add` template + `handleQuickAdd` — built, cache key bug
- `price-radar` widget config — deployed, never triggered
- `collection-stats` widget config — deployed, never triggered
- `gap-filler` widget config — deployed, never triggered

### What needs to happen for each new category widget
1. Create `config/widgets/<category>-profile.ts` (server config, ~60 lines)
2. Add frontend `WIDGET_REGISTRY` entry (prompt + template mapping)
3. Deploy edge function
4. Test with real items

No new templates needed. Hero-card and list cover all 8 categories.
