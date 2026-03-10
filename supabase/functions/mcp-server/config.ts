// MCP Connector — Product configuration
// Change these values when the product name changes.
// Both the MCP server and OAuth consent page reference this file.

export const VERSION = '0.1.0'

export const PRODUCT_CONFIG = {
  name: 'ctrl.rodeo',
  connector_name: 'ctrl.rodeo',
  description: 'Your curated library — search, discover, and save across everything you collect.',
  server_url: 'https://yfhudwakpgzswiylhfbh.supabase.co/functions/v1/mcp-server',
  oauth_url: 'https://yfhudwakpgzswiylhfbh.supabase.co/functions/v1/mcp-oauth',
  consent_copy: {
    taste_only: 'Share your taste patterns (categories, tags, interests) — no specific links or titles.',
    library: 'Share your library (titles, categories, tags) — no URLs or private notes.',
    full_access: 'Full access to your library including URLs, notes, and images.',
  },
} as const

// Built-in board definitions (semantic meaning for Claude context)
export const BUILTIN_BOARDS: Record<string, string> = {
  home: 'Home, furniture, interior design, decor',
  wear: 'Clothing, fashion, accessories, shoes',
  watch: 'Film, TV, documentaries, video content',
  listen: 'Music, podcasts, audio, playlists',
  use: 'Tools, gadgets, software, products',
  eat: 'Restaurants, recipes, food, drink',
  go: 'Travel, places, neighborhoods, destinations',
  follow: 'People, creators, accounts to follow',
  read: 'Articles, books, essays, long-form writing',
}

// Privacy tier field mapping
export const PRIVACY_TIERS = {
  taste_only: {
    allowed_fields: ['category', 'content_type', 'taste_tags', 'practical_tags', 'entities', 'domain'],
    description: 'Taste patterns only — no titles, URLs, or notes',
  },
  library: {
    allowed_fields: ['title', 'category', 'content_type', 'taste_tags', 'practical_tags', 'entities', 'domain', 'image', 'video', 'music', 'book'],
    description: 'Library metadata — titles, categories, tags, media info',
  },
  full_access: {
    allowed_fields: ['title', 'url', 'description', 'category', 'content_type', 'taste_tags', 'practical_tags', 'entities', 'domain', 'image', 'notes', 'video', 'music', 'book', 'selected_text', 'source_url'],
    description: 'Full access — everything including URLs and notes',
  },
} as const

export type PrivacyTier = keyof typeof PRIVACY_TIERS

// MCP Tool definitions with annotations
export const TOOL_DEFINITIONS = [
  {
    name: 'search_pins',
    description: `Search saved items in the user's ${PRODUCT_CONFIG.name} library by keyword, board, content type, or tags. Returns matching pins with metadata filtered by the user's privacy settings.`,
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Search query (matched against titles, descriptions, tags, entities)' },
        board: { type: 'string', description: 'Filter by board/category slug (e.g., "wear", "listen", "read")' },
        content_type: { type: 'string', description: 'Filter by content type (product, article, book, video, music, repository, social, tool, place, recipe)' },
        tag: { type: 'string', description: 'Filter by a specific taste or practical tag' },
        limit: { type: 'integer', description: 'Max results to return (default: 20, max: 50)', default: 20 },
      },
      required: [],
    },
    annotations: {
      title: 'Search Pins',
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
  },
  {
    name: 'get_board',
    description: `Get all items in a specific board/category from the user's ${PRODUCT_CONFIG.name} library. Boards represent interest areas like Wear, Listen, Read, etc.`,
    inputSchema: {
      type: 'object',
      properties: {
        board: { type: 'string', description: 'Board/category slug (e.g., "wear", "listen", "read", "home", "use", "eat", "go", "follow", "watch", or a custom board slug)' },
        limit: { type: 'integer', description: 'Max results (default: 50, max: 100)', default: 50 },
        offset: { type: 'integer', description: 'Pagination offset', default: 0 },
      },
      required: ['board'],
    },
    annotations: {
      title: 'Get Board',
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
  },
  {
    name: 'get_boards_list',
    description: `List all boards in the user's ${PRODUCT_CONFIG.name} library with item counts and descriptions. Includes both built-in boards (home, wear, watch, listen, use, eat, go, follow, read) and user-created boards.`,
    inputSchema: {
      type: 'object',
      properties: {},
      required: [],
    },
    annotations: {
      title: 'List Boards',
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
  },
  {
    name: 'get_taste_profile',
    description: `Get the user's taste profile — AI-generated clusters with labels, descriptions, cross-board bridges, and motifs. Reveals the user's signature patterns and aesthetic identity across their entire library.`,
    inputSchema: {
      type: 'object',
      properties: {},
      required: [],
    },
    annotations: {
      title: 'Get Taste Profile',
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
  },
  {
    name: 'get_recent_saves',
    description: `Get the most recently saved items from the user's ${PRODUCT_CONFIG.name} library. Useful for understanding what the user is currently interested in.`,
    inputSchema: {
      type: 'object',
      properties: {
        limit: { type: 'integer', description: 'Number of recent saves (default: 20, max: 50)', default: 20 },
        days: { type: 'integer', description: 'Only include saves from the last N days (optional)' },
      },
      required: [],
    },
    annotations: {
      title: 'Recent Saves',
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
  },
  {
    name: 'save_pin',
    description: `Save a URL to the user's ${PRODUCT_CONFIG.name} library. The platform automatically resolves images, categorizes into the right board, extracts entities, and generates taste/practical tags. The pin arrives fully enriched — same quality as a manual save. Idempotent: if the URL already exists, returns the existing pin. Use this proactively when the user expresses a clear choice signal (e.g., "I'll get that", "that's perfect", "add to cart").`,
    inputSchema: {
      type: 'object',
      properties: {
        url: { type: 'string', description: 'URL to save' },
        notes: { type: 'string', description: 'Optional notes (e.g., conversation context: "Recommended during running shoe research")' },
        category: { type: 'string', description: 'Optional board override (e.g., "wear"). If omitted, AI auto-categorizes.' },
        source: { type: 'string', description: 'Capture source identifier (default: "claude_connector", use "claude_auto" for auto-captures on choice signals)', default: 'claude_connector' },
      },
      required: ['url'],
    },
    annotations: {
      title: 'Save Pin',
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
    },
  },
  {
    name: 'get_connector_context',
    description: `Get orientation context for the ${PRODUCT_CONFIG.name} connector — board taxonomy with semantic meanings, available content types, how taste/practical tags work, and tool composition guidance. Call this first to understand how to use the other tools effectively.`,
    inputSchema: {
      type: 'object',
      properties: {},
      required: [],
    },
    annotations: {
      title: 'Connector Context',
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
  },
]
