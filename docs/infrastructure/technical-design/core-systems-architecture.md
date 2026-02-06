# Core Systems Architecture

> How pin creation, pin enrichment, and AI widgets work together

---

## Technical Approach

ctrl.rodeo is an **offline-first, progressive enhancement** system. The client does as much as possible locally (localStorage, rule-based classification, CORS proxy scraping), then enhances with server-side AI and enrichment when available. Every operation is designed to succeed at a baseline level without network access and get better with it.

Three core systems form the backbone of the product:

```
                    ┌─────────────┐
                    │  User adds  │
                    │    a URL    │
                    └──────┬──────┘
                           │
                           ▼
              ┌────────────────────────┐
              │     PIN CREATION       │
              │  Parse, dedupe, store  │
              │  skeleton immediately  │
              └────────────┬───────────┘
                           │
              ┌────────────┼────────────┐
              ▼                         ▼
┌──────────────────────┐  ┌──────────────────────┐
│  CLIENT ENRICHMENT   │  │  SERVER ENRICHMENT   │
│  (per pin type)      │  │  (per pin type)      │
│                      │  │                      │
│  Links: CORS scrape, │  │  Links: enrich-link  │
│  OG tags, images,    │  │  fn, AI classify,    │
│  rule-based category │  │  domain profiling,   │
│  & content type      │  │  image strategies    │
│                      │  │                      │
│  Future: note parse, │  │  Future: image AI,   │
│  file extract, etc.  │  │  NLP, etc.           │
└──────────┬───────────┘  └──────────┬───────────┘
           │                         │
           └────────────┬────────────┘
                        ▼
           ┌────────────────────────┐
           │    ENRICHED PIN        │
           │  title, image, type,   │
           │  category, confidence  │
           └────────────┬───────────┘
                        │
                        ▼
           ┌────────────────────────┐
           │   AI WIDGET PIPELINE   │
           │  Eligibility → Prompt  │
           │  → Claude → Validate   │
           │  → Enrich images       │
           │  → Render              │
           └────────────────────────┘
```

---

## 1. Pin Creation

A "pin" is a saved URL with metadata. In code, pins are called `links`. The creation flow prioritizes instant feedback — the user sees the pin appear immediately, then it fills in with metadata in the background.

### Data Model

```
Link {
  id: string              // Hash of URL
  url: string             // Normalized URL
  title: string           // From OG tags or generated from URL
  description: string     // From meta tags
  image: string|null      // Hero image URL
  domain: string          // Extracted hostname (no www)
  category: string        // home | wear | watch | use | eat | go | follow | read
  confidence: number      // Category confidence (0-1)
  content_type: string    // product | article | video | music | repository | social | document | tool | unknown
  type_confidence: number // Content type confidence (0-1)
  type_source: string     // cache | rules | ai
  image_source: string    // scraped | platform | searched | generated | template
  addedAt: ISO8601
  updatedAt: ISO8601
}
```

### Creation Flow

**Step 1: Parse and deduplicate** (`boards/index.html` ~line 7020)

The user pastes text into the Add Links modal. `extractUrls()` pulls out anything URL-shaped using a regex. Each URL gets normalized (add `https://`, strip tracking params like `utm_*`, `fbclid`, `gclid`), and checked against existing pins via `findByUrl()` which compares lowercased, slash-stripped URLs.

**Step 2: Create skeleton** (`boards/index.html` ~line 7068)

For each new URL, a skeleton link is created with `loading: true` and pushed to localStorage immediately via `addLink()`. The skeleton has a generated title (from the URL path), no image, category `uncategorized`, and zero confidence. The UI renders a loading placeholder card.

**Step 3: Background enrichment** (`boards/index.html` ~line 7082)

Three async operations run per pin:
1. `fetchMetadata(url)` — Client-side OG tag scraping (see Scraping section)
2. `smartCategorize(link)` — AI-first, rules-fallback category assignment
3. `classifyByRules(url, ...)` — Content type classification

Results merge into the skeleton via `updateLink()`, which triggers a re-render. The card transitions from loading state to showing the real title, image, and category badge.

**Step 4: Sync to Supabase** (`boards/index.html` ~line 6174)

