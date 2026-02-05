# Unified Project Plan - Boards

> Single source of truth for all features, stories, and tasks.
> **Last Updated**: 2026-02-05

---

## How to Use This Document

- **Epics**: Major feature areas (collapsible sections)
- **Stories**: User-facing functionality with clear value
- **Tasks**: Specific implementation steps with checkboxes
- **Status**: ✅ Complete | 🔄 In Progress | ⏳ Pending | ❌ Blocked

---

## Table of Contents

1. [Phase 1: Foundation (SHIPPED)](#phase-1-foundation-shipped)
2. [Phase 2: Core Experience (SHIPPED)](#phase-2-core-experience-shipped)
3. [Phase 3: AI Intelligence (MOSTLY COMPLETE)](#phase-3-ai-intelligence-mostly-complete)
4. [Phase 4: Sharing & Collaboration (IN PROGRESS)](#phase-4-sharing--collaboration-in-progress)
5. [Phase 5: User Experience Polish](#phase-5-user-experience-polish)
6. [Phase 6: Performance & Scale](#phase-6-performance--scale)
7. [Phase 7: Platform Expansion](#phase-7-platform-expansion)
8. [Backlog: Future Considerations](#backlog-future-considerations)

---

## Phase 1: Foundation (SHIPPED)

### Epic 1.1: User Authentication ✅
**Released: 2025-12-10**

| Story | Tasks | Status |
|-------|-------|--------|
| **Email Authentication** | | ✅ |
| | Implement email/password signup | ✅ |
| | Magic link login flow | ✅ |
| | Session persistence | ✅ |
| **Social Login** | | ✅ |
| | Google OAuth integration | ✅ |
| | OAuth callback handling | ✅ |
| **Anonymous Access** | | ✅ |
| | Allow browsing without account | ✅ |
| | Local storage for anonymous users | ✅ |
| | Merge data on signup | ✅ |

### Epic 1.2: Core Link Management ✅
**Released: 2025-12-15**

| Story | Tasks | Status |
|-------|-------|--------|
| **Add Links** | | ✅ |
| | URL paste detection | ✅ |
| | Multi-link paste support | ✅ |
| | Duplicate URL detection | ✅ |
| | Auto-enrichment (title, description, image) | ✅ |
| **Manage Links** | | ✅ |
| | Edit link metadata | ✅ |
| | Delete with confirmation | ✅ |
| | Move between categories | ✅ |
| **Data Sync** | | ✅ |
| | Local storage persistence | ✅ |
| | Supabase cloud sync | ✅ |
| | Conflict resolution | ✅ |

### Epic 1.3: Grid Layout ✅
**Released: 2026-01-01**

| Story | Tasks | Status |
|-------|-------|--------|
| **Swiss Grid Design** | | ✅ |
| | Responsive grid system (2-5 columns) | ✅ |
| | Dark mode default | ✅ |
| | Light mode option | ✅ |
| | Mobile-optimized spacing | ✅ |
| **Card Expansion** | | ✅ |
| | Click to expand detail view | ✅ |
| | 2x2, 3x2, 3x3 expansion sizes | ✅ |
| | Grayscale → color on hover | ✅ |

---

## Phase 2: Core Experience (SHIPPED)

### Epic 2.1: Category System ✅
**Released: 2026-01-05**

| Story | Tasks | Status |
|-------|-------|--------|
| **Category Filter Bar** | | ✅ |
| | Display categories as filter tokens | ✅ |
| | Active state highlighting | ✅ |
| | "All" reset button | ✅ |
| | Sticky header behavior | ✅ |
| **Category Management** | | ✅ |
| | 8 default categories (home, wear, watch, use, eat, go, follow, read) | ✅ |
| | AI-suggested categorization | ✅ |
| | Manual category override | ✅ |

### Epic 2.2: Admin Panel ✅
**Released: 2026-01-08**

| Story | Tasks | Status |
|-------|-------|--------|
| **Admin Access Control** | | ✅ |
| | Define ADMIN_EMAILS constant | ✅ |
| | Implement isAdmin() check | ✅ |
| | Gate admin UI behind email check | ✅ |
| | Admin badge in user menu | ✅ |
| **Dev Tools Panel** | | ✅ |
| | Keyboard shortcut (Ctrl+Shift+A) | ✅ |
| | Content type statistics | ✅ |
| | Image strategy analytics | ✅ |
| | Cache management | ✅ |
| | Debug mode toggle | ✅ |

---

## Phase 3: AI Intelligence (MOSTLY COMPLETE)

### Epic 3.1: Content Type System ✅
**Released: 2026-01-15**

| Story | Tasks | Status |
|-------|-------|--------|
| **Rules-Based Classification (Client)** | | ✅ |
| | Define BUILTIN_TYPES with domains, patterns, keywords | ✅ |
| | Implement classifyByRules() | ✅ |
| | Domain profile cache (client-side) | ✅ |
| | Integrate into link add flow | ✅ |
| **AI Classification (Server)** | | ✅ |
| | Create enrich-link Edge Function | ✅ |
| | Anthropic classifier (claude-3-haiku) | ✅ |
| | Confidence threshold (0.7) | ✅ |
| | Parse JSON response | ✅ |
| **Dev Tools Integration** | | ✅ |
| | "Run AI Enrichment Pipeline" button | ✅ |
| | Progress toast during enrichment | ✅ |
| | Display content type in admin panel | ✅ |

| Story | Tasks | Status |
|-------|-------|--------|
| **Domain Profile Caching (Server)** | | ⏳ |
| | Create `domain_profiles` table | ⏳ |
| | Implement DomainProfileManager | ⏳ |
| | Cache single-type domains (30-day TTL) | ⏳ |
| | Skip API call for cached domains | ⏳ |
| **Classification Batching** | | ⏳ |
| | Implement classification queue | ⏳ |
| | Batch queue items (10-20 per call) | ⏳ |
| | Flush queue on timeout/size | ⏳ |

### Epic 3.2: Image Resolution Pipeline ✅
**Released: 2026-01-10**

| Story | Tasks | Status |
|-------|-------|--------|
| **Client-Side Resolution** | | ✅ |
| | imageQueue for background processing | ✅ |
| | Platform APIs (YouTube, Vimeo, GitHub) | ✅ |
| | Integrate into link add flow | ✅ |
| **Server-Side Resolution** | | ✅ |
| | OG image extraction (no CORS) | ✅ |
| | Unsplash API search | ✅ |
| | Image source tracking | ✅ |
| **Manual Override** | | ⏳ |
| | "Edit image" button on cards | ⏳ |
| | Re-fetch, search, upload options | ⏳ |

### Epic 3.3: AI Widget System ✅
**Released: 2026-02-03**

| Story | Tasks | Status |
|-------|-------|--------|
| **Complete the Look Widget** | | ✅ |
| | Widget registry architecture | ✅ |
| | 47+ brand integrations | ✅ |
| | Shopify JSON API integration | ✅ |
| | HTML scraping fallback | ✅ |
| | Client caching (5 min) | ✅ |
| | Server caching (Supabase) | ✅ |
| | Per-widget refresh | ✅ |
| | Widget feedback (basic) | ✅ |

| Story | Tasks | Status |
|-------|-------|--------|
| **Fix Product Images** | | ⏳ HIGH PRIORITY |
| | SERP API integration | ⏳ |
| | Bot protection bypass | ⏳ |
| | Image validation | ⏳ |
| **Style Definition Widget** | | ⏳ |
| | Extract style attributes from board | ⏳ |
| | Generate style summary | ⏳ |
| **Widget Instrumentation** | | ⏳ |
| | Track widget views | ⏳ |
| | Track product clicks | ⏳ |
| | Track saves to board | ⏳ |

---

## Phase 4: Sharing & Collaboration (IN PROGRESS)

### Epic 4.1: Basic Sharing ✅

| Story | Tasks | Status |
|-------|-------|--------|
| **Share Board Link** | | ✅ |
| | Share button in header | ✅ |
| | Visibility options (link-only, public) | ✅ |
| | Update mode (live, snapshot) | ✅ |
| | Copy share link | ✅ |
| **Shared Board View** | | ✅ |
| | Read-only shared view (share.html) | ✅ |
| | Save link to personal board | ✅ |
| | Category filtering on shared view | ✅ |

### Epic 4.2: Username System ⏳

| Story | Tasks | Status |
|-------|-------|--------|
| **Username Setup** | | ⏳ |
| | Add `username` column to profiles table | ⏳ |
| | Username input in Account modal | ✅ |
| | Validate username uniqueness | ⏳ |
| | Username setup flow on first share | ⏳ |
| **Display Username** | | ⏳ |
| | Show @username on shared boards | ⏳ |
| | Username edit in settings | ⏳ |

### Epic 4.3: Collaborative Boards 🔄

**Current Sprint Focus: 2026-02-04 to 2026-02-18**

| Story | Tasks | Status |
|-------|-------|--------|
| **Story 1: Board Switcher UI** | | 🔄 |
| | Add board switcher dropdown in header | 🔄 |
| | Display personal board with link count | ⏳ |
| | Display collaborative boards with member count | ⏳ |
| | "Create Collaborative Board" button | ⏳ |
| | "Join with Invite Link" button | ⏳ |
| | Store active board in URL param | ⏳ |
| | Persist last active board in localStorage | ⏳ |

| Story | Tasks | Status |
|-------|-------|--------|
| **Story 2: Create Collaborative Board** | | ⏳ |
| | Create `collab_boards` table with migration | ⏳ |
| | Create `collab_board_members` table | ⏳ |
| | Add RLS policies for board creation | ⏳ |
| | Build "Create Board" modal UI | ⏳ |
| | Board name and description inputs | ⏳ |
| | Default role selector (editor/viewer) | ⏳ |
| | Generate unique invite code | ⏳ |
| | Auto-add creator as owner | ⏳ |

| Story | Tasks | Status |
|-------|-------|--------|
| **Story 3: View Collaborative Board Links** | | ⏳ |
| | Create `collab_links` table | ⏳ |
| | Create `collab_link_order` table | ⏳ |
| | Add RLS policies for link viewing | ⏳ |
| | Modify getAllLinks() for active board | ⏳ |
| | Display contributor avatar on grid items | ⏳ |
| | Show "Added by [email]" in expanded view | ⏳ |

| Story | Tasks | Status |
|-------|-------|--------|
| **Story 4: Add Links to Collaborative Board** | | ⏳ |
| | Add RLS policies for link insertion | ⏳ |
| | Modify addLink() with added_by field | ⏳ |
| | Target collab_links table when on collab board | ⏳ |
| | Toast confirmation with board name | ⏳ |

| Story | Tasks | Status |
|-------|-------|--------|
| **Story 5: Invite Members via Email** | | ❌ |
| | Build members management modal | ⏳ |
| | Email input with "Send Invite" button | ⏳ |
| | Create invite record (pending status) | ⏳ |
| | Send magic link via Supabase/Resend | ❌ Needs Resend API |
| | Handle invite acceptance flow | ⏳ |

| Story | Tasks | Status |
|-------|-------|--------|
| **Story 6: Invite Members via Link** | | ⏳ |
| | Display invite link in members modal | ⏳ |
| | Copy button for invite link | ⏳ |
| | Role selector for invite link | ⏳ |
| | Create /boards/join/:inviteCode page | ⏳ |
| | Validate invite code and show preview | ⏳ |
| | Add user to board on "Join" click | ⏳ |

| Story | Tasks | Status |
|-------|-------|--------|
| **Story 7: Manage Member Roles** | | ⏳ |
| | Role dropdown for each member (owner only) | ⏳ |
| | "Remove" button (owner only) | ⏳ |
| | Role update API call | ⏳ |
| | Member removal API call | ⏳ |
| | Prevent owner self-removal | ⏳ |
| | Confirmation modal for removal | ⏳ |

| Story | Tasks | Status |
|-------|-------|--------|
| **Story 8: Real-time Link Updates** | | ⏳ |
| | Supabase Realtime subscription for collab_links | ⏳ |
| | Handle INSERT events (animate new link) | ⏳ |
| | Handle UPDATE events (refresh data) | ⏳ |
| | Handle DELETE events (animate removal) | ⏳ |
| | Fallback polling if Realtime disconnects | ⏳ |
| | "X is viewing" presence indicators (stretch) | ⏳ |

| Story | Tasks | Status |
|-------|-------|--------|
| **Story 9: Edit/Delete Collaborative Links** | | ⏳ |
| | RLS policies for updates/deletes | ⏳ |
| | Editors edit/delete own links | ⏳ |
| | Owners edit/delete any link | ⏳ |
| | Permission-based button visibility | ⏳ |
| | Sync changes via Realtime | ⏳ |

| Story | Tasks | Status |
|-------|-------|--------|
| **Story 10: Board Settings & Deletion** | | ⏳ |
| | Settings modal for board owners | ⏳ |
| | Board rename | ⏳ |
| | Description update | ⏳ |
| | Default role change | ⏳ |
| | Board deletion with confirmation | ⏳ |
| | Cascade delete links and members | ⏳ |

---

## Phase 5: User Experience Polish

### Epic 5.1: Onboarding 🔄

| Story | Tasks | Status |
|-------|-------|--------|
| **Empty State Experience** | | ✅ |
| | Welcome message with value prop | ✅ |
| | "Add Your First Link" CTA | ✅ |
| | Paste hint text | ✅ |
| **First Pin Celebration** | | ⏳ |
| | Celebration animation | ⏳ |
| | Feature discovery tips | ⏳ |
| **Progressive Disclosure** | | ⏳ |
| | Unlock features at pin count thresholds | ⏳ |
| | AI widgets appear at 5+ pins | ⏳ |
| | Sharing suggestion at 10+ pins | ⏳ |
| **Onboarding Checklist** | | ⏳ |
| | Dismissible checklist widget | ⏳ |
| | Track completion in localStorage | ⏳ |
| | Progress bar | ⏳ |

### Epic 5.2: Settings & Preferences ⏳

| Story | Tasks | Status |
|-------|-------|--------|
| **Theme Settings** | | ✅ |
| | Dark/Light/System toggle | ✅ |
| | Persist in localStorage | ✅ |
| **Widget Preferences** | | ⏳ |
| | Favorite/hide widgets | ⏳ |
| | Restore hidden widgets | ⏳ |
| **Data Management** | | 🔄 |
| | Export all data (JSON/CSV) | ✅ |
| | Clear local cache | ⏳ |
| | Reset all settings | ⏳ |
| **Advanced Settings** | | ⏳ |
| | Debug mode toggle | ✅ |
| | Admin panel shortcut display | ⏳ |

### Epic 5.3: Search & Navigation 🔄

| Story | Tasks | Status |
|-------|-------|--------|
| **Search Within Board** | | ✅ |
| | Search input in header | ✅ |
| | Client-side fuzzy search | ✅ |
| | Search title, domain, description, category | ✅ |
| | Highlight matches | ⏳ |
| | Clear with Escape | ✅ |
| **Keyboard Navigation** | | ⏳ |
| | j/k - Navigate up/down | ⏳ |
| | e - Expand/collapse | ⏳ |
| | o - Open link | ⏳ |
| | d - Delete (with confirm) | ⏳ |
| | / - Focus search | ⏳ |
| | ? - Show shortcuts modal | ⏳ |

### Epic 5.4: Grid Improvements 🔄

| Story | Tasks | Status |
|-------|-------|--------|
| **Smart Grid Expansion** | | ⏳ |
| | Store image dimensions | ⏳ |
| | Calculate aspect ratio | ⏳ |
| | Auto-suggest layout based on ratio | ⏳ |
| | Preserve manual override | ⏳ |
| **Grid Reflow** | | ✅ |
| | Detect card resize | ✅ |
| | Fill gaps algorithm (CSS grid-auto-flow: dense) | ✅ |
| | Prioritize grid flow setting (reorder expanded cards) | ✅ |
| | Animate card movements | ⏳ |
| **Image Carousel** | | ⏳ |
| | Fetch multiple images | ⏳ |
| | Carousel in expanded view | ⏳ |
| | Swipe/arrow navigation | ⏳ |
| **List View Alternative** | | ⏳ |
| | Toggle between grid and list view | ⏳ |
| | Dense list for quick scanning | ⏳ |
| | Card size options (small/medium/large) | ⏳ |
| **Sort Options** | | ⏳ |
| | Sort by date added | ⏳ |
| | Sort by name | ⏳ |
| | Sort by domain | ⏳ |

### Epic 5.5: Authentication Enhancements ⏳

| Story | Tasks | Status |
|-------|-------|--------|
| **Session Management** | | ⏳ |
| | View all active sessions | ⏳ |
| | Force logout everywhere | ⏳ |
| | Session expiry warning | ⏳ |
| **Social Login Expansion** | | ⏳ |
| | Apple OAuth | ⏳ |
| | GitHub OAuth | ⏳ |
| **Two-Factor Auth** | | ⏳ |
| | TOTP setup flow | ⏳ |
| | Recovery codes | ⏳ |
| **Account Management** | | ⏳ |
| | Email change flow | ⏳ |
| | Account deletion (GDPR) | ⏳ |

---

## Phase 6: Performance & Scale

### Epic 6.1: Performance Optimization ⏳

| Story | Tasks | Status |
|-------|-------|--------|
| **Virtual Scrolling** | | ⏳ |
| | Implement for 500+ links | ⏳ |
| | Only render visible items | ⏳ |
| | Maintain scroll position on filter | ⏳ |
| | Handle expanded cards | ⏳ |
| **Lazy Loading** | | ✅ |
| | Images with loading="lazy" | ✅ |
| | Defer non-critical scripts | ⏳ |

### Epic 6.2: Offline Support ⏳

| Story | Tasks | Status |
|-------|-------|--------|
| **Service Worker** | | ⏳ |
| | Cache static assets | ⏳ |
| | Cache board data in IndexedDB | ⏳ |
| | Offline indicator | ⏳ |
| | Queue mutations for sync | ⏳ |

---

## Phase 7: Platform Expansion

### Epic 7.1: Browser Extension ⏳

| Story | Tasks | Status |
|-------|-------|--------|
| **Chrome Extension** | | ⏳ |
| | "Save to Board" toolbar button | ⏳ |
| | Auto-extract page metadata | ⏳ |
| | Category selector popup | ⏳ |
| | Sync with logged-in account | ⏳ |
| **Firefox Extension** | | ⏳ |
| | Port from Chrome | ⏳ |

### Epic 7.2: Import/Export ⏳

| Story | Tasks | Status |
|-------|-------|--------|
| **Import from Services** | | ⏳ |
| | Import modal UI | ⏳ |
| | Pocket export format | ⏳ |
| | Instapaper export format | ⏳ |
| | Raindrop.io export format | ⏳ |
| | Browser bookmarks HTML | ⏳ |
| | AI categorization on import | ⏳ |

### Epic 7.3: Mobile App ⏳

| Story | Tasks | Status |
|-------|-------|--------|
| **App Foundation** | | ⏳ |
| | Choose framework (RN/Flutter/PWA) | ⏳ |
| | Supabase authentication | ⏳ |
| | Main board view | ⏳ |
| | Pull-to-refresh | ⏳ |
| | Offline caching | ⏳ |
| **Quick Save Shortcut** | | ⏳ |
| | iOS Share Extension | ⏳ |
| | Android Share Intent | ⏳ |
| | Quick category picker | ⏳ |
| | Haptic feedback | ⏳ |
| **Home Screen Widget** | | ⏳ |
| | iOS WidgetKit | ⏳ |
| | Android App Widgets | ⏳ |
| | Recent links display | ⏳ |

---

## Backlog: Future Considerations

### Rich Media Support ⏳

| Story | Status |
|-------|--------|
| Video links (YouTube, Vimeo) - thumbnails, duration, inline preview | ⏳ |
| Music links (Spotify, SoundCloud) - album art, artist info, audio preview | ⏳ |
| Direct image upload to Supabase Storage | ⏳ |
| Direct video upload with compression | ⏳ |

### Advanced AI Features ⏳

| Story | Status |
|-------|--------|
| Multi-type domain learning | ⏳ |
| Path pattern learning for complex domains | ⏳ |
| Type discovery pipeline (clustering + AI analysis) | ⏳ |
| AI image generation for missing thumbnails | ⏳ |
| User-customizable AI prompts | ⏳ |

### Admin Enhancements ⏳

| Story | Status |
|-------|--------|
| Content type management (add/edit types) | ⏳ |
| Visual guidelines management | ⏳ |
| System metrics dashboard | ⏳ |
| Scraping health monitor | ⏳ |
| Widget A/B testing framework | ⏳ |

### Sharing Enhancements ⏳

| Story | Status |
|-------|--------|
| Board fork/copy | ⏳ |
| Persistent saved link state | ⏳ |
| Advanced analytics (clicks, saves, trends) | ⏳ |
| Custom share URLs (ctrl.rodeo/b/my-board) | ⏳ |
| QR code sharing | ⏳ |
| Embed widget for websites | ⏳ |
| Comment system on shared boards | ⏳ |
| Pin suggestions from viewers | ⏳ |
| Follow boards (notifications) | ⏳ |
| Board marketplace/discovery | ⏳ |

### Internationalization ⏳

| Story | Status |
|-------|--------|
| Language selection in settings | ⏳ |
| RTL support | ⏳ |
| Date/time localization | ⏳ |

### Accessibility ⏳

| Story | Status |
|-------|--------|
| High contrast mode | ⏳ |
| Reduced motion option | ⏳ |
| Screen reader optimization | ⏳ |
| Focus indicators | ⏳ |

---

## Summary Statistics

| Category | Complete | In Progress | Pending | Blocked |
|----------|----------|-------------|---------|---------|
| Phase 1: Foundation | 18 | 0 | 0 | 0 |
| Phase 2: Core Experience | 12 | 0 | 0 | 0 |
| Phase 3: AI Intelligence | 28 | 0 | 12 | 0 |
| Phase 4: Sharing & Collaboration | 8 | 8 | 52 | 2 |
| Phase 5: UX Polish | 13 | 0 | 42 | 0 |
| Phase 6: Performance | 1 | 0 | 9 | 0 |
| Phase 7: Platform Expansion | 0 | 0 | 22 | 0 |
| Backlog | 0 | 0 | 30 | 0 |
| **TOTAL** | **80** | **8** | **167** | **2** |

---

## Blocked Items

| Item | Blocker | Owner |
|------|---------|-------|
| Email invitations for collaborative boards | Resend API setup required | Human |
| Push notifications | FCM/APNs setup required | Human |

---

## Needs Decision

| Item | Options | Impact |
|------|---------|--------|
| Collaborative pricing model | Free vs premium tiers | Revenue, feature gating |
| Mobile app platform | iOS first vs cross-platform | Development timeline |
| Analytics provider | Privacy-friendly options | User trust, compliance |

---

*This document consolidates: BACKLOG.md, PROJECT-STATUS.md, sprint.md, shipped.md, and all docs/execution/ plans.*
