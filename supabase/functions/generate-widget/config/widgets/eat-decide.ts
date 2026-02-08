// Widget Definition: Eat Decide
// Picks a restaurant from the user's saved spots

import type { WidgetDefinition } from '../schema.ts'

export const eatDecide: WidgetDefinition = {
  id: 'eat-decide',
  name: 'Decide',
  description: 'Can\'t pick a restaurant? AI picks one from your saved spots with reasoning.',
  version: '1.0.0',

  eligibility: {
    rules: [
      {
        type: 'min_items',
        weight: 1.0,
        params: { min: 3 }
      },
      {
        type: 'category_match',
        weight: 0.8,
        params: {
          categories: ['eat', 'food', 'restaurant', 'dining'],
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
    promptTemplate: `You are a decisive dining advisor. The user has saved these restaurants/food spots and can't decide where to go.

Pick the BEST option and explain why. Also present 2-3 runner-up choices.

Return JSON:
{
  "question": "Where should you eat tonight?",
  "options": [
    {
      "title": "Restaurant Name",
      "description": "Why this is the top pick — specific reasoning based on the saved items"
    },
    {
      "title": "Runner Up 1",
      "description": "Brief reason this is a good alternative"
    }
  ],
  "confidence": 0.8
}`,
    constraints: [
      'Pick from the user\'s actual saved restaurants only',
      'The top pick should have the strongest reasoning',
      'Keep descriptions under 15 words',
      'Return 2-4 options total'
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
    zone: 'hero',
    template: 'choices',
    fallbackTemplate: 'list',
    cssClass: 'widget-eat-decide',
    priority: 6
  },

  categories: ['eat', 'food', 'restaurant', 'dining'],
  tags: ['dining', 'decision', 'ai', 'pick-one'],
  enabled: true,

  relevanceSignals: ['hasRestaurants', 'multipleOptions', 'recentActivity'],
  noveltyDecay: 0.2
}