`syncLinkToSupabase()` upserts the link to the `links` table using `Prefer: resolution=merge-duplicates`. Link ordering syncs separately to the `link_order` table. This is fire-and-forget — the local copy is the source of truth and Supabase is the persistence layer.

### Category System

Eight fixed categories: `home`, `wear`, `watch`, `use`, `eat`, `go`, `follow`, `read`.

The `smartCategorize()` function (`boards/index.html` ~line 5935) tries AI first (Claude Haiku via browser API key), then falls back to rule-based pattern matching. The rules system uses three signals:

1. **Known domains** — Hardcoded domain-to-category maps (nike.com → wear, ikea.com → home). Confidence: 0.95.
2. **URL path patterns** — `/shop/`, `/product/`, `/recipe/` etc. Confidence: 0.8.
3. **Keyword matching** — Title/description scanned for category keywords (2+ matches required). Confidence: 0.6-0.9.

### Storage Architecture

- **Primary**: `localStorage` key `'things-i-like'` — immediate reads/writes, offline-capable
- **Secondary**: Supabase PostgreSQL `links` table — persistence, sharing, cross-device sync
- **Conflict resolution**: Last-write-wins with `updatedAt` timestamp. `addLink()` preserves `addedAt` from the original creation.

---

## 2. Pin Enrichment

Enrichment is the process of turning a raw pin into a rich object with metadata, images, classification, and categorization. Today this pipeline handles URL-based pins (links), but it's designed to accommodate future pin types (notes, images, files) by treating enrichment as a generic transform that any pin passes through.

Enrichment happens in two tiers. The client handles fast, lightweight metadata extraction. The server handles AI-powered classification and multi-strategy image resolution.

### Tier 1: Client-Side Enrichment (Link Scraping)

For URL-based pins, the client enriches by scraping the target page for OG metadata.

**Function**: `fetchMetadata(url)` (`boards/index.html` ~line 5645)

The client can't fetch arbitrary URLs directly (CORS), so it routes through two proxy services:

```
Client ──► allorigins.win/raw?url={url} ──► Target site HTML
                    │ (if fails)
                    ▼
Client ──► corsproxy.io/?{url} ──► Target site HTML
```

- **Timeout**: 8 seconds per attempt
- **Retries**: 1 per proxy (4 total attempts)

From the HTML response, metadata is extracted in priority order:

| Field | Priority 1 | Priority 2 | Priority 3 | Fallback |
|-------|-----------|-----------|-----------|----------|
| Title | `og:title` | `twitter:title` | `<title>` | Domain name |
| Description | `og:description` | `twitter:description` | `meta description` | Empty |
| Image | `og:image` | `twitter:image` | `itemprop="image"` | First `<img>` |

Images are filtered through a logo detector that rejects URLs containing `logo`, `favicon`, `icon`, `sprite`, `profile`, `placeholder`, `1x1`, `transparent`. Relative URLs are resolved to absolute using the page origin.

### Tier 2: Server-Side Enrichment

**Function**: `enrich-link` edge function (`supabase/functions/enrich-link/index.ts`)

The server enrichment runs asynchronously after client enrichment completes. It provides two services that the client can't do well: AI classification and authenticated image resolution. Future pin types would add their own server enrichment strategies (e.g., image analysis for photo pins, NLP for text/note pins).

#### Content Type Classification

Three-tier classification pipeline:

```
1. Domain Profile Cache (domain_profiles table)
   └─ If cached with confidence > 0.85 → return immediately

2. AI Classification (Claude 3 Haiku)
   └─ Prompt: "Classify into: product, article, video, music,
       repository, social, document, tool, unknown"
   └─ Returns: { type, confidence }

3. Domain Profile Update
   └─ Track types_seen per domain → calculate primary_type
   └─ After 5+ samples, domain gets reliable classification
```

The domain profile cache is the key optimization here. After classifying a few pins from `nike.com`, the system learns that nike.com is primarily `product` content and skips the AI call for future nike.com pins. The `domain_profiles` table stores:

