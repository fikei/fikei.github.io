// Widget Registry for Phase 2: Config-Generated Widgets
// Loads widget definitions from config files and provides runtime access
// Phase 2 additions: hot-reload, category-agnostic matching, template selection

import type {
  WidgetDefinition,
  WidgetRegistry,
  EligibilityRuleConfig,
  EligibilityContext,
  EligibilityResult,
  EligibilityDecision,
  ConfidenceConfig,
  MinItemsParams,
  CategoryMatchParams,
  ContentQualityParams,
  VarietyParams,
} from './schema.ts'

// Import widget definitions
import { completeTheLook } from './widgets/complete-the-look.ts'
import { styleSummary } from './widgets/style-summary.ts'
import { priceRadar } from './widgets/price-radar.ts'
import { collectionStats } from './widgets/collection-stats.ts'
import { gapFiller } from './widgets/gap-filler.ts'
import { eatDecide } from './widgets/eat-decide.ts'
import { useCompare } from './widgets/use-compare.ts'
import { discoverMore } from './widgets/discover-more.ts'
import { stylePick } from './widgets/style-pick.ts'
import { outfitChecklist } from './widgets/outfit-checklist.ts'
import { boardOverview } from './widgets/board-overview.ts'

// =============================================================================
// WIDGET REGISTRY
// Hot-reload: register() / unregister() allow dynamic widget management
// =============================================================================

const registry: WidgetRegistry = {
  widgets: {
    'complete-the-look': completeTheLook,
    'style-summary': styleSummary,
    'price-radar': priceRadar,
    'collection-stats': collectionStats,
    'gap-filler': gapFiller,
    'eat-decide': eatDecide,
    'use-compare': useCompare,
    'discover-more': discoverMore,
    'style-pick': stylePick,
    'outfit-checklist': outfitChecklist,
    'board-overview': boardOverview,
  },

  defaults: {
    confidence: {
      threshold: 0.4,
      fallbackBehavior: 'suppress'
    },
    enrichment: {
      enabled: false,
      strategies: [],
      timeout: 5000,
      fallback: 'none',
      brandsEnabled: false
    },
    generation: {
      model: 'claude-3-haiku-20240307',
      maxTokens: 1024
    }
  },

  version: '2.0.0',
  lastUpdated: new Date().toISOString()
}

// =============================================================================
// HOT-RELOAD: Dynamic widget registration
// Adding a new widget = register(widgetDef), no code changes to this file
// =============================================================================

export function registerWidget(widget: WidgetDefinition): void {
  registry.widgets[widget.id] = widget
  registry.lastUpdated = new Date().toISOString()
  console.log(`[registry] Registered widget: ${widget.id} v${widget.version}`)
}

export function unregisterWidget(widgetId: string): boolean {
  if (registry.widgets[widgetId]) {
    delete registry.widgets[widgetId]
    registry.lastUpdated = new Date().toISOString()
    console.log(`[registry] Unregistered widget: ${widgetId}`)
    return true
  }
  return false
}

export function reloadWidget(widget: WidgetDefinition): void {
  const existing = registry.widgets[widget.id]
  if (existing) {
    console.log(`[registry] Reloading widget: ${widget.id} (v${existing.version} -> v${widget.version})`)
  }
  registerWidget(widget)
}

// =============================================================================
// REGISTRY ACCESS FUNCTIONS
// =============================================================================

export function getWidget(widgetId: string): WidgetDefinition | null {
  return registry.widgets[widgetId] || null
}

export function getAllWidgets(): WidgetDefinition[] {
  return Object.values(registry.widgets)
}

export function getEnabledWidgets(): WidgetDefinition[] {
  return Object.values(registry.widgets).filter(w => w.enabled)
}

export function getWidgetsForCategory(category: string): WidgetDefinition[] {
  return getEnabledWidgets().filter(w =>
    w.categories.includes(category) || w.categories.includes('all')
  )
}

export function getConfidenceConfig(widgetId: string): ConfidenceConfig {
  const widget = getWidget(widgetId)
  return widget?.confidence || registry.defaults.confidence
}

// =============================================================================
// CATEGORY-AGNOSTIC MATCHING
// Discovers eligible widgets for any category+items combination
// No hard-coded category logic — driven entirely by widget config
// =============================================================================

export interface DiscoveryResult {
  widgetId: string
  widget: WidgetDefinition
  eligibility: EligibilityDecision
}

/**
 * Discover all eligible widgets for a given category and items context.
 * This replaces hard-coded per-widget-id lookups: the system now asks
 * "which widgets should appear?" rather than "should this specific widget appear?"
 */
