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

### `spectrum` (built)

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

### `stat-row` (built)

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

---

## Part 2: Action Templates

### Problem

The 20 consumption templates above answer **"What should I know?"** None of them ask the user to **do something** and close a feedback loop. Consumption-only widgets are billboards — they inform, but they don't learn. Action templates are conversations.

### What makes a template "action"

Every action card needs three things a consumption card doesn't:

1. **A verb** — what the user does (pick, add, swap, confirm, answer)
2. **A response** — what changes when they act (board updates, AI learns, item moves)
3. **A feedback loop** — why acting makes the system smarter next time

### Action taxonomy

| Intent | User is saying... | Example |
|--------|-------------------|---------|
| Discovery | "Show me more like this" | swipe-stack, quick-add |
| Decision | "Help me choose" | pick-one, vote-split |
| Transaction | "Help me buy/do" | commit-list, alert |
| Organization | "Help me sort/plan" | bundle, goal |
| Feedback | "Learn from my preferences" | prompt, swap |

---

### 10 Action Templates

#### 1. `pick-one`
"Which of these?" — Choose one from 2–3 options. AI learns the preference.

```
+---------------------------------------------------------+
|  Which direction?                  AI            [R]    |
+---------------------------------------------------------+
| +-----------------------------------------------------+ |
| |                                                     | |
| |  +---------------------+  +---------------------+  | |
| |  |      [image]        |  |      [image]        |  | |
| |  |                     |  |                     |  | |
| |  |  Minimal & Clean    |  |  Bold & Graphic     |  | |
| |  |  COS, Lemaire,      |  |  Palace, Brain Dead, | | |
| |  |  Norse Projects     |  |  Stussy             |  | |
| |  |                     |  |                     |  | |
| |  |  [ This one ]       |  |  [ This one ]       |  | |
| |  +---------------------+  +---------------------+  | |
| |                                                     | |
| |           [ Neither / Skip ]                        | |
| +-----------------------------------------------------+ |
+---------------------------------------------------------+
```
**Loop**: Choice trains the profiler. Next `hero-card` and `grid-split` reflect this.

#### 2. `swipe-stack`
Rapid yes/no on a queue of items. Tinder for curation.

```
+---------------------------------------------------------+
|  Quick Sort                        AI            [R]    |
+---------------------------------------------------------+
| +-----------------------------------------------------+ |
| |                                                     | |
| |           +---------------------+                   | |
| |           |                     |                   | |
| |           |      [image]        |                   | |
| |           |                     |                   | |
| |           |  Norse Projects     |                   | |
| |           |  Twill Chino        |                   | |
| |           |  $185               |                   | |
| |           |                     |                   | |
| |           +---------------------+                   | |
| |                                                     | |
| |        [ X Pass ]    [ + Save ]                     | |
| |                                                     | |
| |              3 of 8 remaining                       | |
| +-----------------------------------------------------+ |
+---------------------------------------------------------+
```
**Loop**: Passes and saves train `grid-split` suggestions. Builds taste profile fast.

#### 3. `quick-add` (built)
Single high-confidence suggestion with a prominent save action.

```
+---------------------------------------------------------+
|  You might want this               AI            [R]    |
+---------------------------------------------------------+
| +-----------------------------------------------------+ |
| |                                                     | |
| |  +--------+  New Balance 990v6                      | |
| |  | [img]  |  $184.99                                | |
| |  |        |                                         | |
| |  +--------+  "Fills your footwear gap -             | |
| |               you have tops and bottoms             | |
| |               but no sneakers."                     | |
| |                                                     | |
| |  [ + Add to board ]         [ Visit site > ]        | |
| |                                                     | |
| +-----------------------------------------------------+ |
+---------------------------------------------------------+
```
**Loop**: Add -> item appears in board -> future widgets exclude this gap.

#### 4. `swap`
"Replace this with that" — an upgrade or alternative with a commit action.

