# Multi-LLM Connector Brief: OpenAI & Google Gemini

**Status:** Approved
**Date:** 2026-03-11
**Author:** Claude (autonomous session)

---

## Context

ctrl.rodeo ships a working MCP connector for Claude (Claude.ai + Claude Code). It exposes 7 tools over JSON-RPC with OAuth 2.1 + PKCE auth, three privacy tiers, and an auto-enrichment pipeline on save. The connector lets Claude search a user's library, read boards/taste profiles, and save new pins — all scoped by user-controlled privacy settings.

**Goal:** Extend the same library access to OpenAI (ChatGPT / GPT API) and Google Gemini so users can interact with their ctrl.rodeo collection from any major AI platform.

---

## Current Architecture (Claude MCP)

| Layer | Implementation |
|-------|---------------|
| **Protocol** | MCP 2025-03-26 (JSON-RPC over HTTP POST) |
| **Auth** | OAuth 2.1 + PKCE, dynamic client registration (RFC 7591), RFC 8414 discovery |
| **Server** | Supabase Edge Function (`mcp-server/index.ts`) |
| **OAuth server** | Supabase Edge Function (`mcp-oauth/index.ts`) |
| **Consent** | `connect/index.html` — Supabase Auth + privacy tier selector |
| **Privacy** | 3 tiers: `taste_only`, `library`, `full_access` — enforced server-side via `filterPin()` |
| **Storage** | `links` table (pins), `connector_settings` (privacy), `mcp_tokens` (auth), `connector_usage` (analytics) |

### Tools (identical across all connectors)

| Tool | Purpose |
|------|---------|
| `search_pins` | Full-text + filter search |
| `get_board` | Paginated board contents |
| `get_boards_list` | All boards with counts |
| `get_taste_profile` | Aggregated taste/tag analysis |
| `get_recent_saves` | Most recent pins |
| `save_pin` | Save URL (triggers enrichment) |
| `get_connector_context` | Board taxonomy + composition guidance |

---

## Platform Requirements

### OpenAI — GPT Actions (ChatGPT) / Function Calling (API)

| Requirement | Detail |
|-------------|--------|
| **Interface** | OpenAPI 3.1 spec describing endpoints as REST. ChatGPT calls them as "Actions" in custom GPTs; API users call them via function calling. |
| **Auth** | OAuth 2.0 (authorization code flow). ChatGPT supports OAuth with custom auth URL + token URL. PKCE not required by OpenAI but compatible. |
| **Discovery** | `ai-plugin.json` manifest at domain root (for ChatGPT plugin/GPT store). Points to OpenAPI spec + auth config. |
| **Payload** | Standard HTTP JSON request/response. No JSON-RPC envelope. |
| **Limits** | 45-second timeout per action call. 100KB response max recommended. |

### Google Gemini — Extensions / Function Calling

| Requirement | Detail |
|-------------|--------|
| **Interface** | OpenAPI 3.0 spec. Gemini Extensions use the same spec format as function declarations. |
| **Auth** | OAuth 2.0 authorization code flow. Google supports custom OAuth servers for extensions. |
| **Discovery** | Extension manifest registered in Google AI Studio / Vertex AI. |
| **Payload** | Standard HTTP JSON. |
| **Limits** | Similar timeout constraints. Function calling schemas must be JSON Schema compatible. |

---

## Proposed Architecture

### Key Insight: Shared Backend, Thin Protocol Adapters

The core logic (auth, privacy filtering, pin queries, enrichment pipeline) is already platform-agnostic. The only Claude-specific pieces are:

1. **MCP JSON-RPC envelope** — wraps tool calls in `{"jsonrpc": "2.0", "method": "tools/call", ...}`
2. **MCP session management** — `Mcp-Session-Id` header, `initialize` handshake
3. **Hardcoded Claude redirect URIs** in the OAuth server

**Strategy:** Add a REST adapter layer that maps OpenAPI endpoints to the same internal tool handlers, reuse the OAuth server with platform-specific redirect URIs.

```
┌─────────────┐   ┌─────────────┐   ┌─────────────┐
│  Claude MCP  │   │ OpenAI REST  │   │ Gemini REST  │
│  (JSON-RPC)  │   │ (OpenAPI)    │   │ (OpenAPI)    │
└──────┬───────┘   └──────┬───────┘   └──────┬───────┘
       │                  │                   │
       └──────────┬───────┴───────────────────┘
                  │
          ┌───────▼────────┐
          │  Shared Core   │
          │  (tool handlers │
          │   + privacy +   │
          │   enrichment)   │
          └───────┬────────┘
                  │
          ┌───────▼────────┐
          │   Supabase DB   │
          └────────────────┘
```

### Implementation Plan

#### Phase 1: Extract Shared Core (refactor, no new features)

- Extract tool handler logic from `mcp-server/index.ts` into a shared module (`_shared/connector-core.ts`)
- Functions: `handleSearchPins()`, `handleGetBoard()`, `handleSavePin()`, etc.
- Move `filterPin()`, `resolveUser()`, privacy logic into shared module
- MCP server imports from shared module — zero behavior change

#### Phase 2: REST API Endpoint

- New Supabase Edge Function: `connector-api/index.ts`
- Routes map 1:1 to tools:

| Method | Path | Maps to |
|--------|------|---------|
| GET | `/v1/pins/search` | `search_pins` |
| GET | `/v1/boards` | `get_boards_list` |
| GET | `/v1/boards/:slug` | `get_board` |
| GET | `/v1/taste-profile` | `get_taste_profile` |
| GET | `/v1/pins/recent` | `get_recent_saves` |
| POST | `/v1/pins` | `save_pin` |
| GET | `/v1/context` | `get_connector_context` |

