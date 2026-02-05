// Widget Definition Schema for Phase 2: Config-Generated Widgets
// This schema allows widgets to be defined as configuration rather than code

// =============================================================================
// ELIGIBILITY CONFIGURATION
// Rules that determine if a widget should render
// =============================================================================

export type EligibilityRuleType =
  | 'min_items'           // Minimum number of items required
  | 'max_items'           // Maximum items (for focused widgets)
  | 'category_match'      // Content matches specific categories
  | 'content_quality'     // Items have sufficient metadata
  | 'variety'             // Items from different sources/domains
  | 'recency'             // Items added within timeframe
  | 'custom'              // Custom rule with expression

export interface EligibilityRuleConfig {
  type: EligibilityRuleType
  weight: number              // 0-1, how much this rule affects overall score
  params: Record<string, any> // Rule-specific parameters
}

// Rule parameter types
export interface MinItemsParams {
  min: number
}

export interface MaxItemsParams {
  max: number
}

export interface CategoryMatchParams {
  categories: string[]        // Categories to match (e.g., ['wear', 'fashion'])
  mode: 'any' | 'all'         // Match any or all categories
  fallbackToContent: boolean  // Check item content if category not set
}

export interface ContentQualityParams {
  minScore: number            // 0-1, minimum average quality score
  weights: {
    title: number             // Weight for having title
    description: number       // Weight for having description
    image: number             // Weight for having image
    url: number               // Weight for having URL
  }
}

export interface VarietyParams {
  minUniqueDomains: number
  scoreAtDomains: number      // Full score at this many domains
}

export interface RecencyParams {
  maxAgeDays: number
  requireAll: boolean         // All items must be recent, or just some
}

export interface CustomRuleParams {
  expression: string          // JavaScript expression to evaluate
  description: string         // Human-readable description
}

// =============================================================================
// CONFIDENCE CONFIGURATION
// =============================================================================

export type FallbackBehavior = 'suppress' | 'degrade' | 'retry'

export interface ConfidenceConfig {
  threshold: number           // 0-1, minimum confidence to render
  fallbackBehavior: FallbackBehavior
  retryConfig?: {
    maxRetries: number
    backoffMs: number
  }
}

// =============================================================================
// GENERATION CONFIGURATION
// =============================================================================

export interface GenerationConfig {
  model: string               // e.g., 'claude-3-haiku-20240307'
  maxTokens: number
  temperature?: number        // 0-1
  promptTemplate: string      // Template with {{variables}}
  outputSchema?: object       // JSON Schema for expected output
  constraints?: string[]      // Additional constraints to add to prompt
}

// =============================================================================
// ENRICHMENT CONFIGURATION
// =============================================================================

export type EnrichmentStrategy = 'shopify' | 'serp' | 'scrape' | 'none'

export interface EnrichmentConfig {
  enabled: boolean
  strategies: EnrichmentStrategy[]  // Priority order
  timeout: number                   // Per-strategy timeout in ms
  fallback: EnrichmentStrategy      // What to use if all fail
  brandsEnabled: boolean            // Whether to validate/fix brands
}

// =============================================================================
// RENDERING CONFIGURATION
// =============================================================================

export type WidgetZone = 'hero' | 'inline' | 'footer' | 'sidebar'

export interface RenderingConfig {
  zone: WidgetZone
  template: string            // Template name to use
  fallbackTemplate?: string   // Simpler template if main fails
  cssClass?: string           // Additional CSS class
  priority: number            // Order within zone (lower = higher priority)
}

// =============================================================================
// COMPLETE WIDGET DEFINITION
// =============================================================================

export interface WidgetDefinition {
  // Identity
  id: string
  name: string
  description: string
  version: string

  // Phase 2: Config-driven behavior
  eligibility: {
    rules: EligibilityRuleConfig[]
    requireAllCritical: boolean   // If true, all weight=1.0 rules must pass
    minOverallScore: number       // 0-1
  }

  confidence: ConfidenceConfig

  generation: GenerationConfig

  enrichment: EnrichmentConfig

  rendering: RenderingConfig

  // Metadata
  categories: string[]            // What categories this widget is for
  tags: string[]                  // For filtering/discovery
  enabled: boolean

  // Phase 3: Self-selection hints (future)
  relevanceSignals?: string[]     // What makes this widget relevant
  noveltyDecay?: number           // How quickly to reduce showing this widget
}

// =============================================================================
// WIDGET REGISTRY
// =============================================================================

export interface WidgetRegistry {
  widgets: Record<string, WidgetDefinition>
  defaults: {
    confidence: ConfidenceConfig
    enrichment: EnrichmentConfig
    generation: Partial<GenerationConfig>
  }
  version: string
  lastUpdated: string
}

// =============================================================================
// RUNTIME TYPES
// =============================================================================

export interface EligibilityContext {
  widgetId: string
  items: Array<{
    id: string
    title: string
    description?: string
    image?: string
    url: string
    addedAt?: string
  }>
  category?: string
  userPrefs?: Record<string, any>
}

export interface EligibilityResult {
  passed: boolean
  reason: string
  score: number
}

export interface EligibilityDecision {
  eligible: boolean
  score: number
  rules: Array<{
    name: string
    type: EligibilityRuleType
    passed: boolean
    reason: string
    score: number
  }>
  timestamp: number
}
