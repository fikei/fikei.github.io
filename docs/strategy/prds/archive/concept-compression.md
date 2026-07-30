> **Archived from an orphaned branch.** Recovered from `claude/concept-compression-pins-kvUr1` (last touched 2026-02-23),
> which shares no history with master after the repository history was rewritten.
> Kept for the thinking in it; nothing here is current.

# PRD: Concept Compression

**Version:** 1.0
**Date:** 2026-02-23
**Status:** Draft

---

## Overview

People save links because the content means something to them — not because of its metadata. But ctrl.rodeo's enrichment pipeline currently understands everything *about* a pin except what it actually *says*. It knows a pin is a video, knows it's from YouTube, knows the image meets visual quality standards, knows it belongs in "watch." It doesn't know it's a documentary about how the Voyager team had 12 seconds to fix the antenna before losing contact forever.

That meaning — the irreducible core idea — is what Concept Compression extracts. It's a new enrichment layer that uses AI to distill each pin into a semantic summary and a set of extracted concepts. This gives every pin a machine-readable representation of *why it matters*, which unlocks capabilities that metadata alone can't support: semantic search, concept-level clustering, cross-category connection discovery, and richer input for Lookback and widgets.

The enrichment stack today:

```
Layer 0:  Metadata         (exists — enrich-link)      "What is this called?"
Layer 1:  Classification   (exists — content type)      "What kind of thing is this?"
Layer 2:  Visual quality   (exists — image scoring)      "Does it look right?"
Layer 3:  Concept compression  (THIS PRD)                "What does this mean?"
Layer 4:  Collection synthesis (exists — widgets)         "What do my saves say together?"
```

Layer 3 is the missing middle. Without it, Layer 4 operates on titles and descriptions — marketing copy written for social cards, not for helping a human remember why they saved something. Concept compression gives downstream systems a semantic backbone.

---

## Goals

1. Give every pin a human-readable, machine-queryable representation of its core meaning
2. Enable semantic search across the collection (find by concept, not just keyword)
3. Surface cross-category connections that metadata can't detect (a recipe and an article sharing the same cultural thread)
4. Provide richer input to Lookback's collection intelligence signals and widget content generation
5. Build the foundation for concept-level clustering — grouping pins by *what they're about*, not just what category they're in

---

## Who This Serves

### Primary Personas

| Persona | Why Concept Compression Matters | Key Scenario |
|---------|--------------------------------|--------------|
| **The Researcher** | They save 40 articles across 6 months. Later, they need the ones about a specific thesis — not a specific domain or category. Concept compression lets them search "supply chain resilience" and find pins from economics blogs, YouTube lectures, and a Reddit thread. | Recall by topic, not by source |
| **The Visual Collector** | They save hundreds of design references. The difference between two pins in "wear" isn't the category — it's "oversized silhouettes" vs. "monochrome layering." Concepts make the sub-language of their taste searchable. | Precision within large categories |
| **The Multidisciplinary Maker** | A material science article and a furniture design pin both involve "bent plywood." The connection only emerges at the concept level — categories see "read" and "make," concepts see the shared thread. | Cross-category discovery |
| **The Cultural Omnivore** | They save across every category. Their collection tells a story — if you can read it. Concept compression is the layer that turns a pile of saves into a legible portrait of someone's interests. | Collection as self-portrait |

### Secondary Personas

| Persona | Why It Matters |
|---------|---------------|
| **The DJ** | Genre tags are coarse ("electronic"). Concepts capture finer grain: "UK garage revival," "ambient drone," "Brazilian bass." |
| **The Deep-Dive Enthusiast** | Their obsession phases have internal structure. Concept compression captures the arc — first "pour-over basics," then "water chemistry," then "grinder calibration." |
| **The Sound & Scene Curator** | Venues, artists, and albums saved across months share conceptual threads (a city's scene, a label's aesthetic) that categories flatten. |

### Jobs To Be Done

| When I... | I want to... | So I can... |
|-----------|-------------|-------------|
| Search my collection | Find pins by what they're about, not just keywords | Retrieve things I vaguely remember by concept |
| Browse a large category | See sub-groupings by theme | Navigate 50+ pins without scrolling through all of them |
| Start a creative project | Find everything related to a concept across all categories | Pull references I didn't know I had |
| Share a board | Have my pins described intelligently | Show others what my collection is actually about |
| Return after weeks away | Quickly re-orient on what I've collected | Remember my own taste without re-reading everything |