```sql
domain_profiles {
  domain: text           -- "nike.com"
  classification: text   -- "single_type" | "multi_type"
  primary_type: text     -- "product"
  types_seen: jsonb      -- {"product": 12, "article": 1}
  sample_count: integer  -- 13
  confidence: real       -- 0.92
}
```

#### Image Resolution Pipeline

When client-side scraping doesn't find a good image, the server tries multiple strategies based on content type:

| Content Type | Strategy Chain |
|-------------|---------------|
| product | scrape → search → template |
| article | scrape → search → template |
| video | platform → scrape → template |
| music | platform → search → template |
| repository | platform → template |
| tool | scrape → favicon → template |

**Strategy: Platform APIs**
- YouTube: `img.youtube.com/vi/{id}/hqdefault.jpg` (extracted from URL)
- Vimeo: `vimeo.com/api/v2/video/{id}.json` → `thumbnail_large`
- GitHub: `opengraph.githubassets.com/1/{owner}/{repo}`

**Strategy: Scrape**
Server-side scrape with a real User-Agent. Extracts from:
1. `og:image` / `twitter:image` meta tags
2. JSON-LD structured data (`@type: Product` → `image`)
3. Shopify CDN URLs (`cdn.shopify.com/s/files/...`)
4. `srcset` attributes (takes largest image)

**Strategy: Search**
Unsplash API for generic images when all else fails.

**Strategy: Favicon**
Google's favicon service at 128px as a last resort for tools/apps.

### Enrichment Queue

The client manages server-side enrichment requests through a queue with retry logic (`boards/index.html` ~line 5358):

```
enrichmentQueue[] → process one at a time
  └─ callEnrichmentAPI()
       └─ Retry: 3 attempts with 2s, 4s, 8s backoff
       └─ 4xx errors fail immediately (not retryable)
       └─ 5xx and network errors retry
```

Before making a server call, the client checks its local `domainProfileCache`. If it already knows the domain's content type with high confidence, it sends `skipClassification: true` to avoid unnecessary AI calls.

### Extensibility: Future Pin Types

The two-tier enrichment model is designed to generalize beyond URL pins. Each new pin type would provide:

| Pin Type | Client Enrichment | Server Enrichment |
|----------|------------------|-------------------|
| **Link** (current) | CORS scrape for OG tags, images | AI classification, domain profiling, image strategies |
| **Note** (planned) | Markdown parse, extract inline URLs | NLP: topic extraction, entity recognition, auto-categorize |
| **Image** (planned) | Read EXIF data, generate thumbnail | Vision AI: describe content, suggest category, detect objects |
| **File** (planned) | File type detection, size/format | Content extraction (PDF text, CSV preview), summarize |

The enrichment queue, confidence scoring, category assignment, and Supabase sync are pin-type-agnostic — only the enrichment strategies change per type.

---

## 3. AI Widget Pipeline

Widgets are AI-generated UI components that analyze a user's pins and produce recommendations. The system is **config-driven** — adding a new widget type requires only a TypeScript config file, no code changes.

### Architecture Overview

```
┌──────────────────────────────────────────────────────────────┐
│                    WIDGET REGISTRY                            │
│  config/widgets/complete-the-look.ts                         │
│  config/widgets/style-summary.ts                             │
│  (add new .ts file → new widget type)                        │
└───────────────┬──────────────────────────────────────────────┘
                │
                ▼
┌──────────────────────────────────────────────────────────────┐
│              ELIGIBILITY ENGINE                               │
│  Rule evaluators: min_items, max_items, category_match,      │
│  content_quality, variety, recency                           │
│  → Weighted score → eligible: true/false                     │
└───────────────┬──────────────────────────────────────────────┘
                │
                ▼
┌──────────────────────────────────────────────────────────────┐
│              PROMPT ENGINEERING                               │
│  Widget template prompt + Brand constraints + Items context  │
│  + Confidence instruction + JSON output requirement          │
└───────────────┬──────────────────────────────────────────────┘
                │
                ▼
┌──────────────────────────────────────────────────────────────┐
│              CLAUDE 3 HAIKU                                   │
│  model: claude-3-haiku-20240307                              │
│  max_tokens: 1024                                            │
│  → Returns JSON with suggestions + confidence                │
└───────────────┬──────────────────────────────────────────────┘
                │
                ▼
┌──────────────────────────────────────────────────────────────┐
│              VALIDATION & ENRICHMENT                          │
│  Parse JSON → Validate brands → Check confidence threshold   │
│  → Scrape product images (Shopify → SERP → HTML)            │
└───────────────┬──────────────────────────────────────────────┘
                │
                ▼
┌──────────────────────────────────────────────────────────────┐
│              TEMPLATE RENDERING                               │
│  product-grid | style-card | simple-list | text-summary      │
│  Selected by widget config, fallback chain to simple-list    │
└──────────────────────────────────────────────────────────────┘
```