```
+---------------------------------------------------------+
|  Upgrade?                          AI            [R]    |
+---------------------------------------------------------+
| +-----------------------------------------------------+ |
| |                                                     | |
| |  +------------------+     +------------------+      | |
| |  |    [current]     |     |    [suggested]   |      | |
| |  |                  |     |                  |      | |
| |  |  Uniqlo Tee      | --> |  Reigning Champ  |      | |
| |  |  $14.90          |     |  Midweight Tee   |      | |
| |  |                  |     |  $65             |      | |
| |  +------------------+     +------------------+      | |
| |                                                     | |
| |  "Same fit, much better fabric. Your most-          | |
| |   worn category - worth the upgrade."               | |
| |                                                     | |
| |  [ Keep current ]          [ Swap it ]              | |
| +-----------------------------------------------------+ |
+---------------------------------------------------------+
```
**Loop**: Swap -> replaces pin on board. Keep -> AI stops suggesting upgrades for this item.

#### 5. `commit-list`
Ready-to-buy list with links and total. The checkout moment.

```
+---------------------------------------------------------+
|  Ready to buy                      AI            [R]    |
+---------------------------------------------------------+
| +-----------------------------------------------------+ |
| |                                                     | |
| |  [x]  New Balance 990v6             $185   [ > ]    | |
| |  [x]  Carhartt WIP Michigan Coat    $298   [ > ]    | |
| |  [ ]  Timex Marlin Automatic        $249   [ > ]    | |
| |  [ ]  Bellroy Sling Bag             $89    [ > ]    | |
| |                                                     | |
| |  -------------------------------------------        | |
| |  Selected: 2 items               Total: $483        | |
| |                                                     | |
| |  [ Open selected in tabs ]                          | |
| +-----------------------------------------------------+ |
+---------------------------------------------------------+
```
**Loop**: Checked items -> tracked as "intent to purchase" -> removed from gap analysis.

#### 6. `vote-split`
Two competing directions — user's choice shapes all future widgets.

```
+---------------------------------------------------------+
|  Your collection could go either way   AI        [R]    |
+---------------------------------------------------------+
| +-----------------------------------------------------+ |
| |                                                     | |
| |     Workwear               Minimalist               | |
| |                                                     | |
| |  Carhartt WIP           COS                         | |
| |  Iron Heart              Lemaire                    | |
| |  Red Wing                Common Projects            | |
| |                                                     | |
| |  Rugged, heavy          Clean, restrained           | |
| |  fabrics, utility       silhouettes, quiet          | |
| |  pockets                luxury                      | |
| |                                                     | |
| |  [ Lean this way ]     [ Lean this way ]            | |
| |                                                     | |
| |           [ I like both ]                           | |
| +-----------------------------------------------------+ |
+---------------------------------------------------------+
```
**Loop**: Preference stored -> `hero-card` label shifts -> `grid-split` suggestions align.

#### 7. `prompt`
AI asks, user answers. Open-ended input that feeds the system.

```
+---------------------------------------------------------+
|  Quick question                    AI            [R]    |
+---------------------------------------------------------+
| +-----------------------------------------------------+ |
| |                                                     | |
| |  You've saved a lot of outerwear lately.            | |
| |  What are you looking for?                          | |
| |                                                     | |
| |  +-----------------------------------------------+ | |
| |  |  e.g. "lightweight for spring" or "waterproof" | | |
| |  +-----------------------------------------------+ | |
| |                                                     | |
| |                              [ Submit ]             | |
| |                                                     | |
| +-----------------------------------------------------+ |
+---------------------------------------------------------+
```
**Loop**: Response -> constrains next `grid-split` and `checklist` suggestions.

#### 8. `bundle`
Assembled set — review the whole package, add all at once.

