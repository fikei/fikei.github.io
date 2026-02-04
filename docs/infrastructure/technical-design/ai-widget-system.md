# AI Widget System - Technical Documentation

**Version:** 3.0
**Last Updated:** 2026-02-03
**Status:** Active

## Table of Contents

1. [Overview](#overview)
2. [Architecture](#architecture)
3. [Data Flow](#data-flow)
4. [Components](#components)
5. [API Specification](#api-specification)
6. [Brand Registry & Image Pipeline](#brand-registry--image-pipeline)
7. [Caching Strategy](#caching-strategy)
8. [Issues & Lessons Learned](#issues--lessons-learned)
9. [Proposed Infrastructure Layers](#proposed-infrastructure-layers)
10. [Backlog](#backlog)

---

## Overview

The AI Widget System provides intelligent, context-aware UI components that analyze user collections and generate personalized recommendations. The flagship widget, "Complete the Look," analyzes a user's clothing items and suggests complementary products to purchase.

### Key Capabilities

- **AI-Powered Analysis**: Uses Claude 3 Haiku for content generation
- **Product Image Scraping**: Fetches real product images from 47+ supported brands
- **Multi-Zone Layout**: Hero, inline, and footer widget placement
- **Feedback Loop**: Collects user interactions to improve prompts
- **Caching**: Multi-level caching (client + server) to reduce API costs

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────────────┐
│                              CLIENT                                      │
│  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐         │
│  │  Widget Registry │  │  Widget Cache   │  │ Widget Feedback │         │
│  │  (WIDGET_REGISTRY)│  │  (localStorage) │  │ (localStorage)  │         │
│  └────────┬────────┘  └────────┬────────┘  └────────┬────────┘         │
│           │                    │                    │                   │
│           └────────────────────┼────────────────────┘                   │
│                                │                                         │
│                    ┌───────────▼───────────┐                            │
│                    │  generateWidgets()    │                            │
│                    │  - Check criteria     │                            │
│                    │  - Build prompt       │                            │
│                    │  - Call Edge Function │                            │
│                    │  - Render HTML        │                            │
│                    └───────────┬───────────┘                            │
└────────────────────────────────┼────────────────────────────────────────┘
                                 │ HTTPS POST
                                 ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                         SUPABASE EDGE FUNCTION                          │
│                      /functions/v1/generate-widget                      │
│                                                                         │
│  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐         │
│  │  Brand Registry │  │  Server Cache   │  │  Claude API     │         │
│  │  (47 brands)    │  │  (in-memory)    │  │  (Haiku)        │         │
│  └────────┬────────┘  └────────┬────────┘  └────────┬────────┘         │
│           │                    │                    │                   │
│           └────────────────────┼────────────────────┘                   │
│                                │                                         │
│  ┌─────────────────────────────▼─────────────────────────────────────┐  │
│  │                     REQUEST PIPELINE                               │  │
│  │  1. Validate request (widgetId, prompt, items)                    │  │
│  │  2. Check server cache                                             │  │
│  │  3. Call Claude API with prompt + brand constraints               │  │
│  │  4. Parse JSON response (handle preamble text)                    │  │
│  │  5. Validate brands → replace unsupported with alternatives       │  │
│  │  6. Enrich suggestions with product images                        │  │
│  │  7. Cache and return                                              │  │
│  └───────────────────────────────────────────────────────────────────┘  │
│                                                                         │
│  ┌─────────────────────────────────────────────────────────────────────┐│
│  │                   IMAGE SCRAPING PIPELINE                           ││
│  │  ┌──────────────┐    ┌──────────────┐    ┌──────────────┐          ││
│  │  │ Shopify API  │ -> │ HTML Scrape  │ -> │ Google Shop  │          ││
│  │  │ (primary)    │    │ (fallback)   │    │ (last resort)│          ││
│  │  └──────────────┘    └──────────────┘    └──────────────┘          ││
│  └─────────────────────────────────────────────────────────────────────┘│
└─────────────────────────────────────────────────────────────────────────┘
                                 │
                                 ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                         EXTERNAL SERVICES                                │
│                                                                         │
│  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐         │
│  │  Anthropic API  │  │  Shopify Stores │  │  Brand Websites │         │
│  │  (Claude Haiku) │  │  (JSON API)     │  │  (HTML scrape)  │         │
│  └─────────────────┘  └─────────────────┘  └─────────────────┘         │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## Data Flow

### 1. Widget Generation Flow

```
User loads page with 'wear' category
        │
        ▼
┌───────────────────────────────┐
│ getApplicableWidgets()        │
│ - Filter by category (wear)   │
│ - Filter by minItems (≥2)     │
│ - Filter by status (active)   │
│ - Exclude hidden/dismissed    │
└───────────────────────────────┘
        │
        ▼
┌───────────────────────────────┐
│ generateWidgetContent()       │
│ - Check local cache           │
│ - Shuffle items for variation │
│ - Build request payload       │
└───────────────────────────────┘
        │
        ▼
┌───────────────────────────────┐
│ POST /generate-widget         │
│ {                             │
│   widgetId: 'complete-...',   │
│   prompt: '...',              │
│   items: [...]                │
│ }                             │
└───────────────────────────────┘
        │
        ▼
┌───────────────────────────────┐
│ Edge Function Processing      │
│ - Append brand constraints    │
│ - Call Claude API             │
│ - Parse JSON response         │
│ - Validate brands             │
│ - Scrape product images       │
│ - Return enriched content     │
└───────────────────────────────┘
        │
        ▼
┌───────────────────────────────┐
│ renderCompleteTheLook()       │
│ - Build HTML from response    │
│ - Display matched items       │
│ - Show suggestions with imgs  │
│ - Attach event handlers       │
└───────────────────────────────┘
```

### 2. Image Scraping Flow

```
For each suggestion:
        │
        ▼
┌───────────────────────────────┐
│ findBrandConfig(brand, name)  │
│ - Match against 47 brands     │
│ - Return config or null       │
└───────────────────────────────┘
        │
        ├─── Has shopifyDomain? ─────┐
        │                            │
        ▼                            ▼
┌─────────────────┐       ┌─────────────────────┐
│ No config found │       │ tryShopifyApi()     │
│ → Google Shop   │       │ - /suggest.json     │
└─────────────────┘       │ - /products.json    │
                          └──────────┬──────────┘
                                     │
                          ┌──────────┴──────────┐
                          │ Image found?        │
                          └──────────┬──────────┘
                                     │
                    ┌────────────────┼────────────────┐
                    │ YES            │ NO             │
                    ▼                ▼                │
              Return image    ┌─────────────────┐    │
                              │ scrapeHtml()    │    │
                              │ - Fetch search  │    │
                              │ - Regex match   │    │
                              └────────┬────────┘    │
                                       │             │
                              ┌────────┴────────┐    │
                              │ Image found?    │    │
                              └────────┬────────┘    │
                                       │             │
                          ┌────────────┼─────────────┘
                          │ YES        │ NO
                          ▼            ▼
                    Return image  Return Google Shopping URL
```

---

## Components

### Client-Side Components

#### 1. Widget Registry (`WIDGET_REGISTRY`)
Centralized configuration for all widgets.

```javascript
{
  'complete-the-look': {
    id: 'complete-the-look',
    version: '3.0',
    name: 'Complete the Look',
    description: '...',
    status: 'active',        // active | beta | draft
    zone: 'inline',          // hero | inline | footer
    criteria: {
      category: 'wear',
      minItems: 2,
      maxItems: null,
      itemTypes: ['product']
    },
    prompt: `...`,           // AI prompt template
    template: {
      layout: 'two-column',
      sections: ['your-items', 'suggestions']
    }
  }
}
```

#### 2. Widget Cache (`widgetCache`)
Client-side localStorage cache for AI responses.

```javascript
{
  'complete-the-look:item1,item2:v0': {
    data: { /* AI response */ },
    timestamp: 1706900000000
  }
}
```

#### 3. Widget Feedback (`widgetFeedback`)
Collects user interactions for PRD improvement.

```javascript
{
  ratings: { 'complete-the-look': { up: 5, down: 1 } },
  comments: [{ widgetId, text, timestamp }],
  userPrefs: {
    budgetRange: '$50-150',
    preferredBrands: 'Nike, Uniqlo',
    stylePrefs: 'minimal',
    customPrompt: 'sustainable only'
  }
}
```

### Server-Side Components

#### 1. Brand Registry (`BRANDS`)
47 brand configurations with scraping strategies.

```typescript
interface BrandConfig {
  name: string              // Display name
  keywords: string[]        // Match keywords
  shopifyDomain?: string    // For Shopify JSON API
  searchUrl?: (q) => string // For HTML scraping
  imagePatterns?: RegExp[]  // Image extraction patterns
}

// Shopify brands (31) - most reliable
{ name: 'Kith', shopifyDomain: 'kith.com', keywords: ['kith'] }

// Non-Shopify brands (16) - HTML scraping
{ name: 'Nike', searchUrl: (q) => `...`, imagePatterns: [...], keywords: ['nike'] }
```

#### 2. Brand Validation Layer
Ensures only supported brands are returned.

```typescript
// Check if brand is supported
function isSupportedBrand(brandName: string): boolean

// Get random replacement for unsupported brand
function getRandomSupportedBrand(category: string): string

// Validate and fix all suggestions
function validateSuggestions(suggestions: any[]): any[]
```

---

## API Specification

### POST `/functions/v1/generate-widget`

#### Request
```typescript
{
  widgetId: string           // Widget identifier
  prompt: string             // AI prompt from registry
  items: Array<{
    id: string
    title: string
    description?: string
    image?: string
    url: string
  }>
}
```

#### Response (Success)
```typescript
{
  content: {
    matchedItems: string[]
    reasoning: string
    missingPieces: string
    suggestions: Array<{
      name: string
      brand: string
      price: string
      category: string
      reason: string
      productUrl: string      // Added by enrichment
      productImage: string    // Added by enrichment
      vendor: string          // Added by enrichment
    }>
  },
  cached: boolean
}
```

#### Response (Error)
```typescript
{
  error: string
  details?: number    // HTTP status code
  raw?: string        // Raw AI response (for debugging)
  message?: string    // Error message
}
```

---

## Brand Registry & Image Pipeline

### Supported Brands (47 total)

#### Shopify Stores (31) - JSON API
| Category | Brands |
|----------|--------|
| Streetwear | Stüssy, Palace, BAPE, Kith, Noah, ALD, Awake NY, Brain Dead |
| Scandinavian | Norse Projects, Our Legacy |
| Designer | Lemaire, Common Projects |
| DTC | Outlier, Reigning Champ, Todd Snyder, Buck Mason, Taylor Stitch, Alex Mill, Corridor |
| Denim | Naked & Famous, 3sixteen, Iron Heart |
| Accessories | Topo Designs, Bellroy, Moscot, Garrett Leight, Miansai, Vitaly |
| Performance | Satisfy Running, District Vision |
| Socks | Anonymous Ism |

#### Non-Shopify (16) - HTML Scraping
| Category | Brands |
|----------|--------|
| Athletic | Nike, Adidas, New Balance, Converse, Vans, ASICS, Hoka, Salomon |
| Basics | Uniqlo, COS |
| Workwear | Carhartt WIP, Levi's |
| Outdoor | Patagonia, The North Face, Arc'teryx |
| Footwear | Dr. Martens, Birkenstock, Clarks, Red Wing |
| Watches | Timex, Casio, Seiko |

### Image Scraping Strategies

#### 1. Shopify JSON API (Primary)
```typescript
// Endpoints tried in order:
1. /search/suggest.json?q={query}&resources[type]=product
2. /products.json?limit=10

// Response handling:
- suggest.json: data.resources.results.products[0].image
- products.json: data.products[0].images[0].src
```

#### 2. HTML Scraping (Fallback)
```typescript
// Fetch search page and regex match
const html = await fetch(searchUrl).text()
const match = html.match(imagePattern)
const imageUrl = match[1]
```

#### 3. Google Shopping (Last Resort)
```typescript
// Return search URL when scraping fails
`https://www.google.com/search?tbm=shop&q=${query}`
```

---

## Caching Strategy

### Multi-Level Cache

```
┌──────────────────────────────────────────────────────────┐
│ Level 1: Client localStorage                              │
│ - Key: {widgetId}:{itemIds}:v{refreshCounter}            │
│ - TTL: 1 hour                                            │
│ - Invalidation: Manual refresh button                    │
└──────────────────────────────────────────────────────────┘
                          │
                          ▼
┌──────────────────────────────────────────────────────────┐
│ Level 2: Edge Function in-memory                         │
│ - Key: {widgetId}:{itemIds}                              │
│ - TTL: 1 hour                                            │
│ - Invalidation: Cold start                               │
└──────────────────────────────────────────────────────────┘
```

### Cache Key Generation

```typescript
// Client-side (includes refresh counter for variation)
const cacheKey = `${widgetId}:${itemIds.sort().join(',')}:v${refreshCounter}`

// Server-side (content-based)
const cacheKey = `${widgetId}:${itemIds.sort().join(',')}`
```

---

## Issues & Lessons Learned

### Issue 1: AI Suggesting Variants Instead of Complements

**Problem:** AI was suggesting different colors of items user already owns (e.g., "navy t-shirt" when user has "black t-shirt").

**Root Cause:** Prompt didn't explicitly forbid same-category suggestions.

**Solution:** Rewrote prompt with strict category rules:
```
ABSOLUTE RULES (violations rejected):
❌ User owns a t-shirt → NEVER suggest any top
❌ User owns jeans → NEVER suggest any bottom
✅ Only suggest from EMPTY categories
```

### Issue 2: No Product Images

**Problem:** Product images weren't loading; all showed placeholders.

**Root Cause:**
- HTML scraping blocked by bot protection (Cloudflare, etc.)
- Department store URLs don't have brand-specific image patterns

**Solution:**
1. Prioritized Shopify JSON API (31 brands) - works reliably
2. Added detailed logging at every scraping step
3. Constrained AI to only suggest brands we can scrape

### Issue 3: Unsupported Brands Leaking Through

**Problem:** AI suggested brands not in our registry (e.g., "Theory", "Acne Studios").

**Root Cause:** Prompt constraint wasn't strong enough; AI hallucinated similar brands.

**Solution:** Server-side brand validation layer:
```typescript
function validateSuggestions(suggestions) {
  return suggestions.map(sug => {
    if (!isSupportedBrand(sug.brand)) {
      return { ...sug, brand: getRandomSupportedBrand(sug.category) }
    }
    return sug
  })
}
```

### Issue 4: JSON Parsing Failures

**Problem:** `Invalid AI response format` errors.

**Root Cause:** AI added preamble text like "Here is the JSON response..." before JSON.

**Solution:** Extract JSON between first `{` and last `}`:
```typescript
const firstBrace = text.indexOf('{')
const lastBrace = text.lastIndexOf('}')
const jsonStr = text.substring(firstBrace, lastBrace + 1)
```

### Issue 5: Claude API Rate Limiting (529 Errors)

**Problem:** Frequent 529 errors during development.

**Root Cause:** Too many requests during testing.

**Solution:**
- Implemented caching (reduced API calls ~90%)
- Use test mode during development
- Monitor usage via Anthropic dashboard

### Issue 6: Widget Duplication

**Problem:** Refreshing created duplicate widgets instead of replacing.

**Root Cause:** Widget container wasn't cleared before re-rendering.

**Solution:** Clear widget HTML before regenerating:
```javascript
document.getElementById('widgetInline').innerHTML = ''
generateWidgets()
```

---

## Proposed Infrastructure Layers

Based on the issues encountered, here are recommended abstractions:

### 1. Brand Intelligence Service

**Purpose:** Centralize brand knowledge and validation.

```typescript
interface BrandIntelligenceService {
  // Core brand operations
  findBrand(query: string): BrandConfig | null
  isSupportedBrand(name: string): boolean
  getSimilarBrands(brand: string): string[]

  // Dynamic brand discovery
  extractBrandsFromUrl(url: string): string[]
  findScrapableBrands(brandList: string[]): string[]

  // Category mapping
  getBrandsForCategory(category: string): string[]
  getCategoryForBrand(brand: string): string
}
```

**Benefits:**
- Single source of truth for brand data
- Easy to add new brands
- Can validate scrapeability before suggesting

### 2. Image Resolution Pipeline

**Purpose:** Abstract image fetching with multiple strategies.

```typescript
interface ImagePipeline {
  // Strategy chain
  strategies: ImageStrategy[]

  // Main entry point
  resolve(brand: string, query: string): Promise<ImageResult>

  // Individual strategies
  shopifyApi(domain: string, query: string): Promise<ImageResult>
  htmlScrape(url: string, patterns: RegExp[]): Promise<ImageResult>
  googleImages(query: string): Promise<ImageResult>
  serpApi(query: string): Promise<ImageResult>
}

interface ImageStrategy {
  name: string
  priority: number
  canHandle(brand: BrandConfig): boolean
  execute(brand: BrandConfig, query: string): Promise<ImageResult>
}
```

**Benefits:**
- Pluggable strategy pattern
- Easy to add new image sources (SERP API, etc.)
- Automatic fallback chain

### 3. Prompt Engineering Framework

**Purpose:** Structured prompt building with constraints.

```typescript
interface PromptBuilder {
  // Base prompt
  base(template: string): this

  // Constraints
  addBrandConstraint(brands: string[]): this
  addCategoryConstraint(ownedCategories: string[]): this
  addStyleConstraint(preferences: UserPrefs): this

  // Output format
  requireJson(schema: JsonSchema): this

  // Build final prompt
  build(): string
}

// Usage
const prompt = new PromptBuilder()
  .base(WIDGET_REGISTRY['complete-the-look'].prompt)
  .addBrandConstraint(SUPPORTED_BRANDS)
  .addCategoryConstraint(['tops', 'bottoms']) // user owns these
  .addStyleConstraint(userPrefs)
  .requireJson(outputSchema)
  .build()
```

**Benefits:**
- Consistent prompt structure
- Easy to add/remove constraints
- Testable prompt components

### 4. Response Parser & Validator

**Purpose:** Robust parsing of AI responses.

```typescript
interface ResponseParser {
  // Parse with multiple strategies
  parse(text: string): ParseResult

  // Validation
  validate(content: any, schema: JsonSchema): ValidationResult

  // Fix common issues
  fixMalformedJson(text: string): string
  extractJsonFromText(text: string): string
  removeMarkdownCodeBlocks(text: string): string
}
```

**Benefits:**
- Handles AI quirks (preamble, markdown, etc.)
- Schema validation before use
- Detailed error messages

### 5. Widget State Manager

**Purpose:** Centralize widget state across components.

```typescript
interface WidgetStateManager {
  // Cache management
  getCache(widgetId: string, itemIds: string[]): CachedResult | null
  setCache(widgetId: string, itemIds: string[], data: any): void
  invalidateCache(widgetId?: string): void

  // User preferences
  getPrefs(): WidgetPrefs
  setFavorite(widgetId: string, value: boolean): void
  setDismissed(widgetId: string): void
  setHidden(widgetId: string): void

  // Feedback
  recordRating(widgetId: string, positive: boolean): void
  recordComment(widgetId: string, text: string): void
  exportFeedback(): FeedbackExport
}
```

**Benefits:**
- Single state store
- Consistent persistence
- Easy testing

### 6. Scraping Health Monitor

**Purpose:** Track scraping success rates and alert on failures.

```typescript
interface ScrapingMonitor {
  // Record outcomes
  recordSuccess(brand: string, strategy: string): void
  recordFailure(brand: string, strategy: string, error: string): void

  // Health metrics
  getSuccessRate(brand: string): number
  getFailingBrands(): string[]

  // Alerts
  onHealthDegraded(callback: (brands: string[]) => void): void
}
```

**Benefits:**
- Proactive monitoring
- Automatic brand disabling
- Debug insights

---

## Backlog

### High Priority

1. **Setup Supabase CLI** - Enable local development and testing
   - Install CLI: `npm install -g supabase`
   - Link project: `supabase link --project-ref <ref>`
   - Local functions: `supabase functions serve`

2. **Dynamic Brand Discovery** - Extract brands from user's board
   - Analyze URLs for brand keywords
   - Find similar brands via embeddings
   - Validate scrapeability before adding

3. **User-Customizable Prompts** - Let users personalize suggestions
   - Simple UI for tone/style preferences
   - Hide technical prompt details
   - Merge user prefs with base prompt

### Medium Priority

4. **SERP API Integration** - More reliable image source
   - Google Custom Search API
   - Bing Image Search API
   - Fallback when scraping fails

5. **Brand Health Dashboard** - Monitor scraping success
   - Per-brand success rates
   - Automatic alerting
   - One-click brand disable

6. **A/B Testing Framework** - Test different prompts
   - Split traffic between prompt variants
   - Track engagement metrics
   - Statistical significance testing

### Lower Priority

7. **Price Range Filtering** - Budget-aware suggestions
8. **Seasonal/Occasion Filters** - Context-aware suggestions
9. **Multiple Outfit Options** - Generate 3 alternatives
10. **Outfit History** - Track past suggestions

---

## File Reference

| File | Purpose |
|------|---------|
| `supabase/functions/generate-widget/index.ts` | Edge Function - AI generation + scraping |
| `boards/index.html` | Client app - Widget registry, rendering, feedback |
| `docs/TECH-ai-widget-system.md` | This documentation |

---

## Appendix: Widget PRD Template

```javascript
{
  id: 'widget-id',
  version: '1.0',
  name: 'Human-Readable Name',
  description: 'What this widget does',
  status: 'draft',  // draft → beta → active
  zone: 'inline',   // hero | inline | footer
  criteria: {
    category: 'wear',
    minItems: 2,
    maxItems: null,
    itemTypes: ['product']
  },
  prompt: `
    System context and role...

    Step-by-step instructions...

    Output format (JSON schema)...
  `,
  template: {
    layout: 'two-column',
    sections: ['section1', 'section2']
  }
}
```
