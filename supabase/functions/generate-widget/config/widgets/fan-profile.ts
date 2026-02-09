// Widget Definition: Fan Profile
// Profiler for follow category — identifies interest/creator identity

import type { WidgetDefinition } from '../schema.ts'

export const fanProfile: WidgetDefinition = {
  id: 'fan-profile',
  name: 'Fan Profile',
  description: 'Analyzes saved creators and accounts to identify interest identity and scene alignment',
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
    promptTemplate: `Analyze these saved creators, accounts, and people the user follows and identify their interest identity.

Consider:
- Content domains (music, art, tech, fashion, food, politics)
- Creator types (independent, institutional, niche, mainstream)
- Community and scene alignment
- Depth vs breadth of interests

Return JSON:
{
  "label": "Interest identity in 2-3 words",
  "traits": ["2-4 descriptive traits"],
  "summary": "One sentence describing the world they follow",
  "confidence": 0.75
}`,
    constraints: ['Be specific about scenes and communities', 'Reference creator archetypes', 'Keep it concise']
  },

  enrichment: { enabled: false, strategies: [], timeout: 0, fallback: 'none', brandsEnabled: false },

  rendering: { zone: 'hero', template: 'hero-card', fallbackTemplate: 'text-block', cssClass: '', priority: 5 },

  categories: ['follow'],
  tags: ['analysis', 'profile', 'ai'],
  enabled: true,
  relevanceSignals: ['hasVariety', 'establishedCollection'],
  noveltyDecay: 0.05
}
