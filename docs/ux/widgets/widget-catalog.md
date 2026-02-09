# Widget Catalog

**Date**: 2026-02-09
**Status**: Draft — awaiting prioritization review
**Source**: Persona definitions from `docs/ux/personas.md`, template research from `docs/ux/research/widget-template-patterns.md`

---

## Design Principles

### Every widget serves a user job, not a category

The 4 archetypes from research map to user jobs:

| Archetype | User Job | Template | Question it answers |
|-----------|----------|----------|---------------------|
| **Profiler** | Identity reflection | hero-card | "Who am I based on what I save?" |
| **Completer** | Gap discovery | grid-split | "What's missing from my collection?" |
| **Prioritizer** | Action ranking | list / checklist / choices | "What should I do next?" |
| **Analyzer** | Pattern measurement | spectrum / stat-row | "What do the numbers say?" |

### Every category gets all 4 archetypes

8 categories × 4 archetypes = 32 category-specific widgets.
Plus 8 cross-category widgets = **40 total**.

### Persona alignment drives priority

| Tier | Personas | Build order |
|------|----------|-------------|
| **P0** | Visual Collector, Sound & Scene Curator, DJ, Multidisciplinary Maker | First |
| **P1** | Deep-Dive Enthusiast, Researcher, Cultural Omnivore, Design Technologist | Second |
| **P2** | Student, Small Business Owner, Planner | Future |

---

## Personas Quick Reference

| # | Persona | Categories they use most | Key need |
|---|---------|--------------------------|----------|
| 1 | **Visual Collector** | wear, home, follow, read | Visual browsing, pattern surfacing, mood boards |
| 2 | **Sound & Scene Curator** | follow, go, use, watch | Cross-category connections, event+music+gear |
| 3 | **DJ** | follow, use, go | Track digging, set building, gig hunting |
| 4 | **Multidisciplinary Maker** | use, home, read | Materials+tools+references across domains |
| 5 | **Deep-Dive Enthusiast** | use, eat, read, wear | Obsessive comparison, "best of" curation |
| 6 | **Researcher** | read, follow, watch | Synthesis, trend spotting, evidence retrieval |
| 7 | **Cultural Omnivore** | watch, eat, go, follow, wear | Taste mapping, experience logging, cultural identity |
| 8 | **Design Technologist** | use, read, follow | Code+design references together, cross-domain work |

---

## Widget Catalog (40 widgets)

### PROFILERS — "Tell me who I am" (hero-card template)

| # | ID | Name | Category | Personas | Description |
|---|---|---|---|---|---|
| 1 | `style-summary` | Style Summary | wear | Visual Collector, Cultural Omnivore | "You are: Minimal Modern" + trait tags (neutral tones, clean lines) |
| 2 | `design-dna` | Design DNA | home | Maker, Visual Collector | "Your aesthetic: Japandi" + color/material tags |
| 3 | `viewer-profile` | Viewer Profile | watch | Cultural Omnivore, Deep-Dive | "Your taste: Atmospheric Slow Burns" + mood tags |
| 4 | `setup-profile` | Setup Profile | use | Design Tech, Maker | "Your stack: Creative Pro" + tool tags |
| 5 | `flavor-profile` | Flavor Profile | eat | Deep-Dive, Cultural Omnivore | "Your palate: Southeast Asian Fusion" + flavor tags |
| 6 | `traveler-type` | Traveler Type | go | Cultural Omnivore, Sound & Scene | "You are: Cultural Flaneur" + vibe tags |
| 7 | `fan-profile` | Fan Profile | follow | Sound & Scene, DJ, Cultural Omnivore | "Your feed: Experimental Audio + Visual Art" + interest tags |
| 8 | `reader-identity` | Reader Identity | read | Researcher, Design Tech | "You are: Systems Thinker" + genre/topic tags |

### COMPLETERS — "Fill my gaps" (grid-split template)

| # | ID | Name | Category | Personas | Description |
|---|---|---|---|---|---|
| 9 | `complete-the-look` | Complete the Look | wear | Visual Collector, Cultural Omnivore | Your items + AI-suggested complements |
| 10 | `room-completer` | Room Completer | home | Maker, Visual Collector | Your saved pieces + what's missing from the room |
| 11 | `double-feature` | Double Feature | watch | Cultural Omnivore, Deep-Dive | Your saved film + AI-paired companion pick |
| 12 | `tool-compare` | Tool Compare | use | Maker, Design Tech | Your tools vs. AI-suggested alternatives |
| 13 | `meal-pairing` | Meal Pairing | eat | Deep-Dive, Cultural Omnivore | Your saved dishes + complementary recipes |
| 14 | `trip-builder` | Trip Builder | go | Cultural Omnivore, Sound & Scene | Your saved spots + AI-suggested connectors |
| 15 | `creator-mix` | Creator Mix | follow | Sound & Scene, DJ, Visual Collector | Your follows + similar creators you're missing |
| 16 | `reading-pairs` | Reading Pairs | read | Researcher, Deep-Dive | "If you liked X, try Y" — paired recommendations |

