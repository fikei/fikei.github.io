# Boards React Rewrite — Product Requirements Document

**Status:** Draft
**Date:** 2026-02-28
**Version:** 1.0

---

## 1. Problem Statement

### The Monolith Problem

The Boards application lives as a single 20,040-line HTML file (`boards/index.html`) containing ~3,400 lines of inline CSS and ~17,600 lines of JavaScript inside a self-executing function scope. This architecture was the right choice for rapid prototyping, but it now creates compounding problems.

**Development velocity is degrading.** Every change requires navigating a file with no module boundaries, no type safety, and no component isolation. Feature additions risk unintended side effects across the entire application.

**The security posture is compromised.** The file makes direct calls to the Anthropic API from the browser, exposing API keys to all users (`classifyByAI()`). Metadata fetching routes through third-party CORS proxies (`allorigins.win`, `codetabs.com`), leaking every URL a user saves to external services.

**The design system is diverging.** The monolith defines its own CSS custom properties (lines 50-134) that partially overlap with but do not fully use `design-system/tokens.css`. The result is two parallel sources of truth.

**Observability is zero.** There are no unit tests, no integration tests, no type errors caught at build time. A 17,600-line JavaScript file cannot be tested or refactored safely.

**The offline-first architecture is hand-rolled and brittle.** The sync implementation includes a manual schema cache miss retry loop that strips unrecognized columns one at a time, retrying up to 5 times per sync. Conflict resolution happens through nested Promise.all chains with no transactional guarantees.

**There are 16+ localStorage keys with inconsistent naming conventions** (`things-i-like`, `boards-expanded-cards`, `boards_widget_cache`, `ctrl-rodeo-lookback-cache`), no versioning strategy, and no migration path.

### What a React Rewrite Solves

- **Type safety** through TypeScript catches entire classes of bugs before runtime
- **Component isolation** makes features independently testable and modifiable
- **API security** by moving all AI calls and proxy fetching server-side
- **Design system convergence** by making CSS tokens the only source of truth
- **Testable offline layer** through a dedicated persistence library with explicit contracts
- **Code splitting** so users only load code for features they actually use
- **Proper SPA routing** via Cloudflare Pages (replacing GitHub Pages)

---

## 2. Goals and Non-Goals

### Goals

1. **Full feature parity** with the current monolith before any new feature development
2. **Design system as single source of truth** — no inline styles, no shadow token systems
3. **Security remediation** — eliminate client-side API key exposure and CORS proxy leakage
4. **Offline-first maintained** — zero-friction instant interactions regardless of network state
5. **All AI capabilities preserved** — category suggestion, sub-tag generation, image validation, fashion/music enrichment, scan image, Instagram import, widget system
6. **TypeScript throughout** — full type coverage for all domain models, API contracts, and component props
7. **Progressive migration** — React app runs at a staging URL alongside the monolith
8. **Test coverage from day one** — unit tests for business logic, integration tests for critical paths, E2E for capture-to-display flow
9. **Cloudflare Pages hosting** — proper SPA routing, faster CDN, preview deployments per PR

### Non-Goals

1. New features beyond the existing inventory — new features planned in separate PRDs after parity
2. Mobile native app rewrite (iOS/Android) — only the web application
3. Changing the Supabase schema or edge function interfaces except as required by API layer improvements
4. Changing the brand, design language, or aesthetic — Swiss grid, black/white, Space Grotesk preserved
5. A single cutover date — migration is phased and the monolith remains live during each phase

---

## 3. Technical Architecture

### 3.1 Stack

| Layer | Choice | Rationale |
|-------|--------|-----------|
| Framework | React 18 | Concurrent features (`useTransition`, `Suspense`, `useDeferredValue`) for responsive filtering/search |
| Language | TypeScript 5.x strict | No `any` in production code |
| Build | Vite 5.x | Sub-second HMR, native ESM, built-in code splitting |
| Hosting | Cloudflare Pages | Native SPA routing, global edge CDN, preview deployments, free tier |
| State (client) | Zustand | Flat store with middleware; fits interconnected slices better than Jotai atoms or Redux boilerplate |
| State (server) | TanStack Query | Stale-while-revalidate, background refetch, optimistic updates, automatic retry |
| Persistence | Dexie.js (IndexedDB) | Replaces localStorage — structured queries, no 5MB limit, async, schema migrations |
| Drag-and-drop | @dnd-kit | Accessible, composable, supports custom collision detection for merge zones |
| Routing | React Router v6 | Path-based routing with Cloudflare Pages SPA support |
| CSS | CSS Modules + design system tokens | Co-located styles using existing `tokens.css` variables as source of truth |
| Package manager | pnpm | Deterministic lockfile, faster installs |

### 3.2 Hosting & Deployment — Cloudflare Pages

**Why Cloudflare Pages over GitHub Pages:**
- Native SPA routing — all paths resolve to `index.html` without hacks
- Faster global CDN with edge caching
- Preview deployments per PR (every branch gets a unique URL)
- Free tier: 500 builds/month, unlimited bandwidth
- Future option: Cloudflare Workers for edge-side backend logic

**Migration deployment strategy:**

| Phase | Monolith (GitHub Pages) | React App (Cloudflare Pages) |
|-------|------------------------|------------------------------|
| R1-R2 | `ctrl.rodeo/boards/` (primary) | `next.ctrl.rodeo` (staging, internal testing) |
| R3 | `ctrl.rodeo/boards/` (primary) | `next.ctrl.rodeo` (beta, accessible to testers) |
| R4 | `ctrl.rodeo/boards/` (feature-flagged redirect to React) | `next.ctrl.rodeo` (production-ready) |
| R5 | Archived | `ctrl.rodeo/boards/` (DNS cutover to Cloudflare) |