---

## Design Principles

| Brand Principle | Application |
|-----------------|-------------|
| **Input shapes output** | Concept compression makes the *meaning* of inputs explicit. It's the literal mechanism by which input becomes searchable, connectable output. |
| **Organize as you go** | Runs automatically during enrichment. Users never see "extract concepts" — they just find their pins understand them better over time. |
| **One place, whole life** | Cross-category concept matching is the point. A listen pin and a read pin about the same cultural moment should find each other. |
| **Show, don't decorate** | The essence is shown only when useful — in search results, expanded cards, and Lookback context labels. Never as visual clutter on the grid. |
| **Expand with the user** | Simple collections get simple essences. As the collection deepens, concept clustering and cross-category connections emerge naturally. |

---

## Core Concepts

### The Essence

A 1-2 sentence distillation of what the pin is *about* — not what it *is*. Written from the perspective of "why would someone save this?"

**Examples:**

| Pin Title | OG Description (what exists today) | Essence (what this PRD adds) |
|-----------|-----------------------------------|------------------------------|
| "The Voyager Golden Record" | "Explore the music, sounds, and images NASA sent into space" | "The 1977 team had to decide what represents all of humanity in a single object — and the constraints they worked under (115 images, 90 minutes of music) forced radical prioritization of what matters." |
| "Nike Air Max 97 Silver Bullet" | "Shop the Nike Air Max 97 in Metallic Silver" | "The shoe that made visible air a status symbol. The full-length Air unit and the bullet train-inspired ripple lines created the template for every 'futuristic retro' sneaker since." |
| "How to Make Ramen from Scratch" | "Learn the art of making authentic ramen at home" | "The 48-hour process of building tonkotsu broth — and why the collagen extraction can't be rushed — is basically a meditation on patience as an ingredient." |
| "Brutalism: An Architecture Overview" | "Explore the history and impact of Brutalist architecture" | "Brutalism as political architecture: the ideology that public buildings should be monumental and honest about their materials, and why that made them loved by designers and hated by occupants." |

The essence is **not** a summary. Summaries compress information. The essence captures the *hook* — the conceptual reason someone would find this worth saving.

### Concepts

A set of 3-7 extracted themes, ideas, or topics. These are the building blocks for clustering, search, and cross-category matching.

**Examples:**

| Pin | Concepts |
|-----|----------|
| Voyager Golden Record | `space exploration`, `curation under constraints`, `cultural representation`, `Cold War optimism`, `time capsule` |
| Nike Air Max 97 | `visible technology as design`, `sneaker culture`, `retro-futurism`, `status signaling`, `industrial design` |
| Ramen from Scratch | `slow food`, `collagen science`, `Japanese culinary tradition`, `patience as technique`, `broth fundamentals` |
| Brutalism article | `brutalist architecture`, `political design`, `material honesty`, `public space ideology`, `polarizing aesthetics` |

Concepts are:
- **Lowercase, natural language phrases** (not hashtags, not single words)
- **Meaning-bearing** (not generic — "interesting article" is never a concept)
- **Cross-category capable** — "material honesty" could link a brutalism article, a raw-edge leather jacket, and a no-makeup-makeup tutorial
- **Hierarchically aware** — "sneaker culture" is broader than "Air Max history"; both can coexist

### Concept Confidence

Each concept extraction includes a confidence score (0-1) reflecting how well the AI could understand the pin's content.

| Score | Meaning | Typical Cause |
|-------|---------|---------------|
| 0.9+ | Strong understanding | Rich title + description, clear content type |
| 0.7-0.9 | Good understanding | Decent metadata, some ambiguity |
| 0.5-0.7 | Partial understanding | Minimal metadata, generic title |
| <0.5 | Low understanding | No description, opaque URL, paywall content |

Low-confidence pins are candidates for re-extraction when the page is next visited or when richer metadata becomes available (e.g., after `enrich-link` fills in a better title or description).

---

## How It Works

### Integration into the Enrichment Pipeline

Concept compression runs as **Step 2.7** in the existing `enrich-link` edge function, after content type classification and image resolution, and after any watch/book enrichment has added structured metadata.

