// Widget Definition: Setup Profile
// Profiler for use category — identifies tech/tool philosophy

import type { WidgetDefinition } from '../schema.ts'

export const setupProfile: WidgetDefinition = {
  id: 'setup-profile',
  name: 'Setup Profile',
  description: 'Analyzes saved tools, gadgets, and tech to identify setup philosophy and workflow style',
  version: '1.0.0',

  eligibility: {
    rules: [
      { type: 'min_items', weight: 1.0, params: { min: 3 } },
      { type: 'variety', weight: 0.7, params: { minUniqueDomains: 2, scoreAtDomains: 3 } }
    ],
    requireAllCritical: true,
    minOverallScore: 0.5
  },

  confidence: { threshold: 0.5, fallbackBehavior: 'suppress' },

  generation: {
    model: 'claude-3-haiku-20240307',
    maxTokens: 512,
    promptTemplate: `Analyze these saved tools, gadgets, and tech items and identify the user's setup identity.

Consider:
- Tool philosophy (power user, minimalist, all-in-one, best-of-breed)
- Ecosystem preference (Apple, open-source, cross-platform)
- Complexity level (simple, prosumer, professional)
- Workflow style (creative, productivity, development, hybrid)

Return JSON:
{
  "label": "Setup identity in 2-3 words",
  "traits": ["2-4 descriptive traits"],
  "summary": "One sentence describing their overall tech philosophy",
  "confidence": 0.75
}`,
    constraints: ['Be specific about ecosystem alignment', 'Reference actual tools', 'Keep it concise']
  },

  enrichment: { enabled: false, strategies: [], timeout: 0, fallback: 'none', brandsEnabled: false },

  rendering: { zone: 'hero', template: 'hero-card', fallbackTemplate: 'text-block', cssClass: '', priority: 5 },

  categories: ['use', 'tech'],
  tags: ['analysis', 'profile', 'ai'],
  enabled: true,
  relevanceSignals: ['hasVariety', 'establishedCollection'],
  noveltyDecay: 0.05
}
