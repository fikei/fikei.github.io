# Boards - Product Backlog

---

## Epic: Collaborative Boards
> Allow multiple users to contribute links to a shared board with role-based permissions.
> **PRD:** [docs/PRD-collaborative-boards.md](docs/PRD-collaborative-boards.md)

### Story 1: Board Switcher UI
> As a user, I want to switch between my personal board and collaborative boards I'm a member of.

**Tasks:**
- [ ] Add board switcher dropdown component in header
- [ ] Display personal board with link count
- [ ] Display collaborative boards with member count and last active time
- [ ] Add "Create Collaborative Board" button
- [ ] Add "Join with Invite Link" button
- [ ] Store active board in URL param (`?board=uuid`)
- [ ] Persist last active board in localStorage

### Story 2: Create Collaborative Board
> As a user, I want to create a new collaborative board and configure its settings.

**Tasks:**
- [ ] Create `collab_boards` table with migration
- [ ] Create `collab_board_members` table with migration
- [ ] Add RLS policies for board creation
- [ ] Build "Create Board" modal UI
- [ ] Implement board name and description inputs
- [ ] Add default role selector (editor/viewer)
- [ ] Generate unique invite code on creation
- [ ] Auto-add creator as owner in members table

### Story 3: View Collaborative Board Links
> As a board member, I want to view all links in a collaborative board.

**Tasks:**
- [ ] Create `collab_links` table with migration
- [ ] Create `collab_link_order` table with migration
- [ ] Add RLS policies for link viewing
- [ ] Modify `getAllLinks()` to check `activeBoard` state
- [ ] Fetch links from `collab_links` when viewing collab board
- [ ] Display contributor avatar/initial on grid items
- [ ] Show "Added by [email]" in expanded card view

### Story 4: Add Links to Collaborative Board
> As an editor, I want to add links to a collaborative board I have edit access to.

**Tasks:**
- [ ] Add RLS policies for link insertion (editors only)
- [ ] Modify `addLink()` to include `added_by` field
- [ ] Modify `addLink()` to target `collab_links` table when on collab board
- [ ] Update link order in `collab_link_order` table
- [ ] Show toast confirmation with board name

### Story 5: Invite Members via Email
> As a board owner/editor, I want to invite others to join my collaborative board via email.

**Tasks:**
- [ ] Build members management modal UI
- [ ] Add email input with "Send Invite" button
- [ ] Create invite record in `collab_board_members` (pending status)
- [ ] Send magic link email via Supabase/Resend
- [ ] Handle invite acceptance flow
- [ ] Update member status to joined on acceptance

### Story 6: Invite Members via Link
> As a board owner/editor, I want to share an invite link that others can use to join.

**Tasks:**
- [ ] Display invite link in members modal
- [ ] Add copy button for invite link
- [ ] Add role selector for invite link (editor/viewer)
- [ ] Create `/boards/join/:inviteCode` page
- [ ] Validate invite code and show board preview
- [ ] Add user to board on "Join" click
- [ ] Handle already-a-member case

### Story 7: Manage Member Roles
> As a board owner, I want to change member roles or remove members.

**Tasks:**
- [ ] Add role dropdown for each member (owner only)
- [ ] Add "Remove" button for each member (owner only)
- [ ] Implement role update API call
- [ ] Implement member removal API call
- [ ] Prevent owner from removing themselves
- [ ] Show confirmation modal for removal

### Story 8: Real-time Link Updates
> As a board member, I want to see new links appear in real-time when others add them.

**Tasks:**
- [ ] Set up Supabase Realtime subscription for `collab_links`
- [ ] Handle INSERT events - animate new link into grid
- [ ] Handle UPDATE events - refresh link data
- [ ] Handle DELETE events - animate link removal
- [ ] Add fallback polling if Realtime disconnects
- [ ] Show "X is viewing" presence indicators (stretch)

### Story 9: Edit/Delete Collaborative Links
> As an editor, I want to edit or delete links I added, and as an owner, I want to edit or delete any link.

**Tasks:**
- [ ] Add RLS policies for link updates/deletes
- [ ] Allow editors to edit/delete their own links
- [ ] Allow owners to edit/delete any link
- [ ] Show edit/delete buttons based on permissions
- [ ] Sync changes via Realtime to other viewers

### Story 10: Board Settings & Deletion
> As a board owner, I want to rename, configure, or delete my collaborative board.

**Tasks:**
- [ ] Add settings modal for board owners
- [ ] Implement board rename
- [ ] Implement description update
- [ ] Implement default role change
- [ ] Implement board deletion with confirmation
- [ ] Cascade delete all links and members on board deletion

---

## Epic: AI Categorization Improvements

### Story: Refine New vs Existing Category Logic
> As a user, I want AI to better decide when to create a new category vs use an existing one.