```
URL submitted
    │
    ▼
Step 0: Platform API metadata (YouTube, Vimeo)
Step 1: Content type classification
Step 2: Image resolution (3-tier quality gate)
Step 2.5: Watch enrichment (TMDB, YouTube API)
Step 2.6: Book enrichment (Open Library)
Step 2.7: CONCEPT COMPRESSION (NEW)  ◄━━━━━━━━━━━━━━━━━━━
Step 3: Database update
```

**Why after everything else?** Because concept compression benefits from all available context. A pin with a title, description, content type, and structured metadata (video genre, book author, music artist) produces a richer essence than a pin with just a URL. By running last, it gets the best possible input.

### The Compression Prompt

The edge function sends available metadata to Claude Haiku:

```
Given this saved link, extract its conceptual essence.

URL: {url}
Title: {title}
Description: {description}
Content Type: {content_type}
Category: {category}
Domain: {domain}
{if video: Genre: {video.genre}, Creator: {video.creator}, Year: {video.year}}
{if music: Artist: {music.artist}, Album: {music.albumTitle}, Genre: {music.genre}}
{if book: Author: {book.author}, Genre: {book.genre}, Year: {book.year}}

Return JSON:
{
  "essence": "1-2 sentences capturing WHY someone would save this — the core idea, insight, or hook. Not a summary. Write as if explaining to a friend what makes this interesting.",
  "concepts": ["3-7 concept phrases that capture the themes, ideas, and topics. Use lowercase natural language. Be specific enough to enable meaningful connections across different content types."],
  "confidence": 0.0-1.0
}

Rules:
- The essence should capture meaning, not metadata. "A YouTube video about architecture" is useless. "How Tadao Ando uses concrete to create silence" is an essence.
- Concepts should be specific but not so narrow they only match this one pin. "Tadao Ando" is too narrow. "architecture" is too broad. "meditative architecture" or "concrete as emotional material" is right.
- If the title and description are generic or missing, say what you can infer from the URL/domain and mark confidence low.
- Never include the content type as a concept (no "article", "video", "product").
- Never include the domain as a concept (no "YouTube", "Nike.com").
```

### Client-Side Fallback

For pins that fail server enrichment or when the user is offline, a lightweight client-side extraction runs using only the title and description:

```javascript
function extractLocalConcepts(pin) {
  // Simple keyword extraction from title + description
  // No AI call — uses word frequency, bigrams, and stop-word filtering
  // Returns concepts only (no essence) with confidence: 0.3
  // Marked source: 'local' for later server re-extraction
}
```

This ensures every pin has *some* concept data, even if degraded. Server-extracted concepts overwrite local ones when they arrive.

---

## Schema Changes

### New Columns on `links` Table

```sql
-- Migration: 019_concept_compression.sql

ALTER TABLE links ADD COLUMN essence TEXT;
ALTER TABLE links ADD COLUMN concepts TEXT[];  -- PostgreSQL array of concept phrases
ALTER TABLE links ADD COLUMN concept_confidence REAL;
ALTER TABLE links ADD COLUMN concept_source TEXT DEFAULT 'none';
  -- 'ai' (Claude Haiku), 'local' (client-side fallback), 'user' (manually edited), 'none'
ALTER TABLE links ADD COLUMN concept_extracted_at TIMESTAMPTZ;

-- Index for concept search
CREATE INDEX idx_links_concepts ON links USING GIN (concepts);

-- Index for low-confidence re-extraction queue
CREATE INDEX idx_links_concept_confidence ON links (concept_confidence)
  WHERE concept_confidence < 0.5 OR concept_confidence IS NULL;
```

### localStorage Extension

```javascript
// Each link object in localStorage gains:
{
  // ... existing fields ...
  essence: "string or null",
  concepts: ["array", "of", "concept", "phrases"],
  concept_confidence: 0.85,
  concept_source: "ai",        // 'ai', 'local', 'user', 'none'
  concept_extracted_at: "ISO"
}
```

---

## Surfaces

Concept data is consumed by existing and new surfaces. The concept compression system *produces* data — it doesn't own any UI. Each consumer decides how to display it.

### Surface 1: Expanded Pin Card

**Where:** The existing expanded card detail panel in `renderGrid()`.

```
┌─────────────────────────────────────────────┐
│  [Hero Image]                               │
│                                             │
│  Pin Title                                  │
│  domain.com                                 │
│                                             │
│  "The 1977 team had to decide what          │
│   represents all of humanity..."            │  ← essence
│                                             │
│  space exploration · curation under         │
│  constraints · cultural representation      │  ← concepts as tags
│                                             │
│  [Visit]  [Notes]  [Share]                  │
└─────────────────────────────────────────────┘
```