**Build pipeline:**
- Vite builds on `git push` to any branch
- Cloudflare Pages auto-deploys: `main` branch → production, other branches → preview URLs
- Build command: `pnpm build`
- Output directory: `dist/`

**DNS cutover plan:**
1. Add `next.ctrl.rodeo` as custom domain in Cloudflare Pages (CNAME)
2. During R1-R4, monolith stays at `ctrl.rodeo` via GitHub Pages
3. At R5 cutover: change `ctrl.rodeo` DNS to Cloudflare Pages
4. Jekyll site (landing page, soundscape, systemic) stays on GitHub Pages at a subdomain or migrates separately
5. Must add `next.ctrl.rodeo` and `ctrl.rodeo` to Supabase Auth allowed redirect URLs

### 3.3 State Management

**Zustand store slices:**

```typescript
interface PinStore {
  pins: Map<string, Pin>;
  order: string[];
  expandedCards: Map<string, ExpansionState>;
  // mutations
  addPin: (pin: Pin) => void;
  updatePin: (id: string, updates: Partial<Pin>) => void;
  deletePin: (id: string) => void;
  reorderPins: (fromId: string, toId: string, position: 'before' | 'after') => void;
  mergePins: (sourceId: string, targetId: string) => void;
}

interface BoardStore {
  categories: Map<string, Category>;
  currentFilter: string;
  searchQuery: string;
  subTagFilters: Record<string, string | null>;
  setFilter: (filter: string) => void;
  createBoard: (name: string, prompt?: string) => Board;
  deleteBoard: (slug: string) => void;
}

interface SyncStore {
  syncStatus: 'idle' | 'syncing' | 'error';
  pendingSaves: Pin[];
  retryQueue: SyncOperation[];
  enqueue: (op: SyncOperation) => void;
  flush: () => Promise<void>;
}

interface UIStore {
  selectedPin: Pin | null;
  toasts: Toast[];
  modals: ModalState;
  widgets: WidgetStore;
  theme: 'dark' | 'light';
}
```

**Persistence:** Zustand `persist` middleware writes to Dexie (IndexedDB) with versioned schemas and automatic migration between versions.

**Server state:** TanStack Query handles all Supabase fetching — provides stale-while-revalidate, background refetch, optimistic updates, and retry. Replaces the hand-rolled sync loop.

### 3.4 Routing

```
/boards/                    → BoardsApp (main grid)
/boards/share/:code         → SharedBoardView (read-only)
/boards/cleanup             → CleanupView (sequential review)
/boards/pwa-share           → PwaShareHandler (redirect)
```

Category filter uses URL search params (`?category=wear`) synchronized bidirectionally with store state on mount.

### 3.5 Offline-First Strategy

Three-layer persistence model:

| Layer | Technology | Purpose |
|-------|-----------|---------|
| 1. In-memory | Zustand store | Instant reads/writes, all UI interactions |
| 2. Local DB | Dexie.js (IndexedDB) | Replaces localStorage — async, structured, no 5MB limit |
| 3. Cloud | Supabase via TanStack Query | Background sync with operation queue |

**Dexie tables (replacing 16+ localStorage keys):**

| Dexie Table | Replaces localStorage Key |
|------------|--------------------------|
| `pins` | `things-i-like` |
| `pin_order` | (embedded in `things-i-like`) |
| `expanded_states` | `boards-expanded-cards` |
| `board_metadata` | (embedded in `things-i-like`) |
| `widget_cache` | `boards_widget_cache` |
| `widget_prefs` | `boards_widget_prefs` + `boards_widget_feedback` |
| `dimension_filters` | `board-dimensions-{category}` |
| `lookback_state` | `ctrl-rodeo-lookback-*` |
| `domain_profiles` | `boards_domain_profiles` |
| `sync_queue` | `boards_pending_saves` |

**Sync flow:** Every mutation writes to Dexie first (synchronous from user perspective), then enqueues a cloud sync operation. A sync worker processes the queue with exponential backoff. On reconnect, the queue flushes.

**Stale-while-revalidate preserved:** On app load, immediately render from Dexie, then fetch from Supabase in background and merge. The merge algorithm from the monolith is extracted to a pure function with unit tests.

**Service worker:** Upgraded from network-first to Workbox with proper offline-capable caching strategy.

---

## 4. Feature Parity Matrix

### 4.1 Pin Capture (11 Input Methods)

| Feature | Current | React Implementation |
|---------|---------|---------------------|
| Text input via Add modal | `addForm.onsubmit` | `AddPinModal` + `useAddPin` hook |
| Multi-URL paste | `extractUrls()` + `processLinks()` | `usePasteHandler` hook |
| Clipboard detection on focus | `throttledClipboardCheck()` | `useClipboardMonitor` hook |
| Mobile paste bar | `mobilePasteBtn` | `MobilePasteBar` component |
| Bookmarklet | `/boards/?add=URL` deep link | `useDeepLinkCapture` hook |
| Browser extension | `data-boards-extension` attribute | `useExtensionDetection` hook |
| PWA Share Target | `pwa-share.html` + service worker | `PwaShareHandler` route + Workbox |
| Photo upload | `photoInput` file handler | `PhotoUploadCapture` component |
| Scan image (Claude Vision) | `scan-image` edge function | `ScanImageCapture` + `scanImage()` API |
| Video upload | `videoInput` file handler | `VideoUploadCapture` component |
| iOS deep link | `ctrlrodeo://` scheme | iOS auth token capture in `index.html` head script |

### 4.2 Enrichment Pipeline

