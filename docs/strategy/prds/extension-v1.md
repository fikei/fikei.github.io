# Rodeo Browser Extension PRD

**Version:** v1
**Owner:** Rodeo
**Status:** Draft

---

## 1. Overview

### Objective

Build a privacy-first browser extension that:

1. Captures high-intent Pins (explicit saves) — click, context menu, text selection
2. Captures low-intent History exhaust (behavioral signal) — Phase 2+
3. Persists both to Rodeo backend (Supabase)
4. Powers Rodeo's Taste Graph and Insight Engine
5. Maintains strict separation between declared identity and behavioral signal

The extension is Rodeo's primary ingestion layer.

### Relationship to Existing Data Model

| PRD Concept | Existing Infrastructure | Changes Needed |
|-------------|------------------------|----------------|
| Pin (explicit save) | `links` table (30+ columns) | Add `source`, `selected_text`, `device_id` columns |
| Pin enrichment | `enrich-link` edge function | None — called as-is from extension |
| History event | None | New `browsing_history` table (Phase 3) |
| Taste Graph | `taste-graph` edge function + Taste Map | Extend to accept history signals (Phase 4) |
| Signal weighting | `pin_interactions` table | New `domain_affinity`, `session_clusters` tables (Phase 4) |
| User settings | None | `extension_settings` table + `chrome.storage.sync` (Phase 2) |

---

## 2. Product Vision

Rodeo is a personal signal vault.

The extension transforms browsing into:
- **Declared Taste** (Pins) — high-intent, explicit saves to the `links` table
- **Behavioral Signal** (History) — low-intent, passive browsing data
- **Derived Intelligence** (Taste Graph) — AI-labeled clusters, motifs, bridges

History (Phase 3+) is stored server-side to enable:
- Cross-device unification
- Pattern analysis / drift detection
- Aggregated signal intelligence

Raw browsing data must be minimized before persistence.

---

## 3. Scope

### Phase 1 (This Release)
- Chrome desktop, MV3
- Enhanced pin capture (popup, context menu, text selection)
- Direct-to-Supabase saves with async enrichment

### Phase 2
- Privacy & settings infrastructure (pause toggle, domain blocklist, deletion controls)

### Phase 3
- History capture & ingestion (backfill + live navigation events)
- Safari Web Extension (macOS + iOS forward capture)

### Phase 4
- Taste graph integration (signal weighting, rabbit hole detection, gap analysis)

---

## 4. Core Features

### 4.1 Pin Capture (High Intent) — Phase 1

**Functional Requirements:**
- Click extension icon → popup shows page info → SAVE button writes to `links` table
- Right-click → "Save to Rodeo" context menu → saves directly
- Highlight text → right-click → "Save to Rodeo" → saves with `selected_text`

**Pin Data Model (maps to `links` table):**

| Field | Column | Source |
|-------|--------|--------|
| user_id | `user_id` | From Supabase auth session |
| pin_id | `id` | `crypto.randomUUID()` |
| canonical_url | `url` | `normalizeUrl()` — same as boards |
| title | `title` | From `tab.title`, enriched later |
| description | `description` | Empty initially, enriched by `enrich-link` |
| selected_text | `selected_text` | NEW — user-highlighted text (nullable) |
| timestamp | `created_at` | ISO 8601 |
| device_id | `device_id` | NEW — stable per chrome.storage.local |
| source | `source` | NEW — 'explicit', 'context_menu', 'text_selection' |

**Behavior:**
- Immediately visible in Boards Library
- Deduplication via URL match before insert
- Indexed for search (existing `links` indexes)
- `enrich-link` called async (fire-and-forget) for content type, image, metadata
- Uses `Prefer: resolution=merge-duplicates` for safe upserts

### 4.2 History Capture (Low Intent) — Phase 3

Extension:
- Reads local browser history (initial backfill, configurable window, default 30 days)
- Listens to new navigation events via `chrome.webNavigation.onCompleted`
- Processes events client-side before sending (sanitization pipeline)
- Batches events and sends to `ingest-history` edge function

---

## 5. History Persistence (Backend) — Phase 3

### 5.1 Why Persist

History must be stored server-side to enable:
- Cross-device merging
- Longitudinal trend analysis via `domain_affinity` scores
- Session clustering ("rabbit holes") via `session_clusters`
- Integration with existing `taste-graph` edge function

### 5.2 Data Minimization (Client-Side)

Before transmission:
- Strip query parameters with auth/session tokens
- Hash sensitive URL paths (numeric segments > 5 digits → `:id`)
- Remove PII
- Exclude incognito sessions
- Exclude domains in blocklist (default + user-editable)

### 5.3 History Event Schema

Stored in `browsing_history` table:

| Column | Type | Notes |
|--------|------|-------|
| event_id | UUID | PK |
| user_id | UUID | FK to auth.users |
| device_id | TEXT | Matches `links.device_id` |
| visited_at | TIMESTAMPTZ | When the page was visited |
| canonical_domain | TEXT | e.g. 'github.com' |
| url_hash | TEXT | SHA-256 of canonical URL, never raw URL |
| page_title | TEXT | Truncated to 100 chars |
| referrer_domain | TEXT | Domain only |
| session_id | TEXT | Client-generated, gap-based (30min inactivity) |
| source | TEXT | 'history' (backfill) or 'navigation' (live) |

