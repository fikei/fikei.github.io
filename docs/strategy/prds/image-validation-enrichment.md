# PRD: Image Validation & Enrichment Engine

## Overview

An evaluation and enrichment layer that sits between image sourcing and image display, ensuring every pin image is **accurate**, **visually sound**, and **contextually appropriate** before it reaches the user's board.

Today, the image pipeline resolves an image and displays it. The only validation is a blocklist filter (logos, favicons, placeholders). This means scraped images that are technically "not a logo" but are still wrong — a lifestyle banner instead of the product, a site header instead of the article photo, a 50x50 thumbnail — all pass through unchecked.

This PRD defines the validation framework, scoring system, and enrichment strategies that close that gap.

### Relationship to Existing Systems

```
Existing (Epic 3.2)          This PRD                    Existing (Epic 3.5)
┌──────────────────┐    ┌─────────────────────┐    ┌──────────────────────┐
│  Image Sourcing  │───►│  Image Validation &  │───►│  Image Intelligence  │
│                  │    │  Enrichment Engine    │    │  (Edit, Generate,    │
│  • Scrape        │    │                      │    │   Management UI)     │
│  • Platform API  │    │  • Score             │    │                      │
│  • Search        │    │  • Gate              │    │  Consumes scores     │
│  • Template      │    │  • Enrich / Replace  │    │  to decide when to   │
│                  │    │  • Track             │    │  edit or generate    │
└──────────────────┘    └─────────────────────┘    └──────────────────────┘
```

- **Upstream**: Consumes images from the existing resolution pipeline (Epic 3.2, `enrich-link`)
- **Downstream**: Feeds scores into the Image Intelligence system (Epic 3.5) to trigger editing, generation, or manual review
- **Companion PRD**: [Content Type & Image Systems](./content-type-and-image-systems.md) — defines sourcing strategies; this PRD defines what happens after sourcing

---

## Problem Statement

The current pipeline answers: **"Can I find an image?"**

It does not answer:
- **"Is this the right image?"** — A scrape of nike.com/air-max might return a sitewide hero banner, not the Air Max product shot
- **"Is this image good enough?"** — A 100x100 thumbnail technically resolves but looks terrible on a card
- **"Does this fit our platform?"** — A cluttered collage with text overlays violates the ctrl.rodeo aesthetic

Without validation, bad images persist silently. Users either manually replace them (high friction) or live with a board that looks inconsistent. The override rate is the only signal, and it's a lagging indicator with no diagnostic value.

---

## Goals

1. **Score every image** across multiple quality dimensions before display
2. **Gate bad images** — images below threshold trigger fallback strategies automatically
3. **Enable smart enrichment** — use scores to decide whether to scrape harder, edit, or generate
4. **Build a feedback loop** — user overrides improve scoring over time
5. **Keep it fast** — validation must not add perceptible latency to the happy path

---

## Non-Goals

- Image editing or generation capabilities (covered by Epic 3.5 Stories 4-5)
- Image management UI (covered by Epic 3.5 Story 6)
- Custom per-user visual preferences (backlog)
- Content moderation beyond basic safety (future)

---

## Validation Dimensions

### 1. Accuracy — "Is this the right image?"

Does the image actually depict the product, article, or content the pin represents?

| Signal | Method | Weight |
|--------|--------|--------|
| Product presence | AI vision: "Does this image contain [product name]?" | High |
| Title-image alignment | AI vision: compare image description to pin title | High |
| URL-image domain match | Does the image come from the same domain as the pin? | Medium |
| Content type match | Product pin has product photo, article pin has article image | Medium |
| Schema.org alignment | Image matches `product.image` or `article.image` in structured data | High |
| Alt text relevance | Image alt text contains keywords from pin title | Low |

**Failure examples:**
- Pin title: "Nike Air Max 90" → Image: Nike homepage hero banner (wrong product)
- Pin title: "How to make sourdough" → Image: site logo (not the article)
- Pin title: "Spotify playlist" → Image: generic music icon (not the playlist cover)

**Scoring:**
- `1.0` — Image clearly shows the specific item/content
- `0.7` — Image is related but not specific (correct brand, wrong product)
- `0.4` — Image is tangentially related (correct category, wrong item)
- `0.0` — Image is unrelated or a placeholder

