# Decision Log (ADRs)

> Architecture Decision Records for ctrl.rodeo

---

## Format

Each decision follows this format:
- **Status**: Proposed | Accepted | Deprecated | Superseded
- **Context**: What is the issue?
- **Decision**: What did we decide?
- **Consequences**: What are the trade-offs?

---

## Decisions

### ADR-001: Use Vanilla JavaScript (No Frameworks)

**Date**: 2026-01-XX
**Status**: Accepted

**Context**: Need to decide on frontend technology stack. Options include React, Vue, Svelte, or vanilla JS.

**Decision**: Use vanilla JavaScript with no frontend framework.

**Consequences**:
- (+) Smaller bundle sizes
- (+) No build step required for simple changes
- (+) Full control over DOM
- (-) More manual state management
- (-) No component ecosystem

---

### ADR-002: Supabase as Backend

**Date**: 2026-01-XX
**Status**: Accepted

**Context**: Need backend services for authentication, database, and serverless functions.

**Decision**: Use Supabase for all backend services.

**Consequences**:
- (+) Integrated auth, database, functions
- (+) Generous free tier
- (+) Real-time subscriptions
- (-) Vendor lock-in
- (-) Limited function runtime (Deno)

---

### ADR-003: Claude as Primary AI

**Date**: 2026-01-XX
**Status**: Accepted

**Context**: Multiple AI providers available (OpenAI, Anthropic, Google). Need to choose primary.

**Decision**: Use Claude 3 Haiku as primary AI with GPT-4o mini as fallback.

**Consequences**:
- (+) Better instruction following
- (+) Cost effective (Haiku)
- (+) Claude Code integration
- (-) Smaller ecosystem than OpenAI
- (-) No image generation

---

### ADR-004: GitHub Pages Hosting

**Date**: 2026-01-XX
**Status**: Accepted

**Context**: Need hosting for static frontend. Options: Vercel, Netlify, GitHub Pages, Cloudflare Pages.

**Decision**: Use GitHub Pages with custom domain.

**Consequences**:
- (+) Free hosting
- (+) Integrated with repo
- (+) Simple deployment
- (-) No server-side rendering
- (-) No edge functions (use Supabase instead)

---

### ADR-005: Products vs Playground Structure

**Date**: 2026-02-04
**Status**: Accepted

**Context**: Need to distinguish between production-ready applications and experimental projects.

**Decision**: Create separate "Products" and "Playground" categories with different documentation standards.

**Consequences**:
- (+) Clear expectations for each project
- (+) Playground projects can move fast without full docs
- (+) Promotes experimentation
- (-) Need to manage promotion from Playground to Products

---

### ADR-006: localStorage-First Architecture

**Date**: 2025-12-XX
**Status**: Accepted

**Context**: Need to decide where user data lives. Options: server-only (Supabase), local-only (localStorage), or hybrid.

**Decision**: Use localStorage as the primary data store with Supabase as an async persistence layer. All reads and writes go to localStorage first. Supabase sync is fire-and-forget.

**Consequences**:
- (+) App works fully offline with zero latency
- (+) No auth required for basic use (anonymous users can save pins)
- (+) Instant UI response — no network wait for any operation
- (-) Data loss risk if browser storage is cleared (mitigated by Supabase backup)
- (-) No real-time cross-device sync (polling every 30s)
- (-) Conflict resolution is simplistic (last-write-wins)

---

### ADR-007: CORS Proxies for Client-Side Scraping

**Date**: 2025-12-XX
**Status**: Accepted (with reservations — see [R1 in Risks](../infrastructure/risks.md))

**Context**: Need to fetch OG metadata from arbitrary URLs for pin enrichment. Browser CORS policy blocks direct fetches. Options: build a server-side proxy, use public CORS proxy services, or skip client-side scraping entirely.

**Decision**: Use two public CORS proxy services (allorigins.win, corsproxy.io) with fallback between them. Plan to add server-side fallback via Supabase Edge Function.

**Consequences**:
- (+) No server infrastructure needed for basic metadata extraction
- (+) Works for anonymous users without auth
- (+) Two-proxy fallback provides redundancy
- (-) Third-party services can log request URLs (privacy concern)
- (-) No SLA — both services could disappear
- (-) Bot protection on target sites still blocks many scrapes

---

### ADR-008: Domain Profile Caching for AI Cost Amortization

**Date**: 2026-01-XX
**Status**: Accepted

**Context**: Every new pin needs content type classification. Using Claude Haiku for each pin costs ~$0.0002/call. Over time, many pins come from the same domains (nike.com, youtube.com, etc.).

**Decision**: Build a `domain_profiles` table that learns each domain's primary content type. After ~5 classifications from the same domain, skip the AI call entirely and use the cached profile.

**Consequences**:
- (+) AI calls drop dramatically after initial domain learning
- (+) Classification is instant for known domains
- (+) Domain profiles are shared across all users
- (-) Multi-type domains (e.g., medium.com has articles and products) can be misclassified
- (-) Domain profiles never expire (stale if site changes purpose)

