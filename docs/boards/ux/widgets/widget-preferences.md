# Widget Preferences

User controls for managing AI widget behavior: favorites, hidden widgets, feedback, and personalization settings.

---

## User Goals

- **Control which widgets appear** on my board
- **Save favorite widgets** for quick access
- **Hide irrelevant widgets** without losing them forever
- **Provide feedback** to improve recommendations
- **Restore hidden widgets** when I change my mind

---

## Jobs to be Done (JTBD)

| When I... | I want to... | So I can... |
|-----------|-------------|-------------|
| Love a widget | Mark it as favorite | Find it quickly later |
| See an irrelevant widget | Hide it temporarily | Clean up my view |
| Keep seeing bad suggestions | Hide widget permanently | Stop the noise |
| Change my mind | Restore a hidden widget | See it again |
| Want better suggestions | Provide feedback | Improve AI over time |

---

## Wireframes

### Widget Quick Actions

```
Widget Card:
┌─────────────────────────────────────────┐
│  ✨ Complete the Look          [♡] [⋮] │
│                                         │
│  ... widget content ...                 │
│                                         │
│  [ 👎 Dismiss ]      [ 💬 Feedback ]    │
└─────────────────────────────────────────┘

[♡] = Toggle favorite (filled = favorited)
[⋮] = Open menu
```

### Widget Menu Options

```
┌─────────────────────────────┐
│  ★ Add to Favorites         │  ← Toggle
│  ─────────────────────────  │
│  ⏸ Pause this widget        │  ← Temporary hide
│  🚫 Hide permanently        │  ← Won't show again
│  ─────────────────────────  │
│  🔄 Refresh suggestions     │  ← Re-generate
│  📄 View widget PRD         │  ← Technical details
│  💬 Send feedback           │  ← Report issues
└─────────────────────────────┘
```

### Feedback Modal

```
┌─────────────────────────────────────────┐
│  Widget Feedback                  [X]   │
├─────────────────────────────────────────┤
│                                         │
│  How were these recommendations?        │
│                                         │
│  [ 😞 Poor ]  [ 😐 OK ]  [ 😊 Great ]   │
│                                         │
│  What could be better?                  │
│  ┌─────────────────────────────────┐    │
│  │ The styles don't match my      │    │
│  │ aesthetic. I prefer more       │    │
│  │ minimalist items...            │    │
│  └─────────────────────────────────┘    │
│                                         │
│  ☐ Don't show this widget type again   │
│                                         │
│           [ Cancel ]  [ Submit ]        │
└─────────────────────────────────────────┘
```

### Settings: Widget Management

```
┌─────────────────────────────────────────┐
│  Settings > Widgets                     │
├─────────────────────────────────────────┤
│                                         │
│  FAVORITE WIDGETS                       │
│  ─────────────────                      │
│  ★ Complete the Look        [Remove]    │
│  ★ Style Summary            [Remove]    │
│                                         │
│  HIDDEN WIDGETS                         │
│  ─────────────────                      │
│  🚫 Price Drops             [Restore]   │
│  🚫 Similar Items           [Restore]   │
│                                         │
│  DISMISSED (Temporary)                  │
│  ─────────────────                      │
│  ⏸ Back in Stock (3 days)  [Restore]   │
│                                         │
│  [ Restore All Hidden ]                 │
│                                         │
└─────────────────────────────────────────┘
```

### Widget Status Indicator

```
Board Header:
┌──────────────────────────────────────────────────────┐
│  BOARDS                    Widgets: [●●●○○]  [⚙️]   │
└──────────────────────────────────────────────────────┘
                                  ↑
                         3 active, 2 hidden
```

---

## Widget States

| State | Icon | Behavior |
|-------|------|----------|
| Active | ✨ | Shows on board, refreshes automatically |
| Favorited | ★ | Pinned to top, always visible |
| Paused | ⏸ | Temporarily hidden, auto-restores after 7 days |
| Hidden | 🚫 | Permanently hidden until manually restored |
| Dismissed | 👎 | Hidden for this session only |

---

## State Transitions

```
                    [Favorite]
                        │
                        ▼
              ┌─────────────────┐
              │    FAVORITED    │
              │   (always top)  │
              └────────┬────────┘
                       │ [Unfavorite]
                       ▼
              ┌─────────────────┐
  [Show] ───▶ │     ACTIVE      │ ◀─── [Restore]
              │  (normal view)  │
              └────────┬────────┘
                       │
          ┌────────────┼────────────┐
          │            │            │
          ▼            ▼            ▼
   ┌──────────┐  ┌──────────┐  ┌──────────┐
   │ DISMISSED│  │  PAUSED  │  │  HIDDEN  │
   │(session) │  │ (7 days) │  │(forever) │
   └──────────┘  └──────────┘  └──────────┘
```

---

## Personalization Signals

The widget system learns from:

| Signal | Weight | Example |
|--------|--------|---------|
| Favorites | High | User starred a widget type |
| Feedback rating | High | User rated recommendations |
| Dismissals | Medium | User dismissed specific widgets |
| Click-through | Medium | User clicked recommended items |
| Time on widget | Low | User spent time viewing |
| Pin patterns | Low | What user saves after seeing widget |

---

## Known Extensions / Future States

### Short-term
- **Widget scheduling** - Show "Morning picks" vs "Weekend browse"
- **Category-specific widgets** - Different widgets per board category
- **Widget preview** - See what a widget shows before enabling

### Medium-term
- **Widget creation** - Let users define custom widget criteria
- **Widget sharing** - Share widget configurations with others
- **A/B testing** - Show different widget variants to improve

### Long-term
- **Smart widget rotation** - AI decides best widgets to show
- **Cross-device sync** - Widget preferences sync across devices
- **Widget marketplace** - Third-party widget integrations

---

## Technical Notes

- Preferences stored in localStorage via `loadWidgetPrefs()`/`saveWidgetPrefs()`
- Feedback stored in Supabase for analysis
- Widget status cycled via `cycleWidgetStatus()`: Active → Paused → Hidden → Active
- Favorites array, hidden set, dismissed set all tracked separately
- 7-day auto-restore for paused widgets (cron job pending)
