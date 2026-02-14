# Phase 10: Image Validation & Enrichment

> Back to [Project Plan](./index.md)

Every pin image gets scored across accuracy, visual quality, aesthetic fit, distinctiveness, and safety — then gated, enriched, or replaced automatically based on what failed.

**PRD**: [Image Validation & Enrichment Engine](../../strategy/prds/image-validation-enrichment.md)
**Depends on**: Phase 3 Epic 3.2 (Image Resolution), partially Phase 3 Epic 3.5 (Image Intelligence)

---

## Epic 10.1: Heuristic Validation (Tier 1 + Tier 2)

> Fast, deterministic checks that catch obvious failures — no AI, no cost. Tier 1 runs client-side (~0ms), Tier 2 runs server-side (~100ms).

### Story 1: Client-Side Heuristic Gate (Tier 1)

Extend the existing logo/placeholder blocklist into a full heuristic scoring pass that runs before any image is displayed.

| Task | Status |
|------|--------|
| Extract existing blocklist patterns from `enrich-link` and `boards/index.html` into shared constants | Complete |
| Add file size check: reject images < 5KB as likely placeholders | Complete |
| Add dimension check: reject images < 50px in either dimension | Complete |
| Add filename pattern scoring (logo, icon, favicon, sprite, pixel, spacer, blank, transparent) | Complete |
| Add URL pattern detection for known CDN placeholder paths | Complete |
| Detect when image URL matches site favicon URL | Complete |
| Add duplicate detection: same image URL used across multiple pins from same domain | Complete |
| Score each check and compute Tier 1 distinctiveness sub-score | Complete |
| When Tier 1 fails → skip display, trigger next strategy in pipeline | Complete |
| Unit tests for heuristic checks with known good/bad image URLs | Pending |

**Key files**: `js/image-validation.js` (shared module), `boards/index.html` (integration in `fetchMetadata` + `resolveImage`)

### Story 2: Server-Side Technical Analysis (Tier 2)

Validate image metadata without full download. HEAD requests + partial decode for dimensions.

| Task | Status |
|------|--------|
| Add HTTP HEAD request in `enrich-link` to verify image loads (200, correct Content-Type) | Complete |
| Extract image dimensions from headers or partial download (first bytes for JPEG/PNG/WebP) | Complete |
| Detect redirects to generic error/placeholder images (compare final URL to known patterns) | Complete |
| Implement resolution scoring against card context thresholds (grid: 300x200, hero: 600x400, thumb: 100x100) | Complete |
| Implement aspect ratio scoring: reject extreme ratios (> 3:1 or < 1:3) | Complete |
| Implement format validation: JPEG, PNG, WebP, AVIF only | Complete |
| Compute Tier 2 visual quality sub-score from resolution + aspect ratio + format checks | Complete |
| When Tier 2 fails → trigger re-resolution with next strategy | Complete |

**Key files**: `supabase/functions/enrich-link/index.ts` (`validateImageTier2`, `extractDimensions`)

### Story 3: Scoring Data Model

Add score storage to the database so validation results persist and can inform downstream decisions.

| Task | Status |
|------|--------|
| Add `image_scores` JSONB column to links table (accuracy, visual_quality, aesthetic_fit, distinctiveness, safety, composite, tier, evaluated_at, evaluation_method) | Complete |
| Add `image_enrichment_attempts` INT column to links table (default 0) | Complete |
| Add `image_enrichment_log` JSONB column to links table (default '[]') | Complete |
| Create Supabase migration file `007_image_validation.sql` | Complete |
| Update client-side link model to include image_scores | Complete |
| Update Supabase sync to persist image_scores | Complete |

**Key files**: `supabase/migrations/007_image_validation.sql`, `boards/index.html` (sync payload + `updateLinkImage`)

### Story 4: Baseline Metrics

Instrument score tracking to establish baseline before adding AI evaluation.

| Task | Status |
|------|--------|
| Log score distributions for Tier 1/2 evaluations (histogram of composite scores) | Complete |
| Track pass/fail rates per tier (what % of images fail Tier 1? Tier 2?) | Complete |
| Track scores by content type and domain (which types score lowest?) | Complete |
| Create admin view: pins with lowest image scores | Complete |

**Key files**: `boards/index.html` (`imageQualityReport()`, `worstImages()` console diagnostics)

---

## Epic 10.2: AI Vision Scoring (Tier 3)

> Multimodal AI evaluation for accuracy, aesthetics, and safety. Fully async — images display immediately from Tier 2 pass, Tier 3 can downgrade later.

### Story 1: Vision Evaluation Function

Single AI call that scores an image across all remaining dimensions.