### 2. Visual Quality — "Does it meet technical standards?"

Does the image meet minimum technical requirements for display?

| Signal | Method | Weight |
|--------|--------|--------|
| Resolution | Image dimensions ≥ minimum for card size | High |
| Aspect ratio | Falls within acceptable range (not extreme letterbox/pillarbox) | Medium |
| File size | Not suspiciously small (< 5KB = likely placeholder) | Medium |
| Format | Supported format (JPEG, PNG, WebP, AVIF) | High |
| Corruption | Image loads successfully, not truncated | High |
| Upscaling artifacts | AI detection of upscaled low-res source | Low |

**Thresholds:**

| Card Context | Min Width | Min Height | Max Aspect Ratio |
|--------------|-----------|------------|-----------------|
| Grid card | 300px | 200px | 3:1 |
| Hero card | 600px | 400px | 2.5:1 |
| Thumbnail | 100px | 100px | 2:1 |
| Widget item | 200px | 200px | 2:1 |

**Scoring:**
- `1.0` — Meets all thresholds for target card context
- `0.7` — Meets minimum but not ideal (e.g., 300px for a hero slot)
- `0.3` — Below minimum but displayable with degradation
- `0.0` — Corrupt, wrong format, or below absolute minimum (< 50px)

### 3. Aesthetic Fit — "Does it match the platform?"

Does the image align with ctrl.rodeo's visual identity: high contrast, minimal clutter, editorial quality?

| Signal | Method | Weight |
|--------|--------|--------|
| Text overlay detection | AI vision: does image contain embedded text/watermarks? | High |
| Visual clutter | AI vision: busy/cluttered vs clean/minimal | Medium |
| Contrast | Histogram analysis: sufficient tonal range | Medium |
| Brand consistency | Works in the black-and-white design language | Low |
| Watermark detection | Pattern matching for stock photo watermarks | High |

**Scoring:**
- `1.0` — Clean, high-contrast, editorial quality, no text/watermarks
- `0.7` — Minor text overlay or slight clutter, still presentable
- `0.4` — Significant watermarks, heavy text, or visual noise
- `0.0` — Unusable (stock watermark covers product, all-text image)

### 4. Distinctiveness — "Is this a real image, not a generic asset?"

Is this a meaningful, content-specific image rather than a generic site asset?

| Signal | Method | Weight |
|--------|--------|--------|
| Logo/icon detection | Pattern match + AI vision | High |
| Placeholder detection | Size, filename, and content heuristics | High |
| Generic stock detection | AI vision: "Is this a generic stock photo?" | Medium |
| Favicon match | Image is actually the site's favicon scaled up | High |
| Duplicate detection | Same image URL used across multiple pins from same domain | Medium |

**Scoring:**
- `1.0` — Unique, content-specific image
- `0.5` — Somewhat generic but contextually appropriate (e.g., category header)
- `0.2` — Generic stock photo or reused site asset
- `0.0` — Logo, favicon, placeholder, or 1x1 tracking pixel

### 5. Safety — "Is this appropriate to display?"

Basic content safety for platform integrity.

| Signal | Method | Weight |
|--------|--------|--------|
| NSFW content | AI content moderation API | Critical |
| Misleading content | Image misrepresents the linked content | High |
| Broken/dead links | Image URL returns 404 or error | Critical |

**Scoring:**
- `1.0` — Safe and appropriate
- `0.0` — Unsafe, blocked from display

---

## Composite Score

Each image receives a composite `image_quality_score` computed as a weighted average of dimension scores.

```
image_quality_score = (
    accuracy      × 0.35 +
    visual_quality × 0.25 +
    aesthetic_fit  × 0.20 +
    distinctiveness × 0.15 +
    safety         × 0.05    // binary gate, not a gradient
)
```

Safety is a **hard gate**: any image scoring `0.0` on safety is rejected regardless of composite score.

### Score Tiers

| Tier | Score Range | Action |
|------|------------|--------|
| **Excellent** | 0.85 – 1.0 | Display immediately, no further action |
| **Good** | 0.65 – 0.84 | Display, flag for potential improvement |
| **Marginal** | 0.40 – 0.64 | Display with degraded treatment, queue for enrichment |
| **Poor** | 0.15 – 0.39 | Don't display, trigger fallback strategy |
| **Rejected** | 0.00 – 0.14 | Block, use styled text card, queue for generation |

