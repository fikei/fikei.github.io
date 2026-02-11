# Sync Protocol

> How localStorage and Supabase stay in sync

---

## Architecture

The sync model is **local-first with eventual cloud persistence**. localStorage is always the source of truth for the active session. Supabase is the persistence and cross-device sync layer.

```
┌─────────────────────┐         ┌─────────────────────┐
│     localStorage     │         │  Supabase PostgreSQL │
│  (source of truth)   │────────▶│   (persistence)      │
│                      │◀────────│                      │
│  Reads: synchronous  │  async  │  Reads: on login     │
│  Writes: synchronous │  fire & │  Writes: upsert      │
│  Always available    │  forget │  Requires auth       │
└─────────────────────┘         └─────────────────────┘
```

---

## What Syncs

| Data | localStorage Key | Supabase Table | Direction |
|------|-----------------|---------------|-----------|
| Pins (links) | `things-i-like` → `.links` | `links` | Bidirectional |
| Pin ordering | `things-i-like` → `.linkOrder` | `link_order` | Bidirectional |
| Expanded cards | `boards_expanded` | `expanded_cards` | Bidirectional |
| Domain profile cache | `boards_domain_profiles` | `domain_profiles` | Server → Client (read-only) |

### What Does NOT Sync

| Data | localStorage Key | Why Not |
|------|-----------------|---------|
| Widget AI results | `widget_cache` | Ephemeral, regenerated on demand |
| Widget preferences | `widget_prefs` | Local-only UX state |
| Widget feedback | `widget_feedback` | Exported manually, not synced |
| Widget events | `widget_events` | Instrumentation buffer, exported |
| Category filter | `boards_filter` | Per-device UI preference |
| Pending saves | `pending_saves` | Transient offline queue |

---

## Upload (Local → Cloud)

### Per-Pin Sync

**Function**: `syncLinkToSupabase(link)` (~L6174)

Every pin mutation (add, update) triggers an async upload:

```
POST /rest/v1/links
Headers:
  apikey: SUPABASE_ANON_KEY
  Authorization: Bearer {access_token}
  Prefer: resolution=merge-duplicates
Body: {
  id, user_id, url, title, description, image, domain,
  category, confidence, created_at, updated_at,
  content_type, type_confidence, image_source
}
```

- **Method**: POST with `Prefer: resolution=merge-duplicates` (Supabase upsert)
- **Conflict key**: `id` (the URL hash)
- **Auth guard**: Skips silently if `!currentUser` or `!accessToken`
- **Error handling**: `console.error()` only — no retry, no user notification

### Order Sync

**Function**: `syncOrderToSupabase(orderIds)` (~L6220)

```
POST /rest/v1/link_order
Body: { user_id, order_ids: UUID[] }
```

Same upsert pattern. Triggered whenever link order changes (drag, add, delete).

### Delete Sync

**Function**: `deleteLinkFromSupabase(id)` (~L6239)

```
DELETE /rest/v1/links?id=eq.{id}&user_id=eq.{currentUser.id}
```

Triggered when a pin is removed locally.

### Batch Upload

**Function**: `syncToSupabase()` (~L6257)

Uploads all local pins sequentially. Used during:
- First login migration
- Manual "sync to cloud" action

```javascript
for (const link of data.links) {
  await syncLinkToSupabase(link);  // sequential, not parallel
}
await syncOrderToSupabase(data.linkOrder);
```

---

## Download (Cloud → Local)

### Full Fetch

**Function**: `fetchFromSupabase()` (~L6282)

Loads all user data in one shot using three parallel REST queries:

```javascript
const [linksRes, orderRes, expandedRes] = await Promise.all([
  fetch(`/rest/v1/links?user_id=eq.${uid}&select=*`),
  fetch(`/rest/v1/link_order?user_id=eq.${uid}&select=order_ids&limit=1`),
  fetch(`/rest/v1/expanded_cards?user_id=eq.${uid}&select=cards&limit=1`)
]);
```

