// Widget Definition: Listen Next
// Prioritized listening queue — cuts through the backlog

import type { WidgetDefinition } from '../schema.ts'

export const listenNext: WidgetDefinition = {
  id: 'listen-next',
  name: 'Listen Next',
  description: 'AI picks 3 tracks/albums/podcasts from your saves to listen to now — varied by format and artist.',
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
          categories: ['listen', 'music', 'audio'],
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
      },
      {
        type: 'recency',
        weight: 0.3,
        params: { maxAgeDays: 30, requireAll: false }
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
    promptTemplate: `You are a music recommender. The user has a backlog of saved music links. Pick the 3 best items to listen to RIGHT NOW.

Prioritize:
1. Variety — don't stack the same artist or format
2. Recency — recently saved items may be top-of-mind
3. Mix formats — if they have tracks, albums, and podcasts, pick one of each

For each pick, explain in one sentence why NOW is the right time to listen.

Return JSON:
{
  "queue": [
    {
      "id": "item-id",
      "title": "Track/Album/Podcast Name",
      "artist": "Artist Name",
      "reason": "Why listen now — one sentence",
      "estimatedMinutes": 4
    }
  ],
  "sessionLabel": "A short label for this listening session (e.g., 'Focus Flow', 'Commute Companion')",
  "confidence": 0.8
}`,
    constraints: [
      'Pick exactly 3 items from the user\'s saved links',
      'Never suggest the same artist twice',
      'Vary the format if possible (track vs album vs podcast)',
      'estimatedMinutes: tracks ~4, albums ~40, podcasts ~45, mixes ~60',
      'sessionLabel should be 2-3 words, evocative not generic',
      'reason should be personal and specific, not generic praise'
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
    template: 'list',
    fallbackTemplate: 'list',
    cssClass: 'widget-listen-next',
    priority: 8
  },

  categories: ['listen', 'music', 'audio'],
  tags: ['music', 'queue', 'recommendation', 'ai', 'priority'],
  enabled: true,

  relevanceSignals: ['hasMusicItems', 'recentActivity', 'multipleFormats'],
  noveltyDecay: 0.15
}