---

## Image Enrichment Pipeline

When validation identifies a gap, enrichment strategies fire based on what failed.

### Strategy Selection Matrix

| Failed Dimension | Primary Strategy | Fallback Strategy |
|-----------------|-----------------|-------------------|
| Accuracy low, scraped image exists | Re-scrape with product-specific selectors | AI search for "[product name] product photo" |
| Accuracy low, no scraped image | AI search with title + category keywords | AI generation with product prompt |
| Visual quality low (resolution) | Re-scrape for higher-res variant (srcset, CDN params) | AI upscale existing image |
| Visual quality low (aspect ratio) | AI smart crop to target ratio | Re-search with aspect ratio constraints |
| Aesthetic fit low (text/watermarks) | AI edit: remove text overlay | Re-search excluding stock sites |
| Aesthetic fit low (clutter) | AI edit: background removal + clean composite | AI generation with minimal style prompt |
| Distinctiveness low (logo/generic) | Full re-resolution from scratch (skip cache) | AI generation |
| Safety failed | Block permanently, no retry | Styled text card |

### Enrichment Flow

```
Image sourced (scrape/search/platform/template)
    │
    ▼
┌─────────────────────────────────────┐
│          VALIDATION GATE            │
│                                     │
│  Run all 5 dimension evaluations    │
│  Compute composite score            │
│  Determine tier                     │
├─────────────────────────────────────┤
│                                     │
│  Excellent/Good → PASS              │──► Display image
│                                     │
│  Marginal → CONDITIONAL PASS        │──► Display + queue enrichment
│                                     │
│  Poor/Rejected → FAIL               │──► Don't display, run strategy
│                                     │
└─────────────────────────────────────┘
    │ (FAIL path)
    ▼
┌─────────────────────────────────────┐
│        ENRICHMENT ROUTER            │
│                                     │
│  Identify lowest-scoring dimension  │
│  Select strategy from matrix        │
│  Execute strategy                   │
│  Re-validate result                 │
│                                     │
│  Max 3 enrichment attempts per pin  │
│  Then fallback to styled text card  │
└─────────────────────────────────────┘
    │
    ▼
  Re-enter validation gate with new image
```

---

## Tiered Validation Architecture

Not every image needs full AI vision analysis. Use a tiered approach to keep costs low and latency tight.

### Tier 1: Heuristic Checks (Client-side, ~0ms, free)

Fast, deterministic checks that catch the obvious failures:

- File size < 5KB → likely placeholder
- Dimensions < 50px → too small
- Filename matches blocklist patterns (logo, icon, favicon, sprite, pixel, spacer, blank, transparent)
- URL matches known CDN placeholder patterns
- Image URL matches site favicon URL
- Duplicate of another pin's image from the same domain

**If all pass → Tier 2. If any fail → immediately trigger fallback.**

### Tier 2: Technical Analysis (Server-side, ~100ms, free)

Server-side checks using image metadata (HEAD request + partial download):

- Verify image loads (HTTP 200, correct Content-Type)
- Extract dimensions from image headers (no full download needed)
- Check aspect ratio against thresholds
- Verify resolution meets card context requirements
- Detect redirects to generic error/placeholder images

**If all pass → Tier 3 (async). If any fail → trigger re-resolution.**

### Tier 3: AI Vision Analysis (Server-side, ~500ms, ~$0.001/image)

AI-powered evaluation for accuracy, aesthetics, and safety. Runs asynchronously — image displays immediately from Tier 2 pass, Tier 3 can downgrade later.

- Single multimodal API call combining all AI checks:
  ```
  Evaluate this image for a pin titled "[title]" in category "[category]":
  1. Does this image depict [title]? (accuracy: 0-1)
  2. Does it contain text overlays or watermarks? (aesthetic: 0-1)
  3. Is it visually clean and minimal? (aesthetic: 0-1)
  4. Is it a generic stock/placeholder image? (distinctiveness: 0-1)
  5. Is the content safe and appropriate? (safety: pass/fail)
  Return JSON scores.
  ```
