// Widget Definition: Collection Stats
// Key metrics about the user's collection

import type { WidgetDefinition } from '../schema.ts'

export const collectionStats: WidgetDefinition = {
  // Identity
  id: 'collection-stats',
  name: 'Collection Stats',
  description: 'AI computes key metrics about the user\'s saved items — brands, categories, price range, and more',
  version: '1.0.0',

  // Eligibility rules
  eligibility: {
    rules: [
      {
        type: 'min_items',
        weight: 1.0, // Critical
        params: { min: 3 }
      }
    ],
    requireAllCritical: true,
    minOverallScore: 0.5
  },

  // Confidence configuration
  confidence: {
    threshold: 0.4,
    fallbackBehavior: 'suppress'
  },

  // AI Generation settings
  generation: {
    model: 'claude-3-haiku-20240307',
    maxTokens: 512,
    promptTemplate: `Analyze these saved items and extract 3-4 key metrics about the collection.

Pick the most interesting/useful stats from:
- Number of unique brands
- Number of categories covered
- Average price (if prices visible)
- Most common style/color/material
- Date range of items
- Any other standout metric

Return JSON format:
{
  "stats": [
    { "value": "12", "label": "brands" },
    { "value": "3", "label": "styles" },
    { "value": "$85", "label": "avg price" }
  ],
  "confidence": 0.8
}`,
    constraints: [
      'Return exactly 3-4 stats',
      'Values should be short (numbers, short words)',
      'Labels should be 1-2 words',
      'Pick metrics the data actually supports — do not guess'
    ]
  },

  // No enrichment needed
  enrichment: {
    enabled: false,
    strategies: [],
    timeout: 0,
    fallback: 'none',
    brandsEnabled: false
  },

  // Rendering settings
  rendering: {
    zone: 'hero',
    template: 'stat-row',
    fallbackTemplate: 'list',
    cssClass: 'widget-collection-stats',
    priority: 7
  },

  // Metadata
  categories: ['wear', 'tech', 'home', 'eat', 'read', 'watch', 'listen', 'travel', 'fitness', 'make', 'art', 'learn', 'all'],
  tags: ['metrics', 'analytics', 'ai', 'collection'],
  enabled: true,

  // Phase 3 hints
  relevanceSignals: ['establishedCollection', 'hasVariety'],
  noveltyDecay: 0.1
}
