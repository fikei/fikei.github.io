// Widget Definition: Board Overview
// Groups saved items by theme or type

import type { WidgetDefinition } from '../schema.ts'

export const boardOverview: WidgetDefinition = {
  id: 'board-overview',
  name: 'Board at a Glance',
  description: 'Groups your saved items by theme or type so you can see the shape of your collection.',
  version: '1.0.0',

  eligibility: {
    rules: [
      {
        type: 'min_items',
        weight: 1.0,
        params: { min: 2 }
      },
      {
        type: 'variety',
        weight: 0.6,
        params: {
          minUniqueDomains: 1,
          scoreAtDomains: 3
        }
      },
      {
        type: 'content_quality',
        weight: 0.3,
        params: {
          minScore: 0.2,
          weights: { title: 0.6, description: 0.1, image: 0.1, url: 0.2 }
        }
      }
    ],
    requireAllCritical: true,
    minOverallScore: 0.4
  },

  confidence: {
    threshold: 0.5,
    fallbackBehavior: 'suppress'
  },

  generation: {
    model: 'claude-3-haiku-20240307',
    maxTokens: 768,
    promptTemplate: `You are a collection analyst. Group the user's saved items into 2-4 meaningful themes or categories.

RULES:
- Don't just group by website — group by PURPOSE or TYPE
- Each group needs a clear, descriptive title
- Include the actual item names from the user's saves
- 2-4 groups, each with 2-5 items

Return JSON:
{
  "sections": [
    {
      "title": "Everyday Essentials",
      "items": [
        { "name": "Item name", "brand": "Brand" }
      ]
    }
  ],
  "confidence": 0.8
}`,
    constraints: [
      'Use the user\'s actual saved item names',
      'Group by purpose/theme, not by website',
      'Create 2-4 meaningful groups',
      'Each group should have 2-5 items'
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
    zone: 'footer',
    template: 'grouped',
    fallbackTemplate: 'list',
    cssClass: 'widget-board-overview',
    priority: 11
  },

  categories: ['all'],
  tags: ['overview', 'grouping', 'ai', 'analysis'],
  enabled: true,

  relevanceSignals: ['hasVariety', 'establishedCollection'],
  noveltyDecay: 0.1
}
