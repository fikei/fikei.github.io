# AI Widget Pipeline - Strategic Architecture

**Purpose:** Analyze the current pipeline, identify issues from our implementation, and propose a modular architecture for building reusable AI-powered widgets.

---

## Current Pipeline Analysis

### What We Built

```
┌─────────────────────────────────────────────────────────────────┐
│                    CURRENT PIPELINE                              │
│                                                                  │
│  User Board → Widget Criteria → AI Prompt → Claude API          │
│                                      ↓                          │
│                              JSON Response                       │
│                                      ↓                          │
│                           Brand Validation                       │
│                                      ↓                          │
│                         Image Enrichment (broken)               │
│                           ↓              ↓                      │
│                    Shopify API    HTML Scrape                   │
│                      (blocked?)    (blocked?)                   │
│                                      ↓                          │
│                              Render Widget                      │
└─────────────────────────────────────────────────────────────────┘
```

### Issues Encountered

| Issue | Root Cause | Time to Fix | Lesson |
|-------|------------|-------------|--------|
| AI suggesting variants not complements | Prompt wasn't explicit enough | 2 iterations | Prompts need rigid rules, not suggestions |
| Images not loading | Bot protection on brand sites | Ongoing | Can't rely on direct scraping at scale |
| Unsupported brands leaking | AI ignores soft constraints | 1 iteration | Need server-side validation layer |
| JSON parsing failures | AI adds preamble text | 1 iteration | Always extract JSON, never trust raw response |
| Widget duplication | Global state not cleared | 1 iteration | Widget state needs isolation |
| All widgets refresh together | Shared refresh counter | 1 iteration | Per-widget state management needed |

### Core Problem

**We're trying to solve multiple hard problems in one monolithic function:**
1. AI prompt engineering
2. Response parsing & validation
3. Brand/product knowledge
4. Image resolution (multiple strategies)
5. Caching
6. Widget rendering

Each of these deserves its own abstraction layer.

---

## Proposed Modular Architecture

### Layer 1: Widget Registry & Configuration

```typescript
// widgets/registry.ts
interface WidgetDefinition {
  id: string
  version: string
  name: string

  // Display config
  zone: 'hero' | 'inline' | 'footer'

  // Activation criteria
  criteria: {
    categories: string[]      // Which board categories trigger this
    minItems: number
    maxItems?: number
  }

  // AI configuration
  ai: {
    promptTemplate: string    // Base prompt
    constraints: Constraint[] // Brand, category, style constraints
    outputSchema: JSONSchema  // Expected response structure
    model: 'haiku' | 'sonnet' // Which model to use
  }

  // Enrichment pipeline
  enrichment: {
    strategies: string[]      // ['shopify', 'serp', 'ai-generate']
    timeout: number
    fallback: 'placeholder' | 'skip' | 'generic'
  }
}
```

### Layer 2: Prompt Engineering Framework

```typescript
// prompts/builder.ts
class PromptBuilder {
  private base: string
  private constraints: string[] = []
  private examples: string[] = []
  private outputFormat: string

  static forWidget(widgetId: string): PromptBuilder {
    const def = WIDGET_REGISTRY[widgetId]
    return new PromptBuilder(def.ai.promptTemplate)
  }

  // Add hard constraints (AI MUST follow)
  addHardConstraint(rule: string): this {
    this.constraints.push(`ABSOLUTE RULE: ${rule}`)
    return this
  }

  // Add brand constraints from supported list
  addBrandConstraint(brands: string[]): this {
    this.constraints.push(
      `ONLY use these brands: ${brands.join(', ')}\n` +
      `If you suggest a brand not on this list, the response will be REJECTED.`
    )
    return this
  }

  // Add category constraints (what user already owns)
  addOwnedCategoryConstraint(categories: string[]): this {
    const rules = categories.map(c => `❌ NEVER suggest ${c}`)
    this.constraints.push(
      `User already owns items in: ${categories.join(', ')}\n` +
      rules.join('\n')
    )
    return this
  }

  // Require strict JSON output
  requireJson(schema: object): this {
    this.outputFormat = `
RESPOND WITH VALID JSON ONLY.
NO markdown, NO preamble, NO explanation.
Start your response with { and end with }

