# Phase 13: Boards React Rewrite

> Back to [Project Plan](./index.md)
>
> **Reference**: [PRD: Boards React Rewrite](/docs/strategy/prds/boards-react-rewrite.md)
>
> **Vision**: Migrate Boards from a 20,040-line monolith HTML file to a typed, component-driven React 18 application hosted on Cloudflare Pages. The rewrite eliminates critical security vulnerabilities (client-side API key exposure, CORS proxy URL leakage), replaces 16+ localStorage keys with IndexedDB (Dexie), establishes TypeScript throughout, and creates a testable foundation for all future feature development. The monolith stays live during migration — parity is achieved incrementally across 5 phases before DNS cutover.
>
> **Why a new phase**: This is a platform-level architectural migration with its own multi-sprint delivery structure and success gates at each sub-phase. It runs in parallel with ongoing monolith work through Phase R3 and supersedes the monolith entirely at R5.

---

## Migration Deployment Plan

| Sub-Phase | Monolith (GitHub Pages) | React App (Cloudflare Pages) |
|-----------|------------------------|------------------------------|
| R1–R2 | `ctrl.rodeo/boards/` (primary) | `next.ctrl.rodeo` (staging, internal) |
| R3 | `ctrl.rodeo/boards/` (primary) | `next.ctrl.rodeo` (beta, external testers) |
| R4 | `ctrl.rodeo/boards/` (feature-flagged redirect) | `next.ctrl.rodeo` (production-ready) |
| R5 | Archived | `ctrl.rodeo/boards/` (DNS cutover to Cloudflare) |

---

## Phase R1: Foundation

> **Goal**: React app running on Cloudflare Pages at `next.ctrl.rodeo`, loading real data from Supabase.
> **Success gate**: `next.ctrl.rodeo` shows the user's actual pins in a basic grid.

### Epic R1.1: Build Infrastructure

| Story | Tasks | Status |
|-------|-------|--------|
| **Project Scaffold** | | Pending |
| | Initialize Vite 5.x + React 18 + TypeScript strict project in `boards-app/` | Pending |
| | Configure pnpm as package manager; add `pnpm-lock.yaml` to repo | Pending |
| | Add ESLint + Prettier with TypeScript rules | Pending |
| | Set up path aliases (`@/` → `src/`) in `vite.config.ts` and `tsconfig.json` | Pending |
| **Cloudflare Pages Deployment** | | Pending |
| | Connect `boards-app/` directory to Cloudflare Pages project | Pending |
| | Set build command: `pnpm build`, output directory: `dist/` | Pending |
| | Configure `wrangler.toml` for Cloudflare Pages | Pending |
| | Add `next.ctrl.rodeo` as custom domain (CNAME in Cloudflare) | Pending |
| | Verify preview deployments fire on every branch push | Pending |
| **Design System Integration** | | Pending |
| | Import `design-system/tokens.css` and `design-system/components.css` | Pending |
| | Import `design-system/widgets.css` | Pending |
| | Audit token discrepancies: `--text-md`, `--text-xs`, `--text-sm`, `--bg-surface` vs monolith values | Pending |
| | Update `tokens.css` to match monolith rendered values (font size scale, surface color) | Pending |
| | Verify no inline style overrides needed — CSS tokens only | Pending |

---

### Epic R1.2: Data Foundation

| Story | Tasks | Status |
|-------|-------|--------|
| **Dexie Schema** | | Pending |
| | Implement `src/db/schema.ts` — Dexie database `boards-v1` with 10 tables | Pending |
| | Tables: `pins`, `pinOrder`, `expandedStates`, `boardMetadata`, `widgetCache`, `widgetPrefs`, `dimensionFilters`, `lookbackState`, `domainProfiles`, `syncQueue` | Pending |
| | Add typed interfaces for each Dexie table matching `Pin`, `Category`, `Widget` types | Pending |
| **localStorage Migration** | | Pending |
| | Implement migration utility `src/lib/migration.ts` — reads 16+ legacy localStorage keys | Pending |
| | Map: `things-i-like` → `pins` + `pinOrder`; `boards-expanded-cards` → `expandedStates`; `boards_widget_cache` → `widgetCache`; `ctrl-rodeo-lookback-*` → `lookbackState` | Pending |
| | Map: `boards_widget_prefs` + `boards_widget_feedback` → `widgetPrefs`; `board-dimensions-{category}` → `dimensionFilters`; `boards_domain_profiles` → `domainProfiles`; `boards_pending_saves` → `syncQueue` | Pending |
| | Run migration once on first app load, then clear localStorage keys | Pending |
| | Unit tests for migration utility (all 16 key mappings, empty state, corrupt data) | Pending |
| **TypeScript Interfaces** | | Pending |
| | Implement `src/types/pin.ts` — `Pin`, `MusicMetadata`, `VideoMetadata`, `BookMetadata`, `MergeSource`, `ExpansionState` | Pending |
| | Implement `src/types/category.ts` — `Category`, `BuiltinCategory` | Pending |
| | Implement `src/types/widget.ts` — `Widget`, `WidgetZone`, `WidgetFeedback` | Pending |
| | Implement `src/types/api.ts` — API request/response shapes | Pending |
| | Implement `src/constants/categories.ts` — 9 built-in categories | Pending |
| | Implement `src/constants/contentTypes.ts` — 10 content types | Pending |

