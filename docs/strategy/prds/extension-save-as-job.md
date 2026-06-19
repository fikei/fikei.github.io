# Brief: "Save as Job" — Chrome Extension Context Menu

**Status:** Draft · **Owner:** Ian · **Date:** 2026-06-16
**Surface:** `extension/chrome/` · **Backend:** `add-role` edge function · **App:** `ctrl.rodeo/ladder`

---

## 1. Problem

Capturing a job today means leaving the page, opening `ctrl.rodeo/ladder`, and re-entering a URL. Friction kills capture. A user reading a job posting (LinkedIn, company careers page, a job board) should be able to save it in one right-click — and trust that it lands in the right place even if that role is already somewhere in their pipeline.

## 2. What we're building

A context-menu item — **"Save as job"** — that appears when the user right-clicks a link (or the current page). On click it sends the URL to the backend, which **reconciles against any existing representation of the job** and ensures the role ends up in the **Saved** section. The user gets **inline feedback on the page they're already on** — no tab switch.

## 3. Why this is mostly a thin client

The hard part — identity and reconciliation — already exists server-side. The extension is a trigger + a toast.

- **Identity is by deterministic slug, not URL.** `roleSlug(company, title)` (`supabase/functions/_shared/job-auth.ts:142`) produces e.g. `stripe-senior-product-manager`. URL is a reference field only and is **not** unique.
- **`add-role` already reconciles.** It infers company/title from the page (JSON-LD → og:title → `<title>` → host), generates the slug, and does `on conflict (slug) do update` (`supabase/functions/add-role/index.ts:389`), which also **clears `deleted_at` / `archived_at`** — i.e. resurrects an archived role.
- **New roles default to `status='Saved'`** (`add-role/index.ts:387`).
- **The extension already exists** (`extension/chrome/manifest.json`, MV3 v2.2.0) and already requests `contextMenus`. No new permission grant needed beyond wiring the menu item.

**Implication:** we do not write custom dedup logic. The extension POSTs a URL; the backend merges LinkedIn + careers-page + job-board links into one record by slug.

## 4. Reconciliation rules (the one real decision)

`add-role`'s upsert covers the common case but has one gap worth a decision: **a role that is currently `Active` (being pursued) or `Archive` (rejected).** Right now the upsert updates URL/title/company and unsets soft-delete flags, but does **not** force `status` back to `Saved`. Re-saving an in-flight role should not silently demote it.

**Recommended behavior:**

| Existing record state | On "Save as job" |
|---|---|
| Not found | Insert new, `status='Saved'` |
| Soft-deleted (`deleted_at`) | Resurrect → `status='Saved'` |
| `Archive` | Resurrect → `status='Saved'` (user is reconsidering) |
| `Saved` | No-op merge; refresh URL/metadata |
| `Active` (has `stage`) | **Keep `Active`**, refresh metadata; toast says "Already in your pipeline (Interviewing)" |

This needs a small `add-role` change: return a `reconciliation` field (`created` \| `moved_to_saved` \| `already_saved` \| `already_active`) so the extension can word the toast correctly. That's the only backend work.

## 5. UX — feedback on the current page

A content-script toast injected into the active tab (the page the user right-clicked on). States:

- **Saving…** — optimistic, fires immediately on click.
- **Saved** — "Saved to your pipeline" + the detected `company · title` so the user can confirm the right-click grabbed the right link.
- **Moved to Saved** — "Was archived — moved back to Saved."
- **Already there** — "Already in your pipeline (Active · Interviewing)."
- **Needs sign-in** — "Sign in to ctrl.rodeo to save jobs" + button opening `/ladder`.
- **Couldn't read this page** — when company/title inference is weak; offer "Open in ctrl.rodeo to fix."

Each toast carries a link to the role detail page (`/ladder/jobs/<slug>`). Auto-dismiss ~4s.

## 6. Auth

The extension must call `add-role` with the user's Supabase session JWT (localStorage key `sb-yfhudwakpgzswiylhfbh-auth-token` on ctrl.rodeo). The extension already talks to ctrl.rodeo via content scripts — read the token from the ctrl.rodeo origin (or have the popup capture it on sign-in). If no valid session, short-circuit to the "Needs sign-in" toast rather than firing the request.

## 7. Flow

```
right-click link → "Save as job"
        │
background.js: read session JWT for ctrl.rodeo origin
        │  (no token → inject "sign in" toast, stop)
        ▼
POST /functions/v1/add-role  { url, source: "extension" }
        │  Bearer <jwt>
        ▼
add-role: infer company/title → roleSlug → upsert on slug
        │  apply reconciliation rules (§4)
        ▼
returns { slug, company_name, title, status, stage, reconciliation }
        │
content script: render toast on the current page (§5)
```

## 8. Scope

**In:** context-menu item (link + page targets); JWT retrieval; `add-role` call with `source:"extension"`; reconciliation field added to `add-role`; on-page toast with all states; deep link to role detail.

**Out (v1):** editing fit/notes from the toast; bulk-save; non-Chrome browsers; offline queue; capturing JD body text (server already fetches the page).

## 9. Open questions

1. **Active-role demotion** — confirm we keep `Active` untouched on re-save (§4). *Recommend yes.*
2. **Token source** — read JWT from ctrl.rodeo origin via content script, or require sign-in inside the extension popup? *Recommend reuse the origin token; popup is fallback.*
3. **Weak inference** — when company/title can't be confidently parsed, do we still create a `Saved` record (and let the user fix it in-app) or block and prompt? *Recommend create + flag, to preserve one-click capture.*

## 10. Build steps

1. `add-role`: add `reconciliation` to response; apply §4 status rules; bump `VERSION`.
2. `extension/chrome/manifest.json`: register `contextMenus` item (already permissioned).
3. `extension/chrome/background.js`: create menu, on click resolve JWT + POST `add-role`, message the tab.
4. New content-script toast module + styles; render result states.
5. Deploy `add-role`; bump extension version; test against an already-archived role to confirm resurrection.
