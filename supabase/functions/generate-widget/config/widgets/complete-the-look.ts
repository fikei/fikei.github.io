// Widget Definition: Complete the Look
// AI-powered outfit completion suggestions based on saved items

import type { WidgetDefinition } from '../schema.ts'

export const completeTheLook: WidgetDefinition = {
  // Identity
  id: 'complete-the-look',
  name: 'Complete the Look',
  description: 'AI suggests complementary items to complete an outfit based on saved fashion items',
  version: '2.0.0',

  // Eligibility rules (moved from hard-coded)
  eligibility: {
    rules: [
      {
        type: 'min_items',
        weight: 1.0, // Critical - must pass
        params: { min: 2 }
      },
      {
        type: 'category_match',
        weight: 0.8,
        params: {
          categories: ['wear', 'clothing', 'fashion'],
          mode: 'any',
          fallbackToContent: true
        }
      },
      {
        type: 'content_quality',
        weight: 0.6,
        params: {
          minScore: 0.5,
          weights: {
            title: 0.4,
            description: 0.3,
            image: 0.2,
            url: 0.1
          }
        }
      }
    ],
    requireAllCritical: true,
    minOverallScore: 0.5
  },

  // Confidence configuration
  confidence: {
    threshold: 0.6,
    fallbackBehavior: 'degrade'
  },

  // AI Generation settings
  generation: {
    model: 'claude-3-haiku-20240307',
    maxTokens: 1024,
    promptTemplate: `You are a fashion stylist AI. Analyze these items from a user's collection and suggest 3-4 complementary products that would complete their look.

For each suggestion, provide:
- name: Product name (be specific, e.g., "Classic Leather Belt" not just "Belt")
- brand: MUST be from the supported brands list
- category: footwear, outerwear, accessories, etc.
- reason: Why this complements their style (1 sentence)
- searchQuery: Search terms to find this product

SUPPORTED BRANDS (only suggest from these):
{{brandList}}

BRAND CATEGORIES (only suggest products each brand actually makes):
{{brandCategories}}

Return JSON format:
{
  "suggestions": [
    {
      "name": "Product Name",
      "brand": "Brand Name",
      "category": "category",
      "reason": "Why this works",
      "searchQuery": "brand product name"
    }
  ],
  "confidence": 0.85,
  "styleNotes": "Brief style analysis"
}`,
    constraints: [
      'Only suggest products from supported brands',
      'Only suggest product types that brand actually makes',
      'Provide diverse suggestions across categories',
      'Consider price point consistency'
    ]
  },

  // Enrichment (image fetching) settings
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
    template: 'grid-split',
    fallbackTemplate: 'list',
    cssClass: 'widget-complete-look',
    priority: 10
  },

  // Metadata
  categories: ['wear', 'fashion', 'clothing'],
  tags: ['shopping', 'recommendations', 'ai', 'outfit'],
  enabled: true,

  // Phase 3 hints
  relevanceSignals: ['hasClothingItems', 'recentActivity', 'mixedBrands'],
  noveltyDecay: 0.1
}