```
+---------------------------------------------------------+
|  Weekend Kit                       AI            [R]    |
+---------------------------------------------------------+
| +-----------------------------------------------------+ |
| |                                                     | |
| |  +------+ +------+ +------+ +------+ +------+      | |
| |  |[img] | |[img] | |[img] | |[img] | |[img] |      | |
| |  | Tee  | |Shorts| | Cap  | |Snkrs | | Bag  |      | |
| |  | $35  | | $65  | | $40  | | $110 | | $89  |      | |
| |  +------+ +------+ +------+ +------+ +------+      | |
| |                                                     | |
| |  5 items  |  Total: $339  |  All from your brands   | |
| |                                                     | |
| |  [ Save bundle to board ]    [ Edit items ]         | |
| +-----------------------------------------------------+ |
+---------------------------------------------------------+
```
**Loop**: Save -> all 5 pins added at once. Edit -> opens `swipe-stack` for the bundle.

#### 9. `goal`
Set a target, see progress, take the next step.

```
+---------------------------------------------------------+
|  Capsule Wardrobe                  AI            [R]    |
+---------------------------------------------------------+
| +-----------------------------------------------------+ |
| |                                                     | |
| |  Goal: 30-piece capsule wardrobe                    | |
| |                                                     | |
| |  [====================---------]  22 / 30           | |
| |                                                     | |
| |  Covered:  Tops 8  Bottoms 5  Outerwear 4          | |
| |  Missing:  Footwear 3  Accessories 5  Basics 3     | |
| |                                                     | |
| |  Next step:                                         | |
| |  +--------+  White leather sneaker                  | |
| |  | [img]  |  Common Projects Achilles               | |
| |  +--------+  "Versatile - works with 80% of your   | |
| |               existing pieces"                      | |
| |                                                     | |
| |  [ + Add to board ]    [ Change goal ]              | |
| +-----------------------------------------------------+ |
+---------------------------------------------------------+
```
**Loop**: Add -> progress bar moves -> next suggestion updates. Change goal -> recomputes gaps.

#### 10. `alert`
Time-sensitive notification with a single action. Urgency-driven.

```
+---------------------------------------------------------+
|  ! Price Drop                      AI                   |
+---------------------------------------------------------+
| +-----------------------------------------------------+ |
| |                                                     | |
| |  +--------+                                         | |
| |  | [img]  |  Norse Projects Nunk Jacket             | |
| |  |        |  ~~$350~~ -> $210  (-40%)               | |
| |  +--------+                                         | |
| |                                                     | |
| |  On your board since Jan 12.                        | |
| |  Lowest price in 6 months.                          | |
| |                                                     | |
| |  [ Visit store > ]              [ Dismiss ]         | |
| |                                                     | |
| +-----------------------------------------------------+ |
+---------------------------------------------------------+
```
**Loop**: Visit -> tracked as high-intent. Dismiss -> stops alerts for this item.

---

## Complete Template Inventory (30)

### Consumption templates (19)
Inform the user. No feedback loop.

| # | Template | User job | Fallback | Status |
|---|----------|----------|----------|--------|
| 1 | `grid-split` | Complement / compare | -> `list` | Built |
| 2 | `hero-card` | Identity / summary | -> `text-block` | Built |
| 3 | `list` | Ranked actions | *(terminal)* | Built |
| 4 | `text-block` | Narrative analysis | *(terminal)* | Built |
| 5 | `spectrum` | Dimensional positioning | -> `text-block` | Built |
| 6 | `stat-row` | Collection metrics | -> `list` | Built |
| 7 | `comparison` | Head-to-head attributes | -> `grid-split` | Not built |
| 8 | `timeline` | Sequential path/journey | -> `list` | Not built |
| 9 | `rank-podium` | Top picks emphasized | -> `stack-rank` | Not built |
| 10 | `progress` | Goal tracking | -> `stat-row` | Not built |
| 11 | `quote` | Single big insight | -> `text-block` | Not built |
| 12 | `carousel` | Browseable row | -> `grid-split` | Not built |
| 13 | `matrix` | Quadrant positioning | -> `map` | Not built |
| 14 | `score-card` | Headline metric + breakdown | -> `stat-row` | Not built |
| 15 | `pill-cloud` | Weighted tags/themes | -> `hero-card` | Not built |
| 16 | `stack-rank` | Visually weighted ranking | -> `list` | Not built |
| 17 | `accordion` | Expandable detail sections | -> `list` | Not built |
| 18 | `media-feature` | Visual hero with overlay | -> `hero-card` | Not built |
| 19 | `map` | Spatial/conceptual plotting | -> `matrix` | Not built |