---

### Epic R1.3: Authentication

| Story | Tasks | Status |
|-------|-------|--------|
| **Auth Hook** | | Pending |
| | Implement `useAuth` hook: `signIn`, `signOut`, `session`, `currentUser` | Pending |
| | Add iOS auth token capture script to `index.html` head (verbatim from monolith) | Pending |
| | `AuthModal` component with magic link OTP flow | Pending |
| **Supabase Configuration** | | Pending |
| | Add `next.ctrl.rodeo` to Supabase Auth allowed redirect URLs (Boards project) | Pending |
| | Verify magic link OTP redirects to `next.ctrl.rodeo` correctly | Pending |

---

### Epic R1.4: Security Fixes (Backend)

| Story | Tasks | Status |
|-------|-------|--------|
| **`fetch-metadata` Edge Function** | | Pending |
| | Create new `supabase/functions/fetch-metadata/index.ts` | Pending |
| | Server-side URL scraping: replaces `allorigins.win` / `codetabs.com` CORS proxies | Pending |
| | Preserve all platform shortcuts from `fetchMetadata()` (YouTube, Spotify, oEmbed, etc.) | Pending |
| | Return same shape as current metadata response | Pending |
| | Deploy to Boards Supabase project | Pending |
| **`classify` Edge Function (Extended)** | | Pending |
| | Extend existing `classify` edge function to include rule-based classification | Pending |
| | Move `classifyByAI()` server-side — eliminates client-side Anthropic API key exposure | Pending |
| | Move `classifyByRules()` server-side — collocates with `domain_profiles` table | Pending |
| | Implement `src/api/classify.ts` typed client wrapper | Pending |
| | Deploy to Boards Supabase project | Pending |
| **`board-state` Edge Function** | | Pending |
| | Create new `supabase/functions/board-state/index.ts` | Pending |
| | Single-call bootstrap: returns pins + pinOrder + expandedStates + boardMetadata | Pending |
| | Replaces 4 parallel PostgREST calls on app load | Pending |
| | Deploy to Boards Supabase project | Pending |

---

### Epic R1.5: Pin Store and Basic Render

| Story | Tasks | Status |
|-------|-------|--------|
| **Zustand Stores** | | Pending |
| | Implement `src/store/pinStore.ts` — `pins: Map<string, Pin>`, `order: string[]`, `expandedCards: Map<string, ExpansionState>` with mutations | Pending |
| | Implement `src/store/boardStore.ts` — `categories`, `currentFilter`, `searchQuery`, `subTagFilters` | Pending |
| | Implement `src/store/syncStore.ts` — `syncStatus`, `pendingSaves`, `retryQueue`, `enqueue`, `flush` | Pending |
| | Implement `src/store/uiStore.ts` — `selectedPin`, `toasts`, `modals`, `widgets`, `theme` | Pending |
| | Wire Zustand `persist` middleware to Dexie for all stores | Pending |
| **TanStack Query Sync** | | Pending |
| | Implement `src/api/queryKeys.ts` — query key factory for all endpoints | Pending |
| | Implement `useSync` hook using TanStack Query with `board-state` endpoint | Pending |
| | Stale-while-revalidate: render from Dexie immediately, fetch from Supabase in background | Pending |
| | Extract monolith merge algorithm verbatim to `src/lib/sync.ts` | Pending |
| | Unit tests for merge algorithm (local-only, cloud-only, locally-updated, cloud-updated cases) | Pending |
| **Basic Pin Grid** | | Pending |
| | Implement `PinGrid` component with CSS Grid (2-6 responsive columns, Swiss grid layout) | Pending |
| | Implement image-only `PinCard` (default expansion state) from real Supabase data | Pending |
| | `SyncIndicator` component showing sync status | Pending |
| | `AuthGate` component — requires auth before showing pins | Pending |
| | Wire `App.tsx`, `main.tsx`, `routes.tsx` with React Router v6 | Pending |