### PRIORITIZERS — "What to do next" (list / checklist / choices templates)

| # | ID | Name | Category | Template | Personas | Description |
|---|---|---|---|---|---|---|
| 17 | `wardrobe-gaps` | Wardrobe Gaps | wear | list | Visual Collector | Ranked missing categories (no boots, no outerwear...) |
| 18 | `sourcing-list` | Sourcing List | home | list | Maker, Visual Collector | Prioritized items to actually buy next |
| 19 | `watchlist-priority` | Watchlist Priority | watch | list | Cultural Omnivore, Deep-Dive | Ranked by "you'll regret skipping this" |
| 20 | `upgrade-path` | Upgrade Path | use | list | Design Tech, Deep-Dive | Prioritized next purchases by impact |
| 21 | `what-to-eat` | What to Eat | eat | choices | Deep-Dive, Cultural Omnivore | AI surfaces top options — pick one |
| 22 | `packing-list` | Packing List | go | checklist | Cultural Omnivore | Context-aware checklist for saved destinations |
| 23 | `follow-next` | Follow Next | follow | list | Sound & Scene, DJ | Accounts you'd love based on your follow graph |
| 24 | `up-next` | Up Next | read | list | Researcher, Deep-Dive | AI-ranked reading order by relevance + momentum |

### ANALYZERS — "Show me the numbers" (spectrum / stat-row templates)

| # | ID | Name | Category | Template | Personas | Description |
|---|---|---|---|---|---|---|
| 25 | `price-radar` | Price Radar | wear | spectrum | Deep-Dive, Visual Collector | Budget ←——*——→ Luxury across your collection |
| 26 | `palette-analysis` | Palette Analysis | home | spectrum | Visual Collector, Maker | Warm ↔ Cool, Minimal ↔ Ornate |
| 27 | `taste-map` | Taste Map | watch | spectrum | Cultural Omnivore | Cerebral ↔ Visceral, Indie ↔ Studio |
| 28 | `ecosystem-score` | Ecosystem Score | use | stat-row | Design Tech, Maker | How integrated your tools are + gaps |
| 29 | `nutrition-snapshot` | Nutrition Snapshot | eat | stat-row | Deep-Dive | Macros, variety score, cuisine breadth |
| 30 | `trip-vitals` | Trip Vitals | go | stat-row | Cultural Omnivore | Days, budget, climate range, visa needs |
| 31 | `feed-balance` | Feed Balance | follow | spectrum | Sound & Scene, DJ | Serious ↔ Fun, Niche ↔ Broad |
| 32 | `reading-pulse` | Reading Pulse | read | stat-row | Researcher | Genre distribution, avg length, topics covered |

### CROSS-CATEGORY — serve multiple personas, category-agnostic

| # | ID | Name | Template | Zone | Personas | Description |
|---|---|---|---|---|---|---|
| 33 | `taste-dna` | Taste DNA | hero-card | hero | **ALL** | Universal profiler — "Based on 47 saves across 6 categories, you are: ___" |
| 34 | `cross-pollinate` | Cross-Pollinate | grid-split | hero | Sound & Scene, Maker, Design Tech | Unexpected connections — "Your eat + go saves overlap in: Japanese culture" |
| 35 | `collection-stats` | Collection Stats | stat-row | footer | **ALL** | Total saves, categories, domains, quality score |
| 36 | `board-overview` | Board Overview | grouped | footer | **ALL** | Recent saves grouped by category with highlights |
| 37 | `discover-more` | Discover More | quick-add | footer | **ALL** | One strong AI suggestion based on recent saves |
| 38 | `buy-list` | Buy List | checklist | inline | Deep-Dive, Visual Collector | Ready-to-buy checklist with prices + running total |
| 39 | `deep-dive` | Deep Dive | text-block | inline | Researcher, Cultural Omnivore | AI narrative analyzing patterns across your collection |
| 40 | `versus` | Versus | comparison | inline | Deep-Dive, Maker | Head-to-head: two items from your board, A vs B |

---

