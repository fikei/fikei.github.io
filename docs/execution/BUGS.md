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

| Bug | Description | Location | Found | Status |
|-----|-------------|----------|-------|--------|
| BUG-007 | Sync writes silently lost on network failure — `syncLinkToSupabase()` catches errors and logs to console only. Change exists only in localStorage with no retry. User is never notified. | `boards/index.html` | 2026-02-06 | Open |
| BUG-008 | 30s polling is read-only — cross-device sync polls `fetchFromSupabase()` every 30s but never pushes local changes. Failed writes on device A are invisible to device B. | `boards/index.html` | 2026-02-06 | Open |

---

## Medium Priority

| Bug | Description | Location | Found | Status |
|-----|-------------|----------|-------|--------|
| BUG-003 | `sug.brand` missing single-quote escaping in onclick — brands like "Levi's" or "Arc'teryx" break the JS string | `boards/index.html:4933` | 2026-02-07 | Open |
| BUG-004 | `secureImg()` result not HTML-attribute-escaped in `src` attributes — URL with `"` breaks out of attribute | `boards/index.html:4872, 4927` | 2026-02-07 | Open |
| BUG-005 | Operator precedence bug — `suggestion.url \|\| suggestion.searchQuery ? ...` always resolves to Google search URL, `suggestion.url` is never used as href | `boards/index.html:5147` | 2026-02-07 | Open |
| BUG-009 | CORS proxy failures degrade silently — if both allorigins.win and corsproxy.io are down, `fetchMetadata()` returns empty metadata. Pin gets a URL-generated title and no image. No user notification. | `boards/index.html` | 2026-02-06 | Open |
| BUG-010 | Widget generation has no timeout UX — if `generate-widget` edge function is slow (>5s), the UI shows a spinner indefinitely. No timeout message or retry button. | `boards/index.html` | 2026-02-06 | Open |
| BUG-011 | Logo detection false positives — image filter rejects URLs containing `logo`, `icon`, `profile`, etc. This can reject valid product images (e.g., "iconic-shoe.jpg" contains "icon"). | `boards/index.html` | 2026-02-06 | Open |
| BUG-012 | Category change doesn't re-trigger widgets — changing a pin's category via the kebab menu doesn't re-evaluate widget eligibility. Widgets still show based on the old category until page reload. | `boards/index.html` | 2026-02-06 | Open |

---

## Low Priority / Nice to Fix

| Bug | Description | Location | Found | Status |
|-----|-------------|----------|-------|--------|
| BUG-006 | Widget IDs not escaped in onclick handlers — safe today (hardcoded IDs), defensive concern if IDs become dynamic | `boards/index.html:4821, 5166, 5588` | 2026-02-07 | Open |
| BUG-013 | Expanded card state can desync — if a user expands a card offline, expansion syncs to `expanded_cards` table when back online. If the link was deleted on another device while offline, the expansion state references a non-existent link. | `boards/index.html` | 2026-02-06 | Open |
| BUG-014 | URL tracking param removal incomplete — `cleanUrl()` strips `utm_*`, `fbclid`, `gclid` but misses `mc_cid`, `mc_eid` (Mailchimp), `ref` (some platforms), `s` (Twitter). | `boards/index.html` | 2026-02-06 | Open |
| BUG-015 | Paste detection on tab focus — clipboard checked for URLs on tab switch, "add" prompt appears even if URL was already added. No suppression for recently-added URLs. | `boards/index.html` | 2026-02-06 | Open |
| BUG-016 | Admin email hardcoded — `ADMIN_EMAILS = ['fike101@gmail.com']` in client code. Adding another admin requires a code deploy. Should be database-backed. | `boards/index.html` | 2026-02-06 | Open |

---

## Recently Fixed

| Bug | Description | Fixed | Resolution |
|-----|-------------|-------|------------|
| BUG-017 | `generateId()` produced short hash strings (e.g. "a1b2c3") but `links` table requires UUID primary key — caused 400 on insert | 2026-02-09 | Changed to `crypto.randomUUID()` (`boards/index.html:7331`) |
| BUG-018 | `categorizeWithAI()` fetch missing `apikey` header — caused 401 from Supabase edge function | 2026-02-09 | Added `'apikey': SUPABASE_ANON_KEY` to categorize request headers (`boards/index.html:~7675`) |
| BUG-019 | `syncLinkToSupabase()` payload included `image_scores` column that doesn't exist on live DB (migration 007 never applied) — caused PGRST204 | 2026-02-09 | Removed `image_scores` from sync payload (`boards/index.html:~8079`) |
| BUG-020 | `syncLinkToSupabase()` only logged HTTP status on failure, not response body — made debugging impossible | 2026-02-09 | Now logs `errBody` via `await res.text()` on non-OK responses |
| BUG-021 | `validate-image` edge function was never deployed to Supabase — caused CORS preflight failure on image validation calls | 2026-02-09 | Deployed via `supabase functions deploy validate-image` |
| BUG-022 | `categorize` edge function required JWT verification but client sends anon key — caused 401 | 2026-02-09 | Redeployed with `--no-verify-jwt`; confirmed 200 response 2026-02-13 |
