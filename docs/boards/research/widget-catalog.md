# Widget Catalog: 40 Use Cases

> Complete reference of all widget concepts with user goals, design components, data sources, and triggers.
> **Source**: [PRD: AI Widgets](/docs/strategy/prds/ai-widgets.md)
> **Last Updated**: 2026-02-06

---

## Widget Reference Table

| # | Widget | Category | User Goal | Design Components | Data Sources | Trigger |
|---|--------|----------|-----------|-------------------|-------------|---------|
| 1 | Decide | eat | Pick one restaurant for tonight | `w-body--choices` → `w-option × 2-3`, each with `w-text--title` + `w-text--meta` + `w-btn` | title, domain | 3+ eat items |
| 2 | Gap Analysis | home | Find what's missing from this room | `w-body--split` → `w-column × 2`, left `w-row × N` (user items), right `w-row × N` (suggestions) | title, domain, image | 5+ home items, same inferred style |
| 3 | Persuade | watch | Get convinced to press play | `w-body--verdict` → `w-headline` (`w-text--display` + `w-text--meta`) + `w-tag-group` (`w-badge × N`) | title, domain | 3+ watch saves, stale 14+ days |
| 4 | Synthesize | read | Find the hidden thread across articles | `w-body--narrative` → `w-text--prose` with indented hierarchy | title, url, domain | 4+ read items, same inferred topic |
| 5 | Gap Analysis | use | Find the hole in your workflow | `w-body--suggestion` → `w-row` (featured) + `w-text--note` (reason) + `w-btn` | title, domain | 3+ use items, same inferred workflow |
| 6 | Sequence | go | Route saved destinations into a trip | `w-body--list` → `w-row × N` with `w-row__indicator` (step #) + title + meta (duration) | title, url, domain | 3+ go items |
| 7 | Assign | gift | Match saved items to people | `w-body--split` → `w-column` (items) + `w-column` (people), rows linked by assignment | title, domain, follow items | 5+ items + 2+ follow items |
| 8 | Decay | follow | Surface creators you're ignoring | `w-body--list` → `w-row × N` with `w-row__indicator` (⚠️/🔴) + title + meta (days since) | title, domain, **last_interacted_at** | stale 30+ days on any creator |
| 9 | Calculate | spend (cross) | Know your total wishlist cost | `w-body--stats` → `w-stat × 3` (total, count, avg) with optional `w-bar` | title (price inference), domain | cross: 5+ items with price-inferrable titles |
| 10 | Assemble | make | Build a project plan from saves | `w-body--checklist` → `w-row × N` with `w-checkbox` + title + meta, `w-stat` (completion %) | title, url, domain | 4+ items forming a project |
| 11 | Curator | listen | Build a listening session arc | `w-body--list` → `w-row × N` with `w-row__indicator` (energy emoji) + title + meta (duration) | title, domain | 5+ music/podcast saves |
| 12 | Dependency Map | learn | Know what to learn first | `w-body--list` → `w-row × N` with `w-row__indicator` (→ chain) + title + meta (prerequisite) | title, url, domain | 3+ learning saves in same topic |
| 13 | Redundancy | wear | See duplicate items in collection | `w-body--stats` → `w-stat × 3-4` per garment type (e.g., "3 hoodies") | title, domain, **sub-type** | 3+ items same garment type |
| 14 | Collision | events | Spot date conflicts | `w-body--list` → `w-row × N` with `w-row__indicator` (⚠️) + title + meta (conflicting date) | title (date inference) | 2+ events with inferred overlapping dates |
| 15 | Behavior | all | See monthly saving pattern | `w-body--spectrum` → `w-axis × 4-6` per category, bar fill = density, note = trend | title, category, **created_at** | time: 10+ saves across 2+ months |
| 16 | Backlog | read | Know how long to read everything | `w-body--stats` → `w-stat × 3` (total items, est. read time, weeks behind) | title, domain, **article length** | 5+ read items |
| 17 | Conflict | home | See aesthetic clashes | `w-body--verdict` → `w-headline` + `w-tag-group` (clashing traits) | title, domain | 3+ items with conflicting inferred styles |
| 18 | Pattern Reveal | work | See the job you're circling | `w-body--verdict` → `w-headline` (job title inference) + `w-tag-group` (signals) | title, domain | 5+ work-related saves |
| 19 | Predict | all | Know what you'll save next | `w-body--verdict` → `w-headline` (predicted save) + `w-tag-group` (pattern evidence) | title, category, **created_at** | time: 15+ saves with clear category trend |
| 20 | Archaeologist | all | Rediscover forgotten saves | `w-body--verdict` → `w-headline` (item title) + `w-tag-group` (why forgotten) | title, url, **last_interacted_at** | stale 60+ days, no interaction |
| 21 | Negotiate | eat | Build a dining week on budget | `w-body--checklist` → `w-row × N` with `w-checkbox` + title + meta (est. price), `w-stat` (total/budget) | title, domain (price inference), **budget input** | 3+ eat items with price-inferrable names |
| 22 | Translate | read | Find the international angle | `w-body--split` → `w-column` (your sources) + `w-column` (international, flag emojis) | title, url, domain | 4+ articles from same-language sources |
| 23 | Remix | wear | See unexpected outfit pairings | `w-body--choices` → `w-option × 2` with pairing label + style name + select btn | title, domain, **sub-type** | 4+ items across 2+ garment types |
| 24 | Audit | follow | See feed redundancy | `w-body--spectrum` → `w-axis × N` per topic, fill shows creator overlap, note = names | title, domain | 3+ creators in same inferred niche |
| 25 | Expire | all | Find dead links | `w-body--stats` → `w-stat × 3` (alive, dead, moved) + `w-row × N` (dead links) | url, **link health check**, **last_interacted_at** | 10+ saves stale 30+ days |
| 26 | Compare | use | Consider tool alternatives | `w-body--comparison` → `w-option × 2` + `w-divider--labeled` ("vs") | title, domain | 1+ tool saved with known competitors |
| 27 | Pace | read | Know saving vs reading speed | `w-body--stats` → `w-stat × 3` (save rate, read rate, backlog) + `w-text--note` | title, **created_at**, **article length** | time: 5+ saves in last 14 days |
| 28 | Mood | watch | See emotional arc of watchlist | `w-body--spectrum` → `w-axis × 1` (Light → Heavy) + note (dominant genre) | title, domain, **genre sub-type** | 4+ watch items with inferrable genre |
| 29 | Bridge | home + wear | See if spaces match clothes | `w-body--verdict` → `w-headline` (coherence label) + `w-tag-group` (overlap/tension) | title, domain (both categories) | cross: 3+ in home AND 3+ in wear |
| 30 | Graduate | learn | Map skill progression | `w-body--list` → `w-row × N` with `w-row__indicator` (✓/→/○) + title + meta (date range) | title, domain, **created_at** | time: 3+ same topic across 2+ months |
| 31 | Season | wear | Find seasonal wardrobe gaps | `w-body--spectrum` → `w-axis × 4` (Spring/Summer/Fall/Winter), bar fill = density | title, domain, **seasonal sub-type** | 5+ items skewed to 1-2 seasons |
| 32 | Portion | eat | See cuisine diversity | `w-body--stats` → `w-stat × N` per cuisine (%, name) with `w-bar` | title, domain, **cuisine sub-type** | 4+ eat items with inferrable cuisine |
| 33 | Ritual | all (cross) | Bundle saves into daily routines | `w-body--grouped` → `w-section × 2-3` (time of day) with `w-row × N` | title, domain, category | cross: items across 3+ categories |
| 34 | Proxy | follow | Map influence chains | `w-body--narrative` → `w-text--prose` with indented tree (A → B → C) | title, domain | 3+ creators in same domain |
| 35 | Substitute | eat | Find same-vibe dietary alternative | `w-body--comparison` → `w-option × 2` + `w-divider--labeled` + shared `w-text--note` | title, domain | 1+ eat item |
| 36 | Ladder | home | See good/better/best options | `w-body--list` → `w-row × 3` with tier indicators ($/$$/$$) + title + meta | title, domain | 1+ home item |
| 37 | Drift | all | See how taste is evolving | `w-body--spectrum` → `w-axis × N` per category, dual bars (then/now) + note | title, category, **created_at** | time: 10+ saves across 3+ months |
| 38 | Contradict | all (cross) | Surface cognitive dissonance | `w-body--narrative` → `w-text--prose` + inline `w-badge × 2` (contradicting themes) | title, category, domain | cross: items from opposing themes |
| 39 | Cluster | go | Reveal geographic orbiting | `w-body--verdict` → `w-headline` (neighborhood name) + `w-tag-group` (item types) | title, url, domain, **geo inference** | 3+ places in same inferred area |
| 40 | Deadline | watch | See upcoming releases for saved shows | `w-body--list` → `w-row × N` with `w-row__indicator` (🔴/🟡/⚪) + title + meta (days) | title, domain, **release dates (TMDB)** | 2+ TV shows saved |

---

## Data Source Legend

| Symbol | Meaning |
|--------|---------|
| title | Item title (always available) |
| url | Item URL (always available) |
| domain | Extracted from URL (always available) |
| image | Hero image (sometimes missing) |
| category | Item category — 8 values (always available) |
| **bold** | Data NOT currently available — requires new field, API, or migration |

### Missing Data Summary

| Missing Data | Widgets Affected | Count |
|-------------|-----------------|-------|
| `created_at` | #15, 19, 27, 30, 37 | 5 |
| `last_interacted_at` | #3, 8, 20, 25 | 4 |
| Sub-type classification | #13, 23, 28, 31, 32 | 5 |
| External API (TMDB, link-check) | #25, 40 | 2 |
| Article length / read time | #16, 27 | 2 |
| Budget input | #21 | 1 |
| Geographic inference | #6, 39 | 2 |

### Widgets That Can Ship Today (no new data needed)

| # | Widget | Category | All data already exists |
|---|--------|----------|------------------------|
| 1 | Decide | eat | AI picks from restaurant names |
| 4 | Synthesize | read | AI finds thread across article titles |
| 6 | Sequence | go | AI routes from destination names |
| 26 | Compare | use | AI identifies tool + competitor from title + domain |
| 34 | Proxy | follow | AI infers creator relationships |
| 35 | Substitute | eat | AI infers restaurant vibe |
| 36 | Ladder | home | AI infers product type + price tiers |
