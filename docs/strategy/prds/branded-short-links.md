# Branded Short Links

**Status:** Shipped
**Date:** 2026-02-20
**Scope:** Board + pin share links

## Problem

Share links expose implementation details and are too long for social sharing:
- Boards: `ctrl.rodeo/boards/share.html?id=my-fashion-board`
- Pins: no share link existed — copied the raw destination URL

## Solution

Two branded short link formats using 8-char random codes:

| Type | Format | Example |
|------|--------|---------|
| Board | `ctrl.rodeo/b/{slug}` | `ctrl.rodeo/b/k9xm3rtw` |
| Pin | `ctrl.rodeo/p/{code}` | `ctrl.rodeo/p/j7nm2qvx` |

Both use the same pattern: 8-char alphanumeric code, stored in the database, looked up by the 404 router.

## How It Works

GitHub Pages serves `404.html` for any path that doesn't match a file. The 404 page acts as a client-side router:

### Board links (`/b/`)
```
ctrl.rodeo/b/k9xm3rtw
  -> 404.html matches /b/{slug}
  -> redirect to /boards/share.html?id=k9xm3rtw
```

### Pin links (`/p/`)
```
ctrl.rodeo/p/j7nm2qvx
  -> 404.html matches /p/{code}
  -> fetch links.url from Supabase where short_code = j7nm2qvx
  -> redirect to destination URL
```

### Pin short codes
- Generated on first share (not on link creation) to avoid overhead
- 8-char alphanumeric, same format as board slugs
- Stored in `links.short_code` column (unique, indexed)
- No UUID or internal ID exposed in the URL

### Backward Compatibility

Old-format links (`/boards/share.html?id=...`) continue to work. Only newly generated share links use the short format.

## Migration Required

```sql
-- 017_pin_short_codes.sql
ALTER TABLE links ADD COLUMN IF NOT EXISTS short_code TEXT UNIQUE;
CREATE INDEX IF NOT EXISTS idx_links_short_code ON links (short_code) WHERE short_code IS NOT NULL;
```

Run this migration on the Boards Supabase project (`yfhudwakpgzswiylhfbh`) before deploying.

## Files Changed

| File | Change |
|------|--------|
| `404.html` | Client-side router: `/b/{slug}` and `/p/{short_code}` |
| `boards/index.html` | Board share uses `/b/`, pin share generates + saves short code |
| `supabase/migrations/017_pin_short_codes.sql` | New `short_code` column on `links` |
| `docs/strategy/prds/branded-short-links.md` | This brief |

## Brand Impact

- Clean, 8-char links for sharing in bios, messages, social
- `ctrl.rodeo/b/` and `ctrl.rodeo/p/` — consistent, concise, recognizable
- No implementation details or internal IDs leak into shared URLs
- Extensible namespace: `/u/` for profiles, `/c/` for collections