| Feature | Current | React Implementation |
|---------|---------|---------------------|
| Sequential enrichment queue | `queueEnrichment()`, 3 retries | `useEnrichmentQueue` hook with `p-queue` (concurrency: 1) |
| `enrich-link` edge function | Direct fetch | `enrichPin()` in `src/api/enrichment.ts` |
| Platform shortcuts (YouTube, Spotify, etc.) | In `fetchMetadata()` / oEmbed | Preserved in `enrich-link` edge function |
| Duplicate detection | `findByUrl()` check | `useDuplicateDetection` hook |
| Client-side metadata fetch via CORS proxy | `allorigins.win` / `codetabs.com` | **NEW `fetch-metadata` edge function** (security fix) |
| Parallel metadata + categorize | `processLinks()` orchestration | `usePinProcessor` orchestration hook |

### 4.3 Categories and Content Types

| Feature | React Implementation |
|---------|---------------------|
| 9 built-in categories (home, wear, watch, listen, use, eat, go, follow, read) | `CATEGORIES` constant in `src/constants/categories.ts` |
| Category descriptions for AI prompt | Preserved in `categorize` edge function, exported as types |
| 10 content types | `CONTENT_TYPES` constant in `src/constants/contentTypes.ts` |
| Rule-based classification | **Moved to `classify` edge function** (security fix) |
| AI classification | **Moved entirely to `classify` edge function** (eliminates client API key) |
| Smart categorize orchestration | `classifyPin()` in `src/api/classify.ts` |
| User-created boards | `BoardStore` + `src/api/boards.ts` |

### 4.4 Display and Interaction

| Feature | React Implementation |
|---------|---------------------|
| Swiss Grid layout (2-6 responsive columns) | `PinGrid` component with CSS Grid |
| Default expansion (image only) | `PinCard` with `expansion: 'default'` |
| Medium expansion (inline details) | `PinCard` with `expansion: 'medium'` |
| Large expansion (full overlay) | `PinCard` with `expansion: 'large'` |
| Expansion persisted to Supabase | `useExpandedState` hook + TanStack Query |
| Drag-to-reorder (outer 60% of card) | `@dnd-kit/sortable` with pointer sensor |
| Drag-to-merge (center 40% merge zone) | `@dnd-kit` with custom collision detection |
| Drag-to-resize (right edge) | `PinCard` resize handle with `useDragResize` |
| Widget drag repositioning | `@dnd-kit` widget reorder between zones |
| Filter bar (sticky horizontal pills) | `FilterBar` component using `.filter-token` CSS |
| Filter count badges | Derived from `PinStore` with `useMemo` |
| URL param sync | `useFilterUrlSync` hook with React Router |
| Search (real-time full-text) | `useSearch` hook with `useDeferredValue` |
| Cleanup view (sequential card triage) | `CleanupView` route component |
| Sub-tag dimensions (suggest/create/assign) | `SubTagBar` component + `useSubtags` hook |

### 4.5 AI Features

| Feature | Edge Function | React Wrapper |
|---------|--------------|--------------|
| Category suggestion | `categorize` | `useAutoCategorize` hook |
| Sub-tag generation | `generate-subcategories` | `useSubtags` hook |
| Image quality validation | `validate-image` | `useImageValidation` hook |
| Fashion enrichment | `enrich-wear` | `useWearEnrichment` hook |
| Music enrichment | `enrich-music` | `useMusicEnrichment` hook |
| Scan image (Claude Vision) | `scan-image` | `useScanImage` hook |
| Instagram import pipeline | `instagram-import` | `useInstagramImport` hook |
| Widget AI generation | `generate-widget` | `useWidget` hook |
| Events recommendation | `recommend-events` | `useEventsWidget` hook |
| Content classification | `classify` (expanded) | `useClassification` hook |

### 4.6 Widget System (20+ Widget Types)

The widget system is architecturally significant and must be preserved exactly.

| Component | Current | React |
|-----------|---------|-------|
| Widget registry (20+ types) | `WIDGET_REGISTRY` JS object | `WIDGET_REGISTRY` TypeScript const |
| Widget scoring engine | `scoreWidgetFit()`, `profilePins()` | `useWidgetScoring` hook |
| Widget cache (5-min TTL) | `boards_widget_cache` localStorage | Dexie `widget_cache` table |
| Widget rendering (HTML strings) | Template literals + `innerHTML` | Individual React components per template |
| Widget zones (hero/inline/footer) | Position tracking + grid injection | `WidgetHero`, `WidgetInline`, `WidgetFooter` components |
| Widget feedback (thumbs up/down) | `boards_widget_feedback` localStorage | Dexie `widget_prefs` table |
| Widget inspector (dev mode) | DOM overlay | `WidgetInspector` component |
| 11 body templates | HTML string builders | React components using `w-body--*` CSS classes |

**Widget types preserved:**

| Widget ID | Category | Template |
|-----------|----------|----------|
| `complete-the-look` | wear | grid-split |
| `style-summary` | wear | hero-card |
| `outfit-checklist` | wear | checklist |
| `listen-next` | listen | list |
| `sound-shelf` | listen | grouped |
| `fan-profile` | listen | hero-card |
| `viewer-profile` | watch | hero-card |
| `upcoming-releases` | watch | list |
| `eat-decide` | eat | choices |
| `flavor-profile` | eat | hero-card |
| `use-compare` | use | comparison |
| `setup-profile` | use | hero-card |
| `traveler-type` | go | hero-card |
| `events-for-you` | go | list |
| `reader-identity` | read | hero-card |
| `discover-more` | read | list |
| `board-overview` | all | stat-row |
| `collection-stats` | all | stat-row |
| `design-dna` | all | hero-card |
| `gap-filler` | all | quick-add |
| `price-radar` | wear/use | list |

### 4.7 Sharing and Collaboration

| Feature | React Implementation |
|---------|---------------------|
| Board sharing (link-only / public) | `ShareModal` component + `src/api/share.ts` |
| Live vs. snapshot update mode | `useSharedBoard` hook with conditional polling |
| Share analytics (board_views) | Preserved, triggered on `SharedBoardView` mount |
| Board invitations (in progress) | `BoardInviteModal` — status preserved |