Schema:
${JSON.stringify(schema, null, 2)}`
    return this
  }

  build(): string {
    return [
      this.base,
      '\n\n=== CONSTRAINTS ===',
      ...this.constraints,
      '\n\n=== OUTPUT FORMAT ===',
      this.outputFormat
    ].join('\n')
  }
}
```

### Layer 3: Response Parser & Validator

```typescript
// ai/parser.ts
class AIResponseParser {

  static parse<T>(raw: string, schema: JSONSchema): ParseResult<T> {
    // Step 1: Clean markdown
    let text = raw
      .replace(/```json\n?/g, '')
      .replace(/```\n?/g, '')
      .trim()

    // Step 2: Extract JSON if wrapped in text
    const firstBrace = text.indexOf('{')
    const lastBrace = text.lastIndexOf('}')

    if (firstBrace === -1 || lastBrace === -1) {
      return { success: false, error: 'NO_JSON_FOUND', raw }
    }

    const jsonStr = text.substring(firstBrace, lastBrace + 1)

    // Step 3: Parse JSON
    let parsed: any
    try {
      parsed = JSON.parse(jsonStr)
    } catch (e) {
      return { success: false, error: 'INVALID_JSON', raw: jsonStr }
    }

    // Step 4: Validate against schema
    const validation = validateSchema(parsed, schema)
    if (!validation.valid) {
      return { success: false, error: 'SCHEMA_MISMATCH', details: validation.errors }
    }

    return { success: true, data: parsed as T }
  }
}
```

### Layer 4: Brand Intelligence Service

```typescript
// brands/service.ts
class BrandService {
  private brands: BrandConfig[]
  private healthMetrics: Map<string, BrandHealth>

  // Core lookup
  findBrand(query: string): BrandConfig | null {
    const q = query.toLowerCase()
    return this.brands.find(b =>
      b.keywords.some(kw => q.includes(kw))
    )
  }

  // Validation
  isSupportedBrand(name: string): boolean {
    return this.findBrand(name) !== null
  }

  // Get healthy brands only
  getHealthyBrands(minSuccessRate = 0.5): BrandConfig[] {
    return this.brands.filter(b => {
      const health = this.healthMetrics.get(b.name)
      return !health || health.successRate >= minSuccessRate
    })
  }

  // Category mapping
  getBrandsForCategory(category: string): string[] {
    const mapping: Record<string, string[]> = {
      footwear: ['Nike', 'Adidas', 'New Balance', 'Vans', 'Common Projects'],
      tops: ['Reigning Champ', 'Todd Snyder', 'Uniqlo', 'COS'],
      bottoms: ['Naked & Famous', '3sixteen', "Levi's", 'Carhartt WIP'],
      outerwear: ['Patagonia', 'The North Face', "Arc'teryx"],
      accessories: ['Timex', 'Casio', 'Bellroy', 'Moscot']
    }
    return mapping[category] || mapping.accessories
  }

  // Get replacement for unsupported brand
  getAlternative(unsupportedBrand: string, category: string): string {
    const options = this.getBrandsForCategory(category)
    return options[Math.floor(Math.random() * options.length)]
  }

  // Health tracking
  recordOutcome(brand: string, strategy: string, success: boolean): void {
    const health = this.healthMetrics.get(brand) || { attempts: 0, successes: 0 }
    health.attempts++
    if (success) health.successes++
    health.successRate = health.successes / health.attempts
    this.healthMetrics.set(brand, health)
  }
}
```

### Layer 5: Image Resolution Pipeline

```typescript
// images/pipeline.ts
interface ImageStrategy {
  name: string
  priority: number
  canHandle(brand: BrandConfig): boolean
  resolve(brand: BrandConfig, query: string): Promise<ImageResult>
}

class ShopifyStrategy implements ImageStrategy {
  name = 'shopify'
  priority = 1

  canHandle(brand: BrandConfig): boolean {
    return !!brand.shopifyDomain
  }

  async resolve(brand: BrandConfig, query: string): Promise<ImageResult> {
    const endpoints = [
      `https://${brand.shopifyDomain}/search/suggest.json?q=${encodeURIComponent(query)}&resources[type]=product`,
      `https://${brand.shopifyDomain}/products.json?limit=10`
    ]

    for (const endpoint of endpoints) {
      try {
        const res = await fetch(endpoint, {
          headers: { 'Accept': 'application/json' }
        })
        if (!res.ok) continue

        const data = await res.json()
        const image = this.extractImage(data, query)
        if (image) return { success: true, image, source: 'shopify' }
      } catch (e) {
        continue
      }
    }

    return { success: false }
  }
}

