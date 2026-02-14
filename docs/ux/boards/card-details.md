# Card Details & Expanded View

> **Status:** ✅ Shipped
> **Brand Principle:** Show, don't decorate
> **Key Personas:** Visual Collector (critical), Deep-Dive Enthusiast (high), Design Technologist (high)
>
> Back to [Boards UX](./index.md)

Expanded card view shows full details, metadata, actions, and personal notes for each pin.

| Feature | Status | Notes |
|---------|--------|-------|
| Card Expansion | ✅ Shipped | Click/tap card to expand |
| Notes/Annotations | ✅ Shipped | Personal notes field, auto-save, searchable |
| Action Menu | ✅ Shipped | Visit, Share, Organize, Refresh, Delete |
| Error Indicators | ✅ Shipped | Tap-to-retry for enrichment failures |
| Content-Type Metadata | ✅ Shipped | Watch (mood tags, streaming), Listen (BPM/key/genre), GitHub (stars/language) |
| Keyboard Access | ✅ Shipped | Enter/Space to expand, Tab to navigate actions |

---

## User Goals

- **See full details** about a saved pin without leaving the board
- **Add personal context** with notes and annotations
- **Take quick actions** (visit, share, organize) from the card
- **Understand enrichment status** and retry failed operations
- **See platform-specific metadata** (streaming services, music data, GitHub stats)

---

## Jobs to be Done (JTBD)

| When I... | I want to... | So I can... |
|-----------|-------------|-------------|
| Expand a card | See full title and description | Get complete context |
| Remember why I saved something | Add a personal note | Recall my thoughts later |
| Share a pin | Copy link or export | Send it to someone |
| See enrichment failed | Retry with one tap | Fix missing images/data |
| Browse movies/shows | See where it's streaming | Know if I can watch it |
| Listen to music | See BPM, key, and genre | Understand the vibe |
| Evaluate GitHub repos | See stars and language | Assess popularity and stack |
| Organize a pin | Change category or content type | Keep things tidy |

---

## Wireframes

### Expanded Card (Generic)

```
┌─────────────────────────────────────────────────┐
│                                                 │
│            [Full-size Image]                    │
│                                                 │
├─────────────────────────────────────────────────┤
│ Full Title of the Link                          │
│ domain.com • Category • Content Type • Date     │
├─────────────────────────────────────────────────┤
│ Full description text that was truncated in     │
│ the collapsed view. Can span multiple lines.    │
├─────────────────────────────────────────────────┤
│ [Add a note...]________________________         │ ← Notes field
├─────────────────────────────────────────────────┤
│ [Visit] [Share] [Organize] [Refresh] [Delete]   │ ← Actions
└─────────────────────────────────────────────────┘
```

### Watch Card with Mood Tags

```
┌─────────────────────────────────────────────────┐
│                                                 │
│         [Movie/TV Show Poster]                  │
│                                                 │
├─────────────────────────────────────────────────┤
│ The Grand Budapest Hotel (2014)                 │
│ tmdb.org • Watch • Movie • Feb 14               │
├─────────────────────────────────────────────────┤
│ The Grand Budapest Hotel tells of a legendary   │
│ concierge at a famous European hotel...         │
├─────────────────────────────────────────────────┤
│ Available on:                                   │
│ [Netflix] [Hulu] [Prime]                        │ ← Streaming chips
├─────────────────────────────────────────────────┤
│ [comedy] [quirky] [nostalgic]                   │ ← Mood tags
├─────────────────────────────────────────────────┤
│ [Add a note...]________________________         │
├─────────────────────────────────────────────────┤
│ [Visit] [IMDb] [Watched?] [Share] [Delete]      │
└─────────────────────────────────────────────────┘
```

### Listen Card with Music Metadata

```
┌─────────────────────────────────────────────────┐
│                                                 │
│            [Album Art]                          │
│                                                 │
├─────────────────────────────────────────────────┤
│ Artist Name                                     │
│ Track Title                                     │
│ 120 BPM · A Minor · House                       │ ← Music metadata
├─────────────────────────────────────────────────┤
│ [Add a note...]________________________         │
├─────────────────────────────────────────────────┤
│ [Spotify Player Embed]                          │ ← Dark mode embed
├─────────────────────────────────────────────────┤
│ [Visit] [Share] [Delete]                        │
└─────────────────────────────────────────────────┘
```

### GitHub Card

```
┌─────────────────────────────────────────────────┐
│                                                 │
│         [Repository Preview Image]              │
│                                                 │
├─────────────────────────────────────────────────┤
│ username/repository-name                        │
│ github.com • Code • Repository • Feb 14         │
├─────────────────────────────────────────────────┤
│ Project description from GitHub README...       │
├─────────────────────────────────────────────────┤
│ ⭐ 1.2k stars • TypeScript                      │ ← GitHub metadata
├─────────────────────────────────────────────────┤
│ [Add a note...]________________________         │
├─────────────────────────────────────────────────┤
│ [Visit] [Share] [Delete]                        │
└─────────────────────────────────────────────────┘
```

### Error State (Enrichment Failed)

