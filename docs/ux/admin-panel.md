# Admin Panel

Hidden developer tools for power users and debugging, accessible via keyboard shortcut.

---

## User Goals

- **Debug issues** with pins and enrichment
- **View system stats** like cache hit rates
- **Force operations** like re-enrichment
- **Access advanced actions** not in main UI
- **Monitor AI performance** for widgets

---

## Jobs to be Done (JTBD)

| When I... | I want to... | So I can... |
|-----------|-------------|-------------|
| See broken enrichment | View failure reasons | Understand the issue |
| Suspect caching issues | Check cache stats | Diagnose problems |
| Want fresh data | Force re-enrichment | Update stale metadata |
| Monitor AI quality | See widget performance | Assess recommendation value |
| Something seems wrong | Access debug tools | Fix it myself |

---

## Wireframes

### Admin Panel (Ctrl+Shift+A)

```
┌─────────────────────────────────────────────────────────────┐
│  🛠️ Admin Panel                                       [X]   │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  CONTENT TYPE STATS                                         │
│  ─────────────────────                                      │
│  🛍 Product     ████████████████░░░░ 68% (106 pins)        │
│  📰 Article    ████████░░░░░░░░░░░░ 18% (28 pins)         │
│  🎬 Video      ███░░░░░░░░░░░░░░░░░  7% (11 pins)         │
│  🔧 Tool       ██░░░░░░░░░░░░░░░░░░  4% (6 pins)          │
│  ❓ Unknown    █░░░░░░░░░░░░░░░░░░░  3% (5 pins)          │
│                                                             │
│  IMAGE RESOLUTION STATS                                     │
│  ─────────────────────                                      │
│  OG Image:     72%  │  Favicon:     15%  │  AI:     8%     │
│  Placeholder:   5%  │                                       │
│                                                             │
│  CACHE STATS                                                │
│  ─────────────────────                                      │
│  Domain cache:  47 domains   │  Hit rate:  82%             │
│  Widget cache:  12 results   │  Age: 3 min                 │
│                                                             │
│  AI WIDGET STATS                                            │
│  ─────────────────────                                      │
│  Widgets generated: 24   │  Avg confidence: 76%            │
│  Thumbs up: 8           │  Thumbs down: 2                  │
│                                                             │
│  ACTIONS                                                    │
│  ─────────────────────                                      │
│  [ Run AI Enrichment ]  [ Refresh Images ]                 │
│  [ Clear AI Cache ]     [ Clear All Data ]                 │
│  [ Export Debug Log ]   [ Force Sync ]                     │
│                                                             │
│  ENRICHMENT QUEUE                                           │
│  ─────────────────────                                      │
│  Pending: 0  │  Failed: 3  │  [ View Failed ]              │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

### Failed Enrichment Details

```
┌─────────────────────────────────────────────────────────────┐
│  Failed Enrichments (3)                               [X]   │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  1. https://paywalled-site.com/article                      │
│     Error: 403 Forbidden                                    │
│     Attempted: 3 times, last: 2 hours ago                   │
│     [ Retry ]  [ Mark Resolved ]                            │
│                                                             │
│  2. https://broken-link.com/product                         │
│     Error: 404 Not Found                                    │
│     Attempted: 2 times, last: 1 day ago                     │
│     [ Retry ]  [ Mark Resolved ]                            │
│                                                             │
│  3. https://timeout-site.com/page                           │
│     Error: Request Timeout                                  │
│     Attempted: 3 times, last: 5 hours ago                   │
│     [ Retry ]  [ Mark Resolved ]                            │
│                                                             │
│                        [ Retry All ]  [ Clear All ]         │
└─────────────────────────────────────────────────────────────┘
```

### Clear All Data Confirmation (Destructive)

```
┌─────────────────────────────────────────┐
│  ⚠️  DANGER: Clear All Data?            │
├─────────────────────────────────────────┤
│                                         │
│  This will PERMANENTLY DELETE:          │
│                                         │
│  • All 156 pins                         │
│  • All 8 categories                     │
│  • All widget preferences               │
│  • All cached data                      │
│                                         │
│  This action CANNOT be undone.          │
│                                         │
│  Type "DELETE" to confirm:              │
│  ┌─────────────────────────────────┐    │
│  │                                 │    │
│  └─────────────────────────────────┘    │
│                                         │
│           [ Cancel ]  [ Delete ]        │
│                (disabled until typed)   │
└─────────────────────────────────────────┘
```

---

## Access Control

| User Type | Access |
|-----------|--------|
| Regular user | Hidden by default |
| Debug mode enabled | Visible via shortcut |
| Developer | Full access |

### Keyboard Shortcut
```
Ctrl + Shift + A  (Windows/Linux)
Cmd + Shift + A   (Mac)
```

---

## Admin Actions

| Action | What it Does | Destructive? |
|--------|--------------|--------------|
| Run AI Enrichment | Re-enrich all pins | No |
| Refresh Images | Re-fetch all images | No |
| Clear AI Cache | Reset classification cache | No |
| Clear All Data | Delete everything | **Yes** |
| Export Debug Log | Download diagnostics | No |
| Force Sync | Push all data to server | No |
| View Failed | Show enrichment errors | No |

---

## Debug Information

### Console Output (Debug Mode)
```
[Boards] Loading 156 pins...
[Boards] Cache hit for domain: store.nike.com
[Boards] Enriching: https://example.com/product
[Boards] AI classification: product (87%)
[Boards] Widget generation started...
[Boards] Widget cache miss, generating new...
[Boards] 4 recommendations generated
```

### Export Debug Log Format
```json
{
  "timestamp": "2024-12-15T10:30:00Z",
  "version": "1.0.0",
  "user_agent": "Mozilla/5.0...",
  "pins_count": 156,
  "categories_count": 8,
  "cache_stats": {
    "domain_cache": 47,
    "widget_cache": 12,
    "hit_rate": 0.82
  },
  "errors": [
    {
      "type": "enrichment_failed",
      "url": "https://...",
      "error": "403 Forbidden"
    }
  ]
}
```

---

## Known Extensions / Future States

### Short-term
- **Performance metrics** - Page load time, API latency
- **Feature flags** - Enable/disable features
- **Mock data mode** - Test with fake data

### Medium-term
- **A/B test viewer** - See which experiments are active
- **Error reporting** - Send errors to monitoring service
- **User impersonation** - For support purposes

### Long-term
- **Remote debugging** - Share session for support
- **Admin dashboard** - Web-based admin interface
- **Audit log** - Track all admin actions

---

## Technical Notes

- Admin panel access controlled by `isAdmin()` check
- Debug mode stored in localStorage: `debug_mode: true`
- All admin actions logged to console
- Destructive actions require explicit confirmation
- Stats computed from localStorage and Supabase data