class SerpApiStrategy implements ImageStrategy {
  name = 'serp'
  priority = 2

  canHandle(): boolean {
    return !!Deno.env.get('SERP_API_KEY')
  }

  async resolve(brand: BrandConfig, query: string): Promise<ImageResult> {
    const apiKey = Deno.env.get('SERP_API_KEY')
    const searchQuery = `${brand.name} ${query} product`

    const res = await fetch(
      `https://serpapi.com/search.json?q=${encodeURIComponent(searchQuery)}&tbm=isch&api_key=${apiKey}`
    )

    const data = await res.json()
    const image = data.images_results?.[0]?.original

    return image
      ? { success: true, image, source: 'serp' }
      : { success: false }
  }
}

class ImagePipeline {
  private strategies: ImageStrategy[]
  private brandService: BrandService

  async resolve(brandName: string, query: string): Promise<ImageResult> {
    const brand = this.brandService.findBrand(brandName)
    if (!brand) {
      return this.fallbackResult(query)
    }

    // Try strategies in priority order
    const applicable = this.strategies
      .filter(s => s.canHandle(brand))
      .sort((a, b) => a.priority - b.priority)

    for (const strategy of applicable) {
      const result = await strategy.resolve(brand, query)

      // Record outcome for health tracking
      this.brandService.recordOutcome(brand.name, strategy.name, result.success)

      if (result.success) {
        return result
      }
    }

    return this.fallbackResult(query)
  }

  private fallbackResult(query: string): ImageResult {
    return {
      success: false,
      fallbackUrl: `https://www.google.com/search?tbm=shop&q=${encodeURIComponent(query)}`
    }
  }
}
```

### Layer 6: Widget State Manager

```typescript
// widgets/state.ts
class WidgetStateManager {
  private cache: Map<string, CachedResult>
  private refreshCounters: Map<string, number>
  private userPrefs: WidgetPreferences

  // Cache management
  getCacheKey(widgetId: string, itemIds: string[]): string {
    const counter = this.refreshCounters.get(widgetId) || 0
    return `${widgetId}:${itemIds.sort().join(',')}:v${counter}`
  }

  getFromCache(key: string): CachedResult | null {
    const cached = this.cache.get(key)
    if (!cached) return null
    if (Date.now() - cached.timestamp > 3600000) {
      this.cache.delete(key)
      return null
    }
    return cached
  }

  // Per-widget refresh
  incrementRefreshCounter(widgetId: string): void {
    const current = this.refreshCounters.get(widgetId) || 0
    this.refreshCounters.set(widgetId, current + 1)
  }

  clearCacheForWidget(widgetId: string): void {
    for (const key of this.cache.keys()) {
      if (key.startsWith(`${widgetId}:`)) {
        this.cache.delete(key)
      }
    }
  }
}
```

---

## Orchestration: How It All Fits Together

```typescript
// widgets/orchestrator.ts
class WidgetOrchestrator {
  constructor(
    private registry: WidgetRegistry,
    private brandService: BrandService,
    private imagePipeline: ImagePipeline,
    private stateManager: WidgetStateManager,
    private aiClient: AIClient
  ) {}