**Behavior:**
- Essence replaces OG description in the expanded view (falls back to description if no essence)
- Concepts render as subtle inline tags below the essence
- Tapping a concept tag filters the collection to all pins sharing that concept (cross-category)

### Surface 2: Search

**Where:** Existing search functionality in Boards.

Current search matches against `title`, `description`, `domain`, and `category`. Concept compression adds:

- **Essence search** — full-text match against the essence field
- **Concept search** — array containment match against concepts
- **Semantic ranking** — pins matching on concepts rank higher than pins matching on title keywords

```
Search: "material honesty"

Results:
1. Brutalism: An Architecture Overview     [read]    ← concept match: "material honesty"
2. Raw Edge Leather Wallets — Tanner Goods [wear]    ← concept match: "material honesty"
3. No-Makeup Makeup Tutorial              [watch]   ← concept match: "material honesty"
4. Honest Materialworks — Company Page     [make]    ← title keyword match
```

### Surface 3: Concept Clusters

**Where:** New optional view mode in Boards, accessible from the view toggle.

Instead of organizing by category, concept clusters group pins by shared concepts — regardless of category.

```
┌─────────────────────────────────────────────┐
│  View: [Grid] [List] [Concepts]             │
│                                             │
│  retro-futurism (4 pins)                    │
│  ┌──────┐ ┌──────┐ ┌──────┐ ┌──────┐       │
│  │ AM97 │ │Synth │ │Retro │ │Film  │       │
│  │ wear │ │listen│ │read  │ │watch │       │
│  └──────┘ └──────┘ └──────┘ └──────┘       │
│                                             │
│  patience as technique (3 pins)             │
│  ┌──────┐ ┌──────┐ ┌──────┐                │
│  │Ramen │ │Bread │ │Aging │                │
│  │ eat  │ │ eat  │ │read  │                │
│  └──────┘ └──────┘ └──────┘                │
│                                             │
│  meditative architecture (3 pins)           │
│  ┌──────┐ ┌──────┐ ┌──────┐                │
│  │Ando  │ │Light │ │Quiet │                │
│  │ read │ │watch │ │ go   │                │
│  └──────┘ └──────┘ └──────┘                │
└─────────────────────────────────────────────┘
```

**Behavior:**
- Clusters are computed client-side by counting concept co-occurrence across pins
- Minimum 2 pins sharing a concept to form a cluster
- Clusters sorted by pin count (descending), then alphabetically
- Pins can appear in multiple clusters (a pin about "brutalist architecture" with concept "material honesty" appears in both)
- Clusters with only 1 unique concept are shown as-is; clusters with overlapping concepts merge into a named group

### Surface 4: Lookback Enhancement

Concept data enriches Lookback's Signal Layer 4 (Collection Intelligence):

| Existing Signal | Enhancement from Concepts |
|----------------|--------------------------|
| **Cross-category connection** | Currently limited to geographic/domain similarity. Concepts enable "this restaurant and that article both involve fermentation culture." |
| **Emerging theme** | Currently uses title word frequency. Concepts provide actual theme detection: "you've saved 4 pins about 'analog revival' this month." |
| **Taste drift** | Currently category-level ("you used to save wear, now you save eat"). Concepts detect drift within categories: "your music taste shifted from 'UK garage' to 'ambient drone'." |

New Lookback context labels enabled by concepts:

| Signal | Label |
|--------|-------|
| Concept cluster forming | "3 recent saves about 'analog revival'" |
| Cross-category match | "This connects to your wear pin about 'material honesty'" |
| Concept drift | "Your interests shifted from X to Y" |

### Surface 5: Widget Input Enhancement

The `generate-widget` edge function currently receives `{ id, title, description, image, url }` per pin. With concept compression:

```json
{
  "id": "...",
  "title": "...",
  "description": "...",
  "essence": "The 1977 team had to decide what represents all of humanity...",
  "concepts": ["space exploration", "curation under constraints", "cultural representation"],
  "image": "...",
  "url": "..."
}
```

This gives widget prompts dramatically richer context. A "Complete the Look" widget that knows a pin is about "oversized silhouettes" and "monochrome layering" produces far better outfit suggestions than one working from "Shop the Nike ACG Collection."