### 4.8 Lookback / Reminiscence

| Feature | React Implementation |
|---------|---------------------|
| Daily lookback scoring (temporal, consumption gap, recency, diversity) | `useLookback` hook — pure function extracted to `src/lib/lookback.ts` |
| Diversity-aware greedy selection | Same algorithm, unit tested |
| Surfaced history / recency decay | Dexie `lookback_state` table |
| Lookback card UI | `LookbackCard` component |
| Pin interaction tracking | `usePinInteraction` hook |

### 4.9 Additional Features

| Feature | React Implementation |
|---------|---------------------|
| Board Seed Panel (TF-IDF similarity) | `BoardSeedPanel` + `useBoardSuggestions` hook |
| Listen View (music grid/list toggle) | `ListenView` component |
| Listen Player (embedded audio) | `ListenPlayer` component (Spotify/SoundCloud/Bandcamp embeds) |
| Watch View (toggle) | `WatchView` component |
| Rich Content Overlays (per-category metadata) | Per-category config in `src/config/richContent.ts` |
| Events widget (go category) | `EventsWidget` component |
| PWA install prompt | `usePwaInstall` hook |
| Onboarding (escalating prompts) | `useOnboarding` hook |
| Merged pins (up to 10 sources) | `MergedPin` type + `MergeModal` component |
| Export (JSON) | `useExport` hook |
| Auth (magic link OTP) | `useAuth` hook + `AuthModal` component |
| User account + username | `AccountModal` component |
| Admin panel (Supabase role guard) | `AdminPanel` component |
| Theme toggle (dark/light) | `useTheme` hook |

---

## 5. Design System Migration

### 5.1 CSS Token Convergence

The monolith defines its own tokens (lines 50-134) that bridge to design system tokens. In the React rewrite, the bridge is eliminated. The app imports `design-system/tokens.css` directly.

**Known discrepancies to resolve before Phase R1:**

| Token | Monolith Value | `tokens.css` Value | Resolution |
|-------|---------------|-------------------|-----------|
| Font size base | `14px` | `--text-md: 10px` | Update tokens.css to match rendered sizes (monolith values are what users see) |
| Surface color | `--surface: #1a1a1a` | `--bg-surface: #1a1a1a` | Standardize on `--bg-surface` |
| Font size xs | `11px` | `--text-xs: 10px` | Update tokens.css |
| Font size sm | `12px` | `--text-sm: 10px` | Update tokens.css |

Music platform colors (`--color-spotify`, `--color-soundcloud`, etc.) are already correct in tokens.css.

### 5.2 Component Library Strategy

Build thin React wrappers around existing design system CSS classes. The CSS remains the source of truth. React components add behavior and TypeScript props.

```typescript
// Example: Button uses design system CSS classes directly
interface ButtonProps {
  variant?: 'filled' | 'ghost' | 'danger' | 'dashed';
  size?: 'sm' | 'lg' | 'block';
  onClick?: () => void;
  disabled?: boolean;
  children: React.ReactNode;
}

function Button({ variant = 'filled', size, ...props }: ButtonProps) {
  const classes = ['btn', variant !== 'filled' && `btn--${variant}`, size && `btn--${size}`]
    .filter(Boolean).join(' ');
  return <button className={classes} {...props} />;
}
```

**Design system class → React component mapping:**

| CSS Class | React Component |
|-----------|----------------|
| `.btn` (+ variants) | `Button` |
| `.input`, `.textarea`, `.select` | `Input`, `Textarea`, `Select` |
| `.card`, `.card--interactive` | `Card` |
| `.token`, `.token--active` | `FilterToken` |
| `.modal`, `.modal--visible` | `Modal` |
| `.toast`, `.toast--error` | `Toast` (via `useToast` hook) |
| `.filter-token` | `CategoryToken` |
| `.spinner` | `Spinner` |
| `.tabs` | `Tabs` |
| `.toggle` | `Toggle` |
| `.progress` | `ProgressBar` |
| `.status` | `StatusIndicator` |

### 5.3 Widget System in React

Widget CSS classes from `design-system/widgets.css` are preserved unchanged. React widget components use the same `w-` prefixed class names:

```typescript
function HeroCardWidget({ widget, items, data }: WidgetProps) {
  return (
    <div className="w-shell w-shell--hero-card" data-widget-id={widget.id}>
      <WidgetHeader widget={widget} />
      <div className="w-body w-body--verdict">
        <span className="w-text w-text--label">{data.label}</span>
        <span className="w-text w-text--note">{data.summary}</span>
        <div className="w-tag-group">
          {data.traits?.map(t => <span key={t} className="w-badge">{t}</span>)}
        </div>
      </div>
    </div>
  );
}
```

**11 widget body templates → React components:**

| CSS Modifier | Template Name | React Component |
|-------------|--------------|-----------------|
| `w-body--verdict` | hero-card | `HeroCardTemplate` |
| `w-body--list` | list | `ListTemplate` |
| `w-body--spectrum` | spectrum | `SpectrumTemplate` |
| `w-body--split` | grid-split | `GridSplitTemplate` |
| `w-body--narrative` | text-block | `TextBlockTemplate` |
| `w-body--suggestion` | quick-add | `QuickAddTemplate` |
| `w-body--stats` | stat-row | `StatRowTemplate` |
| `w-body--comparison` | comparison | `ComparisonTemplate` |
| `w-body--choices` | choices | `ChoicesTemplate` |
| `w-body--checklist` | checklist | `ChecklistTemplate` |
| `w-body--grouped` | grouped | `GroupedTemplate` |

---

## 6. Backend API Design

### 6.1 New Edge Functions Required

