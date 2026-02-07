// Widget Definition: Price Radar
// Dimensional positioning across price, style, and brand axes

import type { WidgetDefinition } from '../schema.ts'

export const priceRadar: WidgetDefinition = {
  // Identity
  id: 'price-radar',
  name: 'Price Radar',
  description: 'AI analyzes saved items to show where you fall on key dimensions like budget, style, and brand affinity',
  version: '1.0.0',

  // Eligibility rules
  eligibility: {
    rules: [
      {
        type: 'min_items',
        weight: 1.0, // Critical
        params: { min: 3 }
      },
      {
        type: 'variety',
        weight: 0.6,
        params: {
          minUniqueDomains: 2,
          scoreAtDomains: 3
        }
      }
    ],
    requireAllCritical: true,
    minOverallScore: 0.5
  },

  // Confidence configuration
  confidence: {
    threshold: 0.5,
    fallbackBehavior: 'degrade'
  },

  // AI Generation settings
  generation: {
    model: 'claude-3-haiku-20240307',
    maxTokens: 512,
    promptTemplate: `Analyze these saved items and position the user on 2-3 meaningful dimensions.

Choose axes that are relevant to the content (examples):
- Price: Budget <-> Luxury
- Style: Minimal <-> Bold
- Vibe: Classic <-> Trendy
- Palette: Neutral <-> Colorful

For each axis, estimate where the user falls (0.0 = fully left, 1.0 = fully right).

Return JSON format:
{
  "axes": [
    {
      "leftLabel": "Budget",
      "rightLabel": "Luxury",
      "position": 0.35,
      "note": "You: $85 avg"
    },
    {
      "leftLabel": "Minimal",
      "rightLabel": "Bold",
      "position": 0.2,
      "note": "Mostly neutrals"
    }
  ],
  "confidence": 0.75
}`,
    constraints: [
      'Choose 2-3 axes most relevant to the items',
      'Position values must be between 0 and 1',
      'Notes should be short and specific',
      'Avoid generic axes — pick dimensions the data actually supports'
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
    template: 'spectrum',
    fallbackTemplate: 'text-block',
    cssClass: 'widget-price-radar',
    priority: 8
  },

  // Metadata
  categories: ['wear', 'tech', 'home', 'all'],
  tags: ['analysis', 'dimensions', 'ai', 'positioning'],
  enabled: true,

  // Phase 3 hints
  relevanceSignals: ['hasVariety', 'establishedCollection'],
  noveltyDecay: 0.08
}
