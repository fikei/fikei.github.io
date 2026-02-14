// Widget Definition: Events For You
// Recommends upcoming events based on patterns in saved Boards content.
// Uses a dedicated edge function (recommend-events) rather than generate-widget.

import type { WidgetDefinition } from '../schema.ts'

export const eventsForYou: WidgetDefinition = {
  id: 'events-for-you',
  name: 'Events For You',
  description: 'Upcoming events matching your saved interests — music, film, comedy, and more.',
  version: '1.0.0',

  eligibility: {
    rules: [
      {
        type: 'min_items',
        weight: 1.0,
        params: { min: 3 }
      },
      {
        type: 'content_quality',
        weight: 0.4,
        params: {
          minScore: 0.2,
          weights: { title: 0.6, description: 0.2, image: 0.1, url: 0.1 }
        }
      }
    ],
    requireAllCritical: true,
    minOverallScore: 0.3
  },

  confidence: {
    threshold: 0.3,
    fallbackBehavior: 'suppress'
  },

  generation: {
    model: 'claude-3-haiku-20240307',
    maxTokens: 512,
    // Not used — this widget calls recommend-events directly
    promptTemplate: ''
  },

  enrichment: {
    enabled: false,
    strategies: [],
    timeout: 0,
    fallback: 'none',
    brandsEnabled: false
  },

  rendering: {
    zone: 'footer',
    template: 'event-card-list',
    fallbackTemplate: 'list',
    cssClass: 'widget-events-for-you',
    priority: 5
  },

  categories: ['all', 'listen', 'watch', 'go'],
  tags: ['events', 'recommendations', 'local', 'cross-product'],
  enabled: true,

  relevanceSignals: ['hasMusicContent', 'hasEventInterest', 'hasArtistData'],
  noveltyDecay: 0.1
}