**Priority 1 — Security fixes:**

| Function | Purpose | Replaces |
|----------|---------|----------|
| `fetch-metadata` | Server-side URL metadata scraping | Client-side `allorigins.win` / `codetabs.com` CORS proxies |
| `classify` (extended) | Combined rule-based + AI content classification | Client-side `classifyByAI()` with exposed API key |

**Priority 2 — State consolidation:**

| Function | Purpose | Replaces |
|----------|---------|----------|
| `board-state` | Single-call state bootstrap (pins + order + expanded + boards) | 4 parallel PostgREST calls on app load |

**Priority 3 — Business logic migration:**

| Function | Purpose | Replaces |
|----------|---------|----------|
| `merge-pins` | Server-side merged pin creation with field priority | Client-side `createMergedPin()` |
| `cleanup-queue` | Prioritized review queue with adaptive threshold | Client-side `getCleanupQueue()` |
| `board-suggestions` | TF-IDF ranked pin suggestions for user boards | Client-side PinRanker |

### 6.2 Existing Edge Functions — No Changes Required

These are well-designed and need only typed client wrappers:

- `categorize` — AI category suggestion
- `enrich-link` — full enrichment pipeline
- `generate-subcategories` — sub-tag dimension generation
- `generate-widget` — AI widget content generation
- `enrich-music` — MusicBrainz + Last.fm enrichment
- `enrich-wear` — fashion metadata
- `validate-image` — Claude Vision image quality
- `scan-image` — product extraction from photos
- `instagram-import` — multi-step Instagram pipeline
- `recommend-events` — event recommendation

### 6.3 What Moves to Backend

| Logic | Current Location | New Location | Reason |
|-------|----------------|-------------|--------|
| Anthropic API call | `classifyByAI()` in browser | `classify` edge function | **API key exposed client-side** |
| CORS proxy metadata fetch | `allorigins.win` / `codetabs.com` | `fetch-metadata` edge function | **URLs leaked to third parties** |
| Rule-based classification | `classifyByRules()` in browser | `classify` edge function | Collocate with `domain_profiles` table |
| Merged pin field priority | `mergeFieldsFallback()` | `merge-pins` edge function | Business logic belongs server-side |
| Cleanup queue scoring | `getCleanupQueue()` | `cleanup-queue` edge function | Adaptive threshold is business logic |
| Username uniqueness | Queries `shared_boards` table | New `usernames` table + endpoint | Currently checks wrong table |
| Share code generation | Client-side random | Server-side generation | Uniqueness guarantee |
| Admin check | Hardcoded email array | Supabase JWT custom claims | Security |

### 6.4 What Stays Client-Side

| Logic | Reason |
|-------|--------|
| UI rendering, DOM, animations | Inherently browser-bound |
| Drag-and-drop interactions | Requires DOM event handling |
| Clipboard detection | Browser API |
| File upload handling | FileReader API |
| Theme toggle | Instant CSS class swap |
| Search filtering | Fast enough client-side for <1000 pins |
| Category sort order for display | Presentation logic |
| Genre normalization (150+ entry map) | Simple lookup table |
| Lookback scoring | Pure computation on local data, works fine client-side |

### 6.5 New API Surface

```
GET  /api/board-state              → Full state bootstrap
POST /api/pins                     → Create pin (triggers enrichment)
PATCH /api/pins/:id                → Update pin
DELETE /api/pins/:id               → Delete pin
POST /api/pins/reorder             → Batch reorder
POST /api/pins/merge               → Merge pins
POST /api/classify                 → AI + rules classification
POST /api/fetch-metadata           → Server-side URL scraping
POST /api/boards                   → Create user board
DELETE /api/boards/:slug           → Delete board
PATCH /api/boards/:slug            → Update board metadata
GET  /api/cleanup-queue            → Prioritized review queue
POST /api/board-suggestions/:slug  → TF-IDF ranked suggestions
GET  /api/lookback                 → Daily lookback pins (optional, could stay client)
POST /api/usernames/check          → Username availability
POST /api/shares                   → Create share
PATCH /api/shares/:id              → Update share
DELETE /api/shares/:id             → Stop sharing
```

---

## 7. Component Architecture

### 7.1 Top-Level Component Tree

```
BoardsApp
├── AuthGate
├── SyncIndicator
├── FilterBar
│   ├── SearchInput
│   ├── CategoryTokens (All + 9 built-in)
│   ├── UserBoardTokens
│   ├── NewBoardButton
│   └── CleanupToken (conditional)
├── SubTagBar (conditional)
│   ├── SubTagSuggestions
│   ├── ActiveDimension
│   └── DimensionPromptInput
├── WidgetHero (hero zone)
├── PinGrid
│   ├── PinCard[] (draggable)
│   │   ├── PinImage
│   │   ├── PinOverlay
│   │   ├── CategoryBadge
│   │   ├── FormatBadge
│   │   ├── PinDetails (medium/large)
│   │   └── ResizeHandle
│   ├── WidgetInline[] (at scored positions)
│   └── LookbackCard
├── WidgetFooter (footer zone)
├── ListenPlayer (fixed bottom, conditional)
├── MobileAddBar (mobile only)
├── CapturePromo (conditional)
├── IosAppOverlay (iOS only)
├── ToastContainer
└── Modals
    ├── AddModal
    ├── ScanModal
    ├── PinDetailOverlay
    ├── CategoryModal
    ├── ContentTypeModal
    ├── MergeModal
    ├── CreateBoardModal
    ├── AuthModal
    ├── AccountModal
    ├── SettingsModal
    ├── ToolsModal
    ├── AdminPanel
    ├── ConfirmModal
    ├── IgReviewModal
    └── WidgetInspector (dev only)
```

### 7.2 File Structure

