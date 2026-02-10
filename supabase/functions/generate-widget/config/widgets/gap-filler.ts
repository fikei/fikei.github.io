// Widget Definition: Gap Filler
// Single high-confidence suggestion to fill a gap in the user's collection

import type { WidgetDefinition } from '../schema.ts'

export const gapFiller: WidgetDefinition = {
  // Identity
  id: 'gap-filler',
  name: 'You Might Want This',
  description: 'AI identifies the single most impactful gap in the user\'s collection and suggests one item to fill it',
  version: '1.0.0',

  // Eligibility rules
  eligibility: {
    rules: [
      {
        type: 'min_items',
        weight: 1.0, // Critical
        params: { min: 2 }
      },
      {
        type: 'category_match',
        weight: 0.7,
        params: {
          categories: ['wear'],
          mode: 'any',
          fallbackToContent: true
        }
      }
    ],
    requireAllCritical: true,
    minOverallScore: 0.5
  },

  // Confidence configuration
  confidence: {
    threshold: 0.6,
    fallbackBehavior: 'suppress'
  },

  // AI Generation settings
  generation: {
    model: 'claude-3-haiku-20240307',
    maxTokens: 512,
    promptTemplate: `Analyze these saved items and identify the single biggest gap in the user's collection.

Suggest ONE specific product that would fill that gap. Be precise — name a real product from a real brand.

Return JSON format:
{
  "suggestion": {
    "name": "Product Name",
    "brand": "Brand Name",
    "price": "$XX.XX",
    "reason": "Fills your [category] gap — you have X and Y but no Z.",
    "searchQuery": "brand product name"
  },
  "confidence": 0.85
}`,
    constraints: [
      'Suggest exactly ONE item — the highest-impact gap filler',
      'Name a specific, real product',
      'The reason should reference what the user already has',
      'Keep reason under 20 words'
    ]
  },

  // Enrichment for product images
  enrichment: {
    enabled: true,
    strategies: ['shopify', 'serp', 'scrape'],
    timeout: 5000,
    fallback: 'none',
    brandsEnabled: true
  },

  // Rendering settings
  rendering: {
    zone: 'inline',
    template: 'quick-add',
    fallbackTemplate: 'list',
    cssClass: 'widget-gap-filler',
    priority: 9
  },

  // Metadata
  categories: ['wear'],
  tags: ['shopping', 'recommendations', 'ai', 'action', 'gap-analysis'],
  enabled: true,

  // Phase 3 hints
  relevanceSignals: ['hasGaps', 'recentActivity', 'establishedCollection'],
  noveltyDecay: 0.15 // Show less frequently as gaps fill
}