---

## User Interaction with Concepts

### Viewing

- Essence appears in expanded card view, replacing OG description
- Concepts appear as subtle tags in expanded card view
- Concept clusters appear in the new Concepts view mode
- Search results show concept match indicators

### Editing

Users can edit both essence and concepts:

- **Tap essence** in expanded card → inline edit field
- **Tap concept tag** + hold → option to remove concept
- **"+ Add concept"** link at end of concept list → free text input
- Edits set `concept_source: 'user'` and are never overwritten by AI re-extraction

### Re-extraction

- Concept data can be refreshed via the existing three-dot menu → "Refresh" action
- Low-confidence pins (< 0.5) are automatically re-queued when the user opens the expanded card
- Bulk re-extraction available in admin dev tools panel

---

## Technical Architecture

### Compression Function

Added to `enrich-link/index.ts` as a new step:

```typescript
async function extractConcepts(
  url: string,
  title: string,
  description: string,
  contentType: string,
  category: string,
  richMeta?: { video?: any; music?: any; book?: any }
): Promise<{
  essence: string;
  concepts: string[];
  confidence: number;
}> {
  const prompt = buildCompressionPrompt(url, title, description, contentType, category, richMeta);

  const response = await callClaude(prompt, {
    model: 'claude-3-haiku-20240307',
    max_tokens: 300,
    temperature: 0.3  // Low temp for consistent extraction
  });

  return parseConceptResponse(response);
}
```

### Caching & Deduplication

- **Domain-level concept cache**: Similar to the existing `domain_profiles` cache for content type, store concept patterns per domain. E.g., all YouTube music videos from the same channel share concept templates.
- **Concept normalization**: Before storing, normalize concepts via lowercasing, trimming, and collapsing synonyms where obvious ("sneaker culture" and "sneaker culture" deduplicate; "shoe culture" and "sneaker culture" do not — that requires Phase 2 embedding-based deduplication).
- **Batch extraction**: For backfill, process in batches of 20 pins per edge function invocation to minimize cold starts.

### Backfill Strategy

Existing pins need concept extraction. Approach:

1. **Priority queue**: Start with pins that have the richest metadata (high `type_confidence`, non-null `description`, structured `video`/`music`/`book` data)
2. **Background processing**: Edge function `backfill-concepts` processes 50 pins per run, triggered by cron (every 6 hours)
3. **Rate limiting**: Max 200 Claude Haiku calls per hour per user during backfill to stay within API budget
4. **Progress tracking**: `concept_extracted_at IS NULL` identifies unprocessed pins

```typescript
// POST /functions/v1/backfill-concepts
// { user_id, batch_size: 50 }
// Selects pins with richest metadata first, extracts concepts, updates DB
```

### Re-extraction Triggers

| Trigger | Action |
|---------|--------|
| Pin first enriched (new save) | Extract concepts as Step 2.7 |
| Enrichment refreshed (user clicks Refresh) | Re-extract concepts with latest metadata |
| Low-confidence pin opened | Re-queue for extraction with any new metadata |
| Rich metadata added later (watch/book enrichment completes async) | Re-extract with structured metadata included |
| User edits title or description | Re-extract (preserving user-edited concepts) |

---

## Phasing

### Phase 1: Essence + Concepts (MVP)

**What ships:**
- `essence` and `concepts` fields on links table
- Concept extraction as Step 2.7 in `enrich-link`
- Client-side fallback extraction (keyword-based, no AI)
- Essence displayed in expanded card view (replaces OG description)
- Concepts displayed as tags in expanded card view
- Concept tap → filter collection by concept
- Basic concept search (array containment + full-text on essence)

**Not included:**
- Concept clusters view
- Lookback integration
- Widget input enhancement
- User editing of concepts
- Backfill of existing pins

**Personas served:** All — every pin immediately becomes more understandable

**Cost:** ~$0.001 per pin (Claude Haiku, ~150 input tokens + ~200 output tokens). At 1,000 users with 50 pins/month average: ~$50/month.

### Phase 2: Clusters + Backfill

**What ships:**
- Concept clusters view mode
- Backfill edge function for existing pins
- User editing of essence and concepts
- Concept normalization and synonym handling
- Enhanced search ranking (concept matches weighted higher)