```
boards-app/
├── public/
│   └── sw.js                          (Workbox service worker)
├── src/
│   ├── api/                           (typed Supabase wrappers)
│   │   ├── pins.ts
│   │   ├── boards.ts
│   │   ├── sync.ts
│   │   ├── auth.ts
│   │   ├── enrichment.ts
│   │   ├── widgets.ts
│   │   ├── classify.ts
│   │   ├── subcategories.ts
│   │   ├── events.ts
│   │   ├── share.ts
│   │   └── instagram.ts
│   ├── components/
│   │   ├── ui/                        (design system wrappers)
│   │   │   ├── Button.tsx
│   │   │   ├── Card.tsx
│   │   │   ├── Input.tsx
│   │   │   ├── Modal.tsx
│   │   │   ├── Toast.tsx
│   │   │   ├── FilterToken.tsx
│   │   │   ├── Spinner.tsx
│   │   │   └── Toggle.tsx
│   │   ├── pins/
│   │   │   ├── PinGrid.tsx
│   │   │   ├── PinCard.tsx
│   │   │   ├── PinImage.tsx
│   │   │   ├── PinOverlay.tsx
│   │   │   ├── PinDetails.tsx
│   │   │   ├── MergedPinView.tsx
│   │   │   └── LookbackCard.tsx
│   │   ├── filters/
│   │   │   ├── FilterBar.tsx
│   │   │   ├── SubTagBar.tsx
│   │   │   └── SearchInput.tsx
│   │   ├── widgets/
│   │   │   ├── WidgetHero.tsx
│   │   │   ├── WidgetInline.tsx
│   │   │   ├── WidgetFooter.tsx
│   │   │   ├── WidgetHeader.tsx
│   │   │   └── templates/             (11 body templates)
│   │   ├── capture/
│   │   │   ├── AddModal.tsx
│   │   │   ├── ScanModal.tsx
│   │   │   ├── MobilePasteBar.tsx
│   │   │   └── PhotoUploadCapture.tsx
│   │   ├── modals/
│   │   │   ├── CategoryModal.tsx
│   │   │   ├── MergeModal.tsx
│   │   │   ├── ShareModal.tsx
│   │   │   ├── AuthModal.tsx
│   │   │   ├── AccountModal.tsx
│   │   │   ├── SettingsModal.tsx
│   │   │   └── AdminPanel.tsx
│   │   └── layout/
│   │       ├── ListenPlayer.tsx
│   │       ├── ListenView.tsx
│   │       ├── WatchView.tsx
│   │       └── BoardSeedPanel.tsx
│   ├── hooks/                         (custom React hooks)
│   │   ├── useAuth.ts
│   │   ├── useAddPin.ts
│   │   ├── useEnrichmentQueue.ts
│   │   ├── useClipboardMonitor.ts
│   │   ├── useDuplicateDetection.ts
│   │   ├── useSubtags.ts
│   │   ├── useWidgetScoring.ts
│   │   ├── useLookback.ts
│   │   ├── useSearch.ts
│   │   ├── useTheme.ts
│   │   ├── usePwaInstall.ts
│   │   ├── useOnboarding.ts
│   │   ├── useExport.ts
│   │   └── useToast.ts
│   ├── store/                         (Zustand stores)
│   │   ├── pinStore.ts
│   │   ├── boardStore.ts
│   │   ├── syncStore.ts
│   │   └── uiStore.ts
│   ├── lib/                           (pure functions, extractable)
│   │   ├── lookback.ts
│   │   ├── pinRanker.ts               (TF-IDF, extracted verbatim)
│   │   ├── sync.ts                    (merge algorithm)
│   │   ├── enrichmentQueue.ts
│   │   └── widgetScoring.ts
│   ├── config/
│   │   ├── richContent.ts
│   │   └── widgetRegistry.ts
│   ├── constants/
│   │   ├── categories.ts
│   │   └── contentTypes.ts
│   ├── types/
│   │   ├── pin.ts
│   │   ├── category.ts
│   │   ├── widget.ts
│   │   └── api.ts
│   ├── db/
│   │   └── schema.ts                  (Dexie schema)
│   ├── App.tsx
│   ├── main.tsx
│   └── routes.tsx
├── index.html
├── vite.config.ts
├── tsconfig.json
├── package.json
└── wrangler.toml                      (Cloudflare Pages config, if needed)
```

---

## 8. Data Layer

### 8.1 Core TypeScript Interfaces