- Same Bearer token auth (reuse `mcp_tokens` table and `resolveUser()`)
- Same privacy enforcement, same usage logging
- Returns plain JSON (no JSON-RPC wrapper)

#### Phase 3: OpenAI Integration

1. **OpenAPI spec** — generate `openapi.yaml` describing the REST endpoints from Phase 2
2. **OAuth redirect URIs** — add ChatGPT's callback URLs to `mcp-oauth` allowed redirects:
   - `https://chat.openai.com/aip/g/oauth/callback` (GPT Actions)
   - Any OpenAI-provided callback URLs
3. **GPT Action manifest** — `ai-plugin.json` pointing to OpenAPI spec + OAuth config
4. **Consent page** — add OpenAI branding/context to `connect/index.html` (detect via referrer or `state` param)
5. **Custom GPT config** — create a ctrl.rodeo GPT with the actions wired up, including system prompt with composition guidance from `get_connector_context`

#### Phase 4: Google Gemini Integration (Fast-Follow)

Ships after OpenAI is live and validated. The REST API from Phase 2 does the heavy lifting — this phase is wiring only.

1. **OpenAPI spec** — reuse the same spec from Phase 3 (Gemini uses OpenAPI 3.0)
2. **OAuth redirect URIs** — add Google's extension callback URLs
3. **Gemini Extension manifest** — register in Google AI Studio
4. **Consent page** — add Gemini branding variant
5. **Function declarations** — export tool schemas in Gemini's function calling format for API users

---

## Auth Flow (Unified)

All three platforms use the same OAuth 2.1 server with platform-aware redirect URIs:

```
User clicks "Connect ctrl.rodeo" in ChatGPT/Gemini/Claude
  → Platform redirects to mcp-oauth/authorize with platform-specific redirect_uri
  → Server validates redirect_uri against allowlist
  → Redirects to connect/index.html (consent page)
  → User authenticates via Supabase Auth
  → User selects privacy tier
  → Consent page POSTs to mcp-oauth/code
  → Server issues auth code, redirects back to platform
  → Platform exchanges code for access token (PKCE verified)
  → Platform stores token, uses for subsequent API calls
```

The `connector_tokens` table (renamed from `mcp_tokens` in Phase 1) gains a `platform` column (`claude`, `openai`, `gemini`) for analytics — the token itself works identically across platforms.

---

## Privacy Model (Unchanged)

The three-tier system applies equally to all platforms:

| Tier | What AI sees |
|------|-------------|
| **Taste Only** | Categories, content types, taste/practical tags, entities, domains |
| **Library** | + titles, images, media metadata |
| **Full Access** | + URLs, descriptions, notes |

**Decision:** Single global privacy tier at launch. Per-platform controls deferred until user feedback demands it.

---

## Connector Context & Composition Guidance

Each platform receives the same `get_connector_context` payload, which includes:
- Board taxonomy with semantic descriptions
- Content type vocabulary
- Tag system explanation (taste vs. practical)
- Tool composition guidance (what to call first for recommendations, research, self-discovery, saving)
- Auto-capture signals for proactive saving

This ensures consistent AI behavior across Claude, ChatGPT, and Gemini — all three understand how to use the library effectively.

---

## Effort Estimate

| Phase | Scope | Size |
|-------|-------|------|
| 1. Extract shared core | Refactor `mcp-server` internals | Small (1 PR) |
| 2. REST API | New edge function + routing | Medium (1 PR) |
| 3. OpenAI integration | OpenAPI spec + OAuth config + GPT Action | Medium (1-2 PRs) |
| 4. Gemini integration | Reuse spec + Gemini extension registration | Small (1 PR) |

Phase 4 (Gemini) is a fast-follow after Phase 3 (OpenAI) ships and validates.

---

## Decisions (Locked)

| # | Decision | Resolution |
|---|----------|------------|
| 1 | **Platform priority** | OpenAI first. Gemini fast-follow after OpenAI ships and validates. |
| 2 | **Distribution** | Private/unlisted launch. Go public on GPT Store after retention data validates the connector experience. |
| 3 | **Per-platform privacy** | Single global tier at launch. Add per-platform controls when user feedback demands it. |
| 4 | **Rate limiting** | Ship with basic per-token throttle (60 req/min). Don't over-engineer. |
| 5 | **Infrastructure naming** | Rename `mcp_*` → `connector_*` during Phase 1 refactor — cheapest moment to clean up. |

### Format Requirement

All future decision points and open questions in this project must use **1:3:1 format**:
- **1** headline question
- **3** context bullets (pro / con / nuance)
- **1** recommendation

---

## Success Metrics

- Users can search, browse, and save to their ctrl.rodeo library from ChatGPT and Gemini
- Same privacy controls, same enrichment pipeline, same taste profile across all platforms
- Single OAuth consent flow with platform-aware branding
- Zero divergence in tool behavior between platforms

---

*Next steps:*
1. Phase 1: Extract shared core from `mcp-server/index.ts`, rename `mcp_*` → `connector_*`
2. Phase 2: Build REST API endpoint (`connector-api/index.ts`)
3. Phase 3: Wire OpenAI — OpenAPI spec, OAuth redirect URIs, private GPT
4. Phase 4 (fast-follow): Wire Gemini after OpenAI validates
