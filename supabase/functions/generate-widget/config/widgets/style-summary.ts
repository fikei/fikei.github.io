// Widget Definition: Style Summary
// AI-generated analysis of user's style patterns and preferences

import type { WidgetDefinition } from '../schema.ts'

export const styleSummary: WidgetDefinition = {
  // Identity
  id: 'style-summary',
  name: 'Style Summary',
  description: 'AI analyzes saved items to identify style patterns, color preferences, and aesthetic tendencies',
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
        weight: 0.7,
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
    fallbackBehavior: 'suppress'
  },

  // AI Generation settings
  generation: {
    model: 'claude-3-haiku-20240307',
    maxTokens: 512,
    promptTemplate: `Analyze these saved items and identify the user's style patterns.

Consider:
- Color palette preferences
- Brand affinity
- Style categories (streetwear, minimalist, outdoor, etc.)
- Price range tendencies
- Aesthetic themes

Return JSON format:
{
  "styleProfile": {
    "primaryStyle": "Style name",
    "secondaryInfluences": ["Style 1", "Style 2"],
    "colorPalette": ["Color 1", "Color 2", "Color 3"],
    "keyBrands": ["Brand 1", "Brand 2"],
    "priceRange": "budget|mid|premium|luxury",
    "aestheticNotes": "Brief description of their aesthetic"
  },
  "confidence": 0.75
}`,
    constraints: [
      'Be specific about style categorizations',
      'Include actionable insights',
      'Keep descriptions concise'
    ]
  },

  // No enrichment needed for style summary
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
    template: 'hero-card',
    fallbackTemplate: 'text-block',
    cssClass: 'widget-style-summary',
    priority: 5
  },

  // Metadata
  categories: ['wear', 'fashion', 'all'],
  tags: ['analysis', 'insights', 'ai', 'profile'],
  enabled: true,

  // Phase 3 hints
  relevanceSignals: ['hasVariety', 'establishedCollection', 'recentAdditions'],
  noveltyDecay: 0.05 // Show less frequently
}
