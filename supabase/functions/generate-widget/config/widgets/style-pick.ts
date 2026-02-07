// Widget Definition: Style Pick
// Presents saved items as selectable choices

import type { WidgetDefinition } from '../schema.ts'

export const stylePick: WidgetDefinition = {
  id: 'style-pick',
  name: 'Pick Your Favorite',
  description: 'Shows your saved items as selectable cards — tap the one you\'d buy first.',
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
        weight: 0.7,
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
    promptTemplate: `You are a personal shopper. The user has saved these items. Present 3-4 of their best saved items as choices and ask them to pick their favorite.

For each option, write a brief one-line reason why it stands out.

Return JSON:
{
  "question": "Which would you grab first?",
  "options": [
    { "title": "Item name", "description": "Why this one stands out — 1 sentence" }
  ],
  "confidence": 0.8
}`,
    constraints: [
      'Use the user\'s actual saved item names',
      'Present 3-4 options maximum',
      'Descriptions under 12 words',
      'Question should be engaging and casual'
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
    cssClass: 'widget-style-pick',
    priority: 7
  },

  categories: ['wear', 'clothing', 'fashion', 'all'],
  tags: ['choices', 'preference', 'ai', 'interactive'],
  enabled: true,

  relevanceSignals: ['hasProducts', 'multipleOptions', 'recentActivity'],
  noveltyDecay: 0.2
}
