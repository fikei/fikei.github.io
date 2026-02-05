# Widget Template Patterns

**Date**: 2026-02-05
**Status**: Complete
**Method**: Generative design research — category expansion + concept mapping + pattern consolidation

---

## Research Question

> What UX patterns are needed to display AI-generated widget content across all possible content categories on ctrl.rodeo?

## Approach

1. Identify 12 realistic content categories users would curate
2. Generate 4 widget concepts per category (48 total)
3. Map each concept to the UX layout pattern that best serves the user
4. Consolidate into a minimal set of reusable templates

---

## Categories

| # | Category | What users curate |
|---|----------|-------------------|
| 1 | **Wear** | Clothing, shoes, accessories |
| 2 | **Home** | Furniture, decor, housewares |
| 3 | **Tech** | Gadgets, apps, tools |
| 4 | **Eat** | Recipes, restaurants, ingredients |
| 5 | **Read** | Books, articles, newsletters |
| 6 | **Watch** | Movies, shows, documentaries |
| 7 | **Listen** | Music, podcasts, albums |
| 8 | **Travel** | Destinations, stays, experiences |
| 9 | **Fitness** | Workouts, gear, nutrition |
| 10 | **Make** | DIY, crafts, tools, projects |
| 11 | **Art** | Visual art, photography, design inspo |
| 12 | **Learn** | Courses, tutorials, skills |

---

## Findings: 48 Widget Concepts

### 1. Wear

| Widget | What it does | Pattern |
|--------|-------------|---------|
| Complete the Look | Your items + AI-suggested complements | `grid-split` |
| Style Profile | "You are: Minimal Modern" + trait tags | `hero-card` |
| Wardrobe Gaps | Ranked missing categories (no boots, no outerwear...) | `list` |
| Price Radar | Budget <----*-------> Luxury across your collection | `spectrum` |

### 2. Home

| Widget | What it does | Pattern |
|--------|-------------|---------|
| Room Completer | Your saved pieces + what's missing from the room | `grid-split` |
| Design DNA | "Your aesthetic: Japandi" + color/material tags | `hero-card` |
| Sourcing List | Prioritized items to actually buy next | `list` |
| Palette Analysis | Warm <----*-------> Cool, Minimal <----*-------> Ornate | `spectrum` |

### 3. Tech

| Widget | What it does | Pattern |
|--------|-------------|---------|
| Stack Comparison | Your tools vs. AI-suggested alternatives | `grid-split` |
| Setup Profile | "Your stack: Creative Pro" + tool tags | `hero-card` |
| Upgrade Path | Prioritized next purchases by impact | `list` |
| Ecosystem Score | How integrated your tools are + gaps | `stat-row` |

### 4. Eat

| Widget | What it does | Pattern |
|--------|-------------|---------|
| Meal Pairing | Your saved dishes + complementary recipes | `grid-split` |
| Flavor Profile | "Your palate: Southeast Asian Fusion" + flavor tags | `hero-card` |
| Grocery List | Ingredients you need across saved recipes | `list` |
| Nutrition Snapshot | Macros, variety score, cuisine breadth | `stat-row` |

### 5. Read

| Widget | What it does | Pattern |
|--------|-------------|---------|
| Reading Pairs | Books you saved + "If you liked X, try Y" | `grid-split` |
| Reader Identity | "You are: Systems Thinker" + genre tags | `hero-card` |
| Up Next | AI-ranked reading order by momentum + relevance | `list` |
| Reading Pulse | Books/month, genre distribution, avg length | `stat-row` |

### 6. Watch

| Widget | What it does | Pattern |
|--------|-------------|---------|
| Double Feature | Your saved film + AI-paired companion pick | `grid-split` |
| Viewer Profile | "Your taste: Atmospheric Slow Burns" + mood tags | `hero-card` |
| Watchlist Priority | Ranked by "you'll regret skipping this" | `list` |
| Taste Map | Cerebral <----*-------> Visceral, Indie <----*-------> Studio | `spectrum` |

### 7. Listen

| Widget | What it does | Pattern |
|--------|-------------|---------|
| Sonic Pairing | Your saves + "Fans of X also dig Y" | `grid-split` |
| Listener DNA | "Your sound: Lo-fi Psych-Folk" + mood tags | `hero-card` |
| Deep Cuts | Ranked undiscovered tracks from your favorite artists | `list` |
| Listening Range | Mellow <----*-------> Intense, Familiar <----*-------> Adventurous | `spectrum` |

