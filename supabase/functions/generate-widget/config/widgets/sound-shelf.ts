// Widget Definition: Sound Shelf
// Visual album art grid for music links — like flipping through a record collection

import type { WidgetDefinition } from '../schema.ts'

export const soundShelf: WidgetDefinition = {
  id: 'sound-shelf',
  name: 'Sound Shelf',
  description: 'Displays your saved music as a visual album art grid — browse your collection like a record shelf.',
  version: '1.0.0',

  eligibility: {
    rules: [
      {
        type: 'min_items',
        weight: 1.0,
        params: { min: 4 }
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
        weight: 0.5,
        params: {
          minScore: 0.3,
          weights: { title: 0.3, description: 0.1, image: 0.5, url: 0.1 }
        }
      }
    ],
    requireAllCritical: true,
    minOverallScore: 0.5
  },

  confidence: {
    threshold: 0.5,
    fallbackBehavior: 'degrade'
  },

  generation: {
    model: 'claude-3-haiku-20240307',
    maxTokens: 512,
    promptTemplate: `You are a music curator. Analyze these saved music links and organize them into a visual shelf.

Group the items by feel/vibe (not rigid genres). Create 1-2 shelf labels that capture the mood.

Return JSON:
{
  "shelfLabel": "A short, evocative name for this collection (e.g., 'Late Night Electronics', 'Sunday Morning Soul')",
  "items": [
    {
      "id": "item-id",
      "artist": "Artist Name",
      "title": "Track or Album Name",
      "position": 1
    }
  ],
  "vibe": "One sentence capturing the overall mood of this collection",
  "confidence": 0.8
}`,
    constraints: [
      'Use only the user\'s actual saved items — never invent new ones',
      'Order items by visual/thematic flow, not alphabetically',
      'Shelf label should be evocative, not generic (avoid "My Music")',
      'Include all items that have images — skip items without art',
      'Keep vibe description under 15 words'
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
    template: 'grouped',
    fallbackTemplate: 'list',
    cssClass: 'widget-sound-shelf',
    priority: 5
  },

  categories: ['listen', 'music', 'audio'],
  tags: ['music', 'visual', 'collection', 'browse', 'album-art'],
  enabled: true,

  relevanceSignals: ['hasMusicItems', 'hasImages', 'multipleArtists'],
  noveltyDecay: 0.05
}
