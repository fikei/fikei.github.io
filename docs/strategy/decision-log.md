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
**Status**: Superseded by ADR-014

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
**Status**: Superseded by ADR-015

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
**Status**: Superseded by ADR-014

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

### ADR-014: React + TypeScript Rewrite (Supersedes ADR-001, ADR-011)

**Date**: 2026-03-05
**Status**: Accepted

**Context**: The Boards monolith (`boards/index.html`) has grown to 20,040 lines with no module boundaries, no type safety, and no component isolation. Development velocity is degrading — every change risks side effects across the application. There are no tests, no code splitting, and security issues (client-side API key exposure in `classifyByAI()`). ADR-001 (Vanilla JS) and ADR-011 (Single-File) were correct for rapid prototyping but are now net negatives.

**Decision**: Rewrite Boards in React 18 + TypeScript 5.x + Vite 5.x. Use Zustand for client state (flat store fits interconnected slices better than Redux boilerplate or Jotai atoms). Use TanStack Query for server state (stale-while-revalidate, optimistic updates, retry). Use @dnd-kit for drag-and-drop (accessible, composable, custom collision detection for merge zones). Use CSS Modules with existing `design-system/tokens.css` as sole source of truth (no styled-components or Tailwind — the design system already exists). See PRD: `docs/strategy/prds/boards-react-rewrite.md`.

**Consequences**:
- (+) Type safety catches bugs before runtime
- (+) Component isolation makes features independently testable
- (+) Code splitting — users load only what they use
- (+) 17,600 lines become ~40 focused modules
- (+) Test coverage possible from day one (Vitest + MSW + Playwright)
- (-) 20-week migration effort across 5 phases
- (-) Two apps to maintain during migration period
- (-) Build step required (Vite) — no more edit-push-done
- (-) New dependencies (React, Zustand, TanStack Query, Dexie, @dnd-kit)

---

### ADR-015: Cloudflare Pages Hosting (Supersedes ADR-004)

**Date**: 2026-03-05
**Status**: Accepted

**Context**: GitHub Pages cannot serve single-page applications correctly — path-based URLs like `/boards/cleanup` return 404 on hard refresh. The React rewrite needs proper SPA routing. Options: GitHub Pages with 404.html hack, hash-based routing, Vercel, Netlify, Cloudflare Pages.

**Decision**: Host the React app on Cloudflare Pages. Staging URL `next.ctrl.rodeo` during migration, DNS cutover to `ctrl.rodeo` at Phase R5. GitHub Pages remains for the Jekyll landing site during transition.

**Consequences**:
- (+) Native SPA routing — all paths resolve to index.html
- (+) Global edge CDN with edge caching (faster than GitHub Pages)
- (+) Preview deployments per PR (every branch gets a unique URL)
- (+) Free tier: 500 builds/month, unlimited bandwidth
- (+) Future option: Cloudflare Workers for edge-side backend
- (-) DNS change required at cutover (brief SSL/propagation risk)
- (-) Must add new domains to Supabase Auth redirect URLs
- (-) Separate deployment pipeline from the Jekyll site

---

### ADR-016: IndexedDB via Dexie.js (Supersedes ADR-006 partially)

**Date**: 2026-03-05
**Status**: Accepted

**Context**: The monolith uses 16+ localStorage keys with inconsistent naming, no versioning, and the 5MB storage limit. The offline-first principle from ADR-006 remains correct, but localStorage is the wrong persistence layer for an app with 1000+ pins and structured data.

**Decision**: Replace localStorage with Dexie.js (IndexedDB wrapper) for all persistent data. Preserve the offline-first architecture: Zustand store (in-memory) → Dexie (local DB) → Supabase (cloud sync). Same stale-while-revalidate pattern. Include a one-time migration utility that reads all 16 legacy localStorage keys into Dexie tables.

**Consequences**:
- (+) No 5MB storage limit (IndexedDB has effectively unlimited storage)
- (+) Async operations don't block main thread
- (+) Structured queries (indexes on category, contentType, syncStatus)
- (+) Schema migrations built-in (Dexie version system)
- (+) Consistent key naming (one schema definition)
- (-) More complex API than localStorage get/set
- (-) Migration utility needed for existing users
- (-) IndexedDB can be cleared by browser (same risk as localStorage)

---

### ADR-017: Server-Side Classification (Supersedes ADR-007 partially)

**Date**: 2026-03-05
**Status**: Accepted

**Context**: ADR-007 accepted CORS proxies "with reservations." The monolith leaks every user URL to `allorigins.win` and `codetabs.com`. Additionally, `classifyByAI()` calls the Anthropic API directly from the browser, exposing the API key. Both are security issues that cannot be fixed without server-side alternatives.

**Decision**: Create two new Supabase Edge Functions: `fetch-metadata` (replaces CORS proxies) and extend `classify` (absorbs client-side `classifyByAI()`). No user URLs leave the Supabase infrastructure. No API keys in the browser.

**Consequences**:
- (+) User URLs never sent to third-party CORS proxies
- (+) Anthropic API key removed from client-side code
- (+) Server-side scraping bypasses CORS entirely
- (+) Bot protection on target sites is easier to handle server-side
- (-) Requires Supabase auth for metadata fetching (no anonymous enrichment)
- (-) Edge function invocations have cost (mitigated by domain profile caching per ADR-008)

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

*Last updated: 2026-03-05*
