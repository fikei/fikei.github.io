// Widget Registry for Phase 2: Config-Generated Widgets
// Loads widget definitions from config files and provides runtime access

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

// =============================================================================
// WIDGET REGISTRY
// =============================================================================

const registry: WidgetRegistry = {
  widgets: {
    'complete-the-look': completeTheLook,
    'style-summary': styleSummary,
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
export type { WidgetDefinition, WidgetRegistry }