```
┌─────────────────────────────────────────────────┐
│             !                                   │ ← Error badge
│      [Fallback Image]                           │
│                                                 │
├─────────────────────────────────────────────────┤
│ Link Title                                      │
│ domain.com • Category • Feb 14                  │
├─────────────────────────────────────────────────┤
│ [Add a note...]________________________         │
├─────────────────────────────────────────────────┤
│ [Visit] [Refresh] [Share] [Delete]              │
│         ↑                                       │
│    Tap to retry enrichment                      │
└─────────────────────────────────────────────────┘
```

---

## Notes/Annotations ✅ IMPLEMENTED

Personal notes field for each pin. Fully searchable.

**Features:**
- Multi-line text area (`<textarea>`)
- Placeholder: "Add a note..."
- Auto-save on blur (when you click away)
- Included in search results
- Persistent in localStorage and Supabase

**Use cases:**
- "Birthday gift for mom"
- "Reference for project X"
- "Reminds me of trip to Paris"
- "Check this out later"

**Implementation details:**
- Component: `.pin-notes` textarea
- File: `boards/index.html` (rendered in expanded card template)
- Auto-save: Blur event handler
- Search integration: Added to `matchesSearch()` function
- Storage: `notes` field in `links` table

---

## Action Consolidation ✅ IMPLEMENTED

Simplified action menus reduce cognitive load.

### Before (scattered actions)
```
[Visit] [Refresh Image] [Rerun Enrichment] [Share Link]
[Change Category] [Change Content Type] [Delete]
```

### After (consolidated)
```
[Visit] [Share] [Organize] [Refresh] [Delete]
```

**Changes:**
- "Refresh Image" + "Rerun Enrichment" → **"Refresh"** (one action, handles both)
- "Share Link" → **"Share"** (shorter, clearer)
- "Change Category" + "Change Content Type" → **"Organize"** (opens modal with both options)

**Benefits:**
- Fewer buttons = cleaner interface
- Related actions grouped logically
- Consistent 5-button layout across all card types

---

## Error Handling ✅ IMPLEMENTED

Clear feedback when enrichment fails, with tap-to-retry.

**Error badge:**
- Red "!" badge on card thumbnail
- Tooltip shows error reason (e.g., "Rate limit exceeded", "Invalid URL")
- **Tap badge to retry** - triggers refresh action

**Error context:**
- Widget timeout (10s): Shows "Tap to retry"
- Sync failure: Toast notification "Sync failed — changes saved locally"
- Enrichment failure: Error badge with specific reason

**Implementation details:**
- Badge: `.grid-item__error-badge` with `onclick` handler
- Widget timeout: `AbortController` with 10s limit
- Retry queue: Failed syncs stored in `syncRetryQueue` array
- Error storage: `enrichment_failed` and `enrichment_error` fields

---

## Content-Type Metadata ✅ IMPLEMENTED

Platform-specific metadata enhances context.

### Watch (Movies/TV)
- **Mood tags**: Up to 3 keywords/genres from TMDB
- **Streaming services**: Netflix, Hulu, Prime, etc. (colorful chips)
- **IMDb link**: Direct link to IMDb page
- **Watched toggle**: Track what you've seen

### Listen (Music)
- **BPM**: Tempo in beats per minute
- **Key**: Musical key (e.g., "A Minor")
- **Genre**: Primary genre classification
- **Dark mode embeds**: Spotify `?theme=0`, SoundCloud dark theme

### GitHub
- **Stars**: Repository star count
- **Language**: Primary programming language
- **Description**: Auto-imported from README

**Implementation details:**
- TMDB mood tags: `video.keywords` or `video.genres` (max 3)
- Music metadata: `music.bpm`, `music.key`, `music.genre`
- GitHub data: Enrichment via `enrich-link` function
- Spotify dark mode: `?theme=0` query param
- Streaming chips: Color-coded by service

---

## Keyboard Accessibility ✅ IMPLEMENTED

Full keyboard access to card details.

**Navigation:**
- **Enter** or **Space**: Expand/collapse card
- **Tab**: Move through action buttons
- **Escape**: Close expanded card

**Focus indicators:**
- Expanded cards have `3px` outline
- Action buttons have visible focus rings
- Notes textarea has focus border color change

---

## Known Extensions / Future States

### Short-term
- **Rich text notes** - Bold, italic, links in notes
- **Note timestamps** - See when you added/edited a note
- **Quick actions** - Keyboard shortcuts for common actions (V for Visit, S for Share)

### Medium-term
- **Related pins** - See similar items in expanded view
- **AI-suggested tags** - Auto-tag based on notes content
- **Version history** - See previous versions of notes

### Long-term
- **Collaborative notes** - Multiple people can add notes to shared pins
- **Note templates** - Pre-filled note structures for common use cases
- **Voice notes** - Audio annotations

---

## Technical Notes

- Notes field: `<textarea class="pin-notes">` with auto-resize on input
- Auto-save: Blur event listener on textarea
- Search integration: `link.notes` included in `matchesSearch()` function
- Storage: `notes` column in Supabase `links` table (nullable text)
- Error badge: Interactive `<span>` with `onclick="handleAction('refresh', id)"`
- Mood tags: Max 3, extracted from TMDB `keywords` or `genres` arrays
- Music metadata: Displayed in `.listen-player__meta` span
- GitHub metadata: Stars formatted (1200 → "1.2k"), language badge colored
- Spotify dark mode: Query param `?theme=0` appended to embed URL
- Organize modal: Single modal (`#organizeModal`) with category + content type sections
- Focus trap: Modal keydown handler prevents Tab from leaving modal
