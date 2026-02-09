// Widget Definition: Viewer Profile
// Profiler for watch category — identifies viewing taste

import type { WidgetDefinition } from '../schema.ts'

export const viewerProfile: WidgetDefinition = {
  id: 'viewer-profile',
  name: 'Viewer Profile',
  description: 'Analyzes saved films, shows, and videos to identify viewing taste and preferences',
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
    promptTemplate: `Analyze these saved watch items and identify the user's viewing identity.

Consider:
- Genre preferences and blends
- Mood and tone (dark, uplifting, cerebral, visceral)
- Pacing preferences (slow burn vs fast-paced)
- Era and origin (classic, contemporary, international)
- Director or creator sensibility

Return JSON:
{
  "label": "Viewer identity in 2-3 words",
  "traits": ["2-4 descriptive traits"],
  "summary": "One sentence describing their overall viewing taste",
  "confidence": 0.75
}`,
    constraints: ['Be specific about genre blends', 'Reference mood and tone', 'Keep it concise']
  },

  enrichment: { enabled: false, strategies: [], timeout: 0, fallback: 'none', brandsEnabled: false },

  rendering: { zone: 'hero', template: 'hero-card', fallbackTemplate: 'text-block', cssClass: '', priority: 5 },

  categories: ['watch'],
  tags: ['analysis', 'profile', 'ai'],
  enabled: true,
  relevanceSignals: ['hasVariety', 'establishedCollection'],
  noveltyDecay: 0.05
}
