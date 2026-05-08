# /job design system

Default theme: **Wise** ([wise.design](https://wise.design)) — applied via the `tokens-generic-*.css` files. The `tokens-ctrl-*.css` slots in the picker are reserved for the existing CTRL design system migration.

## Hard rules

These are the Wise rules we follow strictly. Don't break them when adding components.

1. **Sentence case only.** Never `text-transform: uppercase`. No tracked all-caps labels. Headings, button labels, navigation, table headers — all sentence case.
2. **Inter for body, Inter SemiBold for display.** Wise Sans is Wise's display face but it's not freely distributable; we substitute Inter SemiBold and tighten letter-spacing on titles. If we ever ship Wise Sans we drop it into `--font-display`.
3. **4px base spacing scale.** Use `var(--space-N)` only — 1=4, 2=8, 3=12, 4=16, 5=24, 6=32, 7=48, 8=64. No magic numbers.
4. **Generous radius.** Wise's smallest desktop radius is 16px. Cards 30px, buttons pill (`--radius-pill: 999px`). Don't use `border-radius: 4px` anywhere — looks wrong.
5. **Forest Green and Bright Green own the brand.** Light theme: Forest Green (`#163300`) is `--accent` (interactive primary); Bright Green (`#9FE870`) is `--accent-strong` (highlighted nav, accent CTAs, active fit pills). Dark theme inverts: Forest is the base, Bright is the accent everywhere.
6. **Token contract.** Every component reads `var(--bg)`, `var(--fg)`, `var(--accent)`, etc. Never hardcode hex values. The CTRL alternate must expose the same custom-property names.
7. **No emoji or decorative icons unless the user adds them.**

## Type scale (px)

| Token | Size | Use |
|-|-|-|
| `--font-size-display` | 56 | landing headlines (none in /job yet) |
| `--font-size-title-1` | 36 | page H1 |
| `--font-size-title-2` | 28 | section H2, card titles |
| `--font-size-title-3` | 22 | sub-section H3 |
| `--font-size-title-4` | 18 | small heading / strong label |
| `--font-size-body-lg` | 18 | KB document body, lede |
| `--font-size-body` | 16 | default body |
| `--font-size-small` | 14 | meta, table cells |
| `--font-size-caption` | 12 | chips, captions |

Line heights: `--lh-display: 1.1`, `--lh-title: 1.25`, `--lh-body: 1.55`, `--lh-tight: 1.35`.

## Cache busting

Every PR that touches `/job/js` or `/job/css` bumps `VERSION` in `job/js/app.js`. The string is appended to `<link>`/`<script>` URLs and to dynamic `import(...)` calls so GH Pages' 10-minute `max-age` doesn't shadow new deploys.