---

## Phase R2: Core Display

> **Goal**: Feature parity for read-only display. React app can browse and filter all pins identically to the monolith.
> **Success gate**: All display and filtering interactions work without touching the monolith.

### Epic R2.1: Pin Cards (All Expansion States)

| Story | Tasks | Status |
|-------|-------|--------|
| **Full PinCard Component** | | Pending |
| | `PinCard` default expansion (image only) | Pending |
| | `PinCard` medium expansion (inline details: title, domain, category badge, format badge) | Pending |
| | `PinCard` large expansion (full overlay with all metadata) | Pending |
| | `PinImage` with fallback and loading skeleton | Pending |
| | `PinOverlay` — hover state with action buttons | Pending |
| | `PinDetails` — medium/large content (title, description, tags, rich metadata) | Pending |
| | `CategoryBadge` and `FormatBadge` components | Pending |
| | `ResizeHandle` — right-edge drag to resize card width | Pending |
| | Persist expansion state to Supabase via `useExpandedState` hook + TanStack Query | Pending |
| **Rich Content Overlays** | | Pending |
| | Per-category config in `src/config/richContent.ts` | Pending |
| | Music metadata display (artist, album, genre, platform) | Pending |
| | Video metadata display (title, type, year, platform) | Pending |
| | Book metadata display (author, publisher, pages) | Pending |
| | Fashion metadata display (brand, color, material) | Pending |

---

### Epic R2.2: Filter Bar

| Story | Tasks | Status |
|-------|-------|--------|
| **FilterBar Component** | | Pending |
| | Sticky horizontal pill row using `.filter-token` CSS classes | Pending |
| | "All" token + 9 built-in category tokens | Pending |
| | User board tokens (dynamic, from `BoardStore`) | Pending |
| | Filter count badges (derived from `PinStore` with `useMemo`) | Pending |
| | `NewBoardButton` — inline board creation trigger | Pending |
| | `CleanupToken` (conditional, shows when cleanup queue is non-empty) | Pending |
| **Search** | | Pending |
| | `SearchInput` component with real-time full-text search | Pending |
| | `useSearch` hook with `useDeferredValue` for responsive filtering | Pending |
| **URL Sync** | | Pending |
| | `useFilterUrlSync` hook — bidirectional sync of filter state with URL search params | Pending |
| | Category filter: `?category=wear`; search: `?q=nike`; board: `?board=slug` | Pending |

---

### Epic R2.3: Sub-Tag Bar

| Story | Tasks | Status |
|-------|-------|--------|
| **SubTagBar Component** | | Pending |
| | `SubTagBar` shown conditionally when a category filter is active | Pending |
| | `useSubtags` hook: suggest/create/assign modes | Pending |
| | `SubTagSuggestions` — AI-generated tag options | Pending |
| | `ActiveDimension` — currently selected sub-tag filter | Pending |
| | `DimensionPromptInput` — custom dimension creation | Pending |

---

### Epic R2.4: Widgets (All 11 Templates)

| Story | Tasks | Status |
|-------|-------|--------|
| **Widget Infrastructure** | | Pending |
| | `useWidgetScoring` hook — extracts `scoreWidgetFit()` and `profilePins()` to `src/lib/widgetScoring.ts` | Pending |
| | Dexie `widget_cache` table with 5-min TTL | Pending |
| | `src/config/widgetRegistry.ts` — TypeScript port of `WIDGET_REGISTRY` (20+ widget configs) | Pending |
| | `src/api/widgets.ts` — typed wrapper for `generate-widget` edge function | Pending |
| **Widget Zone Components** | | Pending |
| | `WidgetHero` — hero zone above pin grid | Pending |
| | `WidgetInline` — inline zones at scored positions within grid | Pending |
| | `WidgetFooter` — footer zone below pin grid | Pending |
| | `WidgetHeader` — shared header (title, description, thumbs up/down feedback) | Pending |
| | `WidgetInspector` — dev-mode overlay (lazy loaded) | Pending |
| **Widget Body Templates (11)** | | Pending |
| | `HeroCardTemplate` — `w-body--verdict` | Pending |
| | `ListTemplate` — `w-body--list` | Pending |
| | `SpectrumTemplate` — `w-body--spectrum` | Pending |
| | `GridSplitTemplate` — `w-body--split` | Pending |
| | `TextBlockTemplate` — `w-body--narrative` | Pending |
| | `QuickAddTemplate` — `w-body--suggestion` | Pending |
| | `StatRowTemplate` — `w-body--stats` | Pending |
| | `ComparisonTemplate` — `w-body--comparison` | Pending |
| | `ChoicesTemplate` — `w-body--choices` | Pending |
| | `ChecklistTemplate` — `w-body--checklist` | Pending |
| | `GroupedTemplate` — `w-body--grouped` | Pending |
| | Visual regression: screenshot each template in both monolith and React, diff | Pending |