**Tasks:**
- [ ] Analyze current category creation frequency
- [ ] Implement semantic similarity check against existing categories
- [ ] Add category count threshold (suggest merge if too many)
- [ ] Add user prompt for ambiguous cases
- [ ] Consider domain-based category hints
- [ ] Add "Suggest category merge" in dev menu

---

## Epic: Enhanced Sharing

### Story: Username System
> As a user, I want to display @username instead of my email on shared boards.

**Tasks:**
- [ ] Add `username` column to users/profiles table
- [ ] Build username setup flow on first share
- [ ] Validate username uniqueness
- [ ] Update shared board display to use username
- [ ] Add username edit in settings

### Story: Fix Pending Saves Not Syncing ✓ COMPLETE
> As a viewer, I want links saved from shared boards to appear on my board immediately (before login too).

**Solution implemented:**
- For anonymous users: `processPendingSaves()` called BEFORE initial render
- For logged-in users: called AFTER cloud sync to avoid overwriting
- Only syncs to Supabase when `currentUser` exists

**Tasks:**
- [x] Call `processPendingSaves()` in init() for anonymous users before render
- [x] Skip Supabase sync when not logged in
- [x] Verify link structure matches: share.html stores `created_at`, index.html converts to `addedAt`
- [x] On login, sync pending saves that were added to local state to Supabase

### Story: Persistent Saved Link State
> As a viewer, I want to see which links I've already saved when I revisit a shared board.

**Tasks:**
- [ ] Store saved link IDs in localStorage per shared board
- [ ] Show "View on Board" button for already-saved links on page load
- [ ] Handle pending saves (not yet synced) in saved state
- [ ] Clear saved state when link is deleted from personal board

### Story: Board Fork/Copy
> As a viewer, I want to copy an entire shared board to my personal board.

**Tasks:**
- [ ] Add "Fork to My Board" button on shared view
- [ ] Copy all links to user's personal board
- [ ] Preserve categories and metadata
- [ ] Show progress for large boards
- [ ] Add attribution note (optional)

### Story: Advanced Analytics
> As a board owner, I want to see detailed analytics about my shared board.

**Tasks:**
- [ ] Track link clicks (outbound)
- [ ] Track link saves (to other boards)
- [ ] Build analytics dashboard modal
- [ ] Show popular links ranking
- [ ] Show view trends over time

---

## Epic: UI/UX Improvements

### Story: Image Carousel
> As a user, I want to see multiple images in expanded card view.

**Tasks:**
- [ ] Fetch multiple images during link metadata extraction
- [ ] Store image array in link data
- [ ] Build carousel component for expanded view
- [ ] Add swipe/arrow navigation
- [ ] Add image counter indicator

### Story: Keyboard Navigation
> As a power user, I want to navigate my board using keyboard shortcuts.

**Tasks:**
- [ ] `j`/`k` - Navigate up/down in grid
- [ ] `e` - Expand/collapse selected card
- [ ] `o` - Open selected link
- [ ] `d` - Delete selected link (with confirm)
- [ ] `/` - Focus search
- [ ] `?` - Show keyboard shortcuts modal

### Story: Search Within Board
> As a user, I want to search for links within my board.

**Tasks:**
- [ ] Add search input in header
- [ ] Implement client-side fuzzy search
- [ ] Search title, domain, description, category
- [ ] Highlight matches in results
- [ ] Clear search with Escape key

---

## Epic: Performance

### Story: Virtual Scrolling
> As a user with many links, I want smooth scrolling performance.

**Tasks:**
- [ ] Implement virtual scrolling for 500+ links
- [ ] Only render visible grid items
- [ ] Maintain scroll position on filter change
- [ ] Handle expanded cards in virtual list

### Story: Offline Support
> As a user, I want to view my board offline.

**Tasks:**
- [ ] Add service worker for caching
- [ ] Cache board data in IndexedDB
- [ ] Show offline indicator
- [ ] Queue mutations for sync when online

---

## Epic: Integrations

### Story: Browser Extension
> As a user, I want to save links with one click from any webpage.

**Tasks:**
- [ ] Build Chrome/Firefox extension
- [ ] Add "Save to Board" button in toolbar
- [ ] Auto-extract page metadata
- [ ] Show category selector popup
- [ ] Sync with logged-in account

### Story: Import from Other Services
> As a new user, I want to import my existing bookmarks.

**Tasks:**
- [ ] Build import modal UI
- [ ] Support Pocket export format
- [ ] Support Instapaper export format
- [ ] Support Raindrop.io export format
- [ ] Support browser bookmarks HTML export
- [ ] Run AI categorization on imported links

---

## Epic: Rich Media Support

### Story: Video Support
> As a user, I want to save and preview video links on my board.

