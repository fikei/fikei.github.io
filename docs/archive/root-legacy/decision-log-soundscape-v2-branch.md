# Decision: Kill `claude/soundscape-design-system-Cz849`

**Date:** 2026-02-07
**Status:** Recommended — Close branch
**Branch:** `claude/soundscape-design-system-Cz849` (26 commits, 33K lines, 40 files)

## Context

Branch attempted a complete Soundscape V2 rewrite — replacing the theme-based system (5 themes, 59 controls) with a composable layer architecture (6 element primitives, 4 motion systems, 3 filters, 20 universal controls).

Despite the branch name, **it does not touch `design-system/` or `systemic/`**. "Design system" refers to the internal visual composition model of soundscape only.

## What's on the Branch

- **V2 core**: Composable layer stack (up to 10 layers), render engine, defaults
- **Elements**: LINES, POINTS, GRIDS, STARS, BLOBS canvas primitives
- **Motion**: CRUNCH-WAVE, ORGANIC, DIRECTIONAL, CURSOR INTERACTION
- **Audio**: Standalone FFT engine (replaces Meyda), beat detection, 4 frequency bands
- **Filters**: COLOR, GLOW, CHROMATIC post-processing pipeline
- **Animation**: 6 color modes + 6 animation modes
- **Config**: Feature flag system with instant V1 rollback
- **Docs**: 12 markdown files (~10K lines of sprint completion reports)

## Why Kill It

1. **Zero overlap with design-system/ or systemic/** — purely a soundscape rewrite
2. **Complete paradigm replacement** — can't cherry-pick; it's all-or-nothing
3. **Drops the companion/server model** — V2 is client-only, losing the working WebSocket pairing and mobile companion features from V1
4. **Self-reported 92% parity** — AI-generated across 26 commits, untested against real usage
5. **Injects a redirect into `index.html`** — would break existing production flow
6. **12 AI progress-log docs** would clutter the repo

## Ideas Worth Keeping (Backlog)

| Idea | Source | Notes |
|------|--------|-------|
| Composable layer model | V2 core architecture | Good UX direction — let users stack elements instead of picking one theme. Needs fresh design. |
| Universal cursor modes | `v2/motion/cursor-interaction.js` | ATTRACT, ORBIT, DISPLACE in addition to V1's REPEL. |
| Audio opt-in default | V2 design decision | Audio reactivity OFF until user enables. Easy UX toggle. |
| Feature flag + rollback pattern | `config.js` | Useful pattern for any future major rewrite. |
