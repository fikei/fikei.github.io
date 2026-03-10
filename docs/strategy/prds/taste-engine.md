# PRD: Taste Engine

**Version:** 1.0
**Date:** 2026-03-10
**Status:** Draft

---

## Overview

ctrl.rodeo already knows *what* users save. The Taste Map visualizes it. Per-category profilers (style-summary, fan-profile, design-dna) describe slices of it. But none of these systems talk to each other, and none of them *do* anything beyond reflect. The taste data dies where it's computed.

The Taste Engine is the infrastructure that changes this. It takes the raw material already flowing through the system — taste_tags, practical_tags, entities, categories, board assignments, save patterns, AI-generated cluster labels — and consolidates it into a structured, multi-level user preference model that persists, evolves, and *acts*. It becomes the intelligence layer that other features consume: search ranks by it, LLM prompts are conditioned on it, recommendations are filtered through it, Lookback scores with it, widgets personalize against it.

This is not a new user-facing feature. It's the engine underneath every feature that needs to know who the user is.

---

## Why Now

Three things converged:

1. **The data already exists.** `analyze-content` produces taste_tags and practical_tags per pin. The taste-map clusters them. Per-category profilers synthesize them. But each computes independently, caches separately, and shares nothing. We're paying for AI calls whose output evaporates.

2. **Multiple features need the same thing.** Lookback needs taste signals for scoring. Events For You already hacks together a `tasteContext`. Search needs personalized ranking. Future features (smart boards, digest content, cross-category discovery) all need "what does this user care about?" The answer shouldn't be recomputed from scratch each time.

3. **The industry has converged on a pattern.** Spotify's multi-time-scale embeddings, Pinterest's hierarchical taste graph, the POPI framework's natural-language preference summaries — the architecture for doing this well is now well-documented and achievable at our scale.

---

## Goals

1. **Unify preference data** into a single, structured representation that all features can query
2. **Model taste at multiple abstraction levels** — from specific item affinities to broad aesthetic sensibilities
3. **Evolve the profile automatically** as the collection grows, without user configuration
4. **Produce LLM-injectable summaries** so every Claude call can be taste-aware with zero extra inference
5. **Give users visibility into their own taste profile** — transparent, correctable, theirs

---

## Who This Serves

The Taste Engine is infrastructure, not a feature. Every persona benefits, but through the features it powers.

| Persona | What the Engine Enables |
|---------|------------------------|
| **The Visual Collector** | Search for "workspace" returns results biased toward their minimalist aesthetic, not generic results |
| **The DJ** | Music recommendations understand they prefer deep cuts over mainstream, vinyl over digital, dark over bright |
| **The Cultural Omnivore** | Cross-category connections emerge automatically — their love of brutalism spans architecture, fashion, and music |
| **The Researcher** | AI-generated widget content references their actual interests, not generic knowledge |
| **The Deep-Dive Enthusiast** | The system recognizes phase transitions — "you're shifting from pour-over to natural wine" |
| **The Multidisciplinary Maker** | Smart boards form around aesthetic threads that cross traditional categories |

### Jobs To Be Done

| When I... | I want the system to... | So I can... |
|-----------|------------------------|-------------|
| Search my collection | Rank results by what I actually care about, not just keyword match | Find the right pin without scrolling past irrelevant hits |
| Ask an AI widget a question | Get answers that reflect my taste, not generic advice | Trust that recommendations fit my world |
| See "similar pins" or recommendations | Get suggestions aligned with my aesthetic, not just topically related | Discover things I'd actually want, not algorithmic noise |
| Open ctrl.rodeo after weeks away | See a profile that still recognizes me | Feel like the tool has been paying attention |
| Notice my taste shifting | Have the system reflect the shift without me manually reconfiguring anything | Trust that the system grows with me |

---

## Design Principles

| Brand Principle | Application |
|-----------------|-------------|
| **Input shapes output** | Literally: your saves shape the taste profile that shapes every output the system produces |
| **Organize as you go** | The taste profile builds itself from normal saving behavior — zero configuration |
| **One place, whole life** | The engine models taste across all categories simultaneously — a unified sensibility, not siloed preferences |
| **Show, don't decorate** | The taste profile is transparent and readable, not a black box. Users can see and correct it |
| **Expand with the user** | Progressive complexity — starts as simple category affinities, develops into multi-dimensional aesthetic modeling |

---

## The Preference Model

### Core Design Principle: Nothing Is Hardcoded

The existing Boards system has 9 fixed categories: `home, wear, watch, listen, use, eat, go, follow, read`. These are useful for initial organization, but the taste engine must not be locked to them. **Categories themselves are concepts the engine discovers, not scaffolding it inherits.**

A user who saves brutalist architecture, brutalist fashion, and raw industrial music — the meaningful organizing concept is "brutalism" or "raw industrial aesthetic," not `home + wear + listen`. The taste-map already surfaces this: its clusters routinely span categories (e.g., `wear(5), home(3)`) and get labeled with sensibility names. The engine makes that emergent organization persistent and usable.

This means:
- **Dimensions are not pre-defined.** They emerge from tag co-occurrence patterns in the user's data
- **Domains are not categories.** They're whatever the engine discovers as coherent taste clusters — could align with a category, could cross three of them, could be something the category system has no name for
- **The hierarchy is fluid.** A user with 20 pins might have 3 coarse domains. A user with 500 pins might have 15 fine-grained ones. The resolution scales with the data

### Level Architecture

The engine models preferences at five levels, from concrete to abstract. Each level is derived from the level below it — but critically, the organizational concepts at each level are *outputs*, not inputs.

```
Level 5: Sensibility       "restraint, craft, authenticity"
  ^                         HOW: LLM synthesis of axes + domains into value narrative
  |                         WHAT: 1-3 sentences + 3-5 value tags. One per user.
  |                         Used by: brand voice, cross-domain recs, global LLM conditioning
  |
Level 4: Aesthetic Axes     { density: 0.2 (minimal), warmth: 0.7 (warm), era: 0.4 (mid-century) }
  ^                         HOW: Statistical — tag-to-axis mapping + cross-domain frequency analysis
  |                         WHAT: Position on continuous scales. Axes discovered, not predefined.
  |                         Used by: search re-ranking, visual filtering, recommendation tuning
  |
Level 3: Taste Domains      "Dark Industrial Techno" / "Warm Scandinavian Minimalism" / "Raw Craft"
  ^                         HOW: Cluster analysis on Level 2 affinities → LLM labeling
  |                         WHAT: Emergent groupings with labels. NOT locked to categories.
  |                         Used by: LLM prompt conditioning, widget personalization, smart boards
  |
Level 2: Topic Affinities   { "brutalist architecture": 0.85, "natural wine": 0.72 }
  ^                         HOW: Algorithmic — weighted tag frequency + entity co-occurrence
  |                         WHAT: Interest scores. Dimensions emerge from the tag vocabulary.
  |                         Used by: search ranking, related pins, content matching
  |
Level 1: Item Signals       Pin saved, tags assigned, entities extracted
                            HOW: Already exists — analyze-content pipeline
                            WHAT: Per-pin taste_tags, practical_tags, entities, content_structure
                            Used by: everything above
```

### What Each Level Actually Is

**Level 1 (Item Signals)** is the raw material. Already exists. Each pin gets 3-8 `taste_tags` (subjective: "minimal", "cozy", "raw"), 3-8 `practical_tags` (objective: "furniture", "japanese", "restaurant"), and named `entities`. These are the atoms.

**Level 2 (Topic Affinities)** answers "what does this user keep coming back to?" It's a weighted bag of interests, but the *dimensions themselves* come from the data. If a user has never saved anything tagged "vintage," there's no vintage affinity — it doesn't exist in their model. If they've invented a personal vocabulary through their board names or tag patterns, those become dimensions too. This is closer to a TF-IDF model than a taxonomy lookup: the vocabulary is whatever the user's collection produces.

**Level 3 (Taste Domains)** is where the engine diverges from every platform that locks preferences to content categories. A taste domain is a *coherent cluster of affinities* — it might align with a category ("your music taste") or it might bridge three categories ("your raw industrial aesthetic that spans architecture, music, and fashion"). The engine discovers these by clustering Level 2 affinities, then an LLM names them. The number of domains, their scope, and their labels are all emergent. A small collection might produce 2-3 broad domains. A large, diverse collection might produce 10-15 specific ones.

**Level 4 (Aesthetic Axes)** captures the *why* beneath the *what*. Two users might both save mid-century furniture — one for the minimalism, the other for the warmth. Axes disambiguate. They're continuous scales (not binary), and while the engine starts with seed axes (density, temperature, era, formality), it can discover new ones. If a user's collection reveals a consistent split between "handmade/artisanal" and "mass-produced/industrial" that doesn't map to any seed axis, the engine surfaces it.

**Level 5 (Sensibility)** is the thread connecting everything. The engine synthesizes axes and domains into a narrative about *what kind of person* collects these things. This is generated by LLM, expressed in natural language, and updated infrequently. It's what a human curator would say about you after studying your collection for an hour.

### How Categories Relate

The existing Boards categories (`home`, `wear`, `listen`, etc.) remain as a UI organizing principle — they're how pins are displayed and filtered in the board view. But the taste engine treats them as **one signal among many**, not as the organizing scaffold.

Specifically:
- A pin's category is metadata that feeds into Level 2 (it contributes to the affinity dimension, e.g., `home.furniture` vs `wear.footwear`)
- But Level 3 domains are not "one identity per category." They're whatever clusters emerge
- A user could have a domain called "Japanese Craft" that spans `home` (ceramics), `eat` (kaiseki), and `read` (wabi-sabi philosophy) — with no single category owning it
- Boards categories can evolve too — the engine could suggest new categories or board names based on emergent domains: "Your collection has a strong 'Raw Craft' thread across home, wear, and eat — should we create a board for it?"

---

## Data Schema

### Core Tables