- Cache results keyed by image URL (images don't change)
- Skip for known-good sources (YouTube thumbnails, GitHub social previews)

**Cost projection:**

| Monthly Pins | Tier 1 Filter Rate | Tier 2 Filter Rate | Tier 3 Calls | Cost |
|-------------|-------------------|-------------------|-------------|------|
| 1,000 | ~20% pass to T2 | ~80% pass to T3 | ~640 | $0.64 |
| 10,000 | ~20% | ~80% | ~6,400 | $6.40 |
| 100,000 | ~20% | ~80% | ~64,000 | $64.00 |

---

## Image Source Strategies

Every pin image has one of three origins. Validation applies equally to all, but each source has unique enrichment paths.

### 1. Scraped Image (Primary — always attempted first)

The image found by scraping the source URL's HTML (OG tags, JSON-LD, `<img>` tags).

**Validation focus:**
- Accuracy is the main concern — scraped images are often generic site assets, not the specific content
- Logo/placeholder filtering (already exists, extend with scoring)
- Check if the scraped image is the actual product vs. a related/promotional image

**Enrichment when scraped image fails:**
- Re-scrape with content-type-specific selectors:
  - Product: look for `[data-product-image]`, `.product-image`, Shopify CDN patterns
  - Article: look for `article img:first-of-type`, `.post-image`, `figure img`
  - Video: extract platform thumbnail via API
- Try alternative scrape targets (srcset largest, data-src, lazy-load attributes)
- Fall through to search or generation if re-scrape fails

### 2. AI-Edited Image (Enhancement of existing)

An existing image (typically scraped) that has been modified by an AI editing model.

**Validation focus:**
- Accuracy should remain high — editing shouldn't change what the image depicts
- Aesthetic fit should improve — that's the point of editing
- Artifact detection — look for AI editing artifacts (seams, unnatural compositing)

**Edit operations and when to trigger them:**

| Trigger Condition | Edit Operation | Expected Improvement |
|------------------|---------------|---------------------|
| Aesthetic score < 0.5 due to text/watermarks | `remove_text` | Aesthetic +0.3 |
| Aesthetic score < 0.5 due to clutter | `remove_background` | Aesthetic +0.2 |
| Visual quality low due to aspect ratio | `smart_crop` | Visual quality +0.3 |
| Accuracy good but aesthetic poor | `style_transfer` to editorial look | Aesthetic +0.4 |

**Re-validation after edit:**
- Must re-score accuracy (editing can degrade it)
- Aesthetic and visual quality should improve; if not, reject the edit and keep original

### 3. Generated Image (Created from scratch)

An entirely new image created by an AI generation model when no adequate source image exists.

**Validation focus:**
- Accuracy is lower confidence by nature — generated images approximate the content
- Style consistency — must match platform aesthetic (high contrast, minimal, editorial)
- AI artifact detection — hands, text, anatomical errors, logical inconsistencies

**Generation strategy by content type:**

| Content Type | Generation Prompt Style | Validation Priority |
|-------------|------------------------|-------------------|
| product | "Product photography of [title], white background, studio lighting" | Accuracy: does it look like the product? |
| article | "Editorial photograph representing [topic], high contrast, documentary style" | Relevance: does it capture the topic? |
| music | "Album art style image for [title/artist], minimal, high contrast" | Aesthetic: does it feel like album art? |
| tool | "App icon / interface screenshot for [title], clean UI" | Accuracy: does it represent the tool? |
| unknown | "Minimal, abstract representation of [title], black and white, Swiss design" | Aesthetic: does it fit the platform? |

**Generation quality gates:**
- Generated images start with accuracy capped at 0.7 (inherent uncertainty)
- Must score ≥ 0.6 aesthetic to display (no ugly generations)
- If generation fails quality gate, retry once with refined prompt, then fall back to styled text card

---

## Data Model

### Image Validation Record

```sql
ALTER TABLE links ADD COLUMN IF NOT EXISTS image_scores JSONB;
-- {
--   accuracy: 0.85,
--   visual_quality: 0.92,
--   aesthetic_fit: 0.78,
--   distinctiveness: 0.95,
--   safety: 1.0,
--   composite: 0.87,
--   tier: "excellent",
--   evaluated_at: "2026-02-08T...",
--   evaluation_method: "tier3_ai_vision"
-- }

ALTER TABLE links ADD COLUMN IF NOT EXISTS image_enrichment_attempts INT DEFAULT 0;
ALTER TABLE links ADD COLUMN IF NOT EXISTS image_enrichment_log JSONB DEFAULT '[]';
-- [
--   { attempt: 1, strategy: "re-scrape-product", result: "failed", score_before: 0.3, score_after: null },
--   { attempt: 2, strategy: "ai-search", result: "success", score_before: 0.3, score_after: 0.82 }
-- ]
```

### Validation Cache

```sql
CREATE TABLE IF NOT EXISTS image_validation_cache (
    image_url_hash TEXT PRIMARY KEY,  -- SHA256 of normalized URL
    image_url TEXT NOT NULL,
    scores JSONB NOT NULL,
    evaluated_at TIMESTAMPTZ DEFAULT NOW(),
    ttl_days INT DEFAULT 30,
    source_domain TEXT,
    content_type TEXT
);

CREATE INDEX idx_validation_cache_domain ON image_validation_cache(source_domain);
CREATE INDEX idx_validation_cache_score ON image_validation_cache((scores->>'composite')::NUMERIC);
```

### Strategy Performance Tracking

Extend existing `strategy_performance` table:

```sql
ALTER TABLE strategy_performance ADD COLUMN IF NOT EXISTS avg_accuracy_score NUMERIC(3,2);
ALTER TABLE strategy_performance ADD COLUMN IF NOT EXISTS avg_aesthetic_score NUMERIC(3,2);
ALTER TABLE strategy_performance ADD COLUMN IF NOT EXISTS avg_composite_score NUMERIC(3,2);
ALTER TABLE strategy_performance ADD COLUMN IF NOT EXISTS override_rate NUMERIC(3,2);
```

---

## User Stories

### US-1: Automatic Image Validation

> As a user, I want the system to automatically evaluate image quality so I don't have to manually check every pin.

**Acceptance Criteria:**
- Every new image runs through at least Tier 1 + Tier 2 validation
- Images scoring "Poor" or "Rejected" are not displayed; fallback strategy runs automatically
- Images scoring "Marginal" display but are queued for background improvement
- No user action required for the happy path

### US-2: Smart Image Replacement

> As a user, I want pins with bad images to automatically get better ones without my intervention.

**Acceptance Criteria:**
- When an image fails validation, the system tries up to 3 enrichment strategies
- Each attempt targets the specific dimension that failed (not a generic re-fetch)
- If all attempts fail, a styled text card displays (not a broken/ugly image)
- User can see that enrichment was attempted (transparency)

### US-3: Image Quality Visibility

> As a power user, I want to see why the system chose a particular image and how it scored.

**Acceptance Criteria:**
- Image editor panel shows dimension scores for the current image
- Enrichment history shows what was tried and why
- Score breakdown helps inform manual image selection

### US-4: Feedback Loop

> As a user, when I manually override an image, that feedback improves future scoring.

**Acceptance Criteria:**
- Manual override records: original image scores, reason inferred from replacement
- Override data feeds into strategy performance metrics
- High-override domains/content-types trigger strategy re-evaluation
- System learns: "for domain X, scraped images have low accuracy" → skip to search

---

## Implementation Phases

### Phase A: Heuristic Foundation (Tier 1 + Tier 2)

Extend existing logo/placeholder detection with comprehensive heuristic scoring. No AI costs, immediate improvement.

| Task | Scope |
|------|-------|
| Implement Tier 1 heuristic checks in client-side image resolution | Client |
| Add image dimension extraction to `enrich-link` (HEAD request for Content-Length, image decode for dimensions) | Server |
| Implement file size, resolution, and aspect ratio scoring | Server |
| Add `image_scores` column to links table | Database |
| Score existing blocklist filter as distinctiveness dimension | Server |
| Define and enforce minimum thresholds per card context (grid, hero, thumb, widget) | Client + Server |
| When Tier 1/2 fails, trigger next strategy in existing pipeline instead of displaying bad image | Client |
| Track score distributions for baseline metrics | Server |

### Phase B: AI Vision Scoring (Tier 3)

Add multimodal AI evaluation for accuracy and aesthetics. Async, so no latency impact on display.

| Task | Scope |
|------|-------|
| Design single-call AI vision prompt that returns all dimension scores | Server |
| Implement `validate-image` edge function or add validation step to `enrich-link` | Server |
| Build `image_validation_cache` table and cache layer | Database + Server |
| Skip Tier 3 for known-good sources (YouTube, GitHub, Vimeo thumbnails) | Server |
| Implement async validation: display image from Tier 2 pass, downgrade if Tier 3 fails | Client + Server |
| Add accuracy scoring: compare image content to pin title/description | Server |
| Add aesthetic scoring: text/watermark detection, clutter analysis | Server |
| Cost tracking and budget controls for vision API calls | Server |

### Phase C: Enrichment Router

Use validation scores to drive smart image replacement and improvement.

| Task | Scope |
|------|-------|
| Implement enrichment router: map failed dimensions to strategies | Server |
| Content-type-specific re-scrape selectors (product, article, video) | Server |
| AI search with score-informed keywords (when accuracy fails) | Server |
| Implement max 3 attempts with re-validation after each | Server |
| Enrichment logging (`image_enrichment_log` column) | Database + Server |
| Strategy performance tracking with score averages | Database + Server |

### Phase D: Feedback Loop

Close the loop between user behavior and system scoring.

| Task | Scope |
|------|-------|
| Record override events with before/after image scores | Client + Server |
| Compute per-domain, per-content-type override rates | Server |
| When override rate > 20% for a source, auto-adjust strategy priority | Server |
| Surface validation scores in image editor UI (when Epic 3.5 Story 6 ships) | Client |
| Weekly strategy performance report (which strategies produce the best scores?) | Server |

---

## Success Metrics

| Metric | Current | Target | Measurement |
|--------|---------|--------|-------------|
| Image override rate | Unknown (~estimated 15-25%) | < 10% | Manual replacements / total pins |
| Images scoring "Excellent" | N/A (no scoring) | > 60% | Composite score ≥ 0.85 |
| Images scoring "Poor" or "Rejected" | N/A | < 5% | Composite score < 0.40 |
| Auto-enrichment success rate | N/A | > 70% | Enrichment attempts that raise score above 0.65 |
| Validation latency (Tier 1+2) | N/A | < 200ms p95 | Time for heuristic + technical checks |
| Validation latency (Tier 3) | N/A | < 2s p95 | Time for AI vision analysis (async) |
| Cost per validated image | N/A | < $0.002 | Total validation costs / images evaluated |

---

## Risks & Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| AI vision costs grow with scale | Budget exceeded | Tiered architecture — Tier 1/2 are free, Tier 3 only for uncertain images; cache aggressively |
| False negatives (good images scored poorly) | Good images replaced unnecessarily | Conservative thresholds initially; "Marginal" tier displays the image while queuing improvement |
| False positives (bad images scored well) | Bad images persist | User override feedback loop corrects scoring over time |
| Latency impact on image display | Perceived slowness | Tier 3 is fully async; images display immediately from Tier 1/2 pass |
| AI vision model inconsistency | Score variance between calls | Cache scores per image URL; re-evaluate only when image URL changes |
| Over-enrichment (too many retries) | Wasted API calls, cost | Hard cap of 3 attempts per pin; exponential backoff between attempts |
| Generated images don't match product | User confusion | Cap generated image accuracy at 0.7; require human confirmation for generated product images |

---

## Dependencies

- **Existing**: `enrich-link` edge function, image resolution pipeline, content type system
- **Epic 3.5 Story 2**: Independent image pipeline (for `resolve-image` function) — enrichment router benefits from this but can work without it
- **Epic 3.5 Stories 4-5**: AI editing and generation — enrichment strategies reference these but Phase A-B don't require them
- **Multimodal AI API**: Claude 3 Haiku/Sonnet with vision (for Tier 3) or equivalent
- **Supabase Storage**: For storing edited/generated images (Epic 3.5 dependency)

---

## Related Documents

- [PRD: Content Type & Image Systems](./content-type-and-image-systems.md) — image sourcing strategies
- [PRD: Boards MVP](./boards-mvp.md) — hero image acceptance criteria
- [TECH: AI Widget System](../../infrastructure/technical-design/ai-widget-system.md) — widget image scraping
- [Project Plan: Phase 3 AI Intelligence](../../execution/project-plan/phase-3-ai-intelligence.md) — Epic 3.5 Image Intelligence System
