# Mobile Capture

> **Status:** ✅ Shipped
> **Brand Principle:** Organize as you go
> **Key Personas:** Visual Collector, DJ, Multidisciplinary Maker
>
> Back to [UX Index](../index.md)

Creatives find things everywhere — commuting, at shows, in studios, at shops. Capture must work from a phone as easily as from a desktop.

---

## User Goals

- **Save links from my phone** without typing
- **Share from any app** directly to Boards
- **Paste URLs quickly** while browsing on mobile
- **Add links when I see them** in the real world (product photos, screenshots)
- **Minimize friction** — every extra tap reduces capture rate

---

## Jobs to be Done (JTBD)

| When I... | I want to... | So I can... |
|-----------|-------------|-------------|
| Browse on mobile | Have quick URL input always visible | Paste and save without opening a modal |
| Share a page from Safari/Chrome | Send directly to Boards | Skip copy-paste completely |
| See a product in a store | Photo it and extract the URL | Add it without typing |
| Screenshot a website | Extract the URL from the image | Save the link even if I forgot to copy it |
| Get a link in Messages/Slack | Paste it instantly | Add before I forget |
| Browse without Boards open | Open Boards with a link pre-loaded | One-tap save from share sheet |

---

## What's Shipped

### Mobile Quick-Add Bar ✅
- Always-visible URL input at bottom of mobile viewport
- Auto-processes URLs on paste
- One-tap paste button to read clipboard
- Enter key or + button to submit
- Fixed positioning: always accessible while scrolling

### PWA Share Target ✅
- Boards appears in mobile share sheets when installed as PWA
- Handles shared URLs, text containing URLs, and page titles
- Redirects through `/boards/pwa-share.html` extraction page
- Auto-adds via `?add=URL` deep link
- Works on iOS and Android

### Deep Link Handler ✅
- `?add=URL` query parameter auto-adds links on load
- Works from bookmarklets, share targets, external apps
- URL-encodes properly for special characters
- Triggers enrichment pipeline automatically

### Bookmarklet ✅
- Drag-to-bookmarks-bar "Save to Boards" link
- Accessible via Tools modal (FAB menu → Tools)
- One-click save from any page
- Uses deep link handler under the hood

### Image Scanning ✅
- Scan photos with Claude Vision to identify products/content
- Extracts title, description, URL, category, confidence score
- Handles screenshots, product photos, artwork, event posters
- Multi-select interface for batch-adding found items
- Accessible via FAB menu → Scan Image

### Tools Modal ✅
- New modal in FAB menu
- Contains: bookmarklet link, share URL explainer, PWA install instructions
- One-stop reference for all capture methods
- Drag-and-drop bookmarklet with tap-to-copy fallback

---

## Wireframes

### Mobile Quick-Add Bar (Bottom Fixed)

```
┌──────────────────────────────────────┐
│                                      │
│  [Grid of pins scrolls here...]     │
│                                      │
│  [...]                               │
│                                      │
└──────────────────────────────────────┘
┌──────────────────────────────────────┐
│ [Paste URL          ] [Paste] [ + ]  │
└──────────────────────────────────────┘
        ↑ Fixed bottom bar
```

### PWA Share Target Flow

```
Mobile Share Sheet       Extraction Page         Boards Opens
┌─────────────────┐     ┌─────────────────┐    ┌─────────────────┐
│ Share to...     │  →  │ Saving to       │ → │ [Add modal      │
│                 │     │ Boards...       │    │  with URL       │
│ ☑ Boards        │     │                 │    │  pre-filled]    │
│ ○ Messages      │     │                 │    │                 │
│ ○ Notes         │     │ (auto-redirect) │    │ [Add Pin]       │
└─────────────────┘     └─────────────────┘    └─────────────────┘
```

### Deep Link Handler

```
External App              Boards Opens
┌─────────────────┐      ┌─────────────────┐
│ Click link:     │  →   │ [Add modal      │
│ ctrl.rodeo/     │      │  with URL       │
│ boards/         │      │  pre-filled]    │
│ ?add=URL        │      │                 │
│                 │      │ [Add Pin]       │
└─────────────────┘      └─────────────────┘
```

### Image Scanning Flow