export function discoverWidgets(
  category: string,
  items: EligibilityContext['items'],
  userPrefs?: Record<string, any>
): DiscoveryResult[] {
  const candidates = getWidgetsForCategory(category)

  console.log(`[registry] Discovering widgets for category="${category}" with ${items.length} items, ${candidates.length} candidates`)

  const results: DiscoveryResult[] = []

  for (const widget of candidates) {
    const context: EligibilityContext = {
      widgetId: widget.id,
      items,
      category,
      userPrefs
    }

    const eligibility = checkEligibility(widget.id, context)

    if (eligibility.eligible) {
      results.push({ widgetId: widget.id, widget, eligibility })
      console.log(`[registry] ✓ ${widget.id} eligible (score: ${eligibility.score.toFixed(2)})`)
    } else {
      console.log(`[registry] ✗ ${widget.id} not eligible (score: ${eligibility.score.toFixed(2)})`)
    }
  }

  // Sort by rendering priority (lower = higher priority)
  results.sort((a, b) => a.widget.rendering.priority - b.widget.rendering.priority)

  return results
}

/**
 * Returns a summary of all registered widgets and their categories.
 * Useful for the frontend to know what's available without calling AI.
 */
export function getRegistrySummary(): Array<{
  id: string
  name: string
  version: string
  categories: string[]
  zone: string
  template: string
  enabled: boolean
}> {
  return getAllWidgets().map(w => ({
    id: w.id,
    name: w.name,
    version: w.version,
    categories: w.categories,
    zone: w.rendering.zone,
    template: w.rendering.template,
    enabled: w.enabled
  }))
}

// =============================================================================
// ELIGIBILITY RULE EVALUATORS
// Config-driven rule evaluation
// =============================================================================

type RuleEvaluator = (context: EligibilityContext, params: any) => EligibilityResult

const ruleEvaluators: Record<string, RuleEvaluator> = {
  min_items: (context, params: MinItemsParams): EligibilityResult => {
    const { min } = params
    const passed = context.items.length >= min
    return {
      passed,
      reason: passed
        ? `Has ${context.items.length} items (≥${min})`
        : `Only ${context.items.length} items (need ≥${min})`,
      score: passed ? 1 : context.items.length / min
    }
  },

  max_items: (context, params: { max: number }): EligibilityResult => {
    const { max } = params
    const passed = context.items.length <= max
    return {
      passed,
      reason: passed
        ? `Has ${context.items.length} items (≤${max})`
        : `Too many items: ${context.items.length} (max ${max})`,
      score: passed ? 1 : max / context.items.length
    }
  },

  category_match: (context, params: CategoryMatchParams): EligibilityResult => {
    const { categories, mode, fallbackToContent } = params

    // Check direct category match
    const categoryMatch = context.category && categories.some(c =>
      context.category!.toLowerCase().includes(c.toLowerCase())
    )

    // Fallback: check if items look like they match
    let contentMatch = false
    if (fallbackToContent && !categoryMatch) {
      const patterns = categories.map(c => new RegExp(c, 'i'))
      contentMatch = context.items.some(item => {
        const text = `${item.title} ${item.url} ${item.description || ''}`
        return patterns.some(p => p.test(text))
      })
    }

    const passed = categoryMatch || contentMatch
    return {
      passed,
      reason: passed
        ? 'Content matches target categories'
        : 'Content does not match target categories',
      score: categoryMatch ? 1 : (contentMatch ? 0.7 : 0)
    }
  },

  content_quality: (context, params: ContentQualityParams): EligibilityResult => {
    const { minScore, weights } = params

    const qualityScores = context.items.map(item => {
      let score = 0
      if (item.title && item.title.length > 5) score += weights.title
      if (item.description && item.description.length > 10) score += weights.description
      if (item.image) score += weights.image
      if (item.url) score += weights.url
      return score
    })

    const avgQuality = qualityScores.reduce((a, b) => a + b, 0) / qualityScores.length
    const passed = avgQuality >= minScore

    return {
      passed,
      reason: `Average content quality: ${(avgQuality * 100).toFixed(0)}%`,
      score: avgQuality
    }
  },

  variety: (context, params: VarietyParams): EligibilityResult => {
    const { minUniqueDomains, scoreAtDomains } = params

    const domains = new Set(
      context.items
        .map(i => {
          try { return new URL(i.url).hostname }
          catch { return null }
        })
        .filter(Boolean)
    )

    const varietyScore = Math.min(domains.size / scoreAtDomains, 1)
    const passed = domains.size >= minUniqueDomains

    return {
      passed,
      reason: `${domains.size} unique sources`,
      score: varietyScore
    }
  },

  recency: (context, params: { maxAgeDays: number, requireAll: boolean }): EligibilityResult => {
    const { maxAgeDays, requireAll } = params
    const cutoff = Date.now() - (maxAgeDays * 24 * 60 * 60 * 1000)

    const recentItems = context.items.filter(item => {
      if (!item.addedAt) return true // Assume recent if no date
      return new Date(item.addedAt).getTime() >= cutoff
    })

    const recentRatio = recentItems.length / context.items.length
    const passed = requireAll ? recentRatio === 1 : recentRatio > 0

    return {
      passed,
      reason: `${recentItems.length}/${context.items.length} items added within ${maxAgeDays} days`,
      score: recentRatio
    }
  },

  custom: (context, params: { expression: string, description: string }): EligibilityResult => {
    // For safety, custom rules are not evaluated dynamically in production
    // They would need to be pre-compiled or use a safe evaluator
    console.warn('[registry] Custom rule evaluation not implemented:', params.description)
    return {
      passed: true,
      reason: 'Custom rule (not evaluated)',
      score: 0.5
    }
  }
}