### 8. Travel

| Widget | What it does | Pattern |
|--------|-------------|---------|
| Trip Builder | Your saved spots + AI-suggested connectors | `grid-split` |
| Traveler Type | "You are: Cultural Flaneur" + vibe tags | `hero-card` |
| Packing List | Context-aware checklist for saved destinations | `list` |
| Trip Vitals | Days, budget, climate range, visa needs | `stat-row` |

### 9. Fitness

| Widget | What it does | Pattern |
|--------|-------------|---------|
| Program Gaps | Your saved workouts + missing movement patterns | `grid-split` |
| Training Profile | "Your style: Hybrid Athlete" + focus tags | `hero-card` |
| Gear Upgrades | Prioritized equipment by training impact | `list` |
| Balance Check | Push/Pull, Upper/Lower, Mobility/Strength | `spectrum` |

### 10. Make

| Widget | What it does | Pattern |
|--------|-------------|---------|
| Project Kit | Your saved materials + what else you need | `grid-split` |
| Maker Profile | "You build: Functional Woodwork" + skill tags | `hero-card` |
| Tool Priority | Ranked tools by how many projects they unlock | `list` |
| Workshop Vitals | Projects saved, tools owned, skill areas, est. cost | `stat-row` |

### 11. Art

| Widget | What it does | Pattern |
|--------|-------------|---------|
| Curation Pair | Your saves + AI-curated companion pieces | `grid-split` |
| Eye Profile | "Your eye: Brutalist Warmth" + palette/mood tags | `hero-card` |
| Discovery Feed | Ranked artists/works based on your taste graph | `list` |
| Aesthetic Axes | Abstract <----*-------> Figurative, Quiet <----*-------> Loud | `spectrum` |

### 12. Learn

| Widget | What it does | Pattern |
|--------|-------------|---------|
| Skill Stack | Your saved courses + AI-suggested prerequisites | `grid-split` |
| Learner Profile | "You're building: Full-Stack Design" + domain tags | `hero-card` |
| Study Path | Optimal learning order across saved resources | `list` |
| Progress Snapshot | Topics covered, depth score, hours est., gaps | `stat-row` |

---

## Pattern Consolidation

### Usage Distribution

| Pattern | Count | User job | Zone |
|---------|-------|----------|------|
| `grid-split` | 12 | "Your stuff + our suggestions" | inline |
| `hero-card` | 12 | "You are this" — identity reflection | hero |
| `list` | 12 | "Do these, in this order" — prioritized action | inline / footer |
| `spectrum` | 6 | "Where you fall" — dimensional positioning | hero / inline |
| `stat-row` | 6 | "By the numbers" — collection analytics | hero / inline |
| `text-block` | 0* | "Here's the story" — narrative analysis | any (fallback) |

*`text-block` is never a primary pick but is essential as a degraded fallback for `hero-card` and for contextual analysis.

### Template Inventory

| # | Template | User job | Fallback | Status |
|---|----------|----------|----------|--------|
| 1 | `grid-split` | Complement / compare | -> `list` | Built |
| 2 | `hero-card` | Identity / summary | -> `text-block` | Built |
| 3 | `list` | Ranked actions | *(terminal)* | Built |
| 4 | `text-block` | Narrative analysis | *(terminal)* | Built |
| 5 | `spectrum` | Dimensional positioning | -> `text-block` | **Not built** |
| 6 | `stat-row` | Collection metrics | -> `list` | **Not built** |

---

## Wireframes

### `grid-split` (built)

Two groups of thumbnail cards separated by a divider.

```
+---------------------------------------------------------+
|  Widget Name                       AI            [R]    |
+---------------------------------------------------------+
| +-----------------------------------------------------+ |
| |                                                     | |
| |  +--------+  +--------+  +--------+                 | |
| |  | [img]  |  | [img]  |  | [img]  |  YOUR ITEMS    | |
| |  | Title  |  | Title  |  | Title  |                 | |
| |  | meta   |  | meta   |  | meta   |                 | |
| |  +--------+  +--------+  +--------+                 | |
| |                                                     | |
| |  - - - - - - - - - - - - - - - - - - - - - - - -   | |
| |                                                     | |
| |  +--------+  +--------+  +--------+                 | |
| |  | [img]  |  | [img]  |  | [img]  |  AI PICKS      | |
| |  | Title  |  | Title  |  | Title  |                 | |
| |  | Brand  |  | Brand  |  | Brand  |                 | |
| |  +--------+  +--------+  +--------+                 | |
| |                                                     | |
| +-----------------------------------------------------+ |
+---------------------------------------------------------+
```

