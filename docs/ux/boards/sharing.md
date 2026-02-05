# Sharing & Collaboration

Features that let users share their boards publicly or with specific people, and eventually collaborate on shared collections.

---

## User Goals

- **Share my board** with friends or publicly
- **Control who sees what** with privacy settings
- **Get a shareable link** I can send anywhere
- **Track engagement** on shared boards
- **Choose what updates** viewers see

---

## Jobs to be Done (JTBD)

| When I... | I want to... | So I can... |
|-----------|-------------|-------------|
| Curate a great collection | Share it with others | Get feedback and inspire |
| Send my wishlist | Create a share link | Let friends see what I want |
| Share publicly | Control my privacy | Not expose personal info |
| Track my shared board | See view counts | Know if people are looking |
| Add new pins | Choose if viewers see them | Control the experience |

---

## Wireframes

### Share Button

```
Board Header:
┌──────────────────────────────────────────────────────┐
│  BOARDS                          [Share] [+ Add]    │
└──────────────────────────────────────────────────────┘
                                      ↑
                                 Opens modal
```

### Share Modal (Initial)

```
┌─────────────────────────────────────────┐
│  Share Board                      [X]   │
├─────────────────────────────────────────┤
│                                         │
│  Visibility:                            │
│                                         │
│  ┌─────────────────────────────────┐    │
│  │ 🔗  Anyone with the link        │    │
│  │     Only people with link can   │    │
│  │     view your board             │    │
│  └─────────────────────────────────┘    │
│                                         │
│  ┌─────────────────────────────────┐    │
│  │ 🌐  Public                      │    │
│  │     Anyone can find and view    │    │
│  │     your board                  │    │
│  └─────────────────────────────────┘    │
│                                         │
│  Updates:                               │
│                                         │
│  ┌─────────────────────────────────┐    │
│  │ ⚡  Live                         │    │
│  │     Viewers see changes as you  │    │
│  │     add new pins                │    │
│  └─────────────────────────────────┘    │
│                                         │
│  ┌─────────────────────────────────┐    │
│  │ 📸  Snapshot                    │    │
│  │     Viewers see board as it is  │    │
│  │     now (frozen in time)        │    │
│  └─────────────────────────────────┘    │
│                                         │
│           [ Cancel ]  [ Create Link ]   │
└─────────────────────────────────────────┘
```

### Share Modal (Link Created)

```
┌─────────────────────────────────────────┐
│  Share Board                      [X]   │
├─────────────────────────────────────────┤
│                                         │
│  ✓ Your board is shared!                │
│                                         │
│  Share Link:                            │
│  ┌─────────────────────────────────┐    │
│  │ ctrl.rodeo/b/abc123        [📋] │    │
│  └─────────────────────────────────┘    │
│           Copied! ✓                     │
│                                         │
│  Stats:                                 │
│  👁 12 views  •  Shared 3 days ago      │
│                                         │
│  Settings:                              │
│  • Visibility: Link only                │
│  • Updates: Live                        │
│  [ Change settings ]                    │
│                                         │
│  ────────────────────────────────────   │
│                                         │
│  [ Stop Sharing ]                       │
│                                         │
└─────────────────────────────────────────┘
```

### Shared Board View (Viewer's Perspective)

```
┌─────────────────────────────────────────────────────────────┐
│  📋 Ian's Fashion Board              Shared by ian@email    │
├─────────────────────────────────────────────────────────────┤
│  [ All ] [ Clothing ] [ Accessories ] [ Shoes ]             │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  ┌─────────┐  ┌─────────┐  ┌─────────┐  ┌─────────┐       │
│  │         │  │         │  │         │  │         │       │
│  │  [img]  │  │  [img]  │  │  [img]  │  │  [img]  │       │
│  │         │  │         │  │         │  │         │       │
│  │ Title   │  │ Title   │  │ Title   │  │ Title   │       │
│  └─────────┘  └─────────┘  └─────────┘  └─────────┘       │
│                                                             │
│  ┌─────────────────────────────────────────────────────┐   │
│  │  Create your own board at ctrl.rodeo →               │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

### Share from Pin (Individual)

```
Pin expanded view:
┌─────────────────────────────────────────────────────┐
│  Product Title                                      │
│  ─────────────────                                  │
│                                                     │
│  ...                                                │
│                                                     │
│  ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌─────────┐   │
│  │  Open   │ │  Copy   │ │  Share  │ │ Delete  │   │
│  │   ↗️    │ │   📋    │ │   📤    │ │   🗑️    │   │
│  └─────────┘ └─────────┘ └─────────┘ └─────────┘   │
│                    ↑                                │
│              Share single pin                       │
└─────────────────────────────────────────────────────┘
```

---

## Sharing Options

| Option | Behavior |
|--------|----------|
| **Link Only** | URL required to access, not indexed |
| **Public** | Discoverable, indexed by search engines |
| **Live** | Updates in real-time as you add pins |
| **Snapshot** | Frozen at share time, won't update |

---

## Privacy Considerations

### What's Shared
- Pin titles, descriptions, images
- Categories
- Board owner's display name (optional email)

### What's NOT Shared
- Account settings
- Private notes (future feature)
- Analytics beyond view count
- Other user's boards

---

## Known Extensions / Future States

### Short-term
- **Custom share URLs** - `ctrl.rodeo/b/my-fashion-board`
- **Category-specific sharing** - Share only one category
- **QR code** - For easy mobile sharing

### Medium-term
- **Collaborative boards** - Multiple editors
- **Comment system** - Viewers can leave comments
- **Pin suggestions** - Viewers can suggest pins to add
- **Embed widget** - Embed board on other websites

### Long-term
- **Board marketplace** - Discover public boards
- **Follow boards** - Get notified when boards update
- **Board templates** - Clone someone's board structure
- **Team workspaces** - Shared organization for teams

---

## Technical Notes

- Share links use unique 8-character IDs
- Shared boards served from `share.html` (read-only view)
- View counts tracked in Supabase `shares` table
- Live vs Snapshot determined by `realtime` boolean
- Share data includes: `board_id`, `visibility`, `realtime`, `created_at`, `view_count`