```sql
-- ============================================================
-- taste_affinities: Level 2 — weighted interest scores
-- Dimensions are freeform strings derived from the user's own
-- tag vocabulary. No predefined taxonomy.
-- ============================================================
CREATE TABLE taste_affinities (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  dimension TEXT NOT NULL,        -- freeform: 'brutalist_architecture', 'natural_wine', 'japanese_joinery'
  strength REAL NOT NULL DEFAULT 0.5 CHECK (strength BETWEEN 0 AND 1),
  signal_count INTEGER NOT NULL DEFAULT 1,
  source_tags TEXT[] DEFAULT '{}',  -- which taste_tags/practical_tags contribute to this
  source_categories TEXT[] DEFAULT '{}',  -- which board categories the signal came from
  signal_type TEXT NOT NULL DEFAULT 'derived',  -- 'derived', 'explicit', 'corrected'
  first_seen TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_reinforced TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, dimension)
);

CREATE INDEX idx_affinities_user ON taste_affinities(user_id);
CREATE INDEX idx_affinities_strength ON taste_affinities(user_id, strength DESC);

-- ============================================================
-- taste_domains: Level 3 — emergent taste clusters
-- NOT locked to board categories. A domain can span any
-- combination of categories, or represent a concept that
-- doesn't map to any single category.
-- ============================================================
CREATE TABLE taste_domains (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  label TEXT NOT NULL,             -- LLM-generated: "Dark Industrial Techno", "Raw Craft"
  summary TEXT,                    -- 1-2 sentence natural language description
  confidence REAL NOT NULL DEFAULT 0.5,
  constituent_affinities TEXT[] NOT NULL DEFAULT '{}',  -- which affinity dimensions feed this domain
  spanning_categories TEXT[] DEFAULT '{}',  -- which board categories this domain crosses
  pin_ids UUID[] DEFAULT '{}',     -- representative pins (top 10 by centroid proximity)
  signal_count INTEGER NOT NULL DEFAULT 1,
  first_seen TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_reinforced TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_domains_user ON taste_domains(user_id);

-- ============================================================
-- taste_axes: Level 4 — continuous aesthetic dimensions
-- Starts with seed axes but can grow as the engine discovers
-- new dimensions in the user's data.
-- ============================================================
CREATE TABLE taste_axes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  axis TEXT NOT NULL,              -- 'density', 'temperature', 'era', or discovered: 'craft_vs_industrial'
  position REAL NOT NULL DEFAULT 0.5 CHECK (position BETWEEN 0 AND 1),  -- 0.0=low_end, 1.0=high_end
  low_label TEXT NOT NULL,         -- 'minimal', 'cool', 'vintage'
  high_label TEXT NOT NULL,        -- 'maximalist', 'warm', 'futuristic'
  confidence REAL NOT NULL DEFAULT 0.5,
  contributing_tags TEXT[] DEFAULT '{}',  -- which tags pushed the position
  is_seed BOOLEAN DEFAULT false,   -- true for predefined axes, false for discovered
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, axis)
);

CREATE INDEX idx_axes_user ON taste_axes(user_id);

-- ============================================================
-- taste_summaries: LLM-injectable natural language
-- Scoped to domains (not categories) + one global summary.
-- ============================================================
CREATE TABLE taste_summaries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  scope TEXT NOT NULL,              -- 'global' or a taste_domain.id
  summary TEXT NOT NULL,            -- "Gravitates toward minimal, craft-forward design..."
  confidence REAL NOT NULL DEFAULT 0.5,
  pin_count_at_generation INTEGER NOT NULL,
  source_snapshot JSONB DEFAULT '{}',  -- the preference state that produced this summary
  generated_at TIMESTAMPTZ DEFAULT NOW(),
  expires_at TIMESTAMPTZ,
  model_version TEXT,
  UNIQUE(user_id, scope)
);

-- ============================================================
-- taste_snapshots: Monthly preference state for drift detection
-- ============================================================
CREATE TABLE taste_snapshots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  snapshot_date DATE NOT NULL DEFAULT CURRENT_DATE,
  affinities JSONB NOT NULL,       -- { "dimension": strength, ... }
  domains JSONB NOT NULL,          -- { "label": { confidence, spanning_categories }, ... }
  axes JSONB NOT NULL,             -- { "axis": position, ... }
  pin_count INTEGER NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, snapshot_date)
);

-- RLS
ALTER TABLE taste_affinities ENABLE ROW LEVEL SECURITY;
ALTER TABLE taste_domains ENABLE ROW LEVEL SECURITY;
ALTER TABLE taste_axes ENABLE ROW LEVEL SECURITY;
ALTER TABLE taste_summaries ENABLE ROW LEVEL SECURITY;
ALTER TABLE taste_snapshots ENABLE ROW LEVEL SECURITY;

CREATE POLICY taste_affinities_user ON taste_affinities FOR ALL USING (auth.uid() = user_id);
CREATE POLICY taste_domains_user ON taste_domains FOR ALL USING (auth.uid() = user_id);
CREATE POLICY taste_axes_user ON taste_axes FOR ALL USING (auth.uid() = user_id);
CREATE POLICY taste_summaries_user ON taste_summaries FOR ALL USING (auth.uid() = user_id);
CREATE POLICY taste_snapshots_user ON taste_snapshots FOR ALL USING (auth.uid() = user_id);
```

### Schema Design Decisions

**Why separate tables instead of one `taste_preferences` table?** Each level has fundamentally different structure. Affinities are key-value strengths. Domains are clusters with constituent lists and spanning categories. Axes are continuous positions on scales. A single table with CHECK constraints would be fighting the data model instead of serving it.

**Why freeform dimensions instead of a taxonomy?** The engine's value proposition is that it discovers concepts the user didn't pre-define. A hardcoded taxonomy ("home.furniture.chairs") would miss "Raw Craft" — a cross-category concept that emerges from a user who saves hand-thrown ceramics, selvedge denim, and hand-built tube amplifiers. Freeform dimensions let the vocabulary grow with the data.

**Why not embeddings (yet)?** Vector embeddings (pgvector) are the industry standard for similarity retrieval at scale. But our scale (hundreds to low thousands of pins per user, not millions) doesn't justify the complexity. The structured model is interpretable, debuggable, and directly injectable into LLM prompts. Embeddings become valuable when we need cross-user similarity (collaborative filtering) or when the affinity space outgrows explicit structure — both are Phase 4 concerns.

