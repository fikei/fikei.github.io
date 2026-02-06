# Auth & User System

> How authentication, sessions, and user capabilities work

---

## Overview

Authentication uses Supabase Auth with **passwordless magic link** (email OTP). There are no passwords. Users click a link in their email to sign in, which sets a JWT session in localStorage.

---

## Auth Flow

```
User enters email
    │
    ▼
supabase.auth.signInWithOtp({ email })
    │
    ▼
Supabase sends magic link email
    │
    ▼
User clicks link → redirected to ctrl.rodeo/boards/#access_token=...
    │
    ▼
Supabase client detects hash → sets session in localStorage
    │
    ▼
onAuthStateChange('SIGNED_IN', session) fires
    │
    ▼
currentUser = session.user
    │
    ▼
migrateLocalToSupabase() — upload any local-only pins to cloud
    │
    ▼
fetchFromSupabase() — load cloud data
```

**Source**: `boards/index.html` ~L8570 (sign in), ~L8662 (auth state change), ~L8905 (magic link callback)

---

## Session Management

### Token Storage

Supabase stores the auth session in localStorage under the key:
```
sb-yfhudwakpgzswiylhfbh-auth-token
```

The stored value is a JSON object containing:
```json
{
  "access_token": "eyJ...",
  "refresh_token": "...",
  "user": {
    "id": "uuid",
    "email": "user@example.com"
  }
}
```

**Source**: `boards/index.html` ~L6145

### Token Usage

All Supabase REST API calls include two headers:
```
apikey: SUPABASE_ANON_KEY     (identifies the Supabase project)
Authorization: Bearer {access_token}  (identifies the user for RLS)
```

### Token Refresh

Handled automatically by the Supabase JS client. The client detects expired tokens and uses the refresh token to get new ones. No manual refresh logic in the app.

### Session Restoration

On page load, `init()` checks for a stored session:
1. Read from localStorage (`getStoredSession()`)
2. Set `currentUser` if found
3. Call `supabase.auth.getSession()` to validate with server
4. If valid, proceed with cloud sync

**Source**: `boards/index.html` ~L8914

---

## User Data Model

The app stores minimal user data. Supabase Auth manages the user record.

```
currentUser {
  id: UUID        // Supabase auth user ID, used as FK in all tables
  email: string   // Used for display and admin check
}
```

No user profile table exists. User identity is the auth.users row managed by Supabase.

---

## Capabilities by Auth State

### Anonymous (not signed in)

| Capability | Available |
|-----------|-----------|
| Add pins to localStorage | Yes |
| Browse and filter pins | Yes |
| Client-side enrichment (metadata scraping) | Yes |
| Client-side categorization (rules-based) | Yes |
| View shared boards (public/link visibility) | Yes |
| Record board views | Yes |
| Sync to Supabase | **No** |
| Create shared boards | **No** |
| Server-side enrichment | **No** |
| Widget generation | **No** |
| Cross-device access | **No** |

### Authenticated (signed in)

All anonymous capabilities, plus:

| Capability | Available |
|-----------|-----------|
| Sync pins to Supabase | Yes |
| Load pins from cloud | Yes |
| Create/manage shared boards | Yes |
| Server-side enrichment (enrich-link) | Yes |
| Widget generation (generate-widget) | Yes |
| Cross-device sync (30s polling) | Yes |
| Delete pins from cloud | Yes |
| Persistent link ordering | Yes |
| Persistent expanded card states | Yes |

### Admin

Single admin: `fike101@gmail.com`

```javascript
const ADMIN_EMAILS = ['fike101@gmail.com'];
function isAdmin() {
  return currentUser && ADMIN_EMAILS.includes(currentUser.email);
}
```

Admin-only features:
- Widget management UI
- Content type management (future)
- System metrics (future)

**Source**: `boards/index.html` ~L3513

---

## Auth Guard Pattern

Every Supabase operation checks auth state before proceeding:

```javascript
async function syncLinkToSupabase(link) {
  if (!currentUser) {
    console.log('[sync] Skipped - not logged in');
    return;
  }
  const accessToken = getAccessToken();
  if (!accessToken) {
    console.log('[sync] Skipped - no access token');
    return;
  }
  // ... proceed with API call
}
```

This pattern is repeated in `syncOrderToSupabase()`, `deleteLinkFromSupabase()`, `fetchFromSupabase()`, `migrateLocalToSupabase()`, and `syncToSupabase()`.

**Source**: `boards/index.html` ~L6174

---

## Sign Out

```javascript
await supabase.auth.signOut();
currentUser = null;
updateAuthUI();
```

Sign out clears the Supabase session from localStorage. Local pin data in `things-i-like` is **not** cleared — the user keeps their local copy.

**Source**: `boards/index.html` ~L8599

---

## First-Time Login Data Migration

When a user signs in for the first time and has local-only pins, `migrateLocalToSupabase()` handles the merge:

1. Check if user already has cloud data (`SELECT count(*) FROM links WHERE user_id = ...`)
2. If cloud is empty: upload all local pins silently
3. If cloud has data: show confirmation dialog ("Merge local data to cloud?")
4. On confirm: upload all local pins (upsert — won't duplicate)
5. Also sync expanded card states

**Source**: `boards/index.html` ~L6349

---

*Last updated: 2026-02-05*
