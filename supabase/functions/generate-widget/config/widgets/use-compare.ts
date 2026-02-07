// Widget Definition: Use Compare
// Compares a saved tool/product against its top competitor

import type { WidgetDefinition } from '../schema.ts'

export const useCompare: WidgetDefinition = {
  id: 'use-compare',
  name: 'Compare',
  description: 'Compares a saved tool/product against its top competitor with pros and cons.',
  version: '1.0.0',

  eligibility: {
    rules: [
      {
        type: 'min_items',
        weight: 1.0,
        params: { min: 1 }
      },
      {
        type: 'category_match',
        weight: 0.8,
        params: {
          categories: ['use', 'tech', 'home', 'tools', 'software'],
          mode: 'any',
          fallbackToContent: true
        }
      },
      {
        type: 'content_quality',
        weight: 0.5,
        params: {
          minScore: 0.4,
          weights: { title: 0.5, description: 0.2, image: 0.1, url: 0.2 }
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
    maxTokens: 768,
    promptTemplate: `You are a product comparison expert. Pick the most interesting item from the user's saved items and compare it against its top competitor.

RULES:
- Pick an item that has a clear, well-known competitor
- List 2-3 specific pros and cons for each
- Be objective and fair to both options
- Include price if you can reasonably estimate it

Return JSON:
{
  "optionA": {
    "title": "Saved Item Name",
    "price": "$XX",
    "pros": ["Specific advantage 1", "Specific advantage 2"],
    "cons": ["Specific weakness"]
  },
  "optionB": {
    "title": "Top Competitor",
    "price": "$XX",
    "pros": ["Specific advantage 1", "Specific advantage 2"],
    "cons": ["Specific weakness"]
  },
  "dividerLabel": "VS",
  "confidence": 0.75
}`,
    constraints: [
      'Option A must be from the user\'s saved items',
      'Option B must be a real, well-known competitor',
      'List 2-3 pros and 1-2 cons for each',
      'Keep pros/cons under 8 words each'
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
    template: 'comparison',
    fallbackTemplate: 'list',
    cssClass: 'widget-use-compare',
    priority: 8
  },

  categories: ['use', 'tech', 'home', 'tools', 'software'],
  tags: ['comparison', 'decision', 'ai', 'versus'],
  enabled: true,

  relevanceSignals: ['hasProducts', 'knownBrands', 'recentActivity'],
  noveltyDecay: 0.1
}
