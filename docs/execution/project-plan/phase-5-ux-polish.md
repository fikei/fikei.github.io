# Phase 5: User Experience Polish

> Back to [Project Plan](./index.md)

---

## Epic 5.1: Onboarding

| Story | Tasks | Status |
|-------|-------|--------|
| **Empty State Experience** | | Pending |
| | Welcome message with value prop | Pending |
| | "Add Your First Link" CTA | Pending |
| | Paste hint text | Pending |
| **First Pin Celebration** | | Complete |
| | Celebration animation | Complete |
| | Feature discovery tips | Complete |
| **Progressive Disclosure** | | Complete |
| | Unlock features at pin count thresholds | Complete |
| | AI widgets appear at 5+ pins | Complete |
| | Sharing suggestion at 10+ pins | Complete |
| **Onboarding Checklist** | | Pending |
| | Dismissible checklist widget | Pending |
| | Track completion in localStorage | Pending |
| | Progress bar | Pending |

---

## Epic 5.2: Settings & Preferences

| Story | Tasks | Status |
|-------|-------|--------|
| **Theme Settings** | | Complete |
| | Dark/Light/System toggle | Complete |
| | Persist in localStorage | Complete |
| **Widget Preferences** | | Pending |
| | Favorite/hide widgets | Pending |
| | Restore hidden widgets | Pending |
| **Data Management** | | Pending |
| | Export all data (JSON/CSV) | Pending |
| | Clear local cache | Pending |
| | Reset all settings | Pending |
| **Advanced Settings** | | Pending |
| | Debug mode toggle | Complete |
| | Admin panel shortcut display | Pending |

---

## Epic 5.3: Pin Annotations

| Story | Tasks | Status |
|-------|-------|--------|
| **Notes Field** | | Complete |
| | Add notes textarea to expanded card view | Complete |
| | Auto-save notes on input | Complete |
| | Include notes in search index | Complete |
| | Persist notes to database | Complete |

---

## Epic 5.4: Search & Navigation

| Story | Tasks | Status |
|-------|-------|--------|
| **Search Within Board** | | Pending |
| | Search input in header | Pending |
| | Client-side fuzzy search | Pending |
| | Search title, domain, description, category | Pending |
| | Highlight matches | Pending |
| | Clear with Escape | Pending |
| **Keyboard Navigation** | | In Progress |
| | Arrow keys - Navigate grid | Complete |
| | Enter/Space - Expand/collapse | Complete |
| | j/k - Navigate up/down | Pending |
| | o - Open link | Pending |
| | d - Delete (with confirm) | Pending |
| | / - Focus search | Pending |
| | ? - Show shortcuts modal | Pending |

---

## Epic 5.4A: Mobile & Touch Improvements

| Story | Tasks | Status |
|-------|-------|--------|
| **Touch Device Optimization** | | Complete |
| | Always show card overlay on touch devices (gradient + title) | Complete |
| | Fix logo detection false positives (path-segment matching) | Complete |
| **Embed Enhancements** | | Complete |
| | Dark mode for Spotify embeds (theme=0) | Complete |
| | Dark mode for SoundCloud embeds | Complete |
| **Paste Detection** | | Complete |
| | Dedup paste prompts for recently added URLs | Complete |
| **URL Cleanup** | | Complete |
| | Expand tracking param removal (fbclid, mc_cid, etc.) | Complete |
| **Widget Re-triggering** | | Complete |
| | Re-trigger widget generation on category change | Complete |

---

## Epic 5.4B: Menu & Modal Consolidation

| Story | Tasks | Status |
|-------|-------|--------|
| **Hamburger Menu Simplification** | | Complete |
| | Consolidate "Refresh Image" + "Rerun Enrichment" → "Refresh" | Complete |
| | Rename "Share Link" → "Share" | Complete |
| **Organize Modal** | | Complete |
| | Combine "Change Category" + "Change Content Type" in single modal | Complete |
| | Category + content type selector in unified UI | Complete |

---

## Epic 5.5: Grid Improvements

| Story | Tasks | Status |
|-------|-------|--------|
| **Smart Grid Expansion** | | Pending |
| | Store image dimensions | Pending |
| | Calculate aspect ratio | Pending |
| | Auto-suggest layout based on ratio | Pending |
| | Preserve manual override | Pending |
| **Grid Reflow** | | Pending |
| | Detect card resize | Pending |
| | Fill gaps algorithm | Pending |
| | Animate card movements | Pending |
| | Option to disable auto-reflow | Pending |
| **Image Carousel** | | Pending |
| | Fetch multiple images | Pending |
| | Carousel in expanded view | Pending |
| | Swipe/arrow navigation | Pending |
| **List View Alternative** | | Pending |
| | Toggle between grid and list view | Pending |
| | Dense list for quick scanning | Pending |
| | Card size options (small/medium/large) | Pending |
| **Sort Options** | | Pending |
| | Sort by date added | Pending |
| | Sort by name | Pending |
| | Sort by domain | Pending |

---

## Epic 5.6: Error Handling & User Feedback

| Story | Tasks | Status |
|-------|-------|--------|
| **Sync Error Handling** | | Complete |
| | User-facing toast on sync failures | Complete |
| | Retry queue for failed sync operations | Complete |
| **Widget Error Handling** | | Complete |
| | 10s timeout on widget generation | Complete |
| | "Tap to retry" UI for widget timeouts | Complete |
| | Error indicator on enrichment failures | Complete |
| | Tap error badge to see context and trigger refresh | Complete |
| **Toast Notifications** | | Complete |
| | aria-live announcements for screen readers | Complete |
| | Consistent toast styling with design system | Complete |

---

## Epic 5.7: Authentication Enhancements

| Story | Tasks | Status |
|-------|-------|--------|
| **Session Management** | | Pending |
| | View all active sessions | Pending |
| | Force logout everywhere | Pending |
| | Session expiry warning | Pending |
| **Social Login Expansion** | | Pending |
| | Apple OAuth | Pending |
| | GitHub OAuth | Pending |
| **Two-Factor Auth** | | Pending |
| | TOTP setup flow | Pending |
| | Recovery codes | Pending |
| **Account Management** | | Pending |
| | Email change flow | Pending |
| | Account deletion (GDPR) | Pending |
