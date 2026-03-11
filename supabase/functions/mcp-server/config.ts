// MCP Connector — Product configuration
// Change these values when the product name changes.
// Both the MCP server and OAuth consent page reference this file.

export const VERSION = '0.3.0'

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

  // --- Pin Management Tools ---
  {
    name: 'get_pin',
    description: `Get full details for a single pin by ID. Use after updates to confirm state, or when you need complete metadata for a specific item.`,
    inputSchema: {
      type: 'object',
      properties: {
        pin_id: { type: 'string', description: 'The pin ID (from search_pins, get_board, or get_recent_saves)' },
      },
      required: ['pin_id'],
    },
    annotations: {
      title: 'Get Pin',
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
  },
  {
    name: 'update_pin',
    description: `Edit one or more fields on an existing pin. Use to fix titles, move between boards, add notes, mark as watched/read, change content type, or update tags. Only include fields you want to change — omitted fields are left unchanged.`,
    inputSchema: {
      type: 'object',
      properties: {
        pin_id: { type: 'string', description: 'The pin ID to update' },
        title: { type: 'string', description: 'New title' },
        description: { type: 'string', description: 'New description/summary' },
        notes: { type: 'string', description: 'Personal notes (replaces existing)' },
        category: { type: 'string', description: 'Board to move the pin to (e.g., "wear", "listen", or a custom slug)' },
        content_type: {
          type: 'string', description: 'Content type override',
          enum: ['product', 'article', 'book', 'video', 'music', 'repository', 'social', 'document', 'tool', 'place', 'recipe', 'event', 'newsletter', 'dataset'],
        },
        watched: { type: 'boolean', description: 'Mark as watched (video content)' },
        read: { type: 'boolean', description: 'Mark as read (articles/books)' },
        tags: { type: 'array', items: { type: 'string' }, description: 'Replace user tags array (not AI-managed taste_tags/practical_tags)' },
      },
      required: ['pin_id'],
    },
    annotations: {
      title: 'Update Pin',
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
  },
  {
    name: 'delete_pin',
    description: `Permanently delete a pin from the library. This is irreversible. Always confirm with the user before calling with confirm: true.`,
    inputSchema: {
      type: 'object',
      properties: {
        pin_id: { type: 'string', description: 'The pin ID to permanently delete' },
        confirm: { type: 'boolean', description: 'Must be true to confirm deletion. Always ask the user first.' },
      },
      required: ['pin_id', 'confirm'],
    },
    annotations: {
      title: 'Delete Pin',
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: false,
      openWorldHint: false,
    },
  },

  // --- Board Management Tools ---
  {
    name: 'create_board',
    description: `Create a new user-defined board. Provide a display name and an optional AI routing prompt that tells the categorizer what belongs here (e.g., "Running shoes, workout clothes, fitness gear").`,
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Display name (e.g., "Running Gear", "SF Restaurants"). Auto-slugified.' },
        prompt: { type: 'string', description: 'Optional AI routing prompt — describes what goes here so the categorizer routes future pins correctly' },
        pinned: { type: 'boolean', description: 'Pin this board to the top of the list', default: false },
      },
      required: ['name'],
    },
    annotations: {
      title: 'Create Board',
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false,
    },
  },
  {
    name: 'update_board',
    description: `Edit a board's metadata — rename, update AI routing prompt, or toggle pinned state. Built-in boards (home, wear, watch, etc.) can only have their prompt and pinned state changed, not their name.`,
    inputSchema: {
      type: 'object',
      properties: {
        board: { type: 'string', description: 'Board slug to update' },
        display_name: { type: 'string', description: 'New display name (user boards only)' },
        prompt: { type: 'string', description: 'New AI routing prompt' },
        pinned: { type: 'boolean', description: 'Pin/unpin this board' },
      },
      required: ['board'],
    },
    annotations: {
      title: 'Update Board',
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
  },
  {
    name: 'delete_board',
    description: `Delete a user-created board and reassign its pins. Built-in boards cannot be deleted. Always confirm with the user before calling with confirm: true.`,
    inputSchema: {
      type: 'object',
      properties: {
        board: { type: 'string', description: 'Slug of the board to delete (must be user-created)' },
        reassign_to: { type: 'string', description: 'Board to move pins to (default: "uncategorized")' },
        confirm: { type: 'boolean', description: 'Must be true. Always ask the user first.' },
      },
      required: ['board', 'confirm'],
    },
    annotations: {
      title: 'Delete Board',
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: false,
      openWorldHint: false,
    },
  },

  // --- Enrichment Tools ---
  {
    name: 're_enrich_pin',
    description: `Re-run the AI enrichment pipeline on an existing pin. Refreshes tags, entities, classification, and optionally the image. Use when a pin has missing tags, no image, or outdated metadata. Returns immediately — enrichment completes within ~30 seconds.`,
    inputSchema: {
      type: 'object',
      properties: {
        pin_id: { type: 'string', description: 'The pin ID to re-enrich' },
        force_image: { type: 'boolean', description: 'Force image re-resolution even if pin has one (default: false)', default: false },
      },
      required: ['pin_id'],
    },
    annotations: {
      title: 'Re-enrich Pin',
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false,
    },
  },
  {
    name: 'batch_re_enrich',
    description: `Trigger re-enrichment for multiple pins. Filter by board, missing tags, or missing image. Provide pin_ids for specific pins, board for a whole board, or neither for the entire library. Returns immediately — enrichment runs async.`,
    inputSchema: {
      type: 'object',
      properties: {
        pin_ids: { type: 'array', items: { type: 'string' }, description: 'Specific pin IDs to re-enrich (max 50)' },
        board: { type: 'string', description: 'Re-enrich all pins in this board' },
        missing_tags: { type: 'boolean', description: 'Only re-enrich pins with no taste_tags or practical_tags' },
        missing_image: { type: 'boolean', description: 'Only re-enrich pins with no image' },
        limit: { type: 'integer', description: 'Max pins to process (default: 20, max: 50)', default: 20 },
      },
      required: [],
    },
    annotations: {
      title: 'Batch Re-enrich',
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false,
    },
  },

  // --- Batch Operations ---
  {
    name: 'batch_move_pins',
    description: `Move multiple pins to a different board. Provide pin_ids for specific pins, board for all pins in a source board, or neither for the entire library. Always requires a to_board target.`,
    inputSchema: {
      type: 'object',
      properties: {
        pin_ids: { type: 'array', items: { type: 'string' }, description: 'Pin IDs to move (max 100)' },
        board: { type: 'string', description: 'Move all pins from this source board' },
        to_board: { type: 'string', description: 'Target board slug to move pins to' },
        limit: { type: 'integer', description: 'Max pins to move (default: 100, max: 500)', default: 100 },
      },
      required: ['to_board'],
    },
    annotations: {
      title: 'Batch Move Pins',
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
  },
  {
    name: 'batch_tag_pins',
    description: `Add or remove tags from multiple pins. Operates on the user-editable tags column (not AI-managed taste_tags/practical_tags). Provide pin_ids, board, or neither (all library).`,
    inputSchema: {
      type: 'object',
      properties: {
        pin_ids: { type: 'array', items: { type: 'string' }, description: 'Pin IDs to tag (max 100)' },
        board: { type: 'string', description: 'Tag all pins in this board' },
        add_tags: { type: 'array', items: { type: 'string' }, description: 'Tags to add' },
        remove_tags: { type: 'array', items: { type: 'string' }, description: 'Tags to remove' },
        limit: { type: 'integer', description: 'Max pins to update (default: 100, max: 500)', default: 100 },
      },
      required: [],
    },
    annotations: {
      title: 'Batch Tag Pins',
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
  },
  {
    name: 'batch_update_pins',
    description: `Set a single field to the same value across multiple pins. Use for bulk status changes like "mark all as watched", "change content type", or "clear notes". Provide pin_ids, board, or neither (all library).`,
    inputSchema: {
      type: 'object',
      properties: {
        pin_ids: { type: 'array', items: { type: 'string' }, description: 'Pin IDs to update (max 100)' },
        board: { type: 'string', description: 'Update all pins in this board' },
        field: {
          type: 'string', description: 'Field to update',
          enum: ['watched', 'read', 'notes', 'content_type', 'category'],
        },
        value: { description: 'New value (boolean for watched/read, string for others, null to clear)' },
        limit: { type: 'integer', description: 'Max pins to update (default: 100, max: 500)', default: 100 },
      },
      required: ['field', 'value'],
    },
    annotations: {
      title: 'Batch Update Pins',
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
  },
]
