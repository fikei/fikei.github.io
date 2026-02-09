// Widget Definition: Reader Identity
// Profiler for read category — identifies intellectual identity

import type { WidgetDefinition } from '../schema.ts'

export const readerIdentity: WidgetDefinition = {
  id: 'reader-identity',
  name: 'Reader Identity',
  description: 'Analyzes saved articles, books, and reading material to identify intellectual identity',
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
    promptTemplate: `Analyze these saved articles, books, and reading material and identify the user's reader identity.

Consider:
- Subject domains (technology, philosophy, business, science, culture)
- Thinking style (analytical, creative, strategic, narrative)
- Format preferences (long-form, quick reads, academic, journalistic)
- Perspective and worldview tendencies

Return JSON:
{
  "label": "Reader identity in 2-3 words",
  "traits": ["2-4 descriptive traits"],
  "summary": "One sentence describing their intellectual taste",
  "confidence": 0.75
}`,
    constraints: ['Be specific about intellectual traditions', 'Reference thinking styles', 'Keep it concise']
  },

  enrichment: { enabled: false, strategies: [], timeout: 0, fallback: 'none', brandsEnabled: false },

  rendering: { zone: 'hero', template: 'hero-card', fallbackTemplate: 'text-block', cssClass: '', priority: 5 },

  categories: ['read'],
  tags: ['analysis', 'profile', 'ai'],
  enabled: true,
  relevanceSignals: ['hasVariety', 'establishedCollection'],
  noveltyDecay: 0.05
}