---

### Epic R2.5: Category Views

| Story | Tasks | Status |
|-------|-------|--------|
| **Listen View** | | Pending |
| | `ListenView` — music grid/list toggle | Pending |
| | `ListenPlayer` — fixed bottom bar: Spotify/SoundCloud/Bandcamp embeds | Pending |
| **Watch View** | | Pending |
| | `WatchView` component — toggle layout | Pending |
| **Lookback Card** | | Pending |
| | Extract `computeLookbackScore()` verbatim to `src/lib/lookback.ts` | Pending |
| | `useLookback` hook with diversity-aware greedy selection | Pending |
| | `LookbackCard` component in pin grid | Pending |
| | `usePinInteraction` hook — click/expand/share tracking to `pin_interactions` table | Pending |
| | Dexie `lookback_state` table for surfaced history and recency decay | Pending |
| **Cleanup View** | | Pending |
| | `CleanupView` route (`/boards/cleanup`) — sequential card triage | Pending |
| | `cleanup-queue` edge function — server-side prioritized review queue | Pending |
| | Deploy `cleanup-queue` to Boards Supabase project | Pending |

---

## Phase R3: Capture and CRUD

> **Goal**: All capture and mutation operations working in React. Monolith hidden behind feature flag.
> **Success gate**: All pin operations (add, enrich, reorder, merge, delete) work. Monolith accessible only via override flag.

### Epic R3.1: Add Modal and Capture

| Story | Tasks | Status |
|-------|-------|--------|
| **AddModal** | | Pending |
| | `AddModal` — URL text input, multi-URL paste, submit | Pending |
| | `usePasteHandler` hook — multi-URL extraction | Pending |
| | `useClipboardMonitor` hook — clipboard detection on focus | Pending |
| | `useDuplicateDetection` hook — check against existing pins by URL | Pending |
| | `usePinProcessor` orchestration hook — parallel metadata + classify | Pending |
| **Enrichment Queue** | | Pending |
| | `useEnrichmentQueue` hook with `p-queue` (concurrency: 1, 3 retries, exponential backoff) | Pending |
| | `src/api/enrichment.ts` — typed wrapper for `enrich-link` edge function | Pending |
| | `src/lib/enrichmentQueue.ts` — pure queue logic, unit tested | Pending |
| **Capture Methods** | | Pending |
| | `MobilePasteBar` — always-visible mobile add bar | Pending |
| | `useDeepLinkCapture` hook — processes `?add=URL` query param | Pending |
| | `useExtensionDetection` hook — `data-boards-extension` attribute | Pending |
| | `PwaShareHandler` route (`/boards/pwa-share`) + Workbox service worker | Pending |
| | `PhotoUploadCapture` — photo upload with file handler | Pending |
| | `VideoUploadCapture` — video upload with file handler | Pending |
| | `ScanModal` — Claude Vision image scan via `scan-image` edge function | Pending |
| | `useScanImage` hook | Pending |

---

### Epic R3.2: Pin Mutations

