// Widget Definition: Traveler Type
// Profiler for go category — identifies travel identity

import type { WidgetDefinition } from '../schema.ts'

export const travelerType: WidgetDefinition = {
  id: 'traveler-type',
  name: 'Traveler Type',
  description: 'Analyzes saved destinations and travel items to identify travel identity',
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
    promptTemplate: `Analyze these saved destinations, experiences, and travel items and identify the user's travel identity.

Consider:
- Destination types (urban, nature, coastal, cultural)
- Travel pace (slow travel, adventure, city-hopping)
- Experience style (luxury, budget, off-the-beaten-path)
- Cultural engagement level (tourist, explorer, immersive)

Return JSON:
{
  "label": "Travel identity in 2-3 words",
  "traits": ["2-4 descriptive traits"],
  "summary": "One sentence describing their overall travel style",
  "confidence": 0.75
}`,
    constraints: ['Be specific about travel philosophy', 'Reference destination patterns', 'Keep it concise']
  },

  enrichment: { enabled: false, strategies: [], timeout: 0, fallback: 'none', brandsEnabled: false },

  rendering: { zone: 'hero', template: 'hero-card', fallbackTemplate: 'text-block', cssClass: '', priority: 5 },

  categories: ['go', 'travel'],
  tags: ['analysis', 'profile', 'ai'],
  enabled: true,
  relevanceSignals: ['hasVariety', 'establishedCollection'],
  noveltyDecay: 0.05
}