**Tasks:**
- [ ] Detect video URLs (YouTube, Vimeo, etc.)
- [ ] Extract video thumbnails and metadata
- [ ] Show video duration on grid item
- [ ] Inline video preview in expanded card
- [ ] Handle video embed permissions

### Story: Music Support
> As a user, I want to save and preview music links on my board.

**Tasks:**
- [ ] Detect music URLs (Spotify, SoundCloud, Apple Music, etc.)
- [ ] Extract album art and track metadata
- [ ] Show artist/track info on grid item
- [ ] Inline audio preview in expanded card (where API permits)
- [ ] Handle music embed permissions

### Story: Direct Image Upload
> As a user, I want to upload images directly to my board.

**Tasks:**
- [ ] Add image upload button/dropzone
- [ ] Upload to Supabase Storage
- [ ] Generate thumbnail for grid display
- [ ] Support drag-and-drop upload
- [ ] Handle image compression/optimization
- [ ] Set storage limits per user

### Story: Direct Video Upload
> As a user, I want to upload videos directly to my board.

**Tasks:**
- [ ] Add video upload button/dropzone
- [ ] Upload to Supabase Storage (or external provider)
- [ ] Generate video thumbnail
- [ ] Support common video formats (mp4, webm, mov)
- [ ] Handle video compression
- [ ] Set storage/size limits per user
- [ ] Show upload progress

---

## Epic: Content Type System

> Detect, classify, and evolve content types for links.
> **PRD:** [docs/PRD-content-type-and-image-systems.md](docs/PRD-content-type-and-image-systems.md)
> **Tech Spec:** [docs/TECH-content-type-and-image-systems.md](docs/TECH-content-type-and-image-systems.md)

### Phase 1: Detection

#### Story: Content Type Classification
> As a system, I want to detect what type of content a link represents.

**Tasks:**
- [ ] Create `content_types` table with builtin types (product, article, video, music, repository, social, document, tool, unknown)
- [ ] Add `content_type` field to links table
- [ ] Implement ContentClassifier interface (provider-agnostic)
- [ ] Implement AnthropicClassifier provider
- [ ] Implement OpenAIClassifier provider (backup)
- [ ] Build classification prompt with type definitions
- [ ] Add confidence threshold handling (0.7)
- [ ] Return type + confidence + signals from classifier

#### Story: Domain Profile Caching
> As a system, I want to cache domain classifications to reduce API costs.

**Tasks:**
- [ ] Create `domain_profiles` table
- [ ] Implement DomainProfileManager
- [ ] Cache single-type domains at domain level
- [ ] Set appropriate TTLs (30 days for known, 7 days for unknown)
- [ ] Add cache hit/miss logging
- [ ] Skip API call for cached domains

#### Story: Classification Batching
> As a system, I want to batch API calls for cost efficiency.

**Tasks:**
- [ ] Implement classification queue
- [ ] Batch queue items (10-20 per call)
- [ ] Build batch classification prompt
- [ ] Parse batch responses
- [ ] Flush queue on timeout (1s) or size threshold

### Phase 2: Multi-Type Domains

#### Story: Domain Type Learning
> As a system, I want to learn which domains have multiple content types.

**Tasks:**
- [ ] Track types_seen per domain in domain_profiles
- [ ] Detect multi-type domains after 5+ samples
- [ ] Mark domain as single_type or multi_type
- [ ] Calculate confidence based on type distribution

#### Story: Path Pattern Learning
> As a system, I want to learn URL patterns for multi-type domains.

**Tasks:**
- [ ] Store path samples for multi-type domains
- [ ] AI-analyze path patterns periodically (every 10 samples)
- [ ] Extract regex patterns (e.g., ^/blog/, ^/products?/)
- [ ] Cache at path-pattern level
- [ ] Handle new paths with API fallback

### Phase 3: Evolution

#### Story: Uncertain Classification Tracking
> As a system, I want to track low-confidence classifications for analysis.

**Tasks:**
- [ ] Create `classification_log` table
- [ ] Store uncertain classifications (confidence < 0.7)
- [ ] Include URL, title, description, predicted type
- [ ] Generate embeddings for clustering

#### Story: Type Discovery Pipeline
> As a system, I want to automatically discover new content types.

**Tasks:**
- [ ] Implement weekly clustering job
- [ ] Cluster uncertain items by embedding similarity
- [ ] AI-analyze clusters (min 10 items) for new types
- [ ] Generate type proposal with name, definition, signals
- [ ] Validate proposals on holdout set (>80% accuracy)

#### Story: Type Promotion
> As an admin, I want to review and promote discovered content types.