  async generateWidget(widgetId: string, items: BoardItem[]): Promise<WidgetResult> {
    const widget = this.registry.get(widgetId)

    // 1. Check cache
    const cacheKey = this.stateManager.getCacheKey(widgetId, items.map(i => i.id))
    const cached = this.stateManager.getFromCache(cacheKey)
    if (cached) return cached.data

    // 2. Build prompt with constraints
    const ownedCategories = this.detectOwnedCategories(items)
    const healthyBrands = this.brandService.getHealthyBrands()

    const prompt = PromptBuilder.forWidget(widgetId)
      .addBrandConstraint(healthyBrands.map(b => b.name))
      .addOwnedCategoryConstraint(ownedCategories)
      .requireJson(widget.ai.outputSchema)
      .build()

    // 3. Call AI
    const rawResponse = await this.aiClient.generate(prompt, items)

    // 4. Parse & validate
    const parseResult = AIResponseParser.parse(rawResponse, widget.ai.outputSchema)
    if (!parseResult.success) {
      throw new WidgetError('PARSE_FAILED', parseResult.error)
    }

    // 5. Validate & fix brands
    const validated = this.validateBrands(parseResult.data)

    // 6. Enrich with images
    const enriched = await this.enrichWithImages(validated)

    // 7. Cache & return
    this.stateManager.setCache(cacheKey, enriched)
    return enriched
  }

  private validateBrands(data: any): any {
    if (!data.suggestions) return data

    return {
      ...data,
      suggestions: data.suggestions.map((sug: any) => {
        if (this.brandService.isSupportedBrand(sug.brand)) {
          return sug
        }
        // Replace unsupported brand
        const newBrand = this.brandService.getAlternative(sug.brand, sug.category)
        return { ...sug, brand: newBrand }
      })
    }
  }

  private async enrichWithImages(data: any): Promise<any> {
    if (!data.suggestions) return data

    const enriched = await Promise.all(
      data.suggestions.map(async (sug: any) => {
        const imageResult = await this.imagePipeline.resolve(sug.brand, sug.searchQuery)
        return {
          ...sug,
          productImage: imageResult.success ? imageResult.image : null,
          productUrl: imageResult.fallbackUrl || `https://google.com/search?tbm=shop&q=${sug.searchQuery}`
        }
      })
    )

    return { ...data, suggestions: enriched }
  }
}
```

---

## Widget Template: Building New Widgets

With this architecture, creating a new widget becomes declarative:

```typescript
// widgets/definitions/price-tracker.ts
export const PriceTrackerWidget: WidgetDefinition = {
  id: 'price-tracker',
  version: '1.0',
  name: 'Price Watch',

  zone: 'footer',

  criteria: {
    categories: ['wear', 'home', 'tech'],
    minItems: 1
  },

  ai: {
    promptTemplate: `
      Analyze these items and identify which ones might go on sale soon.
      Consider: seasonality, product lifecycle, brand sale patterns.
    `,
    constraints: [],
    outputSchema: {
      type: 'object',
      properties: {
        predictions: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              itemId: { type: 'string' },
              saleChance: { type: 'number' },
              reason: { type: 'string' },
              expectedDiscount: { type: 'string' }
            }
          }
        }
      }
    },
    model: 'haiku'
  },

  enrichment: {
    strategies: [],  // No image enrichment needed
    timeout: 5000,
    fallback: 'skip'
  }
}
```

---

## Migration Path

### Phase 1: Extract Services (Now)
- [ ] Extract `BrandService` from generate-widget function
- [ ] Extract `AIResponseParser` as reusable module
- [ ] Add SERP API as alternative image strategy

### Phase 2: Build Framework (Next)
- [ ] Create `PromptBuilder` class
- [ ] Create `ImagePipeline` with strategy pattern
- [ ] Create `WidgetStateManager` for client

### Phase 3: Refactor Existing (Later)
- [ ] Migrate `complete-the-look` to new architecture
- [ ] Migrate `style-summary` to new architecture
- [ ] Add health monitoring dashboard

### Phase 4: Scale (Future)
- [ ] A/B testing framework
- [ ] Dynamic brand discovery from user boards
- [ ] User-customizable prompts

---

## Key Takeaways

1. **Separate concerns**: AI prompt building, response parsing, brand knowledge, and image resolution should each be independent modules.

2. **Validate on server**: Never trust the AI to follow constraints - always validate and fix on the server side.

3. **Strategy pattern for images**: Scraping is unreliable - need multiple fallback strategies with health tracking.

4. **Per-widget state**: Global state causes bugs - each widget needs isolated state management.

5. **Declarative widget definitions**: New widgets should be configuration, not code.

6. **Health monitoring**: Track what's working and automatically disable failing components.
