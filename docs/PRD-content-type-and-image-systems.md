# PRD: Content Type System & Image Resolution System

## Overview

Two interconnected systems that work together to ensure every link on Board looks appropriate and visually appealing:

1. **Content Type System** - Detects and classifies what kind of content a link represents (product, article, video, etc.)
2. **Image Resolution System** - Selects and resolves appropriate images based on content type

These systems are designed to be distinct but complementary, with clear interfaces between them.

---

## System Boundaries

```
┌─────────────────────────────────────────────────────────────────┐
│                     CONTENT TYPE SYSTEM                          │
│                                                                 │
│  Responsibilities:                                              │
│  - Classify links into content types                            │
│  - Cache domain/path patterns                                   │
│  - Discover new content types                                   │
│  - Evolve type definitions                                      │
│                                                                 │
│  Output: { type: string, confidence: number, signals: [] }      │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                   IMAGE RESOLUTION SYSTEM                        │
│                                                                 │
│  Responsibilities:                                              │
│  - Define image strategies per content type                     │
│  - Execute resolution pipeline                                  │
│  - Generate/search for images                                   │
│  - Track performance and improve                                │
│                                                                 │
│  Input: content_type + link metadata                            │
│  Output: { imageUrl: string, source: string }                   │
└─────────────────────────────────────────────────────────────────┘
```

---

## Problem Statement

Links saved to Board often lack images due to:
- Missing Open Graph tags
- Lazy-loaded images not captured by scraper
- Anti-bot measures blocking image extraction
- Some content types (repos, PDFs) don't have natural images

Current behavior shows a letter placeholder, which:
- Reduces visual appeal
- Makes boards look incomplete
- Doesn't leverage available context (title, description, domain)

---

## Goals

### Content Type System
1. **Accurate classification** - >90% accuracy on known types
2. **Self-improving** - Discovers new types from usage patterns
3. **Cost-efficient** - Smart caching reduces API calls by 60-80%
4. **Portable** - Provider-agnostic (Anthropic, OpenAI, local models)

### Image Resolution System
1. **Every link looks good** - No more empty placeholders
2. **Context-appropriate** - Products look like products, articles like articles
3. **Fast** - Background processing, <3s p95 resolution time
4. **Improvable** - Learns from user overrides

---

## Non-Goals (Backlog)

- User-defined custom visual styles
- Per-board style customization
- Style sharing between users

---

## User Stories

### US-1: Automatic Image Resolution
> As a user, I want links without images to automatically get appropriate visuals so my board looks complete.

**Acceptance Criteria:**
- Links without OG images get type-appropriate fallback
- Resolution happens in background, doesn't block adding link
- Placeholder shown immediately, replaced when image ready
- No user action required

### US-2: Content Type Detection
> As a user, I want the system to understand what type of content I'm saving so it can display it appropriately.

**Acceptance Criteria:**
- System detects: product, article, video, music, repository, social, document, tool, unknown
- Detection uses URL + title + description
- Works for new/unknown domains
- Accuracy > 90% for known types

### US-3: Manual Override
> As a user, I want to replace any auto-selected image with my own choice.

**Acceptance Criteria:**
- "Edit image" option on every link
- Can upload custom image
- Can trigger re-fetch
- Can request AI search or generation
- Override persists and syncs

### US-4: Type Evolution
> As a system, new content types should be discovered automatically as usage patterns emerge.

**Acceptance Criteria:**
- Low-confidence classifications are tracked
- Clusters of similar unknowns analyzed weekly
- New types proposed when patterns emerge
- Types can be auto-promoted or queued for review

---

## Content Types & Visual Strategies

| Type | Primary Image Source | Fallback 1 | Fallback 2 | Card Style |
|------|---------------------|------------|------------|------------|
| **product** | Headless re-scrape | AI image search | Manual upload | image_dominant |
| **article** | OG image | AI generation | Styled text card | image_dominant |
| **video** | Platform thumbnail API | AI search | Platform card | image_dominant |
| **music** | Platform album art API | AI search | Waveform card | hybrid |
| **repository** | GitHub social preview | Language stats card | Styled text | text_dominant |
| **social** | oEmbed / Platform API | Author avatar | Platform card | hybrid |
| **document** | First page render | Document icon | Styled text | text_dominant |
| **tool** | High-res favicon + brand card | Homepage screenshot | Styled text | hybrid |
| **unknown** | AI generation | AI search | Styled text card | text_dominant |

---

## Detection Flow