| Story | Tasks | Status |
|-------|-------|--------|
| **CRUD Operations** | | Pending |
| | `src/api/pins.ts` — typed wrappers: create, update, delete, reorder | Pending |
| | Delete pin with `ConfirmModal` | Pending |
| | Category selection via `CategoryModal` | Pending |
| | Content type selection via `ContentTypeModal` | Pending |
| **Drag-and-Drop** | | Pending |
| | `@dnd-kit/sortable` with pointer sensor for drag-to-reorder (outer 60% of card) | Pending |
| | Custom `CollisionDetection` algorithm for center 40% merge zone | Pending |
| | Drag-to-merge triggers `MergeModal` | Pending |
| | `useDragResize` hook — right-edge resize handle | Pending |
| | Widget drag repositioning between zones | Pending |
| | Extensive mobile touch event testing for drag interactions | Pending |
| **Merge Pins** | | Pending |
| | `MergeModal` component — select merge target, preview merged result | Pending |
| | `merge-pins` edge function — server-side field priority logic | Pending |
| | `MergedPinView` component — display up to 10 sources | Pending |
| | Deploy `merge-pins` to Boards Supabase project | Pending |

---

### Epic R3.3: Boards Management

| Story | Tasks | Status |
|-------|-------|--------|
| **User Boards** | | Pending |
| | `CreateBoardModal` — name + optional AI prompt | Pending |
| | `src/api/boards.ts` — create, update, delete board | Pending |
| | `board-suggestions` edge function — TF-IDF ranked pin suggestions (extracts `PinRanker`) | Pending |
| | `BoardSeedPanel` + `useBoardSuggestions` hook | Pending |
| | Deploy `board-suggestions` to Boards Supabase project | Pending |
| **Export** | | Pending |
| | `useExport` hook — JSON export of all pins | Pending |

---

## Phase R4: Auth, Sharing, and Advanced

> **Goal**: Full feature parity. Monolith deprecated; React app is production.
> **Success gate**: All features working in React at parity. Monolith no longer used for new sessions.

### Epic R4.1: Full Auth Flow

| Story | Tasks | Status |
|-------|-------|--------|
| **Auth Modal (Complete)** | | Pending |
| | Magic link OTP with countdown timer | Pending |
| | Rate limiting UI (max attempts, cooldown display) | Pending |
| | Sign-out flow | Pending |
| **Account Management** | | Pending |
| | `AccountModal` — username display and edit | Pending |
| | Username uniqueness via `usernames` table + availability check endpoint | Pending |
| | `SettingsModal` — preferences, theme, data management | Pending |
| | `ToolsModal` — bookmarklet install, PWA install, share link | Pending |
| | `usePwaInstall` hook — PWA install prompt | Pending |
| | `useTheme` hook — dark/light toggle | Pending |

---

### Epic R4.2: Sharing

| Story | Tasks | Status |
|-------|-------|--------|
| **Board Sharing** | | Pending |
| | `ShareModal` — create share (link-only / public), set visibility | Pending |
| | `src/api/share.ts` — create, update, delete share | Pending |
| | `SharedBoardView` route (`/boards/share/:code`) — read-only view | Pending |
| | `useSharedBoard` hook — live vs. snapshot conditional polling | Pending |
| | Share analytics: `board_views` insert on `SharedBoardView` mount | Pending |
| | Server-side share code generation (uniqueness guarantee) | Pending |

---

### Epic R4.3: Advanced Features

| Story | Tasks | Status |
|-------|-------|--------|
| **Admin Panel** | | Pending |
| | `AdminPanel` component with Supabase JWT custom claims role guard | Pending |
| | Replace hardcoded email array with proper role check | Pending |
| | Lazy-load `AdminPanel` (< 20KB gzipped target) | Pending |
| **Onboarding and Capture Promo** | | Pending |
| | `useOnboarding` hook — escalating prompts for new users | Pending |
| | `CapturePromo` component — contextual capture method suggestions | Pending |
| **iOS and Instagram** | | Pending |
| | `IosAppOverlay` — iOS-only app redirect banner | Pending |
| | `IgReviewModal` — Instagram import review UI | Pending |
| | `useInstagramImport` hook — wired to `instagram-import` edge function | Pending |

---

## Phase R5: Hardening

> **Goal**: Performance targets met, test suite complete, DNS cutover to Cloudflare Pages.
> **Success gate**: `ctrl.rodeo/boards/` served by Cloudflare Pages. Monolith archived.

### Epic R5.1: Performance