### Hybrid (1)
Informs and collects lightweight input.

| # | Template | User job | Fallback | Status |
|---|----------|----------|----------|--------|
| 20 | `checklist` | Actionable to-dos | -> `list` | Not built |

### Action templates (10)
Collect user input. Close a feedback loop. Make the system smarter.

| # | Template | Verb | Feedback loop | Fallback | Status |
|---|----------|------|---------------|----------|--------|
| 21 | `pick-one` | Choose | Trains taste profile | -> `vote-split` | Not built |
| 22 | `swipe-stack` | Pass / Save | Rapid preference building | -> `quick-add` | Not built |
| 23 | `quick-add` | Add to board | Fills gaps, updates suggestions | -> `list` | Built |
| 24 | `swap` | Keep / Replace | Upgrades collection | -> `comparison` | Not built |
| 25 | `commit-list` | Select + open | Purchase intent tracking | -> `checklist` | Not built |
| 26 | `vote-split` | Pick direction | Shapes all future widgets | -> `pick-one` | Not built |
| 27 | `prompt` | Type + submit | Constrains AI suggestions | -> `text-block` | Not built |
| 28 | `bundle` | Save set | Batch-adds to board | -> `carousel` | Not built |
| 29 | `goal` | Add + set target | Progress-driven suggestions | -> `progress` | Not built |
| 30 | `alert` | Visit / Dismiss | Intent + notification prefs | -> `quick-add` | Not built |

---

## Implications

### For implementation
- 30 templates = 19 consumption + 1 hybrid + 10 action
- 7 are built, 23 are not
- Action templates require client-side event handling and state persistence that consumption templates do not
- Action templates feed back into the system: choices train the AI, adds update the board, dismissals adjust future suggestions

### For widget config authors
Pick the template that matches the **user job**, not the content type:

**Consumption** (read-only):
- "Suggesting complements?" -> `grid-split`
- "Reflecting identity?" -> `hero-card`
- "Prioritizing actions?" -> `list`
- "Showing where they fall?" -> `spectrum`
- "Showing metrics?" -> `stat-row`
- "Explaining reasoning?" -> `text-block`

**Action** (feedback loop):
- "Help them choose between options?" -> `pick-one` or `vote-split`
- "Help them discover rapidly?" -> `swipe-stack`
- "One strong suggestion?" -> `quick-add`
- "Upgrade an existing item?" -> `swap`
- "Ready to buy?" -> `commit-list`
- "Need user input?" -> `prompt`
- "Assemble a set?" -> `bundle`
- "Track toward a goal?" -> `goal`
- "Time-sensitive?" -> `alert`

### For category expansion
Each category maps to the same 4 archetypes (consumption) plus action widgets as needed:

| Archetype | User job | Template |
|-----------|----------|----------|
| Completer | "Fill the gaps in my collection" | `grid-split` |
| Profiler | "Tell me who I am based on what I save" | `hero-card` |
| Prioritizer | "Tell me what to do next" | `list` |
| Analyzer | "Show me the numbers / dimensions" | `spectrum` or `stat-row` |
| Decider | "Help me choose" | `pick-one` or `vote-split` |
| Actioner | "Add this to my board" | `quick-add` or `bundle` |
