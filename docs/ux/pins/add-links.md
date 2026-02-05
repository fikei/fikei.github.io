# Add Links

The primary action users take in Boards - adding URLs to save, organize, and revisit later.

---

## User Goals

- **Quickly save a link** with minimal friction
- **Add multiple links at once** when batch-saving
- **Paste messy text** and have URLs extracted automatically
- **Assign a category** during or after adding
- **See duplicates caught** before creating redundant pins

---

## Jobs to be Done (JTBD)

| When I... | I want to... | So I can... |
|-----------|-------------|-------------|
| Find something interesting | Add it in seconds | Not lose it and continue browsing |
| Copy multiple URLs | Paste them all at once | Save time on batch operations |
| Have a URL in clipboard | Be prompted to add it | Add even faster |
| Try to add a duplicate | Be warned before saving | Avoid redundant pins |
| Add from mobile | Have a simple input | Save while on the go |

---

## Wireframes

### Primary Add Button

```
┌──────────────────────────────────────────────────────┐
│  BOARDS                          [Search] [+ Add]   │
└──────────────────────────────────────────────────────┘
                                          ↑
                                    Primary CTA
```

### Add Links Modal (Single URL)

```
┌─────────────────────────────────────────┐
│  Add Links                        [X]   │
├─────────────────────────────────────────┤
│                                         │
│  Paste URL or text containing links:    │
│                                         │
│  ┌─────────────────────────────────┐    │
│  │ https://                        │    │
│  │                                 │    │
│  │                                 │    │
│  └─────────────────────────────────┘    │
│                                         │
│  Category: [ Select... ▾ ]              │
│            [ ] Create new category      │
│                                         │
│           [ Cancel ]  [ Add ]           │
└─────────────────────────────────────────┘
```

### Add Links Modal (Multiple URLs Detected)

```
┌─────────────────────────────────────────┐
│  Add Links                        [X]   │
├─────────────────────────────────────────┤
│                                         │
│  Found 4 URLs:                          │
│                                         │
│  ☑ https://store.com/jacket             │
│  ☑ https://store.com/pants              │
│  ☑ https://store.com/shoes              │
│  ☐ https://tracking.ad/click?... (ad)   │
│                                         │
│  Category: [ Clothing ▾ ]               │
│                                         │
│  [ Select All ] [ Deselect All ]        │
│                                         │
│           [ Cancel ]  [ Add 3 Links ]   │
└─────────────────────────────────────────┘
```

### Clipboard Prompt

```
┌─────────────────────────────────────────┐
│  📋 Link detected in clipboard          │
│                                         │
│  https://example.com/product            │
│                                         │
│  [ Dismiss ]           [ Add to Board ] │
└─────────────────────────────────────────┘
```

### Duplicate Detection

```
┌─────────────────────────────────────────┐
│  ⚠️  This link already exists           │
│                                         │
│  Found in: "Clothing" category          │
│  Added: 3 days ago                      │
│                                         │
│  [ View Existing ]    [ Add Anyway ]    │
└─────────────────────────────────────────┘
```

---

## Input Handling

### URL Extraction Rules

```
Input: "Check out https://a.com and also
        visit http://b.com for more.
        Don't forget www.c.com!"

Extracted:
  ✓ https://a.com
  ✓ http://b.com
  ✓ https://www.c.com (auto-upgraded)

Filtered out:
  ✗ Tracking URLs (utm_*, fbclid, etc.)
  ✗ Known ad domains
  ✗ Malformed URLs
```

### Normalization

| Input | Normalized |
|-------|------------|
| `example.com` | `https://example.com` |
| `HTTP://EXAMPLE.COM` | `https://example.com` |
| `example.com/page?utm_source=x` | `https://example.com/page` |
| `example.com/page#section` | `https://example.com/page` |

---

## Known Extensions / Future States

### Short-term
- **Browser extension** - Add from any page with one click
- **Share sheet integration** - iOS/Android share to Boards
- **Keyboard shortcut** - `Cmd+V` auto-opens add modal if URL in clipboard

### Medium-term
- **Bookmarklet** - Drag to bookmark bar for quick adding
- **Email-to-add** - Send links to a unique email address
- **Slack integration** - Add links shared in Slack channels

### Long-term
- **Auto-save mode** - Save all visited pages matching criteria
- **Import from services** - Pull from Pocket, Instapaper, Pinterest
- **API for integrations** - Let other apps add to Boards

---

## Technical Notes

- URL extraction via `extractUrls()` regex parser
- Duplicate check happens client-side against loaded pins
- Clipboard access requires user gesture (click) on mobile
- `addLink()` handles single additions
- `processLinks()` handles batch additions with queue
