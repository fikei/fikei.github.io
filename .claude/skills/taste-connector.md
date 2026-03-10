# Taste Connector Skill

This skill enables Claude Code to interact with the user's curated library via the MCP Connector. The connector surfaces taste intelligence — curated links with AI-generated categories, tags, entities, and computed taste profiles.

## When to Trigger

Activate when the user mentions:
- Their library, saved links, bookmarks, pins, or boards
- Taste, preferences, aesthetic patterns
- Recommendations grounded in "what I like" or "what I've saved"
- Saving or capturing a URL to their library
- Board names: home, wear, watch, listen, use, eat, go, follow, read
- Questions like "what have I collected about X?" or "what are my taste patterns?"

## Available MCP Tools

### Read Tools

**`search_pins`** — Search saved items by keyword, board, content type, or tags.
- Args: `query`, `board`, `content_type`, `tag`, `limit`
- Use for: finding specific saves, filtering by topic

**`get_board`** — Get all items in a specific board/category.
- Args: `board` (required), `limit`, `offset`
- Built-in boards: home, wear, watch, listen, use, eat, go, follow, read

**`get_boards_list`** — List all boards with item counts.
- No args. Returns board slugs, counts, descriptions.

**`get_taste_profile`** — Get cross-board taste aggregation.
- Returns: top taste_tags (aesthetic), practical_tags (functional), entities (brands/people/places), content type distribution
- This is the richest tool for understanding the user's taste

**`get_recent_saves`** — Recent items.
- Args: `limit`, `days`

**`get_connector_context`** — Orientation context with board taxonomy and composition guidance.
- Call first if unsure how to use other tools

### Write Tools

**`save_pin`** — Save a URL to the library with full enrichment.
- Args: `url` (required), `notes`, `category`, `source`
- The platform auto-resolves images, categorizes, extracts entities, generates tags
- Idempotent: returns existing pin if URL already saved
- Set `source: "claude_auto"` for auto-captures on choice signals

## Composition Patterns

### Recommendations
1. `get_taste_profile` → understand cross-board taste patterns
2. `search_pins` or `get_board` → see what they've already saved in the category
3. Recommend based on actual taste signals, not generic suggestions

### Research
1. `search_pins(query=...)` → find what they've collected
2. Build on their existing collection, don't re-search the web for things they already have

### Self-Discovery
1. `get_taste_profile` + `get_boards_list` → full picture
2. Synthesize patterns, surface cross-board connections

### Auto-Capture
When the user expresses a clear choice signal ("I'll get that", "that's the one", "perfect, ordering that"), proactively:
1. `save_pin(url, source="claude_auto", notes="<conversation context>")`
2. This keeps the library growing passively

## Privacy
The user controls what's shared via privacy tiers (Taste Only / Library / Full Access) and per-board/field toggles. All filtering happens server-side — you'll only see data the user has chosen to share. Never ask for data that returns empty due to privacy settings.

## Tag System
- **taste_tags**: Subjective aesthetic/vibe (minimalist, brutalist, artisanal, lo_fi)
- **practical_tags**: Objective functional (waterproof, noise_cancelling, hardcover)
- **entities**: Named things (brands, people, places, products, concepts)