// =============================================================================
// ELIGIBILITY ENGINE (Config-Driven)
// =============================================================================

export function checkEligibility(
  widgetId: string,
  context: EligibilityContext
): EligibilityDecision {
  const widget = getWidget(widgetId)

  if (!widget) {
    console.warn(`[registry] Widget not found: ${widgetId}`)
    return {
      eligible: false,
      score: 0,
      rules: [{ name: 'widget_exists', type: 'custom', passed: false, reason: 'Widget not found', score: 0 }],
      timestamp: Date.now()
    }
  }

  const { rules, requireAllCritical, minOverallScore } = widget.eligibility
  const results: EligibilityDecision['rules'] = []
  let totalWeight = 0
  let weightedScore = 0

  for (const rule of rules) {
    const evaluator = ruleEvaluators[rule.type]

    if (!evaluator) {
      console.warn(`[registry] Unknown rule type: ${rule.type}`)
      continue
    }

    const result = evaluator(context, rule.params)
    results.push({
      name: rule.type,
      type: rule.type,
      passed: result.passed,
      reason: result.reason,
      score: result.score
    })

    totalWeight += rule.weight
    weightedScore += result.score * rule.weight
  }

  const overallScore = totalWeight > 0 ? weightedScore / totalWeight : 0

  // Check critical rules (weight = 1.0)
  const criticalRulesFailed = requireAllCritical && results.some(r => {
    const ruleConfig = rules.find(rule => rule.type === r.type)
    return ruleConfig?.weight === 1.0 && !r.passed
  })

  return {
    eligible: !criticalRulesFailed && overallScore >= minOverallScore,
    score: overallScore,
    rules: results,
    timestamp: Date.now()
  }
}

// =============================================================================
// PROMPT BUILDER (Config-Driven)
// =============================================================================

export function buildPrompt(
  widgetId: string,
  context: EligibilityContext,
  templateVars: Record<string, string>
): string | null {
  const widget = getWidget(widgetId)

  if (!widget) {
    return null
  }

  let prompt = widget.generation.promptTemplate

  // Replace template variables
  for (const [key, value] of Object.entries(templateVars)) {
    prompt = prompt.replace(new RegExp(`{{${key}}}`, 'g'), value)
  }

  // Add constraints
  if (widget.generation.constraints && widget.generation.constraints.length > 0) {
    prompt += '\n\nADDITIONAL CONSTRAINTS:\n'
    prompt += widget.generation.constraints.map(c => `- ${c}`).join('\n')
  }

  // Add items context
  const itemsContext = context.items.map((item, i) =>
    `${i + 1}. ID: ${item.id}
   Title: ${item.title}
   ${item.description ? `Description: ${item.description}` : ''}
   URL: ${item.url}`
  ).join('\n\n')

  prompt += `\n\nHere are the items to analyze:\n\n${itemsContext}`

  // Add confidence instruction
  prompt += `\n\nIMPORTANT: Include a "confidence" field (0.0 to 1.0) in your response.`

  prompt += '\n\nRespond with valid JSON only, no markdown or explanation.'

  return prompt
}

// =============================================================================
// REGISTRY EXPORT
// =============================================================================

export { registry }
export type { WidgetDefinition, WidgetRegistry, DiscoveryResult }
