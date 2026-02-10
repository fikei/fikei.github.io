// Widget Definition: Upcoming Releases
// Forward-looking widget — predicts releases from brands/creators in collection

import type { WidgetDefinition } from '../schema.ts'

export const upcomingReleases: WidgetDefinition = {
  id: 'upcoming-releases',
  name: 'Upcoming Releases',
  description: 'Predicts upcoming releases, drops, and launches from brands and creators in your collection',
  version: '1.0.0',

  eligibility: {
    rules: [
      { type: 'min_items', weight: 1.0, params: { min: 2 } },
      { type: 'variety', weight: 0.8, params: { minUniqueDomains: 1, scoreAtDomains: 3 } }
    ],
    requireAllCritical: true,
    minOverallScore: 0.5
  },

  confidence: { threshold: 0.4, fallbackBehavior: 'suppress' },

  generation: {
    model: 'claude-3-haiku-20240307',
    maxTokens: 768,
    promptTemplate: `Based on the user's saved items, identify brands, creators, studios, or publishers represented in their collection.

For each, predict or note upcoming releases, drops, new products, or launches that the user would care about.

RULES:
- Focus on brands/creators that appear in the saved items
- Be specific about WHAT is coming (product names, seasons, release windows)
- If you don't know exact dates, give a general timeframe (e.g., "Spring 2026", "Q2 2026")
- Include 3-5 items, ranked by relevance to the user's collection
- Only include things that are plausibly upcoming — don't fabricate releases

Return JSON:
{
  "items": [
    {
      "brand": "Brand or creator name",
      "release": "What's coming",
      "when": "Timeframe",
      "relevance": "Why this matters for their collection"
    }
  ],
  "confidence": 0.7
}`,
    constraints: [
      'Only reference brands actually present in saved items',
      'Be honest about uncertainty — use "Expected" or "Rumored" prefixes',
      'Prioritize by relevance to the user collection'
    ]
  },

  enrichment: { enabled: false, strategies: [], timeout: 0, fallback: 'none', brandsEnabled: false },

  rendering: { zone: 'inline', template: 'list', fallbackTemplate: 'text-block', cssClass: '', priority: 8 },

  categories: ['all'],
  tags: ['forward-looking', 'releases', 'ai'],
  enabled: true,
  relevanceSignals: ['hasVariety', 'establishedCollection', 'recentAdditions'],
  noveltyDecay: 0.1
}
