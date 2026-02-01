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
