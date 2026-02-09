// Widget Definition: Flavor Profile
// Profiler for eat category — identifies culinary identity

import type { WidgetDefinition } from '../schema.ts'

export const flavorProfile: WidgetDefinition = {
  id: 'flavor-profile',
  name: 'Flavor Profile',
  description: 'Analyzes saved food, recipe, and restaurant items to identify culinary identity',
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
    promptTemplate: `Analyze these saved food, recipe, and restaurant items and identify the user's culinary identity.

Consider:
- Cuisine regions and traditions
- Flavor preferences (spicy, umami, sweet, herbaceous)
- Cooking complexity (quick meals, elaborate projects, restaurant-level)
- Dietary patterns and ingredient preferences

Return JSON:
{
  "label": "Culinary identity in 2-3 words",
  "traits": ["2-4 descriptive traits"],
  "summary": "One sentence describing their overall food taste",
  "confidence": 0.75
}`,
    constraints: ['Be specific about cuisine traditions', 'Reference flavor profiles', 'Keep it concise']
  },

  enrichment: { enabled: false, strategies: [], timeout: 0, fallback: 'none', brandsEnabled: false },

  rendering: { zone: 'hero', template: 'hero-card', fallbackTemplate: 'text-block', cssClass: '', priority: 5 },

  categories: ['eat', 'food', 'restaurant', 'dining'],
  tags: ['analysis', 'profile', 'ai'],
  enabled: true,
  relevanceSignals: ['hasVariety', 'establishedCollection'],
  noveltyDecay: 0.05
}
