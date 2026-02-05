# Phase 4: Sharing & Collaboration (IN PROGRESS)

> Back to [Project Plan](./index.md)

---

## Epic 4.1: Basic Sharing

| Story | Tasks | Status |
|-------|-------|--------|
| **Share Board Link** | | Complete |
| | Share button in header | Complete |
| | Visibility options (link-only, public) | Complete |
| | Update mode (live, snapshot) | Complete |
| | Copy share link | Complete |
| **Shared Board View** | | Complete |
| | Read-only shared view (share.html) | Complete |
| | Save link to personal board | Complete |
| | Category filtering on shared view | Complete |

---

## Epic 4.2: Username System

| Story | Tasks | Status |
|-------|-------|--------|
| **Username Setup** | | Pending |
| | Add `username` column to profiles table | Pending |
| | Username input in Account modal | Complete |
| | Validate username uniqueness | Pending |
| | Username setup flow on first share | Pending |
| **Display Username** | | Pending |
| | Show @username on shared boards | Pending |
| | Username edit in settings | Pending |

---

## Epic 4.3: Collaborative Boards

**Current Sprint Focus: 2026-02-04 to 2026-02-18**

| Story | Tasks | Status |
|-------|-------|--------|
| **Story 1: Board Switcher UI** | | In Progress |
| | Add board switcher dropdown in header | In Progress |
| | Display personal board with link count | Pending |
| | Display collaborative boards with member count | Pending |
| | "Create Collaborative Board" button | Pending |
| | "Join with Invite Link" button | Pending |
| | Store active board in URL param | Pending |
| | Persist last active board in localStorage | Pending |

| Story | Tasks | Status |
|-------|-------|--------|
| **Story 2: Create Collaborative Board** | | Pending |
| | Create `collab_boards` table with migration | Pending |
| | Create `collab_board_members` table | Pending |
| | Add RLS policies for board creation | Pending |
| | Build "Create Board" modal UI | Pending |
| | Board name and description inputs | Pending |
| | Default role selector (editor/viewer) | Pending |
| | Generate unique invite code | Pending |
| | Auto-add creator as owner | Pending |

| Story | Tasks | Status |
|-------|-------|--------|
| **Story 3: View Collaborative Board Links** | | Pending |
| | Create `collab_links` table | Pending |
| | Create `collab_link_order` table | Pending |
| | Add RLS policies for link viewing | Pending |
| | Modify getAllLinks() for active board | Pending |
| | Display contributor avatar on grid items | Pending |
| | Show "Added by [email]" in expanded view | Pending |

| Story | Tasks | Status |
|-------|-------|--------|
| **Story 4: Add Links to Collaborative Board** | | Pending |
| | Add RLS policies for link insertion | Pending |
| | Modify addLink() with added_by field | Pending |
| | Target collab_links table when on collab board | Pending |
| | Toast confirmation with board name | Pending |

| Story | Tasks | Status |
|-------|-------|--------|
| **Story 5: Invite Members via Email** | | Blocked |
| | Build members management modal | Pending |
| | Email input with "Send Invite" button | Pending |
| | Create invite record (pending status) | Pending |
| | Send magic link via Supabase/Resend | Blocked (Needs Resend API) |
| | Handle invite acceptance flow | Pending |

| Story | Tasks | Status |
|-------|-------|--------|
| **Story 6: Invite Members via Link** | | Pending |
| | Display invite link in members modal | Pending |
| | Copy button for invite link | Pending |
| | Role selector for invite link | Pending |
| | Create /boards/join/:inviteCode page | Pending |
| | Validate invite code and show preview | Pending |
| | Add user to board on "Join" click | Pending |

| Story | Tasks | Status |
|-------|-------|--------|
| **Story 7: Manage Member Roles** | | Pending |
| | Role dropdown for each member (owner only) | Pending |
| | "Remove" button (owner only) | Pending |
| | Role update API call | Pending |
| | Member removal API call | Pending |
| | Prevent owner self-removal | Pending |
| | Confirmation modal for removal | Pending |

| Story | Tasks | Status |
|-------|-------|--------|
| **Story 8: Real-time Link Updates** | | Pending |
| | Supabase Realtime subscription for collab_links | Pending |
| | Handle INSERT events (animate new link) | Pending |
| | Handle UPDATE events (refresh data) | Pending |
| | Handle DELETE events (animate removal) | Pending |
| | Fallback polling if Realtime disconnects | Pending |
| | "X is viewing" presence indicators (stretch) | Pending |

| Story | Tasks | Status |
|-------|-------|--------|
| **Story 9: Edit/Delete Collaborative Links** | | Pending |
| | RLS policies for updates/deletes | Pending |
| | Editors edit/delete own links | Pending |
| | Owners edit/delete any link | Pending |
| | Permission-based button visibility | Pending |
| | Sync changes via Realtime | Pending |

| Story | Tasks | Status |
|-------|-------|--------|
| **Story 10: Board Settings & Deletion** | | Pending |
| | Settings modal for board owners | Pending |
| | Board rename | Pending |
| | Description update | Pending |
| | Default role change | Pending |
| | Board deletion with confirmation | Pending |
| | Cascade delete links and members | Pending |
