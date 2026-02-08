// Widget Definition: Discover More
// Recommends new items based on patterns in saved items

import type { WidgetDefinition } from '../schema.ts'

export const discoverMore: WidgetDefinition = {
  id: 'discover-more',
  name: 'More Like Your Board',
  description: 'Analyzes your saved items and recommends something new you might like.',
  version: '1.0.0',

  eligibility: {
    rules: [
      {
        type: 'min_items',
        weight: 1.0,
        params: { min: 3 }
      },
      {
        type: 'variety',
        weight: 0.6,
        params: {
          minUniqueDomains: 2,
          scoreAtDomains: 4
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
    minOverallScore: 0.4
  },

  confidence: {
    threshold: 0.5,
    fallbackBehavior: 'suppress'
  },

  generation: {
    model: 'claude-3-haiku-20240307',
    maxTokens: 512,
    promptTemplate: `You are a discovery engine. Analyze the user's saved items and recommend ONE specific new thing they'd like.

RULES:
- The recommendation must be DIFFERENT from what they already have
- It should complement their existing collection, not duplicate it
- Be specific: real product names, real brands
- Explain WHY this fits based on patterns you see in their saves

Return JSON:
{
  "suggestion": {
    "name": "Specific Product or Thing",
    "brand": "Brand if applicable",
    "price": "$XX if applicable",
    "reason": "Based on your saves, you clearly like X and Y — this combines both.",
    "searchQuery": "search terms to find this item"
  },
  "confidence": 0.7
}`,
    constraints: [
      'Recommend exactly ONE item',
      'Must be a real, findable product or service',
      'Reason should reference specific patterns from saved items',
      'Keep reason under 25 words'
    ]
  },

  enrichment: {
    enabled: true,
    strategies: ['shopify', 'serp', 'scrape'],
    timeout: 5000,
    fallback: 'none',
    brandsEnabled: true
  },

  rendering: {
    zone: 'footer',
    template: 'quick-add',
    fallbackTemplate: 'list',
    cssClass: 'widget-discover-more',
    priority: 12
  },

  categories: ['all'],
  tags: ['discovery', 'recommendations', 'ai', 'cross-category'],
  enabled: true,

  relevanceSignals: ['hasVariety', 'establishedCollection', 'recentAdditions'],
  noveltyDecay: 0.2
}