| Story | Tasks | Status |
|-------|-------|--------|
| **Virtualization** | | Pending |
| | `useVirtualizer` from `@tanstack/react-virtual` for 1000+ pin grid at 60fps | Pending |
| | `useTransition` on filter changes — current view stays interactive during re-render | Pending |
| | `useDeferredValue` on search input — UI stays responsive | Pending |
| | Widget generation debounced — only regenerates on category filter change | Pending |
| | Enrichment queue runs in background without blocking renders | Pending |
| **Code Splitting** | | Pending |
| | Lazy-load `CleanupView` (target: < 20KB gzipped) | Pending |
| | Lazy-load `AdminPanel` (target: < 20KB gzipped) | Pending |
| | Lazy-load `WidgetInspector` (target: dev-only, excluded from prod bundle) | Pending |
| | Lazy-load widget system chunk (target: < 40KB gzipped) | Pending |
| **Bundle Audit** | | Pending |
| | Initial bundle (app shell + auth): target < 80KB gzipped | Pending |
| | Pin grid + cards chunk: target < 100KB gzipped | Pending |
| | Total first load: target < 250KB gzipped | Pending |
| | Core Web Vitals audit: LCP < 2.5s, INP < 200ms, CLS < 0.1 | Pending |

---

### Epic R5.2: Test Suite

| Story | Tasks | Status |
|-------|-------|--------|
| **Unit Tests (Vitest)** | | Pending |
| | `src/lib/lookback.ts` — scoring algorithm, diversity selection | Pending |
| | `src/lib/sync.ts` — sync queue, retry logic, merge algorithm | Pending |
| | `src/lib/widgetScoring.ts` — `scoreWidgetFit()`, `profilePins()` | Pending |
| | `src/lib/enrichmentQueue.ts` — retry with exponential backoff | Pending |
| | `src/store/pinStore.ts` — all reducers and mutations | Pending |
| | `src/lib/migration.ts` — all 16 localStorage key mappings | Pending |
| | Target: 100% coverage for all `src/lib/` modules | Pending |
| **Integration Tests (Vitest + MSW)** | | Pending |
| | Mock Service Worker setup for all network intercepts | Pending |
| | Add pin → enrichment → categorization flow | Pending |
| | Auth state change → sync trigger → merge | Pending |
| | Widget generation → cache → render | Pending |
| | Offline → queue → reconnect → flush | Pending |
| **E2E Tests (Playwright)** | | Pending |
| | Journey 1 — First-time user: land → empty state → paste URL → pin appears → enrichment completes | Pending |
| | Journey 2 — Power user: filter → sub-tag → drag reorder → expand → open link | Pending |
| | Journey 3 — Sync cycle: add pin offline → reconnect → verify synced | Pending |

---

### Epic R5.3: DNS Cutover

| Story | Tasks | Status |
|-------|-------|--------|
| **Pre-Cutover Verification** | | Pending |
| | `ctrl.rodeo` and `next.ctrl.rodeo` both added to Supabase Auth allowed redirect URLs | Pending |
| | All Playwright E2E tests passing on `next.ctrl.rodeo` | Pending |
| | Core Web Vitals targets met (LCP < 2.5s, INP < 200ms, CLS < 0.1) | Pending |
| | Bundle size targets met (< 250KB total first load) | Pending |
| **DNS Migration** | | Pending |
| | Change `ctrl.rodeo` DNS A/CNAME to point to Cloudflare Pages | Pending |
| | Verify SSL certificate auto-provisioned by Cloudflare | Pending |
| | Verify `ctrl.rodeo/boards/` resolves to React app | Pending |
| | Keep GitHub Pages as fallback for 2 weeks post-cutover | Pending |
| **Monolith Archive** | | Pending |
| | Move `boards/index.html` monolith to `boards/archive/monolith-YYYY-MM-DD.html` | Pending |
| | Add redirect or archive notice at original path | Pending |
| | Update Jekyll site nav to point to React app at `ctrl.rodeo/boards/` | Pending |
| | Add redirect from `next.ctrl.rodeo` to `ctrl.rodeo/boards/` | Pending |

---

**Implementation Notes:**
- Stack: React 18, TypeScript 5.x strict, Vite 5.x, Cloudflare Pages, Zustand, TanStack Query, Dexie.js, @dnd-kit, React Router v6, CSS Modules + design-system tokens
- Security fixes in R1.4 (`fetch-metadata`, extended `classify`) are the highest-priority deliverables — they eliminate API key exposure and URL leakage regardless of migration progress
- Monolith development continues through R2; feature flag pauses monolith additions during R3+
- All new edge functions deploy to Boards Supabase project (`yfhudwakpgzswiylhfbh`)
- Drag-to-merge requires custom `CollisionDetection` — extensive testing on touch events required (see Risk Assessment in PRD)
- Visual regression required for all 11 widget templates before R2 completion
