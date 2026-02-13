# Phase 7: Platform Expansion

> Back to [Project Plan](./index.md)

---

## Epic 7.1: Quick Capture Tools

> Multi-platform tools for frictionless link capture across desktop and mobile

| Story | Tasks | Status |
|-------|-------|--------|
| **Mobile Quick-Add Bar** | | ✅ Complete |
| | - [x] Always-visible URL input bar on mobile (bottom, above nav) | ✅ Complete — `boards/index.html:1850-2022` |
| | - [x] "Paste" button with auto-detect and auto-submit | ✅ Complete — `boards/index.html:1898-1917` |
| | - [x] Auto-submit on paste event when URL detected | ✅ Complete — `boards/index.html:1918-1934` |
| | - [x] Deep link handler: `?add=URL` auto-processes links | ✅ Complete — `boards/index.html:1935-1952` |
| | - [x] Responsive styling with design tokens (monospace, uppercase) | ✅ Complete — `boards/index.html:1853-1897` |
| **Desktop Bookmarklet** | | ✅ Complete |
| | - [x] Drag-to-install bookmarklet in Tools modal | ✅ Complete — `boards/index.html:1697-1709` |
| | - [x] One-click capture redirects to `?add=<url>` | ✅ Complete — `boards/index.html:1697` |
| | - [x] Tools modal with bookmarklet + share link + PWA install | ✅ Complete — `boards/index.html:1665-1781` |
| | - [x] PWA install button shows status (available/installed/not available) | ✅ Complete — `boards/index.html:1710-1741` |
| **PWA Share Target** | | ✅ Complete |
| | - [x] Update manifest with share_target config | ✅ Complete — `images/icons/favicons/site.webmanifest` |
| | - [x] Create pwa-share.html landing page | ✅ Complete — `boards/pwa-share.html` |
| | - [x] Smart URL extraction (url param → text field fallback) | ✅ Complete — `boards/pwa-share.html:33-50` |
| | - [x] Service worker registration and offline support | ✅ Complete — `boards/sw.js`, `boards/index.html:166-172` |
| | - [x] Network-first caching strategy with precache | ✅ Complete — `boards/sw.js:8-47` |
| **Image Scanning** | | ✅ Complete |
| | - [x] Create scan-image edge function with Claude Vision API | ✅ Complete — `supabase/functions/scan-image/index.ts` |
| | - [x] Scan button in FAB menu with camera capture support | ✅ Complete — `boards/index.html:1606-1663` |
| | - [x] Scan results modal with item selection UI | ✅ Complete — `boards/index.html:1430-1522` |
| | - [x] Extract products, brands, URLs from images | ✅ Complete — `scan-image/index.ts:69-116` |
| | - [x] Validate and sanitize AI responses | ✅ Complete — `scan-image/index.ts:120-135` |
| | - [x] Integrate with processLinks() workflow | ✅ Complete — `boards/index.html:1580-1604` |

**Implementation Notes:**
- Mobile quick-add bar: 172 lines added to `boards/index.html` (commit `ed407de`)
- Bookmarklet + Tools modal: 171 lines added to `boards/index.html` (commit `b6ed1f1`)
- PWA Share Target: manifest update, new `pwa-share.html`, new `sw.js` (commit `44af7bd`)
- Image scanning: 309 lines in `boards/index.html`, 138 lines in new edge function (commit `08d9f5e`)
- All features use design system tokens: 10px monospace uppercase, black/white minimal aesthetic
- Deep linking works across all capture methods: bookmarklet, PWA share, mobile paste, QR codes

---

## Epic 7.2: Browser Extension

> This extension is later extended with **import capabilities** in [Phase 9 Epic 9.3: Browser Extension Import](./phase-9-bulk-import.md#epic-93-browser-extension-import-tier-2) — network interception for importing saves from Instagram, TikTok, and Twitter/X.

| Story | Tasks | Status |
|-------|-------|--------|
| **Chrome Extension** | | Pending |
| | "Save to Board" toolbar button | Pending |
| | Auto-extract page metadata | Pending |
| | Category selector popup | Pending |
| | Sync with logged-in account | Pending |
| **Firefox Extension** | | Pending |
| | Port from Chrome | Pending |

---

## Epic 7.3: Import/Export

> **Superseded** — Absorbed into [Phase 9: Bulk Import](./phase-9-bulk-import.md), which expands this from 6 tasks into a full cold-start solution covering structured file imports, platform data exports, AI-powered content extraction, onboarding flows, and bulk organization.

| Story | Tasks | Status |
|-------|-------|--------|
| **~~Import from Services~~** | | Superseded |
| | ~~Import modal UI~~ | Superseded → Epic 9.1 Import Progress UI |
| | ~~Pocket export format~~ | Superseded → Epic 9.2 Pocket |
| | ~~Instapaper export format~~ | Superseded → Epic 9.2 Instapaper |
| | ~~Raindrop.io export format~~ | Superseded → Epic 9.2 Raindrop.io |
| | ~~Browser bookmarks HTML~~ | Superseded → Epic 9.2 Browser Bookmarks |
| | ~~AI categorization on import~~ | Superseded → Epic 9.1 Bulk AI Categorization |

---

## Epic 7.4: Mobile App

| Story | Tasks | Status |
|-------|-------|--------|
| **App Foundation** | | Pending |
| | Choose framework (RN/Flutter/PWA) | Pending |
| | Supabase authentication | Pending |
| | Main board view | Pending |
| | Pull-to-refresh | Pending |
| | Offline caching | Pending |
| **Quick Save Shortcut** | | Pending |
| | iOS Share Extension | Pending |
| | Android Share Intent | Pending |
| | Quick category picker | Pending |
| | Haptic feedback | Pending |
| **Home Screen Widget** | | Pending |
| | iOS WidgetKit | Pending |
| | Android App Widgets | Pending |
| | Recent links display | Pending |