---

### ADR-009: Config-Driven Widget System

**Date**: 2026-02-05
**Status**: Accepted

**Context**: Initially, widget eligibility and rendering were hard-coded per widget type. Adding a new widget required code changes in the edge function and the frontend. Need a way to add widgets without deploys.

**Decision**: Define widgets as TypeScript config objects with declarative eligibility rules, prompt templates, enrichment strategies, and template selection. A registry loads all configs and evaluates them dynamically.

**Consequences**:
- (+) New widget type = new config file, no code changes
- (+) A/B testable — swap configs without deploys
- (+) Hot-reload at runtime via `registerWidget()` / `unregisterWidget()`
- (-) More complex initial architecture (schema, registry, evaluators)
- (-) Config validation happens at runtime, not compile time

---

### ADR-010: Two-Tier Pin Enrichment

**Date**: 2026-01-XX
**Status**: Accepted

**Context**: Pin enrichment (title, image, category, content type) can happen client-side or server-side. Client is fast but limited by CORS. Server has full access but costs invocations and requires auth.

**Decision**: Two-tier enrichment. Client tier runs first (CORS proxy scraping, rule-based classification) for instant feedback. Server tier runs asynchronously (AI classification, multi-strategy image resolution) for higher-quality results.

**Consequences**:
- (+) User sees pin metadata in ~2s (client), then it improves (server)
- (+) Works for anonymous users (client tier only)
- (+) Graceful degradation — server tier is optional enhancement
- (-) Two different code paths to maintain
- (-) Pin data can change after the user already saw it (title/image shift)

---

### ADR-011: Single-File Frontend (No Build Step)

**Date**: 2025-12-XX
**Status**: Accepted (with reservations — see [R2 in Risks](../infrastructure/risks.md))

**Context**: As the app grew, all code accumulated in `boards/index.html` (~9,100 lines). Options: extract into modules with a bundler (webpack, vite), extract into separate files with `<script>` tags, or keep as single file.

**Decision**: Keep as single file for now. The IIFE structure provides clean scope. No bundler means no build complexity. Planned modularization when the cost of the monolith exceeds the cost of extraction.

**Consequences**:
- (+) Zero build step — edit HTML, push, done
- (+) No bundler config, no node_modules, no package.json
- (+) Everything is in one place (good for search/grep)
- (-) Hard to navigate (need section map in [client-architecture.md](../infrastructure/technical-design/client-architecture.md))
- (-) Can't lazy-load or tree-shake
- (-) Merge conflicts on collaborative work

---

### ADR-012: Magic Link Authentication (No Passwords)

**Date**: 2025-12-XX
**Status**: Accepted

**Context**: Need user authentication. Options: email/password, social OAuth only, magic link (passwordless), or a combination.

**Decision**: Use Supabase Auth magic link (email OTP) as the only authentication method. No passwords stored.

**Consequences**:
- (+) Zero password management — no forgot-password flows, no bcrypt
- (+) Simpler UX — enter email, click link, done
- (+) More secure — no password database to breach
- (-) Requires email access to log in (can't use on someone else's device easily)
- (-) Magic link emails can be slow or caught by spam filters
- (-) No MFA (magic link is effectively single-factor)

---

### ADR-013: Server-Side Pin Ingestion for Automated Sources

**Date**: 2026-02-06
**Status**: Proposed

**Context**: Today, all pins are created client-side — the user pastes a URL, the client creates a skeleton in localStorage, then syncs to Supabase. For automated sources (RSS feeds, APIs, social imports, AI discovery), pins originate server-side with no client present. Need to decide how server-created pins reach the client.

**Decision**: Automated pins are created server-side via a shared `ingest-pin` edge function. They flow through the same enrichment pipeline (classification, image resolution) but server-side. Pins sync to the client on the next 30s poll or via Supabase Realtime subscription. All automated pins carry `source` provenance metadata and a `reviewed: false` flag so the user can filter and acknowledge them.

**Consequences**:
- (+) All pin types (feed, API, social, discovery) use one ingestion path
- (+) Enrichment pipeline reused — no separate enrichment code for automated pins
- (+) Source tracking enables "where did this pin come from?" filtering
- (+) `reviewed` flag prevents the board from silently filling up
- (-) Reverses the normal data flow (server → client instead of client → server)
- (-) 30s polling delay before automated pins appear (unless Realtime is implemented)
- (-) Server-side enrichment costs scale with feed volume (mitigated by domain profile caching)
- (-) API key management adds auth complexity

---

## Template

```markdown
### ADR-XXX: [Title]

**Date**: YYYY-MM-DD
**Status**: Proposed | Accepted | Deprecated | Superseded

**Context**: [What is the issue?]

**Decision**: [What did we decide?]

**Consequences**:
- (+) [Positive consequence]
- (-) [Negative consequence]
```

---

*Last updated: 2026-02-06*