**Personas served:** The Researcher (search), The Visual Collector (clusters within categories), The Multidisciplinary Maker (cross-category clusters)

**Cost:** Backfill one-time cost ~$0.001 per existing pin. Ongoing same as Phase 1.

### Phase 3: Intelligence Layer

**What ships:**
- Lookback Signal Layer 4 enhancement (concept-based cross-category connections, emerging themes, taste drift)
- Widget input enhancement (essence + concepts in widget prompts)
- Concept-level analytics ("your top concepts this month")
- Embedding-based concept similarity (move beyond exact string match to semantic proximity)

**Prerequisites:** Lookback Phase 1 shipped, widget instrumentation

**Personas served:** The Cultural Omnivore (taste analytics), The DJ (concept drift), The Deep-Dive Enthusiast (interest archaeology with concept granularity)

**Cost:** Embedding generation adds ~$0.0001 per pin. Similarity search uses pgvector (Supabase native). Minimal incremental cost.

---

## Non-Functional Requirements

| Requirement | Target |
|-------------|--------|
| Concept extraction latency | < 2s per pin (Claude Haiku) |
| Client-side fallback latency | < 50ms (keyword extraction, no API call) |
| Concept search latency | < 100ms (GIN index on PostgreSQL array) |
| Cluster computation (1,000 pins) | < 500ms client-side |
| Backfill throughput | 50 pins per 6-hour batch, full backfill in < 7 days for 1,000-pin collection |
| Concept storage overhead | ~200 bytes per pin (essence + concepts array) |

---

## Privacy & Data Handling

| Data | Storage | Retention | Access |
|------|---------|-----------|--------|
| Essence text | `links.essence` column, Supabase | Account lifetime | User only (RLS) |
| Concept phrases | `links.concepts` column, Supabase | Account lifetime | User only (RLS) |
| Concept confidence | `links.concept_confidence` column | Account lifetime | User only (RLS) |
| AI extraction prompts | Not stored — transient in edge function | Request duration | Not persisted |
| Concept embeddings (Phase 3) | `link_embeddings` table, Supabase | Account lifetime | User only (RLS) |

No pin content is shared across users. Concept extraction happens per-user, per-pin. Concepts are derived from metadata the user already owns (titles, descriptions, enriched fields).

---

## Cost Model

| Component | Per-Pin Cost | At 1,000 Users (50 pins/mo each) |
|-----------|-------------|-----------------------------------|
| Claude Haiku extraction | ~$0.001 | ~$50/month |
| Client-side fallback | $0 | $0 |
| PostgreSQL GIN index | Negligible | Negligible |
| Backfill (one-time, per user) | ~$0.001/pin | One-time: ~$0.50/user |
| Concept embeddings (Phase 3) | ~$0.0001/pin | ~$5/month |

**Total Phase 1:** ~$50/month at 1,000 active users
**Total Phase 2:** Same + one-time backfill cost
**Total Phase 3:** ~$55/month at 1,000 active users

This is comparable to the existing content-type classification cost, which also uses Claude Haiku per pin.

---

## Relationship to Existing Systems

### enrich-link Edge Function

Concept compression is added as a step, not a separate function. This avoids an extra HTTP round trip and lets concepts benefit from all metadata gathered in earlier steps.

### AI Categorization

Categories answer "where does this go?" Concepts answer "what is this about?" They're complementary, not competitive. A pin categorized as "wear" might have concepts "oversized silhouettes," "monochrome layering," "Japanese streetwear." The category is organizational; the concepts are semantic.

### Widgets

Widgets currently synthesize across pins using titles and descriptions. Concept data is strictly additive — widgets that want it can include `essence` and `concepts` in their prompts. Widgets that don't need it ignore the fields. No widget changes are required in Phase 1.

### Lookback

Lookback's Signal Layer 4 (Collection Intelligence) currently uses category distribution and title word frequency. Concept data gives it actual semantic understanding. This is a Phase 3 integration — Lookback ships first with temporal and interaction signals, then gains concept-powered intelligence later.

### Search

Current search is keyword-based on titles and descriptions. Concept search is a strict upgrade — it searches additional fields, not different fields. No breaking changes to existing search behavior.

---

## Future Considerations

