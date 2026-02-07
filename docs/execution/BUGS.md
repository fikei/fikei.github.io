# Bugs

Active bugs and issues requiring attention.

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
| - | No high priority bugs | - | - | - |

---

## Medium Priority

| Bug | Description | Location | Found | Status |
|-----|-------------|----------|-------|--------|
| BUG-003 | `sug.brand` missing single-quote escaping in onclick — brands like "Levi's" or "Arc'teryx" break the JS string | `boards/index.html:4933` | 2026-02-07 | Open |
| BUG-004 | `secureImg()` result not HTML-attribute-escaped in `src` attributes — URL with `"` breaks out of attribute | `boards/index.html:4872, 4927` | 2026-02-07 | Open |
| BUG-005 | Operator precedence bug — `suggestion.url \|\| suggestion.searchQuery ? ...` always resolves to Google search URL, `suggestion.url` is never used as href | `boards/index.html:5147` | 2026-02-07 | Open |

---

## Low Priority / Nice to Fix

| Bug | Description | Location | Found | Status |
|-----|-------------|----------|-------|--------|
| BUG-006 | Widget IDs not escaped in onclick handlers — safe today (hardcoded IDs), defensive concern if IDs become dynamic | `boards/index.html:4821, 5166, 5588` | 2026-02-07 | Open |

---

## Recently Fixed

| Bug | Description | Fixed | Resolution |
|-----|-------------|-------|------------|
| - | - | - | - |