Returns a complete data object: `{ links, categories, linkOrder, expanded }`.

Categories are inferred from the links (no separate category table).

**Triggered by**:
- Login (`onAuthStateChange`)
- Page load (if already logged in)
- 30-second polling interval (cross-device sync)

### Field Mapping

Server and client use different field names:

| Server (Supabase) | Client (localStorage) |
|-------------------|---------------------|
| `created_at` | `addedAt` |
| `updated_at` | `updatedAt` |
| `content_type` | `content_type` |
| `type_confidence` | `type_confidence` |
| `image_source` | `image_source` |

---

## Conflict Resolution

### Strategy: Last-Write-Wins + User Choice

There's no automatic merge. The system handles conflicts at two levels:

**Level 1: Per-pin (upsert)**

The `Prefer: resolution=merge-duplicates` header means Supabase overwrites the existing row when the `id` matches. Whichever write happens last wins. No field-level merge.

**Level 2: Full dataset (login migration)**

When a user logs in and has both local and cloud data, `migrateLocalToSupabase()` asks:

```
"You have N local links and M cloud links. Merge local data to cloud?"
```

- **Accept**: Local pins are uploaded (upsert — existing cloud pins with same ID get overwritten by local version)
- **Decline**: Local data stays local, cloud data is loaded

### Known Edge Cases

| Scenario | Behavior |
|----------|----------|
| Edit same pin on two devices | Last sync wins, no field-level merge |
| Delete on device A, edit on device B | If delete syncs first, edit creates a new row. If edit syncs first, delete removes it. |
| Offline edits | Saved to localStorage, uploaded on next successful auth |
| localStorage cleared | Cloud data restored on next login |
| Supabase down | App continues with localStorage, sync fails silently |

---

## Offline Behavior

### Anonymous Users

All features work offline. Pins are stored in localStorage and never leave the device. A `pending_saves` queue collects pins added while offline that should be uploaded on eventual login.

### Authenticated Users

1. Pin operations continue via localStorage (no interruption)
2. `sync*ToSupabase()` calls fail silently (catch block logs error)
3. No offline queue for authenticated users — if sync fails, the change is only in localStorage
4. On reconnect, the 30-second polling triggers `fetchFromSupabase()` which re-establishes sync

### Gap

There's no retry queue for failed syncs of authenticated users. If a sync call fails (network error), the change exists only in localStorage until:
- The user makes another change (which triggers another sync attempt)
- The 30-second polling fetches from cloud (but this is read-only — it doesn't push local changes)

This means authenticated users can lose cloud sync of individual changes during network interruptions.

---

## Cross-Device Sync

A 30-second `setInterval` polls for cloud changes:

```javascript
setInterval(async () => {
  if (currentUser) {
    const cloud = await fetchFromSupabase();
    if (cloud) {
      // Compare and merge
      save(mergedData);
      renderGrid();
    }
  }
}, 30000);
```

This is read-only polling — it pulls cloud changes but doesn't push local changes. Push happens only on explicit user actions (add, edit, delete).

**Source**: `boards/index.html` ~L8958

---

## Sync Timeline

```
Page Load
  ├── [0ms] Load from localStorage → first render
  ├── [~100ms] Check stored session
  ├── [~500ms] fetchFromSupabase() → merge → second render
  └── [30s intervals] Poll for cloud changes

User Adds a Pin
  ├── [0ms] Save to localStorage → render card
  ├── [~2s] fetchMetadata() → update card
  ├── [~3s] smartCategorize() → update category
  └── [~100ms after each update] syncLinkToSupabase() (fire-and-forget)

User Logs In (first time, has local data)
  ├── [0ms] onAuthStateChange fires
  ├── [~200ms] Check cloud data count
  ├── [~300ms] Show merge dialog (if cloud has data)
  ├── [~500ms-5s] Upload all local pins sequentially
  └── [done] Toast "Synced N links to cloud"
```

---

*Last updated: 2026-02-05*