**UNIQUE constraint:** (user_id, url_hash, date_trunc('day', visited_at)) — one event per URL per day.

### 5.4 Storage Architecture

History is stored **separately from Pins** (different tables in the same Supabase project):

| Store | Table | Optimization |
|-------|-------|-------------|
| Pins | `links` | Durable, rich metadata, indexed for search |
| History | `browsing_history` | Append-only, write-heavy, time-indexed |
| Derived Intelligence | `domain_affinity`, `session_clusters` | Computed periodically from history + pins |

History database must not expose raw browsing logs in user UI.

---

## 6. Retention & Lifecycle — Phase 3

### Default Policy
- History: rolling 12 months (pg_cron daily cleanup)
- Derived signals (`domain_affinity`, `session_clusters`): retained indefinitely unless user deletes
- User may configure shorter retention window (future)

### Deletion Requirements

Cascade-delete on user request:
- `browsing_history` events in time window
- Related `domain_affinity` rows
- Related `session_clusters` rows

---

## 7. Privacy Architecture — Phase 2

### 7.1 User Controls (Mandatory)

Extension popup settings tab:
- Pause history capture toggle
- Domain exclusion editor (one domain per line)
- Delete last hour / last day / full purge buttons
- View signal summary (aggregated only — top domains by affinity)

No raw timeline viewer.

### 7.2 Sensitive Domain Blocking

Default blocklist (hardcoded in extension, merged with user list at runtime):
- Email: mail.google.com, outlook.live.com, mail.yahoo.com
- Banking: chase.com, bankofamerica.com, wellsfargo.com
- Health: mychart.com, myhealth.kaiserpermanente.org
- Government: irs.gov, ssa.gov, usa.gov
- Work SaaS: okta.com, workday.com, adp.com (suffix match)

Enforced client-side before transmission. User-editable.

---

## 8. Taste Graph Integration — Phase 4

### Signal Weighting

| Signal | Weight | Half-Life | Notes |
|--------|--------|-----------|-------|
| Explicit pin | 1.0 | 180 days | High signal, intentional |
| History (5+ visit days) | 0.4 | 60 days | Strong passive interest |
| History (2-4 visit days) | 0.15 | 30 days | Weak signal |
| History (1 visit) | 0 | N/A | Excluded — too noisy |

### Derived Outputs (from `browsing_history` + `links`)

- **Session clustering**: "rabbit holes" — detected from `session_clusters` table
- **Topic emergence**: new domains appearing in history that weren't there before
- **Taste drift**: change in `domain_affinity` scores over time
- **Domain affinity scores**: computed daily, stored in `domain_affinity`
- **Gap detection**: high-affinity domains with zero pins → "You browse X but haven't saved from it"

Raw history never directly surfaces in UI.

---

## 9. Security Architecture

### Transport
- HTTPS/TLS only (Supabase enforces)
- All requests use Supabase JWT (user's `access_token`)

### Storage
- Supabase encryption at rest (default)
- RLS policies on all tables: `auth.uid() = user_id`
- No staff access to raw browsing data

### Extension Security
- Supabase anon key is public (same as in boards/index.html)
- User access token never logged, never in URLs
- `scripting` permission scoped to `https://ctrl.rodeo/*` via host_permissions
- Raw browsing URLs never leave the device (only hashed)

---

## 10. Permissions (Chrome MV3)

### Phase 1
- `activeTab` — read current tab info
- `storage` — cache auth session, device ID
- `contextMenus` — "Save to Rodeo" right-click menu
- `scripting` — read auth from ctrl.rodeo localStorage
- `host_permissions: ["https://ctrl.rodeo/*"]`

### Phase 3 (Additional)
- `history` — read browser history for backfill
- `tabs` — detect tab navigation, check incognito
- `webNavigation` — listen for navigation events

Permission justification: "Rodeo uses browsing history to build your private taste graph. History is private, encrypted, and never shared."

---

## 11. UX Principles

1. Transparent about persistence
2. User-controlled
3. Reversible
4. Minimal
5. Non-invasive

Never surprise the user with inferred sensitive insights.

---

## 12. Non-Goals (v1)

- Social graph
- Public browsing visualization
- Feed-style discovery
- Selling behavioral data
- Raw history viewer

---

## 13. Success Metrics

### Activation
- % install → first pin saved via extension
- % users enabling history capture (Phase 3)

### Depth
- Avg pins per week via extension
- Avg clusters per user (Phase 4)
- % users with 3+ recurring themes (Phase 4)

### Trust
- History opt-out rate (Phase 3)
- Domain exclusion edits (Phase 2)
- Deletion requests (Phase 2)

Healthy trust = high usage + low opt-out + moderate control engagement.

---

## 14. Risks

| Risk | Mitigation |
|------|-----------|
| Breach blast radius (history storage) | Minimize raw data, hash URLs, encrypt at rest |
| Regulatory scrutiny (GDPR/CCPA) | Clear deletion tools, no ad monetization |
| User perception of surveillance | Transparent controls, pause toggle, no raw viewer |
| App Store review friction (Safari) | Phase 3 — clear privacy justification |
| Schema cache miss on new columns | Retry with column stripping (matches boards pattern) |