### Widget Definition (Config-Driven)

Each widget is a TypeScript config file in `supabase/functions/generate-widget/config/widgets/`. Here's the shape:

```typescript
{
  id: 'complete-the-look',
  name: 'Complete the Look',
  version: '2.0.0',

  eligibility: {
    rules: [
      { type: 'min_items', weight: 1.0, params: { min: 2 } },
      { type: 'category_match', weight: 0.8, params: { categories: ['wear'] } },
      { type: 'content_quality', weight: 0.6, params: { minFields: 2 } }
    ],
    requireAllCritical: true,   // weight=1.0 rules must pass
    minOverallScore: 0.5
  },

  confidence: {
    threshold: 0.6,             // Suppress if AI confidence < 60%
    fallbackBehavior: 'degrade' // 'suppress' | 'degrade' | 'retry'
  },

  generation: {
    model: 'claude-3-haiku-20240307',
    maxTokens: 1024,
    promptTemplate: 'You are a fashion stylist AI...'
  },

  enrichment: {
    enabled: true,
    strategies: ['shopify', 'serp', 'scrape'],
    timeout: 5000,
    brandsEnabled: true
  },

  rendering: {
    zone: 'inline',             // hero | inline | footer
    template: 'product-grid',
    priority: 10
  }
}
```

### Eligibility Engine

Before calling the AI, the system evaluates whether a widget should appear at all. Each eligibility rule returns a score (0-1) and has a weight:

| Rule | What It Checks | Example |
|------|---------------|---------|
| `min_items` | Board has enough pins | At least 2 wear items |
| `max_items` | Not too many (for focused widgets) | Max 20 items |
| `category_match` | Pins match widget's target categories | Has 'wear' category pins |
| `content_quality` | Pins have good metadata (title, image) | 80% have images |
| `variety` | Pins from diverse sources | Not all from one domain |
| `recency` | Pins were added recently | Within last 30 days |

The weighted average produces an overall score. Critical rules (weight=1.0) must all pass. If the score is below `minOverallScore`, the widget is suppressed entirely.

### Brand Registry

The AI is constrained to suggest products only from 47 validated brands. This prevents hallucinated brand names and ensures product URLs can be resolved.

**31 Shopify stores** (JSON API available):
Stussy, Palace, BAPE, Kith, Norse Projects, Our Legacy, Lemaire, Common Projects, Outlier, Reigning Champ, Todd Snyder, Buck Mason, Taylor Stitch, etc.

**16 non-Shopify brands** (HTML scraping):
Nike, Adidas, New Balance, Converse, Vans, Uniqlo, COS, Carhartt WIP, Patagonia, The North Face, Arc'teryx, etc.

Each brand has a config specifying:
- **categories**: What products they actually make (prevents "Bellroy sneakers")
- **shopifyDomain**: For Shopify JSON API access
- **searchUrl**: For HTML scraping fallback
- **imagePatterns**: Regex to extract product images from their pages

Post-AI validation replaces any unsupported brand or invalid brand-category combination with a valid alternative.

### Image Enrichment for Suggestions

After the AI returns product suggestions, each suggestion needs a real product image. Three strategies, tried in order:

```
1. Shopify JSON API
   GET {domain}/search/suggest.json?q={query}&resources[type]=product
   Speed: <500ms | Success rate: ~80%

2. SERP API (Google Shopping)
   GET serpapi.com/search?engine=google_shopping&q={brand}+{product}
   Speed: ~1-2s | Success rate: ~70% | Cost: $0.01/search

3. HTML Scraping
   Fetch brand's search page, extract with regex patterns
   Speed: ~2-3s | Success rate: ~40% (bot protection)
```