## Build Priority

### Wave 1: Profilers for every category
**Why first**: Every persona lists "taste/pattern surfacing" as critical. Profilers are the simplest widgets (one AI call, one template, pure read-only) and deliver immediate "wow" value.

| Widget | Category | Status |
|--------|----------|--------|
| `style-summary` | wear | **Shipped** |
| `taste-dna` | all | Build |
| `fan-profile` | follow | Build |
| `viewer-profile` | watch | Build |
| `reader-identity` | read | Build |
| `design-dna` | home | Build |
| `setup-profile` | use | Build |
| `flavor-profile` | eat | Build |
| `traveler-type` | go | Build |

**Persona coverage**: All 8 primary+secondary personas get at least one profiler in wave 1.

### Wave 2: Completers for high-value categories
**Why second**: "Fill the gaps" is the second-highest user job. grid-split template is already built.

| Widget | Category | Status |
|--------|----------|--------|
| `complete-the-look` | wear | **Shipped** |
| `cross-pollinate` | all | Build |
| `creator-mix` | follow | Build |
| `reading-pairs` | read | Build |
| `double-feature` | watch | Build |
| `room-completer` | home | Build |
| `tool-compare` | use | **Shipped** (as use-compare) |
| `meal-pairing` | eat | Build |
| `trip-builder` | go | Build |

### Wave 3: Prioritizers + Analyzers
**Why third**: Require more data to be useful (users need enough saves to analyze).

### Wave 4: Cross-category action widgets
**Why last**: Require cross-category data infrastructure and action handling (checklist state, buy tracking).

---

## Template Coverage

All 40 widgets map to the 11 built templates:

| Template | Widget count | Archetype |
|----------|-------------|-----------|
| hero-card | 9 | Profiler |
| grid-split | 9 | Completer |
| list | 6 | Prioritizer |
| spectrum | 5 | Analyzer |
| stat-row | 5 | Analyzer |
| checklist | 3 | Prioritizer / Action |
| choices | 1 | Prioritizer |
| comparison | 2 | Completer / Action |
| quick-add | 1 | Action |
| text-block | 1 | Narrative |
| grouped | 2 | Overview |
| **Total** | **44** | (4 widgets use alternate templates) |

No new templates needed.

---

## Changes from Current System

### Removed
- `style-pick` — overlaps with `style-summary`. Identity reflection should be one widget per category.
- `outfit-checklist` — replaced by `buy-list` which works across all product categories, not just wear.
- `eat-decide` — renamed to `what-to-eat` for clarity, narrowed to eat only.

### Renamed
- `gap-filler` → `wardrobe-gaps` — clearer purpose, list template instead of quick-add.
- `use-compare` → `tool-compare` — narrowed to use category only.

### Added
- 30 new widgets covering all 8 categories × 4 archetypes + 8 cross-category.
- `taste-dna` is the highest-priority new widget — universal profiler serving all personas.
- `cross-pollinate` is the key differentiator — no other tool shows connections between categories.

---

## Persona Coverage Matrix

| Widget Type | Visual Collector | Sound & Scene | DJ | Maker | Deep-Dive | Researcher | Cultural Omnivore | Design Tech |
|------------|---|---|---|---|---|---|---|---|
| **Profilers** | style-summary, design-dna | fan-profile | fan-profile | design-dna, setup-profile | flavor-profile, viewer-profile | reader-identity | viewer-profile, traveler-type, style-summary | setup-profile, reader-identity |
| **Completers** | complete-the-look, room-completer | creator-mix, trip-builder | creator-mix | room-completer, tool-compare | double-feature, meal-pairing, reading-pairs | reading-pairs | double-feature, complete-the-look, meal-pairing | tool-compare |
| **Prioritizers** | wardrobe-gaps, sourcing-list | follow-next | follow-next | sourcing-list, upgrade-path | watchlist-priority, up-next, what-to-eat | up-next | watchlist-priority, packing-list | upgrade-path |
| **Analyzers** | price-radar, palette-analysis | feed-balance | feed-balance | ecosystem-score, palette-analysis | nutrition-snapshot | reading-pulse | taste-map, trip-vitals | ecosystem-score |
| **Cross-cat** | taste-dna, buy-list | taste-dna, cross-pollinate | taste-dna | taste-dna, cross-pollinate, versus | taste-dna, versus, buy-list | taste-dna, deep-dive | taste-dna, board-overview | taste-dna, cross-pollinate |
| **Total widgets** | 10 | 7 | 5 | 10 | 10 | 6 | 10 | 7 |
