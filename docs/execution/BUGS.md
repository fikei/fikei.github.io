# Bugs

Active bugs and known issues requiring attention.

> See also: [Known Risks](../infrastructure/risks.md) for systemic architecture risks

---

## Critical

| Bug | Description | Location | Found | Status |
|-----|-------------|----------|-------|--------|
| BUG-001 | `item.url` not escaped in href — user-provided URL injected directly into `href` attribute without `esc()` | `boards/index.html:4869` | 2026-02-07 | Open |
| BUG-002 | `sug.productUrl` not escaped in href — AI-returned URL injected directly into `href` attribute without `esc()` | `boards/index.html:4935` | 2026-02-07 | Open |

---

## High Priority

<<<<<<< HEAD
| Bug | Description | Found | Status |
|-----|-------------|-------|--------|
| Sync writes silently lost on network failure | `syncLinkToSupabase()` catches errors and logs to console only. If a write fails (network timeout, Supabase down), the change exists only in localStorage with no retry. User is never notified. | 2026-02-06 | Open |
| 30s polling is read-only | Cross-device sync polls `fetchFromSupabase()` every 30s but never pushes local changes. If a user edits on device A and the sync write fails, device B will never see the edit until the user makes another change on A that succeeds. | 2026-02-06 | Open |
=======
| Bug | Description | Location | Found | Status |
|-----|-------------|----------|-------|--------|
| - | No high priority bugs | - | - | - |
>>>>>>> claude/ai-widget-phase-2-Lgjfd

---

## Medium Priority

<<<<<<< HEAD
| Bug | Description | Found | Status |
|-----|-------------|-------|--------|
| CORS proxy failures degrade silently | If both allorigins.win and corsproxy.io are down, `fetchMetadata()` returns empty metadata. Pin gets a URL-generated title and no image. No user notification. | 2026-02-06 | Open |
| Widget generation has no timeout UX | If `generate-widget` edge function is slow (>5s), the UI shows a spinner indefinitely. No timeout message or retry button. | 2026-02-06 | Open |
| Logo detection false positives | Image filter rejects URLs containing `logo`, `icon`, `profile`, etc. This can reject valid product images (e.g., "iconic-shoe.jpg" contains "icon"). | 2026-02-06 | Open |
| Category change doesn't re-trigger widgets | Changing a pin's category via the kebab menu doesn't re-evaluate widget eligibility. Widgets still show based on the old category until a page reload. | 2026-02-06 | Open |
=======
| Bug | Description | Location | Found | Status |
|-----|-------------|----------|-------|--------|
| BUG-003 | `sug.brand` missing single-quote escaping in onclick — brands like "Levi's" or "Arc'teryx" break the JS string | `boards/index.html:4933` | 2026-02-07 | Open |
| BUG-004 | `secureImg()` result not HTML-attribute-escaped in `src` attributes — URL with `"` breaks out of attribute | `boards/index.html:4872, 4927` | 2026-02-07 | Open |
| BUG-005 | Operator precedence bug — `suggestion.url \|\| suggestion.searchQuery ? ...` always resolves to Google search URL, `suggestion.url` is never used as href | `boards/index.html:5147` | 2026-02-07 | Open |
>>>>>>> claude/ai-widget-phase-2-Lgjfd

---

## Low Priority / Nice to Fix

<<<<<<< HEAD
| Bug | Description | Found | Status |
|-----|-------------|-------|--------|
| Expanded card state can desync | If a user expands a card offline, the expansion syncs to `expanded_cards` table when back online. But if the link was deleted on another device while offline, the expansion state references a non-existent link. Harmless but clutters the table. | 2026-02-06 | Open |
| URL tracking param removal incomplete | `cleanUrl()` strips `utm_*`, `fbclid`, `gclid` but misses other trackers: `mc_cid`, `mc_eid` (Mailchimp), `ref` (some platforms), `s` (Twitter). | 2026-02-06 | Open |
| Paste detection on tab focus | When the user switches to the Boards tab, clipboard is checked for URLs and an "add" prompt appears. This can be annoying if the clipboard URL was already added. No suppression for recently-added URLs. | 2026-02-06 | Open |
| Admin email hardcoded | `ADMIN_EMAILS = ['fike101@gmail.com']` is in client code. Adding another admin requires a code deploy. Should be a database-backed role. | 2026-02-06 | Open |
=======
| Bug | Description | Location | Found | Status |
|-----|-------------|----------|-------|--------|
| BUG-006 | Widget IDs not escaped in onclick handlers — safe today (hardcoded IDs), defensive concern if IDs become dynamic | `boards/index.html:4821, 5166, 5588` | 2026-02-07 | Open |
>>>>>>> claude/ai-widget-phase-2-Lgjfd

---

## Recently Fixed

| Bug | Description | Fixed | Resolution |
|-----|-------------|-------|------------|
| - | - | - | - |