```typescript
// src/types/pin.ts
export interface Pin {
  id: string;
  url: string;
  title: string;
  description: string | null;
  image: string | null;
  domain: string;
  category: BuiltinCategory | string;
  categoryConfidence: number;
  contentType: ContentType | null;
  typeConfidence: number | null;
  typeSignals: TypeSignal[] | null;
  imageSource: string | null;
  imageScores: ImageScores | null;
  addedAt: string;
  updatedAt: string | null;
  loading: boolean;
  enrichmentFailed: boolean;
  enrichmentError: string | null;
  video: VideoMetadata | null;
  music: MusicMetadata | null;
  book: BookMetadata | null;
  watched: boolean;
  read: boolean;
  lastInteractedAt: string | null;
  isMerged: boolean;
  sources: MergeSource[] | null;
  mergedAt: string | null;
  shortCode: string | null;
  notes: string | null;
  tags: string[];
  syncStatus: 'synced' | 'pending' | 'error';
}

export type BuiltinCategory =
  'home' | 'wear' | 'watch' | 'listen' | 'use' | 'eat' | 'go' | 'follow' | 'read';

export type ContentType =
  'product' | 'article' | 'book' | 'video' | 'music' | 'repository' |
  'social' | 'document' | 'tool' | 'unknown';

export type ExpansionState = 'default' | 'medium' | 'large';

export interface MusicMetadata {
  artist: string | null;
  trackTitle: string | null;
  albumTitle: string | null;
  genre: string | null;
  genreTags: string[];
  bpm: number | null;
  key: string | null;
  label: string | null;
  releaseDate: string | null;
  duration: number | null;
  contentFormat: 'track' | 'album' | 'playlist' | 'podcast-episode' | null;
  platform: string | null;
  platformId: string | null;
  embedUrl: string | null;
  embedType: 'iframe' | null;
  embedHeight: number | null;
  isExplicit: boolean;
}

export interface VideoMetadata {
  title: string | null;
  type: 'movie' | 'tv-show' | 'documentary' | 'short' | 'anime' | 'video' | 'trailer' | null;
  creator: string | null;
  year: number | null;
  runtime: number | null;
  genre: string | null;
  platform: string | null;
  platformId: string | null;
  rating: string | null;
  contentFormat: 'movie' | 'series' | 'episode' | 'clip' | 'trailer' | null;
  seriesInfo: { season: number; episode: number } | null;
}

export interface BookMetadata {
  author: string | null;
  isbn: string | null;
  publisher: string | null;
  publishDate: string | null;
  pages: number | null;
  genre: string | null;
}

export interface Category {
  slug: string;
  pinned: boolean;
  isUserBoard: boolean;
  displayName: string | null;
  prompt: string | null;
  createdAt: string | null;
}

export interface Widget {
  id: string;
  version: string;
  name: string;
  description: string;
  status: 'active' | 'beta' | 'draft';
  zone: 'hero' | 'inline' | 'footer';
  criteria: { minItems: number };
  prompt: string;
  template: { name: string; fallback: string };
}
```

### 8.2 Dexie Schema

```typescript
// src/db/schema.ts
import Dexie from 'dexie';

export const db = new Dexie('boards-v1');

db.version(1).stores({
  pins: 'id, url, category, contentType, addedAt, syncStatus',
  pinOrder: 'userId',
  expandedStates: 'pinId',
  boardMetadata: 'slug, userId',
  widgetCache: 'key, expiresAt',
  widgetPrefs: 'userId',
  dimensionFilters: '[category+id]',
  lookbackState: 'pinId, surfacedAt',
  domainProfiles: 'domain',
  syncQueue: '++id, operation, status, createdAt',
});
```

### 8.3 TanStack Query Keys

```typescript
// src/api/queryKeys.ts
export const queryKeys = {
  boardState: () => ['boardState'] as const,
  pins: () => ['pins'] as const,
  pin: (id: string) => ['pins', id] as const,
  widgets: (category: string, itemIds: string[]) => ['widgets', category, itemIds] as const,
  cleanup: () => ['cleanup'] as const,
  share: (code: string) => ['share', code] as const,
  events: (profile: object) => ['events', profile] as const,
  subtags: (category: string, action: string) => ['subtags', category, action] as const,
};
```

---

## 9. Migration Strategy

### Phase R1 — Foundation (Weeks 1-4)

**Goal:** React app running on Cloudflare Pages at `next.ctrl.rodeo`, loading real data from Supabase.

#### Epic R1.1: Build Infrastructure
- Initialize Vite + React 18 + TypeScript project
- Configure Cloudflare Pages deployment (connect repo, set build command)
- Set up `next.ctrl.rodeo` custom domain
- Import `design-system/tokens.css` and `design-system/components.css`
- Resolve token discrepancies (typography scale)

#### Epic R1.2: Data Foundation
- Implement Dexie schema (10 tables)
- Implement localStorage migration utility (reads 16+ legacy keys → Dexie)
- Unit tests for migration

#### Epic R1.3: Auth
- `useAuth` hook (signIn, signOut, session, currentUser)
- Copy iOS auth token capture script to `index.html`
- `AuthModal` component
- Add `next.ctrl.rodeo` to Supabase Auth allowed redirect URLs

#### Epic R1.4: Security Fixes (Backend)
- `fetch-metadata` edge function (eliminates CORS proxy)
- Extend `classify` edge function (eliminates client API key)
- `board-state` edge function (single-call bootstrap)
- Deploy all to Boards Supabase project

#### Epic R1.5: Pin Store + Basic Render
- `PinStore` (Zustand) + Dexie persistence
- `useSync` with TanStack Query
- Basic `PinGrid` — image-only cards from real data

**Success:** `next.ctrl.rodeo` shows the user's actual pins in a grid.

### Phase R2 — Core Display (Weeks 5-8)

**Goal:** Feature parity for read-only display.

- `PinCard` with all three expansion states
- `FilterBar` with categories, URL sync, search
- `SubTagBar` with suggest/create/assign modes
- `LookbackCard`
- `ListenView` and `ListenPlayer`
- `WatchView`
- Rich content overlays for all categories
- Widget zones (hero/inline/footer) with all 11 templates
- `CleanupView` route

**Success:** React app can browse and filter all pins identically to monolith.

### Phase R3 — Capture and CRUD (Weeks 9-12)

**Goal:** All capture and mutation operations. React becomes primary.

- `AddModal` with text input, multi-URL paste, duplicate detection
- `useEnrichmentQueue` (sequential, 3 retries, exponential backoff)
- All capture methods (clipboard, mobile bar, deep link, bookmarklet, extension)
- PWA Share Target + Workbox service worker
- `ScanModal` (photo/scan image)
- Drag-to-reorder and drag-to-merge with `@dnd-kit`
- Drag-to-resize
- `MergeModal`
- Category and content type selection
- Delete with confirmation
- `CreateBoardModal` and `BoardSeedPanel`
- Export

**Success:** All pin operations work. Monolith hidden behind feature flag.

### Phase R4 — Auth, Sharing, and Advanced (Weeks 13-16)

**Goal:** Full feature parity.

