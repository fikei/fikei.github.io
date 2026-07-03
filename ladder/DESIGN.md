# /ladder design system

Default theme: **Wise** ([wise.design](https://wise.design)) — applied via the `tokens-generic-*.css` files. The `tokens-ctrl-*.css` slots in the picker are reserved for the existing CTRL design system migration.

## Hard rules

These are the Wise rules we follow strictly. Don't break them when adding components.

1. **Sentence case only.** Never `text-transform: uppercase`. No tracked all-caps labels. Headings, button labels, navigation, table headers — all sentence case.
2. **Inter for body, Inter SemiBold for display.** Wise Sans is Wise's display face but it's not freely distributable; we substitute Inter SemiBold and tighten letter-spacing on titles. If we ever ship Wise Sans we drop it into `--font-display`.
3. **4px base spacing scale.** Use `var(--space-N)` only — 1=4, 2=8, 3=12, 4=16, 5=20, 6=24, 7=32, 8=40, 9=48, 10=64. Usage: 16 dense card padding, 20 feature card, 24 section gap, 32 page gutter, 40+ hero/empty states only. No magic numbers.
4. **Soft-but-restrained radius, two button shapes.** Scale: sm 10 / md 14 / lg 16 / xl 20 / 2xl 24. Buttons and inputs are 10px rounded-rects (`--radius-sm`); cards 14–16px. Decision CTAs (`.btn--primary`, `.btn--accent`, review footer) are pills; circular (`--radius-pill`) is otherwise reserved for `.icon-btn` and chips. Don't use `border-radius: 4px` anywhere — looks wrong.
5. **Forest Green and Bright Green own the brand — but only for actions.** Light theme: Forest Green (`#163300`) is `--accent` (interactive primary); Bright Green (`#9FE870`) is `--accent-strong`. Green is reserved for **the primary action on each screen** (accent CTAs, active fit pills in score modals). Active nav, tabs, and selected states are **neutral** (`--bg-overlay` + semibold), never green fills — one accented moment per screen. Red appears only on destructive/error surfaces, never in browse lists. Dark theme inverts: Forest is the base, Bright is the accent.
6. **Token contract.** Every component reads `var(--bg)`, `var(--fg)`, `var(--accent)`, etc. Never hardcode hex values. The CTRL alternate must expose the same custom-property names.
7. **No emoji or decorative icons unless the user adds them — with one scoped exception:** inline SVG line icons are permitted in **primary navigation only** (rail + mobile drawer; see `NAV_ICONS` in `ladder-rail.js`). Never in content, cards, lists, or buttons.

## Type scale (px)

| Token | Size | Use |
|-|-|-|
| `--font-size-display` | 56 | landing headlines (none in /ladder yet) |
| `--font-size-title-1` | 24 | page H1 (bold, -0.02em; clamps to 20 on phones) |
| `--font-size-title-2` | 20 | section H2, card titles |
| `--font-size-title-3` | 18 | sub-section H3, inbox group headers, review title |
| `--font-size-title-4` | 16 | small heading / strong label, mobile-bar title |
| `--font-size-body-lg` | 16 | KB document body, lede |
| `--font-size-body` | 15 | default body, row titles, buttons |
| `--font-size-small` | 13 | meta, table cells, digests |
| `--font-size-caption` | 12 | chips, captions |

Line heights: `--lh-display: 1.1`, `--lh-title: 1.25`, `--lh-body: 1.5`, `--lh-tight: 1.35`.
Control heights: buttons 40 (`.btn--sm` 32); thumb-critical controls stay 48 (review decision footer, drawer rows); desktop rail rows 40.
Weights: `--fw-medium: 500`, `--fw-semibold: 600`, `--fw-bold: 700` (page H1s + inbox group headers are bold).
Light surfaces are warm-neutral: `--bg #FAFAF9`, `--bg-surface #F4F4F2` — no green tint; color comes from content and the single accent.

## Naming (v2.17)

Nav labels are one-word nouns in sentence case; URLs and DB status values never change when labels do.

| Surface | Name | Notes |
|-|-|-|
| /ladder/jobs/recommended/ | **Inbox** | Top-level nav item (the daily loop), not under Jobs. Formerly "For You". |
| /ladder/jobs/ buckets | **Saved · In progress · Archive** | Display labels; DB status values stay `Saved/Active/Archive` (`STATUS_LABELS` in ladder-pipeline.js). |
| /ladder/history/ | **Profile** | Formerly "Your career". |
| /ladder/vision/ | **Search plan** | Subpages: Targets · Signals · Rules · Sources. |
| Page titles | `<Page> — Ladder` | No slash-prefix branding anywhere ("Ask Ladder", gate says "Ladder"). |

## Core patterns (v2.15)

The For You surface follows a **triage, don't browse** model (inbox → review → decide):

| Pattern | Classes | Rules |
|-|-|-|
| Inbox groups | `.inbox`, `.inbox-group`, `.inbox-card`, `.inbox-row` | New roles batch by arrival date ("Today · 3 roles"). One elevated card per day, hairline dividers between rows. Rows show logo + full wrapped title + `company · location` and exactly one affordance: **Review**. Never put scores, accept/reject buttons, or kebab menus on inbox rows. |
| Review overlay | `.review`, `.review__dots`, `.review__foot`, `.review__scores` | Full-screen, one role at a time, progress dots (≤12) or an "n of N" counter. Header card order: role, company · location, **score pills** (fit + strength — the most critical data after the name), salary, company description, source line. Sticky footer with exactly two decisions: "Not for me" (neutral) / "Save role" (accent). Company-level actions live behind the top-bar ⋯. |
| Verdict cards | `.verdict-card`, `.verdict-chip` | Qualitative fit first: "Excellent / Solid / Borderline on <dimension>" + one-sentence rationale, issues sorted first. Numeric bars live in the score modal (opened from the header pills) — pills appear on detail/review headers, never in browse lists. |
| Collapsed JD | `.jd-collapse` | Raw scraped posting text is never the reading surface; it collapses behind "Original posting text". Summaries and match bullets lead. |
| Page ⋯ menu | `.page-menu` | Operational controls (refresh sources, quality-floor toggle, expiry info) live behind one ⋯ in the page header — machinery stays out of the reading flow. Sourcing config (watched companies) lives on /ladder/vision/. |
| Chat launcher | `.chat-fab` | Fixed 44px bubble top-right on every page (neutral surface, chat glyph). Never a floating bottom FAB over list content. |
| Search plan | `.vf-tabs`, `.vf-summary` | Landing = summary view: plan-strength bar + one tappable digest row per section. Sections (Targets · Signals · Rules · Sources) switch via `?section=`. Advanced (score weights, raw plan, unknown fields) folds at the bottom of Signals; Story lives on Profile → Narratives. |

## Cache busting

Every PR that touches `/ladder/js` or `/ladder/css` bumps `VERSION` in `ladder/js/app.js`, the `?v=` on every HTML `<link>`/`<script>`, **and the `@import url("./components.css?v=…")` inside `base.css`** — that import is the easy one to forget and it silently pins component styles to the 10-minute edge cache.