1. **Concept graph** — Once enough concept data exists, build a navigable graph of concept relationships. "Material honesty" connects to "brutalist architecture" connects to "raw materials" connects to "wabi-sabi." The graph is the user's intellectual fingerprint.
2. **Concept-driven recommendations** — "You're interested in 'analog revival' — here are things other people with that concept save." Requires cross-user concept aggregation (with privacy controls).
3. **Concept evolution timeline** — Visualize how concepts enter and leave the collection over time. The Cultural Omnivore persona explicitly wants this kind of reflection.
4. **Natural language collection queries** — "Show me everything about Japanese design philosophy" → AI interprets the query against concept data, returning pins tagged with related concepts across all categories.
5. **Concept compression for non-link pins** — When multi-format pins ship (notes, images, files), concept compression extends to those formats. A photo pin gets concepts from EXIF data + visual analysis. A note pin gets concepts from the text itself.
6. **Shared concept vocabularies** — Collaborative boards could share a concept namespace. Two users saving pins about "brutalist architecture" see their pins clustered together.

---

## Open Questions

1. **Essence tone** — Should the essence be neutral/informational ("This documents the Voyager team's selection process") or opinionated/hook-oriented ("The 1977 team had to decide what represents all of humanity")? The current PRD specifies hook-oriented, but some users may prefer neutral. Should this be a user preference?
2. **Concept granularity** — How specific should concepts be? "Sneaker culture" is useful for clustering. "Nike Air Max 97 Silver Bullet history" is too specific to match anything else. The prompt instructs mid-level specificity, but this will need tuning based on real extraction results.
3. **Concept vocabulary drift** — Over time, the AI may use slightly different phrasings for the same concept ("sneaker culture" vs. "sneaker collecting" vs. "kicks culture"). Phase 2 normalization helps, but Phase 3 embeddings are the real solution. How much drift is acceptable before Phase 3?
4. **Extraction failures** — Some pins have almost no metadata (opaque URLs, paywalled content, deleted pages). Should these get a placeholder essence ("Saved from domain.com — content unavailable for analysis") or no essence at all?
5. **Backfill priority** — Should backfill process newest pins first (users see the feature on recent content immediately) or oldest pins first (maximizes Lookback value)? Current design says richest-metadata-first, which is neither.
6. **Widget interaction** — Should widgets be able to *request* specific concept extractions? E.g., the "Complete the Look" widget might want fashion-specific concepts for wear pins. Or should concept extraction be uniform and let widgets filter?
7. **Concept editing UX** — When a user edits a concept, should it propagate to other pins with the same concept? (Renaming "sneaker culture" to "sneaker collecting" on one pin could update all pins.) This is powerful but potentially surprising.

---

## Success Metrics

| Metric | Target | How Measured |
|--------|--------|-------------|
| Concept extraction coverage | 90% of pins with confidence > 0.5 within 30 days of launch | `concept_confidence` distribution |
| Essence display engagement | 25% of expanded-card views include essence read time > 2s | Scroll/viewport tracking on expanded cards |
| Concept search usage | 15% of searches use concept-matched results (vs. title-only matches) | Search result click attribution |
| Cross-category discovery | 10% of concept tag taps lead to discovering a pin in a different category | Concept filter events with category distribution |
| User concept edits | < 20% of essences manually edited (indicates AI quality is good enough) | `concept_source = 'user'` percentage |
| Collection with 3+ concept clusters | 60% of collections with 50+ pins form at least 3 meaningful clusters | Cluster computation on active collections |
| Lookback concept signal quality (Phase 3) | Concept-sourced Lookback pins clicked at 35%+ rate | `pin_interactions` where lookback signal is concept-based |

---

## Related Documents

- [PRD: Boards MVP](./boards-mvp.md) — Core pin data model and enrichment pipeline
- [PRD: Lookback](./lookback.md) — Signal model and collection intelligence (downstream consumer)
- [PRD: AI Widgets](./ai-widgets.md) — Widget system (downstream consumer)
- [PRD: Content Type System](./content-type-system.md) — Classification system (upstream dependency)
- [TECH: AI Widget System](../../infrastructure/technical-design/ai-widget-system.md) — Widget generation architecture
- [UX: Pins](../../ux/pins/index.md) — Pin lifecycle and component documentation
- [UX: AI Categorization](../../ux/pins/ai-categorization.md) — Classification system details
- [Brand Positioning](../brand-positioning.md) — Brand principles guiding design decisions
- [User Personas](../../ux/personas.md) — Full persona definitions with JTBD