- Auth with magic link, countdowns, rate limiting
- Account management with username (fixed uniqueness)
- Settings, tools, bookmarklet coach
- Board sharing (create, visibility, live/snapshot)
- `SharedBoardView`
- `AdminPanel` with Supabase role guard
- Onboarding, capture promo
- iOS App redirect
- `IgReviewModal` for Instagram import

**Success:** Monolith deprecated. React app is production.

### Phase R5 — Hardening (Weeks 17-20)

**Goal:** Performance, testing, cutover.

- `useVirtualizer` for 1000+ pin grid
- Code splitting: lazy-load CleanupView, AdminPanel, WidgetInspector
- Unit test suite (all hooks, pure functions, store reducers)
- Integration tests (add pin flow, enrich pipeline, sync cycle)
- E2E tests (Playwright): capture → display → filter → delete
- Core Web Vitals audit
- Bundle size audit (target: <250KB gzipped initial load)
- **DNS cutover:** `ctrl.rodeo` points to Cloudflare Pages
- Monolith archived

---

## 10. Testing Strategy

### Unit Tests (Vitest)

100% coverage for all modules in `src/lib/`. Hook tests via `@testing-library/react-hooks`.

Priority targets:
- `src/lib/lookback.ts` — scoring algorithm, diversity selection
- `src/lib/sync.ts` — sync queue, retry logic, merge algorithm
- `src/lib/widgetScoring.ts` — `scoreWidgetFit()`, `profilePins()`
- `src/store/pinStore.ts` — all reducers
- `src/lib/enrichmentQueue.ts` — retry with exponential backoff

### Integration Tests (Vitest + MSW)

Mock Service Worker intercepts all network requests:
- Add pin → enrichment → categorization flow
- Auth state change → sync trigger → merge
- Widget generation → cache → render
- Offline → queue → reconnect → flush

### E2E Tests (Playwright)

Three critical user journeys:
1. **First-time user:** land → empty state → paste URL → pin appears → enrichment completes
2. **Power user:** filter → sub-tag → drag reorder → expand → open link
3. **Sync cycle:** add pin offline → reconnect → verify synced

---

## 11. Performance Requirements

### Core Web Vitals Targets

| Metric | Target | Current Monolith |
|--------|--------|-----------------|
| LCP | < 2.5s | ~4-6s |
| INP | < 200ms | Variable |
| CLS | < 0.1 | Variable |
| TTFB | < 600ms | Fast (CDN) |

### Bundle Size Targets

| Chunk | Target (gzipped) |
|-------|-------------------|
| Initial (app shell + auth) | < 80KB |
| Pin grid + cards | < 100KB |
| Widget system | < 40KB (lazy) |
| Cleanup view | < 20KB (lazy) |
| Admin panel | < 20KB (lazy) |
| **Total first load** | **< 250KB** |

### Runtime Performance

- 1000+ pin grid at 60fps via virtualization (`@tanstack/react-virtual`)
- Filter changes use `useTransition` — current view stays interactive during re-render
- Search input uses `useDeferredValue` — UI stays responsive
- Enrichment queue runs in background without blocking renders
- Widget generation debounced — only regenerates on category filter change

---

## 12. Risk Assessment

### Drag-and-Drop Complexity
**Risk:** Outer 60% = reorder, center 40% = merge zone. `@dnd-kit` doesn't support split personality drop targets by default.
**Mitigation:** Custom `CollisionDetection` algorithm that checks relative X position within target card. Test extensively on mobile touch events.

### Offline/Sync State Complexity
**Risk:** The merge algorithm handles 4 cases (local-only, cloud-only, locally-updated, cloud-updated). Reimplementing incorrectly could cause data loss.
**Mitigation:** Extract current algorithm verbatim to `src/lib/sync.ts` with no changes. Write comprehensive unit tests before any refactoring.

### Widget Template Fidelity
**Risk:** 11 widget templates currently rendered as HTML strings. Translating to JSX must maintain pixel-perfect output.
**Mitigation:** Visual regression tests that screenshot each template in both monolith and React, then diff.

### iOS Auth Token Capture
**Risk:** Head-level script must run before React mounts to capture auth token from URL hash.
**Mitigation:** Copy script verbatim into React app's `index.html` template. Not a React concern.

### Design System Token Drift
**Risk:** 70+ inline CSS variables partially overlap with `tokens.css`. Naive import will produce visual differences.
**Mitigation:** Token reconciliation audit before Phase R1. Update `tokens.css` to match monolith rendered values where they diverge.

### Monolith Maintenance During Migration
**Risk:** New features continue to be added to the monolith during the 20-week migration, creating moving parity target.
**Mitigation:** Feature flag to pause new monolith development during Phases R3+. New features built in React after parity.

### DNS Cutover
**Risk:** Moving `ctrl.rodeo` from GitHub Pages to Cloudflare Pages could cause brief downtime or SSL issues.
**Mitigation:** Use Cloudflare's zero-downtime domain migration. Test with `next.ctrl.rodeo` first. Keep GitHub Pages as fallback for 2 weeks post-cutover.

### Supabase Auth Redirect URLs
**Risk:** Magic link OTP redirects must include the new domain. Missing this breaks login.
**Mitigation:** Add `next.ctrl.rodeo` to Supabase Auth allowed redirect URLs in Phase R1 before any auth testing.

---

## Related Documents

- [Boards MVP PRD](./boards-mvp.md)
- [AI Widget System PRD](./ai-widgets.md)
- [Widget Design System PRD](./widget-design-system.md)
- [Lookback PRD](./lookback.md)
- [Instagram Import PRD](./instagram-import.md)
- [Design System README](../../../design-system/README.md)
- [Database Schema](../../infrastructure/technical-design/database-schema.md)
- [Client Architecture](../../infrastructure/technical-design/client-architecture.md)
