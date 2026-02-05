# Settings & Preferences

User-configurable options for customizing the Boards experience.

---

## User Goals

- **Customize appearance** to my preference
- **Manage my data** and privacy
- **Control notifications** and updates
- **Access advanced options** when needed
- **Export my data** if I want to leave

---

## Jobs to be Done (JTBD)

| When I... | I want to... | So I can... |
|-----------|-------------|-------------|
| Prefer light mode | Toggle the theme | Use in bright environments |
| See too many widgets | Manage widget visibility | Reduce clutter |
| Want my data | Export everything | Have a backup |
| Need to troubleshoot | Access debug options | Fix issues |
| Change my mind | Reset preferences | Start fresh |

---

## Wireframes

### Settings Modal

```
┌─────────────────────────────────────────┐
│  Settings                         [X]   │
├─────────────────────────────────────────┤
│                                         │
│  APPEARANCE                             │
│  ─────────────                          │
│  Theme:                                 │
│  [ ● Dark ]  [ ○ Light ]  [ ○ System ] │
│                                         │
│  WIDGETS                                │
│  ─────────────                          │
│  ★ Favorited (2)                        │
│     Complete the Look         [Remove]  │
│     Style Summary             [Remove]  │
│                                         │
│  🚫 Hidden (1)                          │
│     Price Drops               [Restore] │
│                                         │
│  [ Restore All Hidden ]                 │
│                                         │
│  DATA                                   │
│  ─────────────                          │
│  [ Export All Data ]                    │
│  [ Clear Local Cache ]                  │
│                                         │
│  ADVANCED                               │
│  ─────────────                          │
│  [ ] Enable debug mode                  │
│  [ ] Show admin panel (Ctrl+Shift+A)    │
│                                         │
│  ─────────────────────────────────────  │
│                                         │
│  [ Reset All Settings ]                 │
│                                         │
└─────────────────────────────────────────┘
```

### Theme Toggle States

```
Dark Mode (Default):              Light Mode:
┌───────────────────┐             ┌───────────────────┐
│ ██████████████████│             │                   │
│ ██  Dark Theme  ██│             │   Light Theme     │
│ ██████████████████│             │                   │
│ ██ White text   ██│             │   Black text      │
│ ██████████████████│             │                   │
└───────────────────┘             └───────────────────┘
```

### Export Data Format

```
┌─────────────────────────────────────────┐
│  Export Data                      [X]   │
├─────────────────────────────────────────┤
│                                         │
│  Your export includes:                  │
│  • 156 pins                             │
│  • 8 categories                         │
│  • Widget preferences                   │
│  • Account settings                     │
│                                         │
│  Format:                                │
│  [ ● JSON ]  [ ○ CSV ]                  │
│                                         │
│  ─────────────────────────────────────  │
│                                         │
│  Preview:                               │
│  ┌─────────────────────────────────┐    │
│  │ {                               │    │
│  │   "pins": [...],                │    │
│  │   "categories": [...],          │    │
│  │   "settings": {...}             │    │
│  │ }                               │    │
│  └─────────────────────────────────┘    │
│                                         │
│           [ Cancel ]  [ Download ]      │
└─────────────────────────────────────────┘
```

### Clear Cache Confirmation

```
┌─────────────────────────────────────────┐
│  Clear Local Cache?                     │
├─────────────────────────────────────────┤
│                                         │
│  ⚠️  This will clear:                   │
│                                         │
│  • Cached images                        │
│  • AI classification cache              │
│  • Widget recommendation cache          │
│  • Expanded card states                 │
│                                         │
│  Your pins and categories will NOT      │
│  be affected.                           │
│                                         │
│           [ Cancel ]  [ Clear ]         │
└─────────────────────────────────────────┘
```

### Reset All Settings Confirmation

```
┌─────────────────────────────────────────┐
│  Reset All Settings?                    │
├─────────────────────────────────────────┤
│                                         │
│  ⚠️  This will reset:                   │
│                                         │
│  • Theme to dark mode                   │
│  • Widget preferences                   │
│  • All cached data                      │
│  • Debug settings                       │
│                                         │
│  Your pins and account will NOT         │
│  be affected.                           │
│                                         │
│           [ Cancel ]  [ Reset ]         │
└─────────────────────────────────────────┘
```

---

## Settings Categories

| Category | Options |
|----------|---------|
| **Appearance** | Theme (dark/light/system) |
| **Widgets** | Favorites, hidden, dismissed |
| **Data** | Export, clear cache |
| **Advanced** | Debug mode, admin panel |
| **Account** | Username, email (see Authentication) |

---

## Storage

| Setting | Storage Location |
|---------|-----------------|
| Theme | localStorage |
| Widget preferences | localStorage |
| Debug mode | localStorage |
| Expanded cards | localStorage |
| Account info | Supabase |

---

## Known Extensions / Future States

### Short-term
- **Notification settings** - Email digests, alerts
- **Default category** - Pre-select when adding pins
- **Grid density** - Compact, comfortable, spacious

### Medium-term
- **Keyboard shortcut customization** - Remap shortcuts
- **Import data** - Restore from export
- **Language selection** - Internationalization
- **Accessibility options** - High contrast, reduced motion

### Long-term
- **Sync settings across devices** - Cloud-stored preferences
- **Setting profiles** - "Work" vs "Personal" configurations
- **API access** - Personal access tokens

---

## Technical Notes

- All settings stored via `localStorage` except account data
- Theme applied via CSS class on `<body>`: `theme-dark` / `theme-light`
- System theme detected via `prefers-color-scheme` media query
- Export generates JSON/CSV via client-side blob creation
- Debug mode enables console logging and admin panel access