```
┌─────────────────────────────────────────────────────────────┐
│                    Content Type Detection                    │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  1. Check Domain Profile Cache                              │
│     ├─► Single-type domain → Return cached type             │
│     ├─► Multi-type domain → Check path patterns             │
│     └─► Unknown domain → Continue to API                    │
│                                                             │
│  2. API Classification (if needed)                          │
│     Input: { url, title, description, domain }              │
│     Output: { type, confidence, signals }                   │
│                                                             │
│  3. Rules Fallback (API failure)                            │
│     - Known domain mappings                                 │
│     - URL pattern matching                                  │
│     - Extension detection                                   │
│                                                             │
│  4. Learn & Cache                                           │
│     - Update domain profile                                 │
│     - Store path patterns for multi-type domains            │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

---

## Image Resolution Flow

```
┌─────────────────────────────────────────────────────────────┐
│                    Image Resolution Flow                     │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  1. Link Added                                              │
│     └─► Show placeholder immediately                        │
│                                                             │
│  2. Initial Scrape                                          │
│     └─► OG image found? → Done                              │
│     └─► No image? → Continue                                │
│                                                             │
│  3. Detect Content Type                                     │
│     └─► Get type + confidence                               │
│                                                             │
│  4. Execute Type Strategy (pipeline)                        │
│     └─► Try approach 1 → Success? Done                      │
│     └─► Try approach 2 → Success? Done                      │
│     └─► Try approach 3 → Success? Done                      │
│     └─► All failed → Styled text card                       │
│                                                             │
│  5. Store & Display                                         │
│     └─► Save image URL + method used                        │
│     └─► Fade in new image                                   │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

---

## Multi-Type Domain Handling

Many domains (brand sites, media companies) host multiple content types:

```
smallbrand.com/products/jacket     → product
smallbrand.com/blog/our-story      → article
smallbrand.com/lookbook/summer     → image gallery
```

### Solution: Domain Profiles with Path Patterns

1. First few links from domain → API classification
2. After 5+ samples → Analyze if single or multi-type
3. Multi-type domains → Learn path patterns
4. Cache at pattern level, not domain level

---

## Auto-Evolution System

### Type Discovery Pipeline

```
Week 1-4: Collect uncertain classifications
    │
    ▼
Weekly: Cluster by embedding similarity
    │
    ▼
AI analyzes clusters → Proposes new types
    │
    ▼
Validate on holdout set (>80% accuracy)
    │
    ▼
Promote: Auto (high confidence) or Human Review
```

### Visual Strategy Evolution

```
Deploy strategy → Track performance metrics
    │
    ▼
High manual override rate? (>20%)
    │
    ▼
Analyze what users chose instead
    │
    ▼
AI proposes improved strategy
    │
    ▼
A/B test → Promote winner
```

---

## Cost Optimization

| Strategy | Savings | Implementation |
|----------|---------|----------------|
| **Domain caching** | 60-80% | Cache type at domain/path level |
| **Batching** | 50-70% | Queue links, classify in batches of 10 |
| **Cheap models** | 90%+ | Use Haiku/GPT-4o-mini for classification |
| **Embeddings** | 95%+ | Local classifier for common patterns |

### Projected Costs

| Monthly Links | Without Optimization | With Optimization |
|---------------|---------------------|-------------------|
| 1,000 | $2.00 | $0.05 |
| 10,000 | $20.00 | $0.20 |
| 100,000 | $200.00 | $1.50 |

---

## Success Metrics

| Metric | Target | Measurement |
|--------|--------|-------------|
| **Image coverage** | >95% of links have images | % of links with non-placeholder image |
| **Classification accuracy** | >90% | Manual review sample + override rate |
| **Manual override rate** | <15% | Users replacing auto-selected images |
| **Resolution time** | <3s p95 | Time from link add to image display |
| **Cost per link** | <$0.002 | Total AI costs / links processed |

---

## Phases

### Phase 1: Foundation
- Content type detection (API + rules)
- Basic image strategies per type
- Domain profile caching
- Manual image override

### Phase 2: Intelligence
- Multi-type domain handling
- Path pattern learning
- Background processing queue
- Performance tracking

### Phase 3: Evolution
- Type discovery pipeline
- Visual strategy A/B testing
- Auto-improvement from user feedback
- New type promotion workflow

### Future: Personalized Styles (Backlog)
- User-defined visual preferences
- Style extraction from reference links/images
- Per-board style customization
- Style generation prompts

---

## Risks & Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| AI API downtime | Images fail to resolve | Rules fallback, graceful degradation |
| High costs at scale | Budget exceeded | Aggressive caching, model tiering |
| Poor classification accuracy | Wrong visual treatment | Human feedback loop, confidence thresholds |
| Generated images look off-brand | Visual inconsistency | Style guardrails, review before deploy |
| New types discovered incorrectly | Bad UX for cluster | Validation set, human review option |

---

## Dependencies

- OpenAI or Anthropic API (classification, generation)
- Image search API (Unsplash, Google Custom Search)
- Supabase Storage (uploaded images)
- Background job runner (for async resolution)
