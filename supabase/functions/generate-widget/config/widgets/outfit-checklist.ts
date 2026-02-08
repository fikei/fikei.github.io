// Widget Definition: Outfit Checklist
// Builds a complete outfit as a checklist from saved items

import type { WidgetDefinition } from '../schema.ts'

export const outfitChecklist: WidgetDefinition = {
  id: 'outfit-checklist',
  name: 'Outfit Checklist',
  description: 'Builds a complete outfit from your saves — check off what you already own.',
  version: '1.0.0',

  eligibility: {
    rules: [
      {
        type: 'min_items',
        weight: 1.0,
        params: { min: 2 }
      },
      {
        type: 'category_match',
        weight: 0.8,
        params: {
          categories: ['wear', 'clothing', 'fashion', 'all'],
          mode: 'any',
          fallbackToContent: true
        }
      },
      {
        type: 'content_quality',
        weight: 0.4,
        params: {
          minScore: 0.3,
          weights: { title: 0.5, description: 0.2, image: 0.2, url: 0.1 }
        }
      }
    ],
    requireAllCritical: true,
    minOverallScore: 0.5
  },

  confidence: {
    threshold: 0.6,
    fallbackBehavior: 'suppress'
  },

  generation: {
    model: 'claude-3-haiku-20240307',
    maxTokens: 512,
    promptTemplate: `You are a wardrobe stylist. From the user's saved items, build a complete outfit as a checklist.

Include 4-6 items covering different categories (top, bottom, shoes, accessories). Use items from their saves where possible, and suggest missing pieces.

For each item, indicate if the user already has it (checked) based on whether it appears in their saved items.

Return JSON:
{
  "items": [
    { "name": "White Oxford Shirt", "price": "$65", "checked": true },
    { "name": "Dark Wash Jeans", "price": "$90", "checked": true },
    { "name": "White Sneakers", "price": "$130", "checked": false }
  ],
  "total": "$285",
  "confidence": 0.75
}`,
    constraints: [
      'Use actual saved item names for checked items',
      'Include 4-6 items total',
      'Mark items from saves as checked: true',
      'Total should sum all prices'
    ]
  },

  enrichment: {
    enabled: false,
    strategies: [],
    timeout: 3000,
    fallback: 'none',
    brandsEnabled: false
  },

  rendering: {
    zone: 'inline',
    template: 'checklist',
    fallbackTemplate: 'list',
    cssClass: 'widget-outfit-checklist',
    priority: 10
  },

  categories: ['wear', 'clothing', 'fashion', 'all'],
  tags: ['checklist', 'outfit', 'ai', 'interactive', 'shopping'],
  enabled: true,

  relevanceSignals: ['hasClothingItems', 'mixedBrands', 'recentActivity'],
  noveltyDecay: 0.15
}