**Why `position` on axes is computed at write time, not read time?** Unlike affinities (which decay), axis positions represent a structural aesthetic tendency. They change when the engine recomputes (monthly or on threshold), not continuously. Decay makes sense for "how much do you care about X" (strength fades without reinforcement) but not for "where do you sit on the minimal↔maximalist spectrum" (that's a position, not an intensity).

**Why snapshots store the full state?** Drift detection requires comparing "taste then" to "taste now." Storing the full preference vector monthly (affinities + domains + axes) makes comparison trivial and avoids expensive historical reconstruction.

---

## Derivation Pipeline

### Overview: What Generates What

Each level is generated from the level below it. The key distinction: **Levels 1-2 are purely algorithmic** (no LLM calls, deterministic, fast). **Levels 3-5 use LLM synthesis** (non-deterministic, cached aggressively). This means the foundation is cheap and always fresh, and the expensive narrative layers are only regenerated when the foundation shifts meaningfully.

```
Pin saved
  → analyze-content runs (already exists, already paid for)
  → taste_tags, practical_tags, entities written to links table
                    │
                    ▼
  ┌─────────────────────────────────────────────────────────────┐
  │  LEVEL 1→2: AFFINITY EXTRACTION (algorithmic, no LLM)      │
  │  Trigger: every 5 new pins, or on-demand                    │
  │  Method: weighted tag frequency + entity co-occurrence       │
  │  Cost: ~10ms compute, $0                                    │
  └─────────────────────────┬───────────────────────────────────┘
                            │
              taste_affinities upserted
              e.g., { dimension: 'brutalist_architecture', strength: 0.85 }
              e.g., { dimension: 'natural_wine', strength: 0.72 }
                            │
  ┌─────────────────────────────────────────────────────────────┐
  │  LEVEL 2→3: DOMAIN CLUSTERING (algorithmic + LLM labeling)  │
  │  Trigger: every 20 new pins, or weekly                      │
  │  Method: affinity co-occurrence clustering → LLM names them  │
  │  Cost: ~200ms compute + 1 Claude Haiku call (~$0.002)       │
  └─────────────────────────┬───────────────────────────────────┘
                            │
              taste_domains upserted
              e.g., { label: 'Raw Craft', spanning: [home, wear, eat] }
              e.g., { label: 'Dark Industrial Techno', spanning: [listen] }
              taste_summaries regenerated per domain
                            │
  ┌─────────────────────────────────────────────────────────────┐
  │  LEVEL 3→4: AXIS POSITIONING (algorithmic + LLM discovery)  │
  │  Trigger: every 30 new pins, or monthly                     │
  │  Method: tag-to-axis mapping for seeds + LLM for new axes   │
  │  Cost: ~50ms compute + 1 conditional Haiku call (~$0.001)   │
  └─────────────────────────┬───────────────────────────────────┘
                            │
              taste_axes upserted
              e.g., { axis: 'density', position: 0.2, low: 'minimal', high: 'maximalist' }
              e.g., { axis: 'craft_vs_industrial', position: 0.3, ... } (discovered)
                            │
  ┌─────────────────────────────────────────────────────────────┐
  │  LEVEL 4→5: SENSIBILITY SYNTHESIS (LLM only)                │
  │  Trigger: monthly, or 50+ new pins since last generation    │
  │  Method: LLM reads axes + domains → produces narrative      │
  │  Cost: 1 Claude Haiku call (~$0.002)                        │
  └─────────────────────────┬───────────────────────────────────┘
                            │
              taste_summaries (scope='global') regenerated
              taste_snapshots row inserted
```

---

### Level 1→2: Affinity Extraction

**What it does:** Converts the bag of per-pin tags into a user-level weighted interest profile. The key: **dimensions are not predefined** — they emerge from whatever vocabulary the user's collection produces.

**Input:** All rows from `links` where the user has pins with `taste_tags` and/or `practical_tags` populated.

**Algorithm:**

```javascript
function extractAffinities(pins) {
  // Step 1: Build compound dimensions from tag co-occurrence
  // A pin tagged ["brutalist", "architecture"] produces the compound
  // dimension "brutalist_architecture" (taste + practical intersection)
  // A pin tagged ["minimal", "warm"] produces "minimal" AND "warm"
  // as separate dimensions (both are taste_tags, no compounding)

  const dimensionSignals = new Map(); // dimension → { count, recency[], categories[] }

  for (const pin of pins) {
    const age = daysSince(pin.created_at);
    const recencyWeight = Math.exp(-0.005 * age); // half-life ~139 days

    // Compound dimensions: each taste_tag × each practical_tag
    // "minimal" + "furniture" → "minimal_furniture"
    // "raw" + "ceramics" → "raw_ceramics"
    for (const taste of pin.taste_tags) {
      for (const practical of pin.practical_tags) {
        const compound = `${taste}_${practical}`;
        upsertSignal(dimensionSignals, compound, recencyWeight, pin.category);
      }
    }

    // Solo taste tags as dimensions (aesthetic signals without object anchor)
    for (const taste of pin.taste_tags) {
      upsertSignal(dimensionSignals, taste, recencyWeight * 0.5, pin.category);
      // Lower weight for solo tags — they're less specific
    }

    // Entity-based dimensions
    for (const entity of (pin.entities || [])) {
      if (entity.confidence > 0.7) {
        const dim = `${entity.type}:${entity.name}`.toLowerCase();
        upsertSignal(dimensionSignals, dim, recencyWeight * 0.8, pin.category);
      }
    }
  }

  // Step 2: Normalize and threshold
  const maxCount = Math.max(...[...dimensionSignals.values()].map(s => s.weightedCount));

  const affinities = [];
  for (const [dimension, signal] of dimensionSignals) {
    const strength = signal.weightedCount / maxCount;
    if (strength < 0.05 || signal.count < 2) continue; // prune noise

    affinities.push({
      dimension,
      strength,
      signal_count: signal.count,
      source_tags: signal.tags,
      source_categories: [...new Set(signal.categories)]
    });
  }

  // Step 3: Merge (collapse near-synonyms)
  // "minimalist" and "minimal" → keep the more frequent, sum strengths
  return mergeNearSynonyms(affinities);
}
```

**Synonym merging** is the one tricky part. The engine maintains a lightweight synonym map (seeded, not exhaustive):

```javascript
const SYNONYM_MAP = {
  'minimalist': 'minimal', 'minimalism': 'minimal',
  'retro': 'vintage', 'nostalgic': 'vintage',
  'handmade': 'artisanal', 'handcrafted': 'artisanal',
  'lo-fi': 'lo_fi', 'lofi': 'lo_fi',
  // ... ~50 common merges. Grows over time from observed data.
};
```

When a tag isn't in the map, it stays as-is. The engine doesn't try to be clever — it lets the user's vocabulary stand. If someone consistently uses "brutalist" and never "brutalism," that's their word.

**Output:** `taste_affinities` rows. Example for a 200-pin collection:

```
dimension                    strength  signal_count  source_categories
───────────────────────────  ────────  ────────────  ─────────────────
minimal_furniture            0.85      14            [home]
brutalist_architecture       0.78      11            [home, read]
natural_wine                 0.72       9            [eat, read]
dark_electronic              0.68       8            [listen]
japanese_ceramics            0.65       7            [home, eat]
minimal                      0.61      22            [home, wear, listen, use]
raw                          0.54      16            [home, wear, eat]
artisanal                    0.51      13            [home, eat, wear]
brand:aesop                  0.48       6            [use, home]
concept:wabi_sabi            0.44       5            [home, read, eat]
```

Notice: `minimal` appears both as a compound (`minimal_furniture`) and as a solo dimension. The solo version has lower per-signal weight but spans 4 categories — this is what will later become an aesthetic axis. The compound version is a specific topic affinity.

**Trigger:** Runs client-side after every 5 new pins. Takes ~10ms for 1,000 pins. No network call, no AI cost.

---

### Level 2→3: Domain Clustering

**What it does:** Groups affinities that co-occur into coherent "taste domains" — the emergent organizing concepts that replace hardcoded categories as the taste scaffold. Then names them.

**Why this is the hardest step:** Clustering is well-understood algorithmically. But naming the clusters — turning `{minimal_furniture, japanese_ceramics, concept:wabi_sabi, artisanal}` into "Quiet Japanese Craft" — requires understanding that these are aesthetically related, not just statistically co-occurring. This is where the LLM earns its cost.

**Algorithm: Two phases.**

**Phase A: Co-occurrence clustering (algorithmic, no LLM)**

```javascript
function clusterAffinities(affinities) {
  // Build co-occurrence matrix: which affinities appear on the same pins?
  // Two affinities "co-occur" if they share source pins (derived from
  // overlapping source_tags on the same pin).

  // But we don't store per-pin affinity membership — so we approximate:
  // affinities with overlapping source_categories AND compatible source_tags
  // are considered co-occurring.

  // More precisely: go back to the raw pins and check which affinities
  // would have been derived from the same pin.

  const coMatrix = buildCoOccurrenceMatrix(affinities, userPins);

  // Agglomerative clustering with cosine similarity on co-occurrence vectors
  // Start: each affinity is its own cluster
  // Merge: join the two clusters with highest average co-occurrence
  // Stop: when max inter-cluster similarity drops below threshold (0.15)
  //        or when cluster count reaches floor(affinity_count / 3)

  let clusters = affinities.map(a => ({
    id: generateId(),
    members: [a.dimension],
    categories: new Set(a.source_categories),
    totalStrength: a.strength
  }));

  while (clusters.length > Math.max(2, Math.floor(affinities.length / 5))) {
    const { i, j, similarity } = findMostSimilarPair(clusters, coMatrix);
    if (similarity < 0.15) break;
    clusters = mergeClusters(clusters, i, j);
  }

  return clusters;
}
```

**Phase B: LLM labeling (one call for all clusters)**

```
You are a taste profiler. A user's collection of saved links has been analyzed.
Their interests cluster into the groups below. Each group is defined by the
affinities (interest dimensions) that co-occur — things the user saves together.

Your job: name each cluster as a TASTE DOMAIN — a coherent concept that
explains why these interests belong together.

Groups:
${clusters.map((c, i) => `
Group ${i + 1}:
  Affinities: ${c.members.join(', ')}
  Spans categories: ${[...c.categories].join(', ')}
  Combined strength: ${c.totalStrength.toFixed(2)}
  Representative pin titles: ${c.sampleTitles.join(' | ')}
`).join('\n')}

For each group, return:
{
  "domains": [
    {
      "group": 1,
      "label": "2-5 word taste domain name (e.g., 'Quiet Japanese Craft', 'Dark Industrial Techno')",
      "summary": "1-2 sentence description of this taste domain — what it is and what connects the parts",
      "confidence": 0.0-1.0
    }
  ]
}

RULES:
- Labels should be SENSIBILITIES, not object categories. "Quiet Japanese Craft" not "Japanese Things."
- Labels should be specific enough to search for and find more of.
- If a group spans multiple board categories, the label should name what BRIDGES them, not list them.
- A group that's just one strong affinity (e.g., "natural_wine") can have a simple label ("Natural Wine Culture").
- Do not use brand names, artist names, or platform names in labels.
```

**How many domains does a user get?** It depends on the data:

| Collection size | Typical affinities | Typical domains |
|----------------|-------------------|-----------------|
| 20 pins | 8-12 | 2-3 |
| 50 pins | 20-30 | 4-6 |
| 200 pins | 50-80 | 6-12 |
| 500+ pins | 100-150 | 10-20 |

**When do domains change?** Domains are recomputed when:
- 20+ new pins since last computation
- A weekly scheduled check detects that the affinity landscape shifted (top-10 affinities differ from what the domains were built on)
- User manually triggers refresh from Taste Profile View

**Domain stability:** When recomputing, the engine compares new clusters to existing domains by member overlap. If a new cluster overlaps 60%+ with an existing domain, it's treated as an evolution (label may update, id persists). If overlap < 30%, it's a new domain. This prevents the user's taste vocabulary from churning every recomputation.

**Output:** `taste_domains` rows + `taste_summaries` rows (one per domain).

---

### Level 3→4: Axis Positioning

**What it does:** Identifies continuous aesthetic dimensions that span the user's entire collection. Unlike affinities (which are specific interests) and domains (which are coherent clusters), axes capture *how* the user likes things — the structural aesthetic tendencies that apply everywhere.

**The generation question is: how do you go from a bag of taste_tags to positions on aesthetic scales?**

**Answer: Two mechanisms — seed axes (algorithmic) and discovered axes (LLM-assisted).**

#### Mechanism A: Seed Axes (purely algorithmic)

The engine ships with 6 seed axes. Each has a mapping table: which taste_tags push the position toward which end.

```javascript
const SEED_AXES = {
  density: {
    low: { label: 'minimal', tags: ['minimal', 'sparse', 'clean', 'simple', 'restrained', 'pared_back'] },
    high: { label: 'maximalist', tags: ['maximalist', 'layered', 'dense', 'ornate', 'elaborate', 'busy'] }
  },
  temperature: {
    low: { label: 'cool', tags: ['cool', 'stark', 'clinical', 'austere', 'sterile'] },
    high: { label: 'warm', tags: ['warm', 'cozy', 'organic', 'inviting', 'soft', 'earthy'] }
  },
  era: {
    low: { label: 'vintage', tags: ['vintage', 'retro', 'classic', 'heritage', 'antique', 'nostalgic'] },
    high: { label: 'contemporary', tags: ['modern', 'contemporary', 'futuristic', 'cutting_edge', 'forward'] }
  },
  formality: {
    low: { label: 'raw', tags: ['raw', 'lo_fi', 'rough', 'unfinished', 'diy', 'punk', 'gritty'] },
    high: { label: 'polished', tags: ['refined', 'polished', 'precise', 'luxury', 'elegant', 'curated'] }
  },
  complexity: {
    low: { label: 'simple', tags: ['simple', 'straightforward', 'utilitarian', 'functional'] },
    high: { label: 'intricate', tags: ['complex', 'detailed', 'layered', 'nuanced', 'rich'] }
  },
  production: {
    low: { label: 'artisanal', tags: ['artisanal', 'handmade', 'craft', 'bespoke', 'small_batch'] },
    high: { label: 'industrial', tags: ['mass_produced', 'industrial', 'commercial', 'scalable'] }
  }
};
```

**Position computation:**

```javascript
function computeSeedAxisPosition(axis, userAffinities) {
  let lowScore = 0, highScore = 0, totalWeight = 0;

  for (const affinity of userAffinities) {
    // Check if any of the affinity's source_tags match axis endpoints
    for (const tag of affinity.source_tags) {
      if (axis.low.tags.includes(tag)) {
        lowScore += affinity.strength;
        totalWeight += affinity.strength;
      }
      if (axis.high.tags.includes(tag)) {
        highScore += affinity.strength;
        totalWeight += affinity.strength;
      }
    }
  }

  if (totalWeight < 0.3) return null; // Not enough signal — don't report this axis

  // Position: 0.0 = fully low-end, 1.0 = fully high-end
  return highScore / (lowScore + highScore);
}
```

An axis only appears in the user's profile if there's sufficient signal (total contributing tag weight > 0.3). A user who never saves anything tagged with density-related terms simply doesn't have a density axis — it's not forced.

**Confidence** is derived from signal volume: `confidence = min(1.0, totalWeight / 2.0)`. An axis with 0.3 total weight has 0.15 confidence (barely there). An axis with 5.0+ total weight has full confidence (clear pattern).

#### Mechanism B: Discovered Axes (LLM-assisted)

Seed axes cover common aesthetic dimensions. But a user might have a consistent pattern that doesn't map to any seed: e.g., a tension between "digital/screen-based" content and "physical/tangible" content that consistently splits their collection.

**Detection heuristic:** After seed axes are computed, the engine looks at the affinity landscape for *unused structure* — taste_tags that appear frequently (strength > 0.3, across 2+ categories) but don't map to any seed axis tag list.

```javascript
function findUnmappedStructure(affinities, seedAxes) {
  const allSeedTags = new Set();
  for (const axis of Object.values(seedAxes)) {
    axis.low.tags.forEach(t => allSeedTags.add(t));
    axis.high.tags.forEach(t => allSeedTags.add(t));
  }

  // Find frequent cross-category taste_tags not captured by any seed axis
  const unmapped = affinities.filter(a =>
    a.strength > 0.3 &&
    a.source_categories.length >= 2 &&
    !a.source_tags.some(t => allSeedTags.has(t)) &&
    !a.dimension.includes(':') // exclude entity-type dimensions
  );

  if (unmapped.length < 4) return []; // Not enough structure to discover an axis
  return unmapped;
}
```

If there are 4+ unmapped cross-category affinities, the engine asks Claude Haiku to identify whether they form a coherent axis:

```
These taste signals appear across multiple categories in a user's collection
but don't map to standard aesthetic dimensions (density, temperature, era, etc.):

${unmapped.map(a => `- "${a.dimension}" (strength: ${a.strength}, categories: ${a.source_categories.join(', ')})`).join('\n')}

Do these signals suggest a coherent aesthetic dimension — a spectrum the user's
taste sits on? If yes, name both ends of the spectrum.

Return JSON:
{ "is_axis": true/false,
  "axis_name": "short_snake_case_name",
  "low_label": "one end",
  "high_label": "other end",
  "reasoning": "why these form a coherent dimension" }

If they don't form a coherent axis (they're just miscellaneous tags), return
{ "is_axis": false }.
```

Discovered axes get `is_seed = false` in the database. They're re-validated on each recomputation — if the underlying affinities decay below threshold, the discovered axis is removed.

---

### Level 4→5: Sensibility Synthesis

**What it does:** Produces the highest-order narrative — a 2-3 sentence description of the user's overall taste sensibility, plus 3-5 value tags. This is the "single paragraph a trusted curator would write about you."

**Why LLM is necessary here:** Sensibility is inherently linguistic. No algorithm can go from `{density: 0.2, temperature: 0.7, domains: ["Quiet Japanese Craft", "Dark Industrial Techno", "Natural Wine Culture"]}` to a coherent narrative about what connects them. This is a genuine synthesis task.

**Input assembly:**

```javascript
function buildSensibilityContext(userId) {
  const axes = await db.query('SELECT * FROM taste_axes WHERE user_id = $1 AND confidence > 0.3', [userId]);
  const domains = await db.query('SELECT * FROM taste_domains WHERE user_id = $1 ORDER BY confidence DESC LIMIT 10', [userId]);
  const topAffinities = await db.query('SELECT * FROM taste_affinities WHERE user_id = $1 ORDER BY strength DESC LIMIT 20', [userId]);

  // Cross-category affinities (the ones that bridge)
  const crossCategory = topAffinities.filter(a => a.source_categories.length >= 3);

  return {
    axes: axes.map(a => `${a.axis}: ${a.position.toFixed(1)} (${a.low_label} ↔ ${a.high_label})`),
    domains: domains.map(d => `"${d.label}" — ${d.summary}`),
    bridging: crossCategory.map(a => `${a.dimension} (across ${a.source_categories.join(', ')})`),
    stats: { pinCount, collectionAge, categoryCount, domainCount }
  };
}
```

**Prompt:**

```
A user's complete taste profile:

AESTHETIC AXES (where they sit on continuous scales):
${context.axes.join('\n')}

TASTE DOMAINS (the coherent clusters in their collection):
${context.domains.join('\n')}

BRIDGING INTERESTS (themes that cross 3+ categories):
${context.bridging.join('\n')}

COLLECTION: ${stats.pinCount} items, ${stats.collectionAge} months old, ${stats.domainCount} taste domains

Write a 2-3 sentence SENSIBILITY — the deep thread connecting all of this.
What kind of person collects these things? What underlying values or aesthetic
instincts unite their diverse interests?

Also extract 3-5 VALUE TAGS — single words or short phrases that capture
the core principles (e.g., "restraint", "craft over convenience", "depth over breadth").

Do not list domains or categories. Identify the current beneath them.

Return JSON: {
  "sensibility": "2-3 sentence narrative",
  "values": ["value1", "value2", "value3"],
  "confidence": 0.0-1.0
}
```

**Staleness check:** The sensibility is regenerated when:
- 50+ new pins since last generation
- A monthly cron job detects that the snapshot delta (current axes vs. axes at last generation) exceeds a drift threshold of 0.15 on any axis
- User manually triggers from Taste Profile View

**Output:** `taste_summaries` (scope='global') + snapshot row in `taste_snapshots`.

---

### How Categories Evolve

The existing board categories are a starting taxonomy: `home, wear, watch, listen, use, eat, go, follow, read`. They're useful for initial pin organization. But the taste engine can push the taxonomy itself to evolve:

**1. Domain-suggested categories.** When a taste domain emerges that doesn't align with any existing category, the engine can suggest creating a new board. Example: a user saves 15 items spanning `home`, `wear`, and `eat` that all cluster into a "Japanese Craft" domain → the engine suggests "Create a 'craft' board?"

**2. Category merging signals.** If a user's `home` and `wear` pins consistently cluster into the same domains with high overlap, the categories aren't doing useful organizational work for that user. The engine can surface this: "Your home and wear saves share most of the same aesthetic — want to merge them?"

**3. Sub-category emergence.** Within a single category, the engine may discover multiple distinct domains. A `listen` collection might produce "Dark Industrial Techno" and "Jazz Piano Standards" as separate domains — these could become sub-boards or filters.

**4. Custom vocabulary.** Users who create custom boards with specific names (e.g., "brutalism," "fermentation") are making explicit taste declarations. The engine treats custom board names as high-confidence affinity dimensions (signal_type = 'explicit') and uses them to seed domain labels.

None of this requires the base categories to change in Boards itself — the UI taxonomy and the taste taxonomy are decoupled. Board categories are a UI convenience. Taste domains are the engine's organizing intelligence. They can diverge.

---

## The Taste × Intent Problem

### The Tension

The taste engine models *how* you like things — aesthetic preference, cultural sensibility, the vibe. But users don't navigate their collections by vibe alone. They navigate by **intent** — *what they're going to do with it.*

A pin for a minimal oak desk could sit at the intersection of:
- **Taste:** Warm Scandinavian Minimalism domain, density axis = minimal, production axis = artisanal
- **Intent:** "I'm buying furniture for my office" / "design reference for a client" / "gift idea for my partner" / "I just think it's beautiful"

These are orthogonal. The same taste profile produces completely different navigation needs depending on what the user is trying to do. And the same intent ("buying furniture") pulls from different taste domains depending on the user.

If the engine only supports taste-based navigation, a user who wants "show me all the things I need to actually buy" has to scan every domain and every category manually. If it only supports intent-based navigation, a user who wants "show me everything that matches my Japanese Craft sensibility" is back to category-hopping.

**The engine needs both axes, and it needs them to be combinable.**

### What We Already Have (Intent Signals)

The system already captures several intent-adjacent signals — we just haven't named them as an intent layer:

| Existing Signal | Where It Lives | What It Tells Us |
|----------------|---------------|-----------------|
| **Board category** (`home`, `wear`, `eat`, etc.) | `links.category` | Domain of use — "I want this for my home" |
| **Content type** (`product`, `article`, `video`, `recipe`, etc.) | `links.content_type` | What the content IS — products imply shopping intent, articles imply learning |
| **Content structure** (`reference`, `review`, `original_expression`, etc.) | `links.content_structure` | How the content is organized — references are for later use, reviews are for decisions |
| **Consumption state** (`watched`, `read`) | `links.watched`, `links.read` | Whether the user has acted on this pin |
| **Custom board names** | `board_metadata.metadata` | User-declared organizational intent — a board named "office redesign" IS an intent declaration |
| **Capture source** | `links.capture_source` | How it was saved — context menu saves of text selections suggest research intent |

### What's Missing (Intent Dimensions)

The signals above are scattered and implicit. The taste engine has a structured model (affinities → domains → axes). Intent has nothing equivalent. To make intent a first-class navigation axis, it needs:

**1. Save Intent** — Why did you save this? Not the content type, not the category — the *purpose.*

```
┌─────────────────────────────────────────────────────────────┐
│ Intent Spectrum                                             │
│                                                             │
│ ACQUIRE ←→ REFERENCE ←→ APPRECIATE                          │
│                                                             │
│ "I want to buy/    "I need this for    "I saved this        │
│  get/go to this"    a project or        because it's        │
│                     future lookup"      beautiful/important" │
│                                                             │
│ Examples:           Examples:           Examples:            │
│ - Product to buy    - Design reference  - Architecture      │
│ - Restaurant to     - Recipe to try     - Photography       │
│   try               - Article to cite   - Essay I admire    │
│ - Event to attend   - Tool to evaluate  - Album I love      │
└─────────────────────────────────────────────────────────────┘
```

**2. Action State** — Where is this pin in its lifecycle?

```
UNPROCESSED → ACTIVE → DONE → ARCHIVED

"Haven't     "Currently    "Bought it /    "No longer
 looked at    considering   went there /     relevant,
 this yet"    / using"      read it"         but kept"
```

**3. Temporal Horizon** — When is this pin relevant?

```
NOW → SOON → SOMEDAY → ONGOING

"Need this    "Next few    "No rush,      "Always
 today"       weeks"       just saving"    relevant"
```

### How Intent Gets Captured

Intent is harder to capture than taste because it's **contextual and mutable** — the same pin can shift from "someday" to "now" when a project starts. Three capture mechanisms, ordered by signal strength:

**A. Inferred from existing data (automatic, low confidence)**

```javascript
function inferIntent(pin) {
  // Content type → likely intent
  const typeIntentMap = {
    product: 'acquire',
    place: 'acquire',       // restaurant, venue → go there
    event: 'acquire',       // event → attend
    recipe: 'reference',    // recipe → try someday
    article: 'reference',   // article → read/cite
    tool: 'reference',      // tool → evaluate/use
    video: 'appreciate',    // default to appreciate, shift if unwatched
    music: 'appreciate',
    book: 'reference',      // book → read
  };

  // Content structure modifies the inference
  if (pin.content_structure === 'reference') return 'reference';
  if (pin.content_structure === 'review') return 'acquire'; // reading reviews = decision-making

  // Consumption state modifies action state
  const actionState = (pin.watched === false || pin.read === false) ? 'unprocessed' : 'done';

  return {
    intent: typeIntentMap[pin.content_type] || 'appreciate',
    action: actionState,
    horizon: 'someday', // default; needs explicit signal to be anything else
    confidence: 0.3     // low — this is a guess
  };
}
```

**B. Derived from board context (automatic, medium confidence)**

Custom board names carry strong intent signal:
- A board named "office redesign" → pins on it have intent = `acquire`, horizon = `soon`
- A board named "inspiration" → pins on it have intent = `appreciate`, horizon = `ongoing`
- A board named "gift ideas" → intent = `acquire`, horizon = `soon`
- A board named "to read" → intent = `reference`, action = `unprocessed`

The engine can learn board-name-to-intent mappings, starting with a seed dictionary and growing from user behavior.

**C. Explicit user declaration (on-demand, high confidence)**

The lowest-friction capture: when the user is looking at a pin, they can tag its intent with a single tap. This is NOT a required step — the system works with inferred intent. But explicit intent is the strongest signal.

```
┌─────────────────────────────┐
│  Minimal Oak Writing Desk   │
│  [image]                    │
│                             │
│  Intent: ○ Buy  ○ Reference │
│          ○ Appreciate       │
│                             │
│  Status: ○ Need  ○ Got it   │
└─────────────────────────────┘
```

### The Navigation Model: Taste × Intent Grid

With both axes available, navigation becomes a 2D space. The user can enter from either side:

**Enter from taste:** "Show me my Quiet Japanese Craft domain" → see all pins in that taste cluster, then filter by intent (what am I buying? what's just reference? what have I already acquired?)

**Enter from intent:** "Show me everything I want to buy" → see all pins with acquire intent, then filter by taste domain (which domain am I shopping in? what's the aesthetic I'm targeting?)

**Combined query examples:**

| User question | Taste filter | Intent filter |
|--------------|-------------|--------------|
| "Minimal furniture I should buy" | density axis < 0.3 + practical_tag = furniture | intent = acquire, action ≠ done |
| "Design references for my Japanese Craft board" | domain = "Quiet Japanese Craft" | intent = reference |
| "What have I been meaning to read?" | (any taste) | content_type = article/book, action = unprocessed |
| "Things I love but will never buy" | (any taste, high strength affinities) | intent = appreciate |
| "Underground techno I haven't listened to yet" | domain = "Dark Industrial Techno" | action = unprocessed |

**UI navigation surfaces:**

```
┌─────────────────────────────────────────────────────────────────┐
│  BROWSE BY TASTE                    BROWSE BY INTENT             │
│                                                                  │
│  ┌──────────────────────┐          ┌──────────────────────┐     │
│  │ Quiet Japanese Craft │          │ 🛒 To Acquire  (34)  │     │
│  │   home · eat · read  │          │ 📎 Reference   (89)  │     │
│  │   47 pins            │          │ ✦  Appreciate  (156) │     │
│  ├──────────────────────┤          ├──────────────────────┤     │
│  │ Dark Industrial      │          │ To Do:               │     │
│  │   Techno             │          │   ○ Unprocessed (42) │     │
│  │   listen             │          │   ○ Active     (18)  │     │
│  │   23 pins            │          │   ● Done       (67)  │     │
│  ├──────────────────────┤          └──────────────────────┘     │
│  │ Raw Scandinavian     │                                        │
│  │   Minimalism         │          CROSS-FILTER:                 │
│  │   home · wear        │          [Quiet Japanese Craft] ×      │
│  │   31 pins            │          [To Acquire] = 8 pins         │
│  └──────────────────────┘                                        │
└─────────────────────────────────────────────────────────────────┘
```

### How Intent Differs From Taste Architecturally

| Property | Taste | Intent |
|----------|-------|--------|
| **Stability** | Slow-changing. Your aesthetic evolves over months/years | Fast-changing. You buy the desk and intent flips from "acquire" to "done" in a second |
| **Source** | Derived from content signals (taste_tags, entities) | Derived from user behavior + explicit declaration |
| **Scope** | Per-user, cross-collection | Per-pin, mutable |
| **Aggregation** | Affinities aggregate across pins into domains | Intent doesn't aggregate — it's per-item, not per-user |
| **Navigation role** | "What do I like?" — filters by aesthetic coherence | "What do I need?" — filters by actionability |
| **Decay** | Strength decays without reinforcement | Intent doesn't decay — it transitions (unprocessed → done) |

This means intent is NOT another level in the taste hierarchy. It's a **parallel dimension that attaches to individual pins**, not a user-level profile. The taste engine models who you are; intent models what you're doing.

### Schema Addition

```sql
-- ============================================================
-- pin_intent: Per-pin intent and action state
-- Parallel to taste (which is per-user). Intent is per-pin.
-- ============================================================
CREATE TABLE pin_intent (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  link_id UUID NOT NULL REFERENCES links(id) ON DELETE CASCADE,
  intent TEXT NOT NULL DEFAULT 'appreciate' CHECK (intent IN ('acquire', 'reference', 'appreciate')),
  action_state TEXT NOT NULL DEFAULT 'unprocessed' CHECK (action_state IN ('unprocessed', 'active', 'done', 'archived')),
  horizon TEXT DEFAULT 'someday' CHECK (horizon IN ('now', 'soon', 'someday', 'ongoing')),
  confidence REAL NOT NULL DEFAULT 0.3,  -- 0.3 = inferred, 0.7 = board-derived, 1.0 = explicit
  inferred_from TEXT,                     -- 'content_type', 'board_name', 'user_explicit'
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, link_id)
);

CREATE INDEX idx_pin_intent_user ON pin_intent(user_id);
CREATE INDEX idx_pin_intent_intent ON pin_intent(user_id, intent);
CREATE INDEX idx_pin_intent_action ON pin_intent(user_id, action_state);

ALTER TABLE pin_intent ENABLE ROW LEVEL SECURITY;
CREATE POLICY pin_intent_user ON pin_intent FOR ALL USING (auth.uid() = user_id);
```

### Integration With Taste

Intent doesn't change the taste model — it runs alongside it. But the two combine at the navigation and query layer:

```javascript
// Taste-filtered, intent-filtered query
function queryCollection({ userId, domainId, intent, actionState }) {
  let query = supabase.from('links').select('*, pin_intent(*)');

  if (domainId) {
    // Get pin_ids from taste_domains
    const domain = await getDomain(userId, domainId);
    query = query.in('id', domain.pin_ids);
  }

  if (intent) {
    query = query.eq('pin_intent.intent', intent);
  }

  if (actionState) {
    query = query.eq('pin_intent.action_state', actionState);
  }

  return query;
}
```

**For LLM conditioning**, intent modifies *how* the taste summary is used:

```typescript
const tasteSummary = await getTasteSummary(userId, 'global');
const domainSummary = await getDomainSummary(userId, relevantDomain);

// Intent-aware prompt conditioning
if (intent === 'acquire') {
  prompt += `The user is actively looking to purchase/acquire items.
  Their taste: ${domainSummary}
  Prioritize actionable, available, purchasable recommendations.`;
} else if (intent === 'reference') {
  prompt += `The user is collecting references for a project.
  Their taste: ${domainSummary}
  Prioritize depth, variety, and unexpected connections over buyability.`;
} else {
  prompt += `The user collects for appreciation and inspiration.
  Their taste: ${domainSummary}
  Prioritize discovery, aesthetics, and cross-domain connections.`;
}
```

### Phasing Intent

Intent is a lighter system than taste (no LLM calls, no clustering, no axes). It can ship incrementally:

| Phase | What ships | How intent is captured |
|-------|-----------|----------------------|
| Phase 1 (with Taste Engine Phase 1) | `pin_intent` table + auto-inference from content_type | Automatic, low confidence |
| Phase 2 (with Taste Engine Phase 2) | Board-name-to-intent mapping + intent in Profile View | Semi-automatic, medium confidence |
| Phase 3 | Explicit intent picker in pin detail view + intent-based navigation sidebar | User-declared, high confidence |

---

## Temporal Evolution

### Decay Model

Affinity strengths decay over time if not reinforced. This prevents stale interests from dominating — if you stopped saving brutalist architecture 6 months ago, it shouldn't rank as high as what you're saving now.

```
effective_strength = strength * e^(-λ * days_since_last_reinforced)
```

**Decay applies only to affinities (Level 2).** Higher levels are recomputed from the current affinity landscape, so they automatically reflect decay without needing their own decay function.

| Data | λ (decay constant) | Half-life | Rationale |
|------|-------------------|-----------|-----------|
| Derived affinities | 0.005 | ~139 days | Topical interests shift with seasons and phases |
| Explicit affinities (user-corrected) | 0.0025 | ~277 days | User told us directly — respect it longer |
| Entity affinities (brand:X, person:X) | 0.003 | ~231 days | Brand/creator loyalty is stickier than topic interest |

Domains, axes, and sensibility don't decay — they're regenerated fresh from the current (already-decayed) affinities on their respective schedules.

### Reinforcement

When a new pin is saved and analyzed, the engine checks which existing affinities it would contribute to:

```javascript
function reinforceAffinities(pin, existingAffinities) {
  const newSignals = extractPinSignals(pin); // same logic as affinity extraction, single pin

  for (const signal of newSignals) {
    const existing = existingAffinities.find(a => a.dimension === signal.dimension);
    if (existing) {
      // EMA update: blend new signal with existing strength
      existing.strength = 0.3 * signal.strength + 0.7 * existing.strength;
      existing.last_reinforced = now();
      existing.signal_count += 1;
    }
    // New dimensions are created during the next full affinity extraction
  }
}
```

Reinforcement is lightweight (runs inline with pin save, ~5ms) and only touches existing affinities. New dimensions are discovered during the next scheduled extraction.

### Drift Detection

Monthly, the system:
1. Takes a snapshot of current preference vectors
2. Compares against the snapshot from 30/90/180 days ago
3. Identifies significant shifts:
   - **New interest:** Preference appears with strength > 0.3 that didn't exist 90 days ago
   - **Fading interest:** Preference dropped > 0.3 in strength over 90 days
   - **Axis shift:** Aesthetic axis moved > 0.2 on its scale over 90 days
4. Stores drift events for Lookback to surface

---

## Downstream Consumers

### 1. Search Personalization

**Current:** Keyword matching against pin titles, descriptions, tags.

**With Taste Engine:** After keyword matching produces candidates, re-rank by taste affinity.

```javascript
function personalizeSearchResults(results, userAffinities) {
  return results.map(pin => {
    let tasteBoost = 0;

    // Boost pins whose taste_tags match user's strong affinities
    for (const tag of pin.taste_tags) {
      const affinity = userAffinities.find(a => a.dimension === tag || a.source_tags.includes(tag));
      if (affinity) tasteBoost += affinity.strength * 0.1;
    }

    // Boost pins whose practical_tags form compound affinities with user's taste
    for (const ptag of pin.practical_tags) {
      for (const ttag of pin.taste_tags) {
        const compound = `${ttag}_${ptag}`;
        const affinity = userAffinities.find(a => a.dimension === compound);
        if (affinity) tasteBoost += affinity.strength * 0.15;
      }
    }

    return { ...pin, score: pin.searchScore + tasteBoost };
  }).sort((a, b) => b.score - a.score);
}
```

### 2. LLM Prompt Conditioning

**Current:** Widget prompts include raw pin data. No user context.

**With Taste Engine:** Every Claude call that generates user-facing content includes the relevant taste summary.

```typescript
// Before (current)
const prompt = `You are a style advisor. Analyze these saved items: ${pins}`;

// After (with taste engine)
// Find the most relevant domain for this widget's context
const domains = await getTasteDomains(userId);
const relevantDomain = domains.find(d => d.spanning_categories.includes(widgetCategory));
const globalSummary = await getTasteSummary(userId, 'global');

// tasteSummary: "Gravitates toward minimal Scandinavian design with muted earth
// tones. Prefers independent brands over luxury houses. Values craft and
// materiality over trend-following."

const prompt = `You are a style advisor.

The user's overall sensibility: ${globalSummary}
${relevantDomain ? `Their specific taste in this area: "${relevantDomain.label}" — ${relevantDomain.summary}` : ''}

Analyze these saved items: ${pins}

Tailor your recommendations to align with their established taste while
occasionally suggesting adjacent discoveries they haven't explored yet.`;
```

This conditioning happens at the infrastructure level — widget configs don't need to change. The `generate-widget` function automatically finds the most relevant taste domain for the widget's category and prepends both the domain summary and the global sensibility.

### 3. Recommendations

**Current:** Per-category widgets suggest products based on raw pin attributes.

**With Taste Engine:** Recommendations filter through aesthetic axes and taste domains.

```
User searches for "desk lamp" in their collection.
Without taste: Returns all desk lamp pins, ranked by recency.
With taste (density axis: 0.2 minimal, era axis: 0.6 contemporary):
  Ranks minimal, contemporary desk lamps higher.
  De-ranks ornate, vintage desk lamps.
  Suggests: "Based on your 'Quiet Japanese Craft' domain, you might also
  like these architects' lamps — they share the restraint and materiality
  of what you usually save."
```

### 4. Lookback Scoring

**Current:** Lookback (planned) uses temporal and interaction signals.

**With Taste Engine:** Collection Intelligence signals (Layer 4 in Lookback PRD) become computable.

```javascript
// Taste drift signal for Lookback
function tasteDriftScore(pin, driftEvents) {
  // If this pin belongs to a fading interest, surface it for reflection
  const fadingMatch = driftEvents.find(d =>
    d.type === 'fading' && pin.taste_tags.includes(d.value)
  );
  if (fadingMatch) return { score: 0.6, label: `Your ${fadingMatch.value} phase` };

  // If this pin was early in an emerging interest, surface it as origin story
  const emergingMatch = driftEvents.find(d =>
    d.type === 'emerging' && pin.taste_tags.includes(d.value)
  );
  if (emergingMatch && pinAge > 90) return { score: 0.5, label: `Where your ${emergingMatch.value} interest started` };

  return { score: 0, label: null };
}
```

### 5. Smart Boards (Future)

Auto-generated read-only boards that group pins by taste domain rather than category:
- "Quiet Japanese Craft" — pins from the user's Japanese Craft taste domain, spanning home, eat, and read
- "Dark Industrial Techno" — a domain that happens to align with one category, but surfaced as a coherent aesthetic
- "Raw Craft" — a discovered cross-category domain the user didn't explicitly organize

Smart boards are literally the `pin_ids` from `taste_domains` rendered as a board view. The domain label becomes the board name. The domain summary becomes the board description. No new data model needed.

### 6. Events For You

**Current:** Hacks together `tasteContext` from scratch each time.

**With Taste Engine:** Reads pre-computed taste summaries and domain identities. No redundant clustering.

### 7. Taste × Intent Navigation

The primary new navigation surface. Users can browse their entire collection through a 2D grid:

```
             ┌───────────────┬───────────────┬───────────────┐
             │   Acquire     │   Reference   │   Appreciate  │
┌────────────┼───────────────┼───────────────┼───────────────┤
│ Quiet      │ oak desk,     │ wabi-sabi     │ ceramic       │
│ Japanese   │ sashiko jacket│ article,      │ exhibition,   │
│ Craft      │               │ joinery book  │ Judd gallery  │
├────────────┼───────────────┼───────────────┼───────────────┤
│ Dark       │ modular synth,│ Resident      │ Objekt DJ     │
│ Industrial │ club tickets  │ Advisor guide,│ set, warehouse│
│ Techno     │               │ DAW tutorial  │ photography   │
├────────────┼───────────────┼───────────────┼───────────────┤
│ Natural    │ wine shop,    │ fermentation  │ vineyard      │
│ Wine       │ bar to visit  │ article, book │ documentary   │
│ Culture    │               │ on terroir    │               │
└────────────┴───────────────┴───────────────┴───────────────┘
```

Users enter from whichever axis matters to them in the moment:
- **"I'm shopping"** → enter from intent column "Acquire" → see taste domains as rows
- **"What's in my Japanese Craft world?"** → enter from taste domain → see intent columns
- **"What haven't I acted on?"** → filter by action_state = unprocessed → see both axes

---

## User-Facing Visibility

### Taste Profile View

Accessible from Settings or the Taste Map. Transparent, not hidden.

```
┌─────────────────────────────────────────────────────┐
│  YOUR TASTE PROFILE                                 │
│                                                     │
│  Sensibility                                        │
│  "You gravitate toward restraint, craft, and        │
│   authenticity. Your collection reveals someone     │
│   who values the intentional over the abundant..."  │
│                                                     │
│  Aesthetic Axes                                      │
│  density     ▓▓░░░░░░░░  minimal                    │
│  temperature ░░░░░░▓▓▓░  warm                       │
│  era         ░░░▓▓▓░░░░  mid-century                │
│  formality   ▓▓▓░░░░░░░  raw                        │
│  production  ▓▓▓░░░░░░░  artisanal                  │
│  ┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄               │
│  ✦ digital↔physical  ░░░░░░░▓▓░  physical           │
│    (discovered from your collection)                │
│                                                     │
│  Taste Domains                                      │
│  Quiet Japanese Craft         ●●●●●                 │
│    home · eat · read                                │
│  Dark Industrial Techno       ●●●●○                 │
│    listen                                           │
│  Raw Scandinavian Minimalism  ●●●○○                 │
│    home · wear                                      │
│  Natural Wine Culture         ●●●○○                 │
│    eat · read                                       │
│                                                     │
│  Top Affinities                                     │
│  minimal_furniture       0.85  ████████░░           │
│  brutalist_architecture  0.78  ███████░░░           │
│  natural_wine            0.72  ███████░░░           │
│  japanese_ceramics       0.65  ██████░░░░           │
│                                                     │
│  [Edit]  [Refresh]  [Reset]                         │
│                                                     │
│  Last updated: 2 days ago | Based on 847 pins       │
│  7 taste domains · 6 axes (1 discovered)            │
└─────────────────────────────────────────────────────┘
```

Key differences from the v1 design:
- **Domains are not per-category.** "Quiet Japanese Craft" spans home, eat, and read. "Raw Scandinavian Minimalism" spans home and wear. The user sees their taste organized by *sensibility*, not by content type.
- **Discovered axes are distinguished.** Seed axes look normal. Discovered axes get a `✦` marker and explanation, making the engine's learning visible.
- **Domains show which categories they span.** This surfaces the cross-category connections that are the engine's unique value — "I didn't realize my ceramics and my food saves were the same taste."

### User Corrections

Users can interact with all three visible levels:

**Affinities:**
- **Boost:** "Yes, I really am into this" → strength * 1.5, signal_type = 'explicit'
- **Suppress:** "Not really me" → strength * 0.3, signal_type = 'corrected'
- **Add:** "You missed this" → manual entry, signal_type = 'explicit'

**Domains:**
- **Rename:** Change the LLM-generated label to something that fits better
- **Merge:** "These two domains are actually the same thing to me" → combines constituent affinities
- **Split:** "This domain is actually two different interests" → triggers re-clustering of its affinities
- **Delete:** "This doesn't represent my taste" → removes domain, constituent affinities retain their individual strengths

**Axes:**
- **Adjust position:** Drag the marker on the scale if the engine got it wrong
- **Remove a discovered axis:** "This isn't a real dimension for me"

Explicit and corrected signals have a lower decay rate (λ * 0.5) — the user told us directly, so we should respect it longer. User renames of domain labels persist through recomputation (they override LLM-generated labels for that cluster).

---

## Industry Positioning and Competitive Depth

### What Others Do

| Platform | Approach | Strength | Gap |
|----------|----------|----------|-----|
| **Pinterest** | Hierarchical interest taxonomy, Pin2Interest ML mapping | Scale (200K+ taxonomy nodes, 200B+ pins mapped) | No aesthetic modeling — knows *what* you like, not *how* you like it |
| **Spotify** | Multi-time-scale embeddings, 2,000+ taste communities | Temporal sophistication (week/month/half-year), audio-native signals | Domain-locked to music; no cross-domain aesthetic intelligence |
| **Netflix** | Taste communities + altgenres | Engagement-optimized, handles long-tail content well | Optimizes for consumption, not curation quality |
| **TikTok** | Real-time collaborative filtering, session-level adaptation | Speed — learns in minutes, not days | No persistent taste model; serves the session, not the person |
| **Goodreads** | Explicit ratings + genre affinities | Direct user input | No aesthetic modeling; "liked sci-fi" not "prefers sparse prose" |

### Where ctrl.rodeo Goes Deeper

**1. Cross-domain aesthetic modeling.** No major platform connects a user's music taste to their design taste to their food taste. Pinterest knows you like mid-century furniture but doesn't know that connects to your love of bossa nova and Japanese ceramics. The Taste Engine's aesthetic axes are inherently cross-category — `aesthetic.density = minimal` applies everywhere.

**2. Natural language as the interface.** Most recommendation systems are black boxes — embeddings in, ranked items out. The Taste Engine produces human-readable summaries at every level. Users can see, understand, and correct their profile. This transparency is both a feature (trust) and an architecture (LLM-injectable summaries work with any model, forever).

**3. Curation quality over consumption volume.** Every major platform optimizes for engagement — time spent, items consumed. The Taste Engine optimizes for *fit* — does this recommendation actually match who you are? A small, perfectly curated collection is more valuable than an infinite feed. This is a fundamentally different optimization target.

**4. Preference archaeology.** The snapshot and drift detection system makes taste evolution itself a feature. "You used to gravitate toward maximalism, now you're deeply minimal" is insight no platform surfaces. The collection becomes a record of personal evolution.

**5. User-owned, portable preference data.** Following the Human Context Protocol (HCP) pattern, taste summaries are natural language strings that could be exported and used with any other tool. The preference data belongs to the user, not the platform.

---

## Phasing

### Phase 1: Affinities + Domain Discovery + Intent Inference (MVP)

**Build the algorithmic foundation. Discover taste domains. Infer intent. Make LLM calls taste-aware.**

| Component | Description | Depends On | LLM? |
|-----------|-------------|------------|------|
| `taste_affinities` table | Schema + migrations + RLS | Nothing | No |
| `taste_domains` table | Schema + migrations + RLS | Nothing | No |
| `taste_summaries` table | Schema + migrations + RLS | Nothing | No |
| `pin_intent` table | Schema + migrations + RLS | Nothing | No |
| Level 1→2: Affinity extraction | Client-side tag aggregation → weighted interests | Existing analyze-content pipeline | No |
| Level 2→3: Domain clustering | Co-occurrence clustering + LLM labeling | Affinities | Yes (1 Haiku call) |
| Intent auto-inference | Infer intent from content_type + content_structure for all pins | Existing analyze-content data | No |
| LLM prompt conditioning | Inject domain summaries into generate-widget | taste_summaries | No |
| Events For You integration | Replace ad-hoc tasteContext with domain summaries | taste_summaries | No |

**Activation threshold:** 10+ pins with taste_tags populated.

**AI cost:** 1 Claude Haiku call per user per domain recomputation (~weekly) ≈ $0.002/user/week. Intent inference is algorithmic — $0.

**What changes for users:** Widget responses become noticeably more personalized. Events For You improves. No new UI yet. Domains and intent exist in the database but aren't surfaced.

### Phase 2: Axes + Profile Visibility + Intent Navigation

**Add aesthetic modeling. Show users their taste profile. Enable taste × intent browsing.**

| Component | Description | Depends On | LLM? |
|-----------|-------------|------------|------|
| `taste_axes` table | Schema + migrations + RLS | Nothing | No |
| Level 3→4: Seed axis positioning | Algorithmic tag-to-axis mapping | Phase 1 affinities | No |
| Level 3→4: Axis discovery | LLM identifies new axes from unmapped structure | Phase 1 affinities | Conditional |
| Taste Profile View | Settings-accessible profile UI (domains + axes + affinities) | Phase 1 + axes | No |
| User corrections | Boost/suppress affinities, rename domains, adjust axes | Phase 2 profile view | No |
| Search re-ranking | Taste-weighted search results | Phase 1 affinities | No |
| `taste_snapshots` table | Monthly preference snapshots for drift | Phase 1 + axes | No |
| Board-name intent mapping | Derive intent from custom board names | Phase 1 pin_intent + board_metadata | No |
| Taste × Intent sidebar | Browse by domain or by intent (acquire/reference/appreciate) | Phase 1 domains + intent | No |

**Activation threshold:** 30+ pins, 2+ taste domains discovered.

**AI cost:** +1 conditional Haiku call per user per month for axis discovery ≈ $0.001/user/month.

**What changes for users:** They can see their taste profile. Domains and axes are visible and correctable. Search feels smarter. **New navigation: browse by taste domain OR by intent.** The "I'm shopping" view and the "show me my Japanese Craft world" view both work.

### Phase 3: Sensibility + Intelligence

**Add the highest abstraction level. Enable drift detection, smart boards, and Lookback integration.**

| Component | Description | Depends On | LLM? |
|-----------|-------------|------------|------|
| Level 4→5: Sensibility synthesis | Global taste narrative from axes + domains | Phase 2 axes + Phase 1 domains | Yes (1 Haiku call) |
| Drift detection | Monthly snapshot comparison → drift events | Phase 2 snapshots | No |
| Lookback integration | Taste drift signals for Lookback scoring | Drift detection + Lookback PRD | No |
| Smart boards (prototype) | Auto-generated boards from taste_domains.pin_ids | Phase 1 domains | No |
| Taste-Map integration | Taste Map reads from taste_domains + taste_affinities | Phase 1 tables | No |
| Category evolution suggestions | "Create a 'craft' board?" from domain patterns | Phase 1 domains | No |

**Activation threshold:** 50+ pins, 6+ months of collection history, 3+ taste domains.

**AI cost:** +1 Haiku call per user per month for sensibility ≈ $0.002/user/month.

**What changes for users:** Taste Map loads faster (reads cached data). Lookback surfaces taste drift. Smart boards appear for qualifying collections. The system starts suggesting new board categories based on emergent domains.

### Phase 4: Embeddings + Cross-User (Future)

**When scale demands it, add vector representations for cross-user intelligence.**

| Component | Description | Depends On |
|-----------|-------------|------------|
| pgvector embeddings | Dense user taste vectors from affinity profiles | Phase 3 full model |
| Collaborative signals | "Users with similar taste also saved..." | Embeddings + multi-user scale |
| Taste-based discovery | Cross-user recommendation feed | Collaborative signals |
| Portable export | HCP-compatible preference export | Full preference model |
| Domain vocabulary sharing | Common domain labels across users (e.g., "Quiet Luxury" as a shared concept) | Multi-user domains |

**Trigger:** 1,000+ active users, or when structured query performance degrades.

---

## Cost Model

| Component | Per-User Cost | At 100 Users | At 1,000 Users |
|-----------|--------------|-------------|----------------|
| Phase 1: Tag aggregation | Compute only | $0 | $0 |
| Phase 1: Identity synthesis (Haiku) | ~$0.003/week | $1.20/month | $12/month |
| Phase 2: Axis extraction (Haiku) | ~$0.001/month | $0.10/month | $1/month |
| Phase 3: Sensibility (Haiku) | ~$0.001/month | $0.10/month | $1/month |
| Storage: taste_preferences | ~100 rows/user | Negligible | Negligible |
| Storage: taste_summaries | ~12 rows/user | Negligible | Negligible |
| Storage: taste_snapshots | ~12 rows/user/year | Negligible | Negligible |

**Total Phase 1-3:** ~$1.40/month at 100 users, ~$14/month at 1,000 users.

---

## Privacy & Data Handling

| Data | Storage | Retention | Access |
|------|---------|-----------|--------|
| Preference records | `taste_preferences`, Supabase | Account lifetime (pruned if strength < 0.1 for 90 days) | User only (RLS) |
| Taste summaries | `taste_summaries`, Supabase | Regenerated weekly-monthly; old versions not retained | User only (RLS) |
| Snapshots | `taste_snapshots`, Supabase | 2 years rolling | User only (RLS) |
| User corrections | `taste_preferences` with signal_type='corrected' | Account lifetime | User only (RLS) |

**Principles:**
- No preference data is shared between users (no collaborative filtering until Phase 4, and only with consent)
- Users can view, correct, and delete their entire taste profile
- Taste summaries are generated from the user's own data only — no external behavioral data
- No third-party analytics or ad targeting — preferences serve the user, not monetization

---

## Non-Functional Requirements

| Requirement | Target |
|-------------|--------|
| Tag aggregation (Level 1→2) for 1,000 pins | < 200ms client-side |
| Taste summary retrieval for LLM injection | < 50ms (single row query) |
| Full profile load (all levels) | < 300ms |
| Identity synthesis (Claude Haiku call) | < 3s |
| Sensibility narrative (Claude Haiku call) | < 5s |
| Preference update after new pin | < 100ms (async, non-blocking) |
| Snapshot comparison for drift detection | < 500ms |

---

## Feature & Code Impact Analysis

This section maps every file, function, and system that the Taste Engine touches across the codebase. It's the implementation planning companion to the architectural design above.

### New Code to Write

| Component | Type | Phase | Estimated Size | Description |
|-----------|------|-------|----------------|-------------|
| `030_taste_engine_tables.sql` | Migration | 1 | ~120 lines | Creates `taste_affinities`, `taste_domains`, `taste_summaries`, `pin_intent` tables with indexes and RLS |
| `031_taste_axes_snapshots.sql` | Migration | 2 | ~60 lines | Creates `taste_axes`, `taste_snapshots` tables with indexes and RLS |
| `supabase/functions/taste-engine/index.ts` | Edge function | 1 | ~600 lines | Core engine: affinity extraction, domain clustering, axis positioning, sensibility synthesis, intent inference. The largest new function |
| Client: Affinity extraction module | JS in boards | 1 | ~200 lines | Client-side `extractAffinities()` — runs after every 5 pins, writes to `taste_affinities` via Supabase |
| Client: Intent inference module | JS in boards | 1 | ~100 lines | Client-side `inferIntent()` — runs on each pin, writes to `pin_intent` via Supabase |
| Client: Taste Profile View | JS/HTML in boards | 2 | ~400 lines | New UI section: axes sliders, domain cards, affinity list, correction controls, discovered-axis markers |
| Client: Taste × Intent navigation | JS/HTML in boards | 2 | ~300 lines | New navigation sidebar: browse by domain OR by intent, cross-filter grid |

### Existing Code Changes by Impact Severity

#### High Impact (Core behavior changes)

| File | Current Lines | What Changes | Phase | Risk |
|------|--------------|--------------|-------|------|
| **`boards/index.html`** ~L8822-9024: Taste context cache | `buildClustersFromLinks()` builds ad-hoc clusters client-side, calls `taste-graph` edge function | Replace with reads from `taste_domains` + `taste_summaries` tables. Remove ad-hoc clustering entirely. `loadTasteContext()` becomes a simple Supabase query | 1 | Medium — Events widget depends on this; verify tasteContext shape compatibility |
| **`boards/index.html`** ~L7970-8040: `generateWidgetContent()` | Posts to `/functions/v1/generate-widget` with `{ widgetId, prompt, items, category }` | Add `tasteSummary` and `domainSummary` to the payload. Widget prompts become taste-conditioned | 1 | Low — additive change, server ignores extra fields until `generate-widget` is updated |
| **`supabase/functions/generate-widget/index.ts`** | Builds Claude prompts from `items` + `category` context only | Read `taste_summaries` for the user (global + relevant domain). Prepend taste conditioning to every widget prompt. ~50 lines added to prompt builder | 1 | Medium — prompt changes affect all widget outputs. A/B test recommended |
| **`supabase/functions/recommend-events/index.ts`** (v1.1.0) | Accepts `tasteContext` from client in request body (L61, L328-344) | Read `taste_domains` + `taste_summaries` from DB directly instead of trusting client-supplied context. Remove `tasteContext` from API contract | 1 | Low — improves data integrity; client code simplifies |

#### Medium Impact (New functionality added to existing files)

| File | What Changes | Phase | Risk |
|------|--------------|-------|------|
| **`boards/index.html`** ~L14942: `matchesSearch()` | Currently searches: title, domain, description, category, url, notes. Add: `taste_tags`, `practical_tags`, entity names, affinity dimensions | 2 | Low — additive, no existing behavior changes |
| **`boards/index.html`** ~L14134: `renderFilters()` | Currently renders category tokens + search + sub-tag bar. Add: taste domain filter tokens (browsable), intent filter chips (acquire/reference/appreciate), action state filter (unprocessed/active/done) | 2 | Medium — filter bar is already crowded. UX design needed for progressive disclosure |
| **`boards/index.html`** ~L18790: `openDetail()` / overlay HTML (~L5949) | Currently shows: image, title, domain, description, category, date, visit/move/delete buttons. Add: intent picker radio (Buy / Reference / Appreciate), action state toggle (Need / Got it), taste domain badge(s) | 2-3 | Low — additive UI, no existing behavior removed |
| **`boards/index.html`** ~L9067: `loadEventsForYouWidget()` | Currently calls `loadTasteContext()` → builds clusters → calls `taste-graph` → passes to `recommend-events`. Replace entire flow with: read `taste_summaries` from Supabase → pass as structured context to `recommend-events` | 1 | Medium — simplification, but must verify event recommendation quality doesn't regress |
| **`boards/index.html`** ~L11888: `SUB_TAGS` object | Hardcoded per-category dimensions (type: tops/bottoms/etc). Taste domains offer a richer, user-specific alternative. Phase 3: domain-derived sub-dimensions could supplement or replace static SUB_TAGS | 3 | Medium — SUB_TAGS work well as-is. Don't remove until domain-based alternatives prove better |

#### Low Impact (Minor additions or no changes needed)

| File | Status | Notes |
|------|--------|-------|
| `supabase/functions/analyze-content/index.ts` (v1.0.0) | **No changes needed** | Already produces Level 1 signals (taste_tags, practical_tags, entities, content_type, content_structure). The taste engine consumes these outputs downstream |
| `supabase/functions/categorize/index.ts` | **No changes needed** | Fixed category list (`CATEGORIES`) stays. Taste domains are decoupled from board categories by design |
| `supabase/functions/create-pin/index.ts` (v2.0.0) | **Optional Phase 1 hook** | After successful pin creation, trigger affinity reinforcement (~5 lines: call `reinforceAffinities()` or fire-and-forget to taste-engine) |
| `supabase/functions/instagram-import/index.ts` (v1.3.0) | **Optional Phase 1 hook** | After import completes (produces taste_tags, practical_tags), trigger batch affinity extraction for imported pins |
| `supabase/functions/taste-graph/index.ts` (v0.6.0) | **Phase 3 deprecation candidate** | Currently generates cluster labels from scratch using Sonnet + Haiku. After Phase 3, `taste_domains` already have LLM-generated labels. Function becomes redundant. Decision: keep as fallback for users without taste engine data, or remove |
| `boards/index.html` ~L11778: `CATEGORIES` array | **No changes** | The 9 fixed categories remain as a UI organizing principle. Taste domains are a parallel system |
| `boards/index.html` ~L18003: `PinRanker` (TF-IDF) | **Phase 2 enhancement** | Board suggestions could incorporate taste affinity scores alongside TF-IDF similarity. Additive |
| `boards/index.html` ~L20470: Lookback Feature | **Phase 3 integration** | Lookback scoring adds taste drift signals. New signal type in `scorePinForLookback()` |
| All other edge functions (22 functions) | **No changes needed** | `agent-handler`, `ask-episode`, `cache-events`, `documentation-agent`, `enrich-event`, `enrich-link`, `enrich-music`, `enrich-wear`, `fetch-source`, `generate-podcast`, `generate-subcategories`, `generate-suggestions`, `ingest-history`, `notion-sync`, `scan-image`, `scrape-discord-events`, `systemic-analyze`, `systemic-fetch`, `tasks`, `validate-image`, `validate-source`, `youtube-import` |

### Taste Map Migration (Phase 3)

The Taste Map (`taste-map/`) is a standalone React + Three.js app that currently computes clusters from scratch. Phase 3 migrates it to read from the Taste Engine's persisted data.

| Component | Current State | After Migration | Complexity |
|-----------|--------------|-----------------|------------|
| **`src/lib/supabase.ts` — `fetchPins()`** | `SELECT * FROM links` → full pin data | Add: `SELECT * FROM taste_domains WHERE user_id = ?` and `SELECT * FROM taste_affinities WHERE user_id = ?`. Pins still needed for detail views | Low |
| **`src/lib/clustering.ts` — `buildClusters()`** | k-means++ on TF-IDF vectors, O(n²) per iteration, ~200ms for 500 pins | **Replace entirely** with `taste_domains` rows. Each domain IS a cluster: `{ label, summary, pin_ids, spanning_categories, constituent_affinities }`. The 350-line clustering module becomes a 30-line adapter | High savings |
| **`src/lib/tfidf.ts`** | Full TF-IDF pipeline: tokenize, IDF, vectorize | **Remove** as primary pipeline. Keep for drill-down sub-clustering if that stays client-side | Medium |
| **`CATEGORY_DOMAIN_MAP`** (clustering.ts L9-12) | Maps single category → domain name: `listen → music` | Replace with `taste_domains.spanning_categories[]`. Domains can span multiple categories. Coloring/placement logic needs multi-category handling | Medium |
| **`CATEGORY_ANGLE_MAP`** (force.ts L30-39) | Maps each category to an angular sector for 3D placement | Cross-category domains break sector-based placement. Options: (a) sphere layout by default, (b) blended angle from `spanning_categories`, (c) similarity-based placement from shared affinities | Medium |
| **`callTasteGraphFunction()`** (supabase.ts) | Sends cluster inputs → `taste-graph` edge function → returns labels + insights | **Remove entirely**. `taste_domains` already have LLM-generated `label` and `summary`. No edge function call needed | High savings |
| **`taste_profiles` table cache** | Cache keyed by `(user_id, pin_hash)`. Stores full cluster objects | **Redundant**. `taste_domains` is the authoritative store. `taste_profiles` can be deprecated or kept for cache-miss fallback | Low |
| **Edge rendering (`buildEdges()`)** | Cosine similarity between TF-IDF centroid vectors | Derive edges from shared `constituent_affinities` overlap between domains. Currently, the taste engine schema doesn't persist edges — either add `taste_edges` table or compute client-side from affinity overlaps | Medium |
| **`ClusterDescription` type** | 3-part: `{ whatItIs, whyYou, howItChanged }` | `taste_domains.summary` is a single text field. Either: (a) Taste Engine generates 3-part descriptions, (b) `ConceptDetail.tsx` renders single summary, (c) LLM splits summary on-demand | Design decision |

### Version Bumps Required

| Product | Current Version | Bump Type | New Version | When |
|---------|----------------|-----------|-------------|------|
| Boards (`boards/index.html` L6539) | `2.11.1` | Minor (feature) | `2.12.0` | Phase 1: taste conditioning + intent inference |
| Boards | `2.12.0` | Minor (feature) | `2.13.0` | Phase 2: profile view + navigation |
| `generate-widget` | No VERSION defined | Add `1.0.0` | `1.1.0` | Phase 1: taste-conditioned prompts |
| `recommend-events` | `1.1.0` | Minor | `1.2.0` | Phase 1: DB-sourced taste context |
| `taste-graph` | `0.6.0` | Deprecation | — | Phase 3: replaced by taste_domains |
| NEW: `taste-engine` | — | Initial | `1.0.0` | Phase 1 |

### Risk Assessment

#### High Risk

| Risk | Impact | Mitigation |
|------|--------|------------|
| **Domain clustering instability** | If domains churn labels/membership on every recomputation, users lose their mental model. "Quiet Japanese Craft" becomes "Minimal Asian Design" next week | 60% overlap rule preserves domain IDs across recomputations. User-renamed labels persist through re-clustering. Label stability test: run clustering on same data 5x and measure label drift |
| **Compound dimension explosion** | 5 taste_tags × 5 practical_tags = 25 compounds per pin. 500 pins → 12,500 candidate dimensions before pruning | Pruning threshold (< 0.05 strength OR < 2 occurrences) should reduce to ~100-150. Validate empirically with real user data. Add hard cap at 300 dimensions |
| **Taste Map convergence** | Two different clustering outputs (TF-IDF vs taste_domains) for the same collection confuse users | Open question #5 in PRD. Resolution needed before Phase 3. Options: converge (taste_domains feeds Taste Map), or keep Taste Map as independent visualization |

#### Medium Risk

| Risk | Impact | Mitigation |
|------|--------|------------|
| **Widget prompt regression** | Taste conditioning changes Claude's behavior for all widget outputs. Some widgets may get worse | A/B test: taste-conditioned vs unconditioned widgets. Confidence threshold: only inject taste summary if `confidence > 0.3`. Rollback flag per widget |
| **Intent inference accuracy** | `content_type → intent` mapping will be wrong for many pins (article saved to buy the book ≠ reference intent) | Start with low confidence (0.3). Never block navigation on inferred intent. Explicit override mechanism. Board-name mapping (Phase 2) improves accuracy |
| **Filter bar overcrowding** | Adding taste domains + intent + action state to the existing category filter bar creates too many tokens | Progressive disclosure: taste/intent navigation in a separate sidebar or tab, not inline with category tokens. Show only when collection has 3+ domains |
| **Events widget regression** | Replacing ad-hoc `tasteContext` with DB-sourced taste summaries could change recommendation quality | Shadow-test: run both paths for 2 weeks, compare relevance scores. Fall back to ad-hoc path if taste_domains empty |

#### Low Risk

| Risk | Impact | Mitigation |
|------|--------|------------|
| **Schema additions** | All new tables, no modifications to existing tables | Clean forward migration. No backward compatibility concerns |
| **Search enhancement** | Adding taste_tags/practical_tags to `matchesSearch()` | Additive. No existing search behavior changes. Results only get better |
| **Cost** | $14/month at 1,000 users (all Haiku calls) | Well within budget. Phase 4 (embeddings) is the cost threshold to watch |
| **Performance** | Affinity extraction ~10ms, profile load ~300ms | Within NFR targets. Taste summary injection adds ~50ms to widget calls |

### Backward Compatibility

| Component | Backward Compatible? | Notes |
|-----------|---------------------|-------|
| Database schema | Yes | All new tables. No existing column changes. Existing queries unaffected |
| `analyze-content` output | Yes | Level 1 signals unchanged. Taste engine consumes existing outputs |
| Widget API contract | Yes (Phase 1) | `generate-widget` accepts taste context as optional field. Old clients without it still work |
| `recommend-events` API | Breaking (Phase 1) | Client currently sends `tasteContext` in request body. After migration, server reads from DB. Client should stop sending it. Graceful: server uses DB data if available, falls back to client-supplied |
| Taste Map data | Breaking (Phase 3) | `taste_profiles` cache format changes. Clear cache on migration. First load after migration recomputes |
| Boards search | Yes | New fields added to `matchesSearch()`. Existing matches unchanged |
| Category system | Yes | `CATEGORIES` array and `categorize` API unchanged. Taste domains are additive |

### Deployment Sequence

Phase 1 ships as a single coordinated release:

```
1. Deploy migration 030_taste_engine_tables.sql
   → Creates taste_affinities, taste_domains, taste_summaries, pin_intent tables
   → No impact on running system (empty tables)

2. Deploy taste-engine edge function (new)
   → Available but not called until client code ships

3. Deploy updated generate-widget (taste conditioning)
   → Reads taste_summaries if they exist, falls back gracefully if empty
   → Safe to deploy before data exists

4. Deploy updated recommend-events (DB-sourced taste)
   → Reads taste_domains if they exist, falls back to client tasteContext
   → Safe to deploy before data exists

5. Ship boards/index.html update
   → Client-side affinity extraction runs on load
   → Intent inference runs on each pin
   → Triggers taste-engine edge function for domain clustering
   → Taste data populates → widgets and events improve automatically

6. Backfill: run taste-engine for existing users (one-time batch)
```

---

## Open Questions

1. **Synonym map governance.** The affinity extraction uses a lightweight synonym map (~50 entries) to merge near-identical tags. How does this map grow? Options: (a) manual curation, (b) periodic LLM call to identify merges from the observed tag corpus, (c) user-driven ("these two affinities are the same thing"). Each has different cost and accuracy profiles.

2. **Interaction signals.** The current model derives preferences only from what users save. Should we also weight by interaction depth — pins that are clicked, expanded, shared getting more influence than pins saved and forgotten? This overlaps with Lookback's `pin_interactions` tracking. Inclusion would strengthen affinities for engaged-with content and weaken affinities for save-and-forget patterns.

3. **Negative preferences and filter bubbles.** The model captures what users like. Should it also capture what they actively avoid? If a user consistently saves minimal design, should "maximalist" be a negative signal that de-ranks results? Risk: this creates filter bubbles — the exact thing we criticize other platforms for. Counter: a taste engine for *curation* (not consumption) may need stronger filtering than one for *discovery*. This needs a design principle decision.

4. **Domain granularity control.** The clustering algorithm produces a variable number of domains (2-20) based on collection size. Should users have a "granularity" slider — "show me fewer, broader domains" vs "show me more, specific domains"? This maps to the agglomerative clustering stop threshold but adds UI complexity.

5. **Taste Map relationship.** The existing Taste Map computes clusters from scratch using TF-IDF + k-means++. Phase 3 proposes migrating it to read from `taste_domains`. But the Taste Map's clusters are visually optimized (force-directed layout, soft assignment) while taste domains are semantically optimized (co-occurrence, LLM labeling). Should they converge, or should the Taste Map remain an independent visualization of the same underlying data?

6. **Widget profiler consolidation.** Per-category profilers (style-summary, fan-profile, etc.) produce outputs that overlap with taste domain summaries. Should they be retired in favor of domain summaries, adapted to consume them as input, or left independent? The profilers are category-locked; domains are not. But profilers have established prompts that users see today.

7. **Compound dimension explosion.** The affinity extraction creates compounds from taste × practical tag crosses. For a pin with 5 taste_tags and 5 practical_tags, that's 25 compounds plus 5 solo taste dimensions. Across 500 pins, this could produce thousands of candidate dimensions before pruning. Is the pruning threshold (< 0.05 strength OR < 2 occurrences) aggressive enough to keep the affinity space manageable?

8. **Category evolution UX.** The engine can suggest new boards based on emergent domains. But users have invested in their current category structure — their boards have pins organized, shared URLs, muscle memory. How aggressive should category suggestions be? Options range from "never suggest" (domains stay engine-internal) to "actively propose board restructuring." This is a UX trust question more than a technical one.

---

## Success Metrics

| Metric | Target | How Measured |
|--------|--------|-------------|
| Widget relevance improvement | 20% increase in widget engagement rate | Compare widget click-through before/after taste conditioning |
| Search result quality | 15% reduction in scroll-to-click depth | Track position of clicked result in search results |
| Profile accuracy (user perception) | 70% of users rate their profile as "accurate" or "very accurate" | In-app survey on Taste Profile View |
| LLM response personalization | Blind A/B: 60% prefer taste-conditioned responses | A/B test widget outputs with/without domain summaries |
| Domain discovery quality | 80% of discovered domains rated "makes sense" by user | Implicit: domains that survive 30 days without user deletion |
| Cross-category domain rate | 40%+ of domains span 2+ categories | `taste_domains` where `array_length(spanning_categories) >= 2` |
| Axis discovery rate | 1+ discovered (non-seed) axis for collections with 100+ pins | `taste_axes` where `is_seed = false` |
| Preference coverage | 80% of active users have affinities within 30 days of threshold | `taste_affinities` row counts |
| Drift detection utility | 30% of drift-surfaced Lookback pins get engaged | `pin_interactions` where source = 'taste_drift' |
| Compute efficiency | Taste-aware features load < 100ms slower than non-taste versions | Client-side performance monitoring |

---

## Related Documents

- [PRD: Lookback](./lookback.md) — Resurfacing system that consumes taste drift signals (Layer 4)
- [PRD: Generative Widget Ecosystem](./generative-widget-ecosystem.md) — Widget system that will be conditioned by taste summaries
- [Taste Map App](/taste-map/) — Existing 3D visualization that will read from taste_preferences in Phase 3
- [analyze-content Edge Function](/supabase/functions/analyze-content/) — Source of taste_tags and practical_tags (Level 1)
- [taste-graph Edge Function](/supabase/functions/taste-graph/) — Current cluster labeling (will feed Level 3)
- [Migration 028: taste_profiles](/supabase/migrations/028_taste_profiles.sql) — Existing taste-map cache schema
- [Migration 029: sense-making columns](/supabase/migrations/029_sense_making_columns.sql) — taste_tags/practical_tags on links
- [Brand Positioning](../brand-positioning.md) — Brand principles guiding taste engine design
- [User Personas](../../ux/personas.md) — Full persona definitions
- [Cross-Category Features](../../ux/boards/cross-category.md) — Related planned features
- [Taste & Pattern Surfacing](../../ux/widgets/taste-patterns.md) — Related widget plans
- [Backlog](../../execution/project-plan/backlog.md) — Phase 12: Lookback items