| Task | Status |
|------|--------|
| Design multimodal prompt: accuracy, aesthetic (text/watermarks, clutter), distinctiveness, safety classification | Complete |
| Safety classification uses 3 tiers: "safe" / "mature" / "blocked" — nudity allowed, porn/CSAM/gore blocked | Complete |
| Implement `validate-image` edge function accepting `{ image_url, title, category, content_type }` | Complete |
| Return structured JSON: `{ accuracy, aesthetic_fit, distinctiveness, safety, evaluation_model, tokens_used }` | Complete |
| Error handling: if vision call fails, keep Tier 2 scores (don't block display) | Complete |
| Support multiple vision providers: Claude Sonnet (primary), GPT-4o (fallback) | Complete |

**Key files**: `supabase/functions/validate-image/index.ts`

### Story 2: Validation Cache

Cache AI vision results by image URL so the same image is never re-evaluated.

| Task | Status |
|------|--------|
| Create `image_validation_cache` table (image_url_hash PK, image_url, scores, evaluated_at, ttl_days, source_domain, content_type) | Complete |
| Add index on source_domain for domain-level analytics | Complete |
| Add index on composite score for finding lowest-scored images | Complete |
| Cache lookup before calling AI: if cached and TTL valid, use cached scores | Complete |
| Default TTL: 30 days (images at the same URL rarely change) | Complete |
| Cache invalidation: clear when user manually overrides image | Pending |

**Key files**: `supabase/functions/validate-image/index.ts` (cache lookup/write), `supabase/migrations/007_image_validation.sql` (table)

### Story 3: Known-Good Source Bypass

Skip expensive Tier 3 evaluation for sources with historically high quality.

| Task | Status |
|------|--------|
| Define known-good source list: YouTube thumbnails, GitHub social previews, Vimeo thumbnails, Spotify album art | Complete |
| Auto-assign high scores for known-good sources (accuracy: 0.9, aesthetic: 0.8, distinctiveness: 1.0, safety: 1.0) | Complete |
| Track override rate for known-good sources — if > 10%, remove from bypass list | Pending |

### Story 4: Async Display-Then-Validate Flow

Images display immediately from Tier 2, then Tier 3 runs in background and can downgrade.

| Task | Status |
|------|--------|
| After Tier 2 pass, display image and queue Tier 3 evaluation | Complete |
| On Tier 3 completion: if composite drops below "Marginal" threshold (0.40), remove displayed image | Complete |
| On Tier 3 completion: if composite is "Marginal" (0.40–0.64), queue for background enrichment | Complete |
| UI: smooth transition when image is downgraded (fade to styled text card or replacement) | Complete |
| Track frequency of Tier 3 downgrades (how often does Tier 2 pass but Tier 3 fail?) | Complete |

**Key files**: `boards/index.html` (Tier 3 queue, `callValidateImage`, `handleTier3Downgrade`)

### Story 5: Cost Controls

Budget management for AI vision API calls.

| Task | Status |
|------|--------|
| Track tokens used per validation call | Complete |
| Daily budget cap: stop Tier 3 evaluations when daily cost exceeds threshold | Complete |
| When budget exhausted, fall back to Tier 2 scores only (graceful degradation) | Complete |
| Monthly cost dashboard in admin panel | Pending |

---

## Epic 10.2b: Visual Standards System

> Three-layer config-driven framework defining image quality and aesthetic expectations. Layer 0 (gate) actively blocks bad images. Layers 1 and 2 define scoring prompts for future AI vision ranking and currently shape generate-widget AI prompts.

### Story 1: Product Gate (Layer 0) — URL Pattern & Technical Checks

Synchronous, zero-cost checks that reject images before any AI evaluation.

| Task | Status |
|------|--------|
| Define blocked URL patterns: stock watermarks (Shutterstock, Getty), ad networks (doubleclick, googlesyndication), tracking pixels, data URIs, default social share images, emoji CDNs | Complete |
| Define technical thresholds: min 400x300, max aspect 3.5:1, min 5KB file size | Complete |
| Define blocked compositions list (UI screenshots, memes, logo collages, QR codes, slides, stock handshakes) | Complete |
| Define soft preferences (professional lighting, clear subject, high contrast, human curated feel) | Complete |
| Implement `checkGateUrlPatterns()` — synchronous URL pattern rejection | Complete |
| Implement `checkGateTechnical()` — synchronous dimension/size rejection | Complete |
| Implement `buildGatePrompt()` — for Claude Vision scoring prompts | Complete |
| Wire gate into `enrich-link`: `isRejectedByGate()` at all 5 scrape checkpoints | Complete |
| Wire gate into `enrich-link`: `checkGateTechnical()` in Tier 2 validation after dimension extraction | Complete |

**Key files**: `supabase/functions/generate-widget/config/visual-standards.ts`, `supabase/functions/enrich-link/index.ts`

### Story 2: Content Type Standards (Layer 1)

Per-type scoring definitions for what a "good" image looks like given its content type.

| Task | Status |
|------|--------|
| Define standards for all 9 content types: product, article, video, music, repository, social, document, tool, unknown | Complete |
| Each type specifies: expected_subject, good_framing, good_backgrounds, anti_patterns, aspect_preference | Complete |
| Add digital product safeguards: `product` type scoped to physical only, `tool` type rejects physical product framing | Complete |
| Implement `buildContentTypePrompt()` — generates type context for AI prompts | Complete |
| Add explicit "product = physical only" guidance in prompt when type is product | Complete |
| Wire content type scoring into Claude Vision image scorer (`buildImageScoringPrompt()`) | Pending |

**Key files**: `supabase/functions/generate-widget/config/visual-standards.ts`

### Story 3: Category Aesthetics (Layer 2)

Per-category visual tone definitions for board categories.

| Task | Status |
|------|--------|
| Define aesthetics for all 9 categories: home, wear, watch, listen, use, eat, go, follow, read | Complete |
| Each category specifies: palette (hex colors), mood, textures, lighting, compositions, anti_patterns | Complete |
| Add digital product safeguards: `use` category uses `device-hero` not `product-hero`, anti-pattern for physical product shots on software | Complete |
| Implement `buildCategoryPrompt()` — generates category context for AI prompts | Complete |
| Wire category context into generate-widget AI prompt (alongside brand + design system constraints) | Complete |
| Wire category scoring into Claude Vision image scorer (`buildImageScoringPrompt()`) | Pending |

**Key files**: `supabase/functions/generate-widget/config/visual-standards.ts`, `supabase/functions/generate-widget/index.ts`

### Story 4: Combined Image Scoring Prompt

Build a combined scorer prompt that sends candidate images to Claude Vision for ranking.

| Task | Status |
|------|--------|
| Implement `buildImageScoringPrompt(contentType, category)` — combines gate + type + category prompts | Complete |
| Wire into async Tier 3 evaluation to pick best candidate image from multiple options | Pending |
| Score each candidate across gate_pass, content_type_score, category_score, combined_score | Pending |

**Key files**: `supabase/functions/generate-widget/config/visual-standards.ts`

---

## Epic 10.3: Composite Scoring Engine

> Combine dimension scores into a single quality tier that drives downstream behavior.

### Story 1: Score Computation

Weighted average across dimensions with safety as a hard gate.

| Task | Status |
|------|--------|
| Implement composite score formula: accuracy (0.35) + visual_quality (0.25) + aesthetic_fit (0.20) + distinctiveness (0.15) + safety (0.05) | Pending |
| Safety hard gate: composite = 0.0 if safety = "blocked", regardless of other scores | Pending |
| Map composite to tier: Excellent (0.85+), Good (0.65–0.84), Marginal (0.40–0.64), Poor (0.15–0.39), Rejected (0–0.14) | Pending |
| Store tier label alongside scores in `image_scores` JSONB | Pending |
| Handle partial scoring: if only Tier 1/2 ran, compute partial composite from available dimensions | Pending |

### Story 2: Tier-Based Actions

Different tiers trigger different platform behaviors.

| Task | Status |
|------|--------|
| Excellent/Good → display immediately, no further action | Pending |
| Marginal → display with standard treatment, queue background enrichment | Pending |
| Poor → don't display image, trigger enrichment pipeline, show styled text card | Pending |
| Rejected → block image permanently, use styled text card, don't retry | Pending |
| Blocked (safety) → suppress image, log event, never retry | Pending |
| Surface tier as data attribute on pin cards for debugging (`data-image-tier="good"`) | Pending |

---

## Epic 10.4: Enrichment Router

> When validation identifies a gap, route to the right corrective strategy based on which dimension failed.

### Story 1: Dimension-to-Strategy Mapping

Route enrichment attempts based on the specific failed dimension.

| Task | Status |
|------|--------|
| Implement strategy selection matrix: map each failed dimension to primary + fallback strategy | Pending |
| Accuracy low + scraped image exists → re-scrape with content-type-specific selectors | Pending |
| Accuracy low + no scraped image → AI search with title + category keywords | Pending |
| Visual quality low (resolution) → re-scrape for higher-res variant (srcset, CDN size params) | Pending |
| Visual quality low (aspect ratio) → AI smart crop to target ratio | Pending |
| Visual quality low (poor lighting/color) → AI edit: enhance brightness/contrast/color | Pending |
| Aesthetic fit low (text/watermarks) → AI edit: remove text overlay | Pending |
| Aesthetic fit low (clutter/padding) → AI edit: smart crop or background removal | Pending |
| Distinctiveness low (logo/generic) → full re-resolution from scratch, skip cache | Pending |
| Safety blocked → no enrichment, permanent block | Pending |

### Story 2: Content-Type-Specific Re-Scrape Selectors

Smarter scraping when the first scrape returned the wrong image.

| Task | Status |
|------|--------|
| Product pages: try `[data-product-image]`, `.product-image`, Shopify CDN patterns, JSON-LD `product.image` | Pending |
| Article pages: try `article img:first-of-type`, `.post-image`, `figure img`, `[itemprop="image"]` | Pending |
| Video pages: extract platform thumbnail via API (YouTube, Vimeo, Wistia) | Pending |
| Try srcset largest variant, `data-src`, `data-lazy-src`, `loading="lazy"` originals | Pending |
| Try CDN size parameter manipulation (e.g., `?w=800`, `_800x.jpg`, `-large.jpg`) | Pending |

### Story 3: Enrichment Execution Loop

Max 3 attempts per pin, each targeting the weakest dimension.

| Task | Status |
|------|--------|
| On enrichment trigger: identify lowest-scoring dimension | Pending |
| Execute primary strategy for that dimension | Pending |
| Re-validate result through full scoring pipeline | Pending |
| If still below threshold: execute fallback strategy | Pending |
| If still below threshold after 3 attempts: accept styled text card | Pending |
| Log each attempt to `image_enrichment_log` (attempt number, strategy, before/after scores, result) | Pending |
| Increment `image_enrichment_attempts` counter | Pending |
| Exponential backoff between enrichment attempts (avoid hammering sources) | Pending |

### Story 4: Enrichment for Scraped Images — Visual Compliance

When a scraped image is accurate but doesn't meet platform visual standards.

| Task | Status |
|------|--------|
| Try higher-res variant from same source (srcset, CDN size params like `?w=800`) | Pending |
| AI edit: smart crop to remove excessive padding/whitespace | Pending |
| AI edit: background cleanup or removal for cluttered product shots | Pending |
| AI edit: remove text overlays or watermarks | Pending |
| If source image is fundamentally low quality (dark, blurry), skip editing → fall through to AI search or generation | Pending |

---

## Epic 10.5: Feedback Loop

> User overrides feed back into scoring and strategy performance, closing the loop over time.

### Story 1: Override Event Tracking

Record what the user replaced and why (inferred).

| Task | Status |
|------|--------|
| On manual image override: record original image URL, original scores, new image URL | Pending |
| Infer override reason from score profile (low accuracy? low aesthetic? low distinctiveness?) | Pending |
| Store override events in `image_enrichment_log` as `{ type: 'manual_override', ... }` | Pending |
| Track override rate per domain (which domains have the worst auto-images?) | Pending |
| Track override rate per content type (which types need the most manual fixing?) | Pending |

### Story 2: Strategy Performance Analytics

Measure which sourcing strategies produce the best-scoring images.

| Task | Status |
|------|--------|
| Extend `strategy_performance` table: add avg_accuracy_score, avg_aesthetic_score, avg_composite_score, override_rate | Pending |
| After each image is scored, update strategy performance for the method that produced it | Pending |
| Weekly aggregation: compute rolling averages per strategy × content_type | Pending |
| Admin dashboard: strategy performance comparison table | Pending |

### Story 3: Adaptive Strategy Priority

Automatically adjust strategy order based on historical performance.

| Task | Status |
|------|--------|
| When override rate > 20% for a domain × strategy combination, demote that strategy in priority | Pending |
| When override rate > 20% for a content_type × strategy combination, adjust type defaults | Pending |
| Promote strategies with consistently high composite scores | Pending |
| Log priority changes for auditability | Pending |
| Weekly strategy performance report generation | Pending |

### Story 3: Score Visibility in UI

Surface validation data in the image editor (depends on Epic 3.5 Story 6).

| Task | Status |
|------|--------|
| Show dimension score breakdown in image editor panel (radar chart or bar visualization) | Pending |
| Show enrichment history: what was tried, what scores resulted | Pending |
| Show image tier badge on pin card (dev/admin mode only) | Pending |
| "Why this image?" tooltip explaining the scoring rationale | Pending |

---

## Summary

| Epic | Stories | Tasks | Status |
|------|---------|-------|--------|
| 10.1 Heuristic Validation | 4 | 28 | Complete (27/28) |
| 10.2 AI Vision Scoring | 5 | 23 | Complete (20/23) |
| 10.2b Visual Standards | 4 | 24 | IN PROGRESS (21/24) |
| 10.3 Composite Scoring | 2 | 11 | Pending |
| 10.4 Enrichment Router | 4 | 26 | Pending |
| 10.5 Feedback Loop | 3 | 14 | Pending |
| **Total** | **22** | **126** | **IN PROGRESS (68/126)** |