### `hero-card` (built)

Centered headline with subtitle and tag pills.

```
+---------------------------------------------------------+
|  Widget Name                       AI            [R]    |
+---------------------------------------------------------+
| +-----------------------------------------------------+ |
| |                                                     | |
| |              Minimal Modern                         | |
| |              Based on 12 items                      | |
| |                                                     | |
| |  +-------------+ +-------------+ +-----------+     | |
| |  |Neutral tones| |Clean lines  | |Versatile  |     | |
| |  +-------------+ +-------------+ +-----------+     | |
| |                                                     | |
| +-----------------------------------------------------+ |
+---------------------------------------------------------+
```

### `list` (built)

Stacked rows with separators.

```
+---------------------------------------------------------+
|  Widget Name                       AI            [R]    |
+---------------------------------------------------------+
| +-----------------------------------------------------+ |
| |                                                     | |
| |  New Balance 550 White Green                        | |
| |  -------------------------------------------        | |
| |  Carhartt WIP Michigan Coat                         | |
| |  -------------------------------------------        | |
| |  Miansai Silver Chain Bracelet                      | |
| |  -------------------------------------------        | |
| |  Moscot Lemtosh Sunglasses                          | |
| |  -------------------------------------------        | |
| |  Timex Marlin Automatic                             | |
| |                                                     | |
| +-----------------------------------------------------+ |
+---------------------------------------------------------+
```

### `text-block` (built)

Single prose block in a card.

```
+---------------------------------------------------------+
|  Widget Name                       AI            [R]    |
+---------------------------------------------------------+
| +-----------------------------------------------------+ |
| |                                                     | |
| |  Your collection leans toward relaxed               | |
| |  Scandinavian minimalism with a streetwear          | |
| |  edge - neutral tones, clean silhouettes.           | |
| |                                                     | |
| +-----------------------------------------------------+ |
+---------------------------------------------------------+
```

### `spectrum` (not built)

Labeled scales showing dimensional positioning.

```
+---------------------------------------------------------+
|  Widget Name                       AI            [R]    |
+---------------------------------------------------------+
| +-----------------------------------------------------+ |
| |                                                     | |
| |  Budget  ----------*-----------  Luxury             | |
| |                    ^                                | |
| |                 You: $85 avg                        | |
| |                                                     | |
| |  Minimal  --*---------------------  Bold            | |
| |              ^                                      | |
| |           Mostly neutrals                           | |
| |                                                     | |
| +-----------------------------------------------------+ |
+---------------------------------------------------------+
```

### `stat-row` (not built)

Row of 2-4 key metrics.

```
+---------------------------------------------------------+
|  Widget Name                       AI            [R]    |
+---------------------------------------------------------+
| +-----------------------------------------------------+ |
| |                                                     | |
| |  +-----------+  +-----------+  +-----------+        | |
| |  |    12     |  |     3     |  |   $85     |        | |
| |  |  brands   |  |  styles   |  | avg price |        | |
| |  +-----------+  +-----------+  +-----------+        | |
| |                                                     | |
| +-----------------------------------------------------+ |
+---------------------------------------------------------+
```

---

## Implications

### For implementation
- 6 templates cover all 48 widget concepts across 12 categories
- `spectrum` and `stat-row` are the only gaps — both are fallback-safe to existing templates
- Every category gets exactly 4 widget types, one per user job (discover, reflect, act, measure)

### For widget config authors
- Pick the template that matches the **user job**, not the content type
- "Suggesting complements?" -> `grid-split`
- "Reflecting identity?" -> `hero-card`
- "Prioritizing actions?" -> `list`
- "Showing where they fall?" -> `spectrum`
- "Showing metrics?" -> `stat-row`
- "Explaining reasoning?" -> `text-block`

### For category expansion
- Adding a new category requires zero template work
- Each new category maps to the same 4 widget archetypes:

| Archetype | User job | Template |
|-----------|----------|----------|
| Completer | "Fill the gaps in my collection" | `grid-split` |
| Profiler | "Tell me who I am based on what I save" | `hero-card` |
| Prioritizer | "Tell me what to do next" | `list` |
| Analyzer | "Show me the numbers / dimensions" | `spectrum` or `stat-row` |