**Tasks:**
- [ ] Build type proposal review UI
- [ ] Show cluster samples and AI analysis
- [ ] Approve/reject/edit proposals
- [ ] Auto-promote high-confidence types (>0.9, >100 samples)
- [ ] Notify admin of new discoveries

---

## Epic: Image Resolution System

> Resolve, generate, and improve images for links based on content type.
> **PRD:** [docs/PRD-content-type-and-image-systems.md](docs/PRD-content-type-and-image-systems.md)
> **Tech Spec:** [docs/TECH-content-type-and-image-systems.md](docs/TECH-content-type-and-image-systems.md)

### Phase 1: Resolution Pipeline

#### Story: Image Strategy Registry
> As a system, I want to define image resolution strategies per content type.

**Tasks:**
- [ ] Create `image_strategies` table
- [ ] Define pipeline for each builtin type
- [ ] Store as ordered list of approaches with configs
- [ ] Add image_source field to links table (scraped, searched, generated, uploaded, platform_api)

#### Story: Image Resolver
> As a system, I want to resolve images using type-specific strategies.

**Tasks:**
- [ ] Implement ImageResolver interface
- [ ] Implement scrape method (re-fetch OG image, headless option)
- [ ] Implement search method (Unsplash API)
- [ ] Implement platform_api method (YouTube, Spotify, GitHub)
- [ ] Implement template method (styled text cards)
- [ ] Execute pipeline in order, stop on first success

#### Story: Background Processing
> As a system, I want to resolve images without blocking link addition.

**Tasks:**
- [ ] Implement client-side image queue
- [ ] Show placeholder immediately on add
- [ ] Process queue in background
- [ ] Fade in resolved images with CSS transition
- [ ] Handle resolution failures gracefully
- [ ] Add retry logic with exponential backoff

### Phase 2: Generation & Override

#### Story: AI Image Generation
> As a system, I want to generate images when other methods fail.

**Tasks:**
- [ ] Integrate DALL-E or Stable Diffusion API
- [ ] Build generation prompts from content type + title + description
- [ ] Apply visual guidelines to prompts
- [ ] Store generated images in Supabase Storage
- [ ] Add generation as final pipeline step for appropriate types

#### Story: Manual Image Override
> As a user, I want to replace any auto-selected image.

**Tasks:**
- [ ] Add "Edit image" button to link cards
- [ ] Build image edit modal UI
- [ ] Option: Re-fetch from URL
- [ ] Option: Search for image (keyword input)
- [ ] Option: Generate with AI
- [ ] Option: Upload custom image
- [ ] Save override and mark source as 'uploaded'

### Phase 3: Improvement

#### Story: Strategy Performance Tracking
> As a system, I want to track which image strategies work well.

**Tasks:**
- [ ] Create `strategy_performance` table
- [ ] Track manual override rate per type/strategy
- [ ] Track image load success rate
- [ ] Track resolution time percentiles
- [ ] Build admin dashboard for metrics

#### Story: Strategy Auto-Improvement
> As a system, I want to improve strategies based on user behavior.

**Tasks:**
- [ ] Track what users replace images with
- [ ] Analyze override patterns by content type
- [ ] AI-propose strategy improvements
- [ ] Implement A/B testing framework
- [ ] Promote winning strategies automatically

### Future: Visual Personalization (Backlog)

#### Story: Global Visual Guidelines (Admin)
> As an admin, I want to define system-wide visual style parameters.

**Tasks:**
- [ ] Create visual_guidelines config table
- [ ] Define aesthetic (description, references, mood tags)
- [ ] Define color system (mode, backgrounds, text, accent strategy)
- [ ] Define imagery preferences (type, density, color treatment)
- [ ] Define guardrails (hard rules, banned patterns)
- [ ] Build admin UI for guideline management
- [ ] Apply guidelines to all AI generation prompts

#### Story: User Visual Style Profiles
> As a user, I want to define my own visual aesthetic for my board.

**Tasks:**
- [ ] Build style definition UI (links, images, copy inputs)
- [ ] AI-extract style attributes from inputs
- [ ] Generate style preview with sample cards
- [ ] Apply user style to image generation prompts
- [ ] Allow style refinement through feedback

#### Story: Per-Board Style Customization
> As a user, I want different boards to have different visual styles.

**Tasks:**
- [ ] Add style_mode to boards (system/user_default/custom)
- [ ] Allow style overrides per board
- [ ] Style inheritance hierarchy (item > board > user > system)

---

## Epic: Generative UI

### Story: Generative UI Widgets v1
> As a user, I want dynamic AI-generated UI elements on my board.

**Tasks:**
- [ ] Define widget types (summary, chart, preview, action)
- [ ] AI-generated link summaries in expanded view
- [ ] Smart category suggestions widget
- [ ] Related links widget
- [ ] Quick actions based on link type
- [ ] Widget customization options
