# Product Requirements Document: Collaborative Boards

## Overview

Collaborative Boards extend the current personal board model to allow multiple users to contribute links to a shared collection. Unlike the existing "Shared Boards" feature (which provides read-only access to one user's board), Collaborative Boards enable true multi-user curation.

---

## Problem Statement

Current sharing is one-directional: an owner shares their board, viewers can only look. Users want to:
- Build collections with friends, teams, or communities
- Pool interesting finds into a shared space
- Maintain attribution for who added what

---

## User Stories

1. **As a user**, I want to create a collaborative board and invite others to contribute
2. **As a collaborator**, I want to add links to a board I've been invited to
3. **As a board member**, I want to see who added each link
4. **As a board owner**, I want to manage who can contribute vs. just view
5. **As a user**, I want to easily switch between my personal board and collaborative boards

---

## Design Decisions

### 1. Access Model

```
┌─────────────────────────────────────────────────────────────┐
│                    PERMISSION LEVELS                         │
├─────────────────────────────────────────────────────────────┤
│  OWNER      │ Full control, can delete board, manage roles  │
│  EDITOR     │ Can add/edit/delete links, invite viewers     │
│  VIEWER     │ Read-only access (like current shared boards) │
└─────────────────────────────────────────────────────────────┘

Invite Methods:
• Email invite (sends magic link)
• Invite link (anyone with link can join as Editor/Viewer)
```

### 2. Navigation Model

```
┌─────────────────────────────────────────────────────────────┐
│  HEADER                                                      │
├─────────────────────────────────────────────────────────────┤
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐       │
│  │  My Board    │  │  Team Reads  │  │  Design Inspo│  [+]  │
│  │  (personal)  │  │  (collab)    │  │  (collab)    │       │
│  └──────────────┘  └──────────────┘  └──────────────┘       │
│        ▲                                                     │
│        │                                                     │
│   Active board indicator                                     │
└─────────────────────────────────────────────────────────────┘

• Tab-based navigation between boards
• Personal board always first
• [+] button to create/join collaborative board
```

### 3. Link Attribution

```
┌─────────────────────────────────────────────────────────────┐
│  GRID ITEM (Collaborative Board)                            │
├─────────────────────────────────────────────────────────────┤
│  ┌─────────────────────────────────────┐                    │
│  │  [Category]              [Avatar]   │  ← Contributor     │
│  │                                     │    avatar/initial  │
│  │         [Image/Initial]             │                    │
│  │                                     │                    │
│  ├─────────────────────────────────────┤                    │
│  │  Title                              │                    │
│  │  domain.com                         │                    │
│  └─────────────────────────────────────┘                    │
│                                                             │
│  Expanded view shows: "Added by alice@..." with timestamp   │
└─────────────────────────────────────────────────────────────┘
```

### 4. Board Switcher UI

```
┌─────────────────────────────────────────────────────────────┐
│  BOARD SWITCHER DROPDOWN                                    │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  ┌─────────────────────────────────────────────────────┐   │
│  │  📋 My Board                              Personal   │   │
│  │     142 links                                       │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                             │
│  COLLABORATIVE BOARDS                                       │
│  ┌─────────────────────────────────────────────────────┐   │
│  │  👥 Team Reads                           3 members   │   │
│  │     28 links • Last active 2h ago                   │   │
│  └─────────────────────────────────────────────────────┘   │
│  ┌─────────────────────────────────────────────────────┐   │
│  │  👥 Design Inspiration                   5 members   │   │
│  │     89 links • Last active 1d ago                   │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                             │
│  ─────────────────────────────────────────────────────────  │
│  [+ Create Collaborative Board]                             │
│  [🔗 Join with Invite Link]                                 │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

### 5. Create/Manage Collaborative Board Modal

```
┌─────────────────────────────────────────────────────────────┐
│  CREATE COLLABORATIVE BOARD                            [×]  │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  Board Name                                                 │
│  ┌─────────────────────────────────────────────────────┐   │
│  │ Team Reading List                                   │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                             │
│  Description (optional)                                     │
│  ┌─────────────────────────────────────────────────────┐   │
│  │ Articles and resources for the team                 │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                             │
│  Default Role for New Members                               │
│  ○ Editor - Can add and edit links                         │
│  ○ Viewer - Can only view links                            │
│                                                             │
│                              [Cancel]  [Create Board]       │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

### 6. Members Management

```
┌─────────────────────────────────────────────────────────────┐
│  TEAM READS - MEMBERS                                  [×]  │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  INVITE                                                     │
│  ┌─────────────────────────────────────┐                   │
│  │ email@example.com                   │  [Send Invite]    │
│  └─────────────────────────────────────┘                   │
│                                                             │
│  Or share invite link:                                      │
│  ┌─────────────────────────────────────┐                   │
│  │ boards.app/join/abc123              │  [Copy]           │
│  └─────────────────────────────────────┘                   │
│  Joining as: [Editor ▼]                                     │
│                                                             │
│  ─────────────────────────────────────────────────────────  │
│                                                             │
│  MEMBERS (3)                                                │
│  ┌─────────────────────────────────────────────────────┐   │
│  │  A  alice@example.com                        Owner   │   │
│  │     12 links added                                  │   │
│  └─────────────────────────────────────────────────────┘   │
│  ┌─────────────────────────────────────────────────────┐   │
│  │  B  bob@example.com                    [Editor ▼]   │   │
│  │     8 links added                         [Remove]  │   │
│  └─────────────────────────────────────────────────────┘   │
│  ┌─────────────────────────────────────────────────────┐   │
│  │  C  carol@example.com                  [Viewer ▼]   │   │
│  │     Invited • Pending                     [Remove]  │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

---

## Database Schema

```sql
-- Collaborative boards
CREATE TABLE collab_boards (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  description TEXT,
  owner_id UUID REFERENCES auth.users(id) NOT NULL,
  default_role TEXT DEFAULT 'editor' CHECK (default_role IN ('editor', 'viewer')),
  invite_code TEXT UNIQUE DEFAULT encode(gen_random_bytes(6), 'hex'),
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Board memberships
CREATE TABLE collab_board_members (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  board_id UUID REFERENCES collab_boards(id) ON DELETE CASCADE,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('owner', 'editor', 'viewer')),
  invited_by UUID REFERENCES auth.users(id),
  invited_at TIMESTAMPTZ DEFAULT now(),
  joined_at TIMESTAMPTZ,
  UNIQUE(board_id, user_id)
);

-- Collaborative links (separate from personal links)
CREATE TABLE collab_links (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  board_id UUID REFERENCES collab_boards(id) ON DELETE CASCADE,
  added_by UUID REFERENCES auth.users(id) NOT NULL,
  url TEXT NOT NULL,
  title TEXT,
  description TEXT,
  image TEXT,
  domain TEXT,
  category TEXT DEFAULT 'uncategorized',
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Link order per board
CREATE TABLE collab_link_order (
  board_id UUID PRIMARY KEY REFERENCES collab_boards(id) ON DELETE CASCADE,
  order_ids TEXT[] DEFAULT '{}'
);

-- Board-level expanded cards (shared across all members)
CREATE TABLE collab_expanded_cards (
  board_id UUID PRIMARY KEY REFERENCES collab_boards(id) ON DELETE CASCADE,
  cards JSONB DEFAULT '{}'
);

-- Indexes
CREATE INDEX idx_collab_members_user ON collab_board_members(user_id);
CREATE INDEX idx_collab_members_board ON collab_board_members(board_id);
CREATE INDEX idx_collab_links_board ON collab_links(board_id);
CREATE INDEX idx_collab_boards_invite ON collab_boards(invite_code);
```

---

## RLS Policies

```sql
-- Users can see boards they're members of
CREATE POLICY "Members can view collab boards"
  ON collab_boards FOR SELECT
  USING (
    id IN (SELECT board_id FROM collab_board_members WHERE user_id = auth.uid())
  );

-- Only owners can update board settings
CREATE POLICY "Owners can update collab boards"
  ON collab_boards FOR UPDATE
  USING (owner_id = auth.uid());

-- Members can see other members
CREATE POLICY "Members can view board members"
  ON collab_board_members FOR SELECT
  USING (
    board_id IN (SELECT board_id FROM collab_board_members WHERE user_id = auth.uid())
  );

-- Editors and owners can add links
CREATE POLICY "Editors can add collab links"
  ON collab_links FOR INSERT
  WITH CHECK (
    board_id IN (
      SELECT board_id FROM collab_board_members
      WHERE user_id = auth.uid() AND role IN ('owner', 'editor')
    )
  );

-- Members can view all links in their boards
CREATE POLICY "Members can view collab links"
  ON collab_links FOR SELECT
  USING (
    board_id IN (SELECT board_id FROM collab_board_members WHERE user_id = auth.uid())
  );

-- Users can edit/delete their own links, owners can edit/delete any
CREATE POLICY "Users can update own collab links"
  ON collab_links FOR UPDATE
  USING (
    added_by = auth.uid() OR
    board_id IN (
      SELECT board_id FROM collab_board_members
      WHERE user_id = auth.uid() AND role = 'owner'
    )
  );
```

---

## URL Structure

```
/boards/                     → Personal board (default)
/boards/?board=:id           → Collaborative board view
/boards/join/:inviteCode     → Join page for invite links
```

---

## Component Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                     INDEX.HTML CHANGES                       │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  New State:                                                 │
│  • activeBoard: 'personal' | UUID                          │
│  • collabBoards: []                                        │
│  • activeBoardMembers: []                                  │
│                                                             │
│  New Components:                                            │
│  • BoardSwitcher (dropdown in header)                      │
│  • CreateCollabModal                                       │
│  • MembersModal                                            │
│  • ContributorAvatar (on grid items)                       │
│                                                             │
│  Modified Functions:                                        │
│  • getAllLinks() → checks activeBoard                      │
│  • addLink() → includes added_by for collab                │
│  • renderGrid() → shows contributor for collab             │
│  • syncToSupabase() → uses collab_links table              │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

---

## Sync Strategy

```
Personal Board:
  └── Current polling (30s) + mutation sync

Collaborative Board:
  └── Supabase Realtime subscription
      • INSERT on collab_links → animate in new item
      • UPDATE on collab_links → refresh item
      • DELETE on collab_links → animate out
      • Fallback to polling if Realtime fails
```

---

## Implementation Phases

### Phase 1: Foundation
- [ ] Database schema + migrations
- [ ] RLS policies
- [ ] Board switcher UI (personal only initially)
- [ ] Create collaborative board flow

### Phase 2: Core Collaboration
- [ ] Add links to collab boards
- [ ] View collab board links
- [ ] Contributor attribution display
- [ ] Members list view

### Phase 3: Invites & Permissions
- [ ] Email invites
- [ ] Invite link joining
- [ ] Role management (editor/viewer)
- [ ] Remove members

### Phase 4: Real-time
- [ ] Supabase Realtime subscription
- [ ] Live updates for new links
- [ ] Presence indicators (who's viewing)

### Phase 5: Polish
- [ ] Import links from personal board
- [ ] Export/fork to personal board
- [ ] Activity feed (who added what, when)
- [ ] Board settings (rename, delete, transfer ownership)

---

## Edge Cases

| Scenario | Behavior |
|----------|----------|
| Owner leaves | Must transfer ownership first |
| Last editor becomes viewer | Board becomes read-only |
| Duplicate link added | Show toast "Already in board" |
| User removed while viewing | Redirect to personal board |
| Invite link role changed | Only affects new joins |
| Board deleted | Remove from all members' lists |

---

## Success Metrics

- Collaborative boards created per user
- Average members per board
- Links added via collaboration vs. personal
- Invite acceptance rate
- Time spent on collaborative vs. personal boards

---

## Future Extensions

- **Comments on links** - Discuss within the board
- **Voting/reactions** - Surface popular links
- **Sections/folders** - Organize within a board
- **Board templates** - Start with pre-defined categories
- **Public collaborative boards** - Open contribution with moderation

---

## Related Documents

- [PRD: Boards MVP](./boards-mvp.md) - Core personal board functionality
- [PRD: Content Type System](./content-type-system.md) - Automatic content classification
- [TECH: AI Widget System](../../infrastructure/technical-design/ai-widget-system.md) - Product recommendations
- [Design System](../../../design-system/README.md) - UI components and tokens
- [Vision & Roadmap](../vision-and-roadmap.md) - Product strategy