### Caching

Two levels of caching prevent redundant AI calls:

- **Server in-memory**: `Map<cacheKey, result>` with 1-hour TTL. Key is `widgetId:sortedItemIds`. Cleared on function deployment.
- **Client localStorage**: Per-widget cache with 1-hour TTL. Includes a refresh counter for generating variations.

### Observability

Every widget response includes a `meta` object with timing breakdowns, image resolution stats, brand validation counts, and eligibility scores. The client tracks view, click, suppressed, and error events for each widget interaction.

---

## How the Three Systems Connect

The three systems form a pipeline where each stage feeds the next:

1. **Pin Creation** gives us the raw material — a URL, parsed and stored instantly.

2. **Pin Enrichment** transforms raw pins into rich objects with titles, images, categories, and content types. For links, the dual client/server approach means the user gets fast feedback (client scrape in ~2s) followed by higher-quality data (server enrichment with AI classification and better images). Future pin types will plug into the same two-tier pattern with their own enrichment strategies.

3. **AI Widgets** consume the enriched pins. The richer the pin metadata (good titles, accurate categories, real images), the better the widget recommendations. The eligibility engine specifically checks `content_quality` — pins with poor metadata reduce a widget's eligibility score.

This creates a positive feedback loop: better enrichment leads to better widgets, which increases user engagement, which produces more pins to enrich.

### Shared Infrastructure

All three systems share:
- **Supabase PostgreSQL** for persistence (links, domain_profiles, strategy_performance tables)
- **Claude 3 Haiku** for AI operations (categorization, content type classification, widget generation)
- **Domain profile cache** used by both enrichment (to skip AI classification) and widgets (brand resolution)
- **localStorage** as the primary client-side data store

### Key Architectural Decisions

| Decision | Rationale |
|----------|-----------|
| localStorage as primary store | Offline-first, instant reads, no auth required for basic use |
| CORS proxies for client scraping | No server required for basic metadata extraction |
| Domain profile learning | Amortizes AI cost — after a few links from a domain, classification is free |
| Config-driven widgets | New widget types without code deploys; A/B testable |
| Brand registry constraint | Prevents AI hallucination; ensures real product URLs |
| Multi-strategy image fallback | Shopify API is fast and reliable; SERP and scraping cover the rest |
| Fire-and-forget Supabase sync | Local state is truth; server sync is eventual and non-blocking |

---

## Key Files

| System | File | Purpose |
|--------|------|---------|
| Pin Creation | `boards/index.html` (~L7020) | Add links modal, URL extraction, skeleton creation |
| Pin Creation | `boards/index.html` (~L6393) | `addLink()` — localStorage write + Supabase sync |
| Pin Creation | `boards/index.html` (~L5935) | `smartCategorize()` — AI/rules category assignment |
| Pin Enrichment | `boards/index.html` (~L5645) | `fetchMetadata()` — client-side CORS proxy scraping |
| Pin Enrichment | `boards/index.html` (~L5358) | Enrichment queue with retry logic |
| Pin Enrichment | `supabase/functions/enrich-link/index.ts` | Server-side AI classification + image resolution |
| Widgets | `supabase/functions/generate-widget/index.ts` | Main edge function (AI call, validation, enrichment) |
| Widgets | `supabase/functions/generate-widget/config/schema.ts` | Widget definition types |
| Widgets | `supabase/functions/generate-widget/config/registry.ts` | Widget loader, eligibility evaluator, prompt builder |
| Widgets | `supabase/functions/generate-widget/config/widgets/` | Individual widget configs |

---

## Related Documents

- [System Overview](../architecture.md) — High-level component diagram
- [AI Widget System](./ai-widget-system.md) — Deep dive into widget internals (v5.0)
- [AI Widget Pipeline](./ai-widget-pipeline.md) — Pipeline refactoring strategy
- [Content Type System](./content-type-system.md) — Classification and image resolution specs
- [Widget Architecture](./widget-architecture.md) — Design system components for widgets

---

*Last updated: 2026-02-05*