```
FAB Menu                Photo Upload          Scanning              Results
┌──────────┐           ┌──────────┐          ┌──────────┐          ┌──────────────┐
│ + Add    │  →        │ 📷 Camera│  →       │ ◐ Analyzing         │ ☑ Nike Shoes │
│ 🔍 Search│           │ 📁 Files │          │   image...          │ ☑ Adidas Hat │
│ 📸 Scan  │◄─click    │          │          │                     │ ☐ Background │
│ 🛠 Tools  │           └──────────┘          └──────────┘          │              │
└──────────┘                                                        │ [Add 2 Items]│
                                                                    └──────────────┘
```

### Tools Modal

```
┌─────────────────────────────────────┐
│  Tools                         [X]  │
├─────────────────────────────────────┤
│                                     │
│  BOOKMARKLET                        │
│  Drag this to your bookmarks bar:   │
│                                     │
│  [+ Save to Boards]  ← drag/click   │
│                                     │
│  Or tap to copy the link.           │
│                                     │
├─────────────────────────────────────┤
│                                     │
│  SHARE FROM ANY APP                 │
│  Install Boards as a PWA to enable  │
│  "Share to Boards" in your device's │
│  share menu.                        │
│                                     │
├─────────────────────────────────────┤
│                                     │
│  DEEP LINK                          │
│  ctrl.rodeo/boards/?add=URL         │
│                                     │
└─────────────────────────────────────┘
```

---

## Capture Methods Comparison

| Method | Friction | Best For | Requires |
|--------|----------|----------|----------|
| **Quick-Add Bar** | Lowest (paste + tap) | Mobile browsing | Open Boards app |
| **Share Target** | Very Low (2 taps) | Sharing from any app | PWA installed |
| **Deep Link** | Low (1 click) | Links from Messages, email, Slack | `?add=URL` format |
| **Bookmarklet** | Low (1 click) | Desktop browsing | Bookmark bar setup |
| **Image Scan** | Medium (photo + review) | Real-world products, screenshots | Camera access |
| **Add Button** | Medium (open modal) | Manual entry | None |

---

## What's Planned

### Audio Snippet Capture
- Record a few seconds at a club or show
- Audio fingerprinting to identify track (Shazam-like)
- Creates music pin with artist/track metadata

### Quick Capture Widget
- Home screen widget for instant URL/note/photo capture
- One-tap save without opening the full app

### Offline Capture Queue
- Save pins offline when no connection
- Sync and enrich when back online
- Visual indicator for queued items

---

## Technical Notes

| Feature | Implementation |
|---------|---------------|
| **Quick-Add Bar** | `#quickAdd` fixed bottom div, `quickAddInput`/`quickAddPaste`/`quickAddSubmit` event handlers in `boards/index.html` |
| **PWA Share Target** | `site.webmanifest` `share_target` config → `/boards/pwa-share.html` → `?add=URL` redirect |
| **Deep Link** | URL param handler on page load: `new URLSearchParams(location.search).get('add')` triggers `addLink()` |
| **Bookmarklet** | `javascript:void(window.location='...')` link in Tools modal, drag-to-bookmark-bar |
| **Image Scan** | `scan-image` edge function (Claude Sonnet 4 Vision API), base64 image upload, JSON response with items array |
| **Tools Modal** | `#toolsModal` in FAB menu, contains bookmarklet, share info, PWA install guidance |
| **Service Worker** | `/boards/sw.js` handles PWA install, offline caching, share target navigation |

Key files:
- `boards/index.html` — Quick-add bar UI + handlers, deep link handler, image scan modal, Tools modal
- `boards/sw.js` — Service worker for PWA + share target
- `boards/pwa-share.html` — Share target extraction page (parses `url`/`text`/`title` params)
- `images/icons/favicons/site.webmanifest` — PWA manifest with `share_target` config
- `supabase/functions/scan-image/index.ts` — Claude Vision API integration

---

## Persona Fit

| Persona | Scenario | Capture Method |
|---------|----------|----------------|
| Visual Collector | Sees a design in a bookstore → photos it | Image Scan |
| DJ | Browsing Beatport on phone → saves track link | Quick-Add Bar |
| Multidisciplinary Maker | Gets product link in Slack → shares to Boards | Share Target |
| Design Technologist | Reading Hacker News → bookmarklet save | Bookmarklet |
| Sound & Scene Curator | Screenshots a festival lineup → extracts URLs | Image Scan |
| Deep-Dive Enthusiast | Receives research link via email → deep link to add | Deep Link |

---

*See also: [Link Capture & Enrichment](./link-capture.md) · [Multi-Format Content](./multi-format.md)*
