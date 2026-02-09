// Widget Definition: Design DNA
// Profiler for home category — identifies interior design aesthetic

import type { WidgetDefinition } from '../schema.ts'

export const designDna: WidgetDefinition = {
  id: 'design-dna',
  name: 'Design DNA',
  description: 'Analyzes saved home items to identify interior design aesthetic and material preferences',
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
    promptTemplate: `Analyze these saved home items and identify the user's interior design aesthetic.

Consider:
- Color temperature and palette (warm vs cool, neutral vs bold)
- Material preferences (wood, metal, fabric, ceramic, glass)
- Design era or movement (mid-century, Scandinavian, industrial, Japandi)
- Spatial style (minimal, maximalist, eclectic, curated)

Return JSON:
{
  "label": "Design identity in 2-3 words",
  "traits": ["2-4 descriptive traits"],
  "summary": "One sentence describing their overall home aesthetic",
  "confidence": 0.75
}`,
    constraints: ['Be specific about design movements', 'Reference actual materials visible in items', 'Keep it concise']
  },

  enrichment: { enabled: false, strategies: [], timeout: 0, fallback: 'none', brandsEnabled: false },

  rendering: { zone: 'hero', template: 'hero-card', fallbackTemplate: 'text-block', cssClass: '', priority: 5 },

  categories: ['home'],
  tags: ['analysis', 'profile', 'ai'],
  enabled: true,
  relevanceSignals: ['hasVariety', 'establishedCollection'],
  noveltyDecay: 0.05
}
