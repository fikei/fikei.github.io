# Story: Source-accurate liveness on the Saved bucket — auto-verify on visit, archive dead, feedback in-app

> Back to [Project Plan](./index.md) · Related: [Ladder product tech design](../../infrastructure/technical-design/ladder-product.md), [Recs scoring follow-ups](../ladder-recs-scoring-followups.md)
>
> Persona: primary user (Ian). Surface: `/ladder/jobs/?bucket=leads` (Saved).

## User story

**As** someone who saves a lot of roles, **I want** my Saved list to automatically drop postings that are no longer live whenever I open the page, with a clear note of what changed, **so that** I never waste time on a dead posting and my Saved list is trustworthy without manual pruning.

## Current state (what already exists)

Visiting the Saved bucket already kicks a background liveness sweep — this Story **extends** it, it does not start from zero:

- `ladder-pipeline.js:318` `_maybeAutoLiveness()` runs on first render of the leads bucket, 1h-debounced via `localStorage['job:lastLivenessAt']`, calls the `check-liveness` edge function, refetches the pipeline, and shows a banner **only** when roles flipped to Closed (auto-hides after 20s).
- `check-liveness` (`supabase/functions/check-liveness/index.ts`) probes each Saved role's `url` and **closes only on HTTP `{404, 410, 451}`** (`CLOSE_STATUSES`). A close sets `is_live=false`, `closed_detected_at`, `status='Closed'`, `archived_at`, and appends `status_history`.

## Why it's not enough (gaps found in a manual sweep, 2026-07-09, 47 Saved roles)

1. **False negatives — dead postings still shown (the main problem).** ATS single-page-app URLs return **HTTP 200 even after the posting is pulled**, so the HTTP probe never closes them. Five Saved roles were actually dead — **OpenAI (ChatGPT Healthcare), Garner Health (Sr PM), Anthropic (PM, Enterprise), Mercury (Sr PM, Ledger), Playlist (Founding PM)** — yet all read `is_live=true / 200`. Only hitting the **ATS API by posting ID** (Ashby board list / Greenhouse job endpoint) revealed they were gone.
2. **False positives — live postings flagged dead.** A `403`/`429` (bot-block / rate-limit) is not a closure. Circle Medical's Sr PM was stamped `is_live=false @ 429` while its JD is plainly live.
3. **Unverifiable sources handled as if verified.** LinkedIn (~40% of Saved) returns a login-wall to server-side fetches, so neither the current probe nor a JD fetch can confirm state; ~9 roles were genuinely inconclusive. Today they silently keep whatever HTTP code came back.
4. **Feedback is thin.** The banner only appears on a state-flip and only counts closures — no "couldn't verify" signal, no per-row provenance, no undo.

## Scope

Upgrade liveness from "HTTP status of a URL" to **source-aware verification of a specific posting**, run automatically on visit, with explicit three-state feedback and safe auto-archive.

### In scope
- **Per-source verifiers** keyed off the role's `source`/URL host:
  - **Ashby** — fetch `posting-api/job-board/<org>`, assert the posting UUID is present.
  - **Greenhouse** — `boards-api.greenhouse.io/v1/boards/<org>/jobs/<id>` → 200 live / 404 dead (guard board-exists so a bad slug ≠ closure).
  - **Lever** — `api.lever.co/v0/postings/<org>/<id>` → 200/404.
  - **Workday / custom careers** — JD-content check (title present vs. "no longer available").
  - **LinkedIn** — guest `jobs-guest/jobs/api/jobPosting/<id>`; if login-walled → INCONCLUSIVE.
- **Three states, not two:** `LIVE`, `DEAD` (strong signal only), `INCONCLUSIVE` (403/429/timeout/login-wall/unknown host). **INCONCLUSIVE never archives.**
- **Auto-archive** `DEAD` roles (`status='Archive'`, `archived_at`, `exit_reason='position_closed'`, `status_history` append) so they leave the Saved bucket into Archive.
- **In-app feedback** on visit: a lightweight progress state while checking, then a results summary — e.g. *"Checked 47 · 5 archived (no longer live) · 9 couldn't verify"* — with an **Undo** affordance for the archive batch and a per-row muted "couldn't verify · retry" marker for INCONCLUSIVE.

### Out of scope
- Re-verifying LinkedIn behind auth (would need the user's session / a headless authed fetch) — tracked as a follow-up.
- Changing recommendation (For You) liveness — this Story is the Saved/pipeline bucket only.

## Acceptance criteria

- [ ] Opening `/ladder/jobs/?bucket=leads` auto-runs the sweep (keep the ~1h debounce; add a manual "Check now" override).
- [ ] Ashby/Greenhouse/Lever postings are verified by **posting ID against the source API**, not by HTTP status of the SPA URL. The 5 known-dead roles above would be detected as DEAD.
- [ ] `403`/`429`/timeout/login-wall resolve to **INCONCLUSIVE** and never close/archive a role (Circle Medical stays live).
- [ ] DEAD roles are auto-archived (leave the Saved bucket, land in Archive) with `exit_reason='position_closed'` and a `status_history` entry attributing the close to `liveness-jd`.
- [ ] On completion the page shows a summary count (checked / archived / couldn't-verify) with an **Undo** that restores the archived batch to Saved.
- [ ] INCONCLUSIVE rows show a subtle inline marker with a one-tap retry; they are not hidden.
- [ ] The sweep is non-blocking (list renders first) and resilient (one source's failure never mass-closes — e.g. a transient board-fetch that returns zero must not archive that org's roles).

## Tasks

1. `check-liveness` v2: add a `verifier` layer that dispatches by source/host (reuse the ATS adapters in `supabase/functions/_shared/sources/`), returning `{ state: 'live'|'dead'|'inconclusive', evidence }`. Only `dead` triggers the close/archive write.
2. Add `liveness_state` (text) + keep `liveness_status_code`; stop treating 403/429/timeout as anything but inconclusive.
3. Return a structured result `{ checked, archived:[…], inconclusive:[…] }` from the function.
4. `ladder-pipeline.js`: replace the closures-only banner with a three-part summary + **Undo** (calls `set-archived`/jobs-pipe to restore), and a per-row inconclusive marker + retry.
5. Bump `check-liveness` VERSION + `LADDER_VERSION`; update `ladder-product.md`.

## Open decisions (resolve before build)

1. **Auto-archive vs. one-click on DEAD?** Auto-archive (recommended — the user asked for hands-off; DEAD is a strong, ATS-authoritative signal and Undo covers mistakes) vs. stage them behind a "5 look dead — archive all?" confirm (safer, but reintroduces the manual step this Story removes).
2. **INCONCLUSIVE cadence** — retry silently next visit (recommended) vs. show a persistent "couldn't verify" badge until resolved (more visible, more noise).
3. **LinkedIn** — accept INCONCLUSIVE for now (recommended; ~40% of Saved but unverifiable server-side) vs. invest in an authed-browser verifier this Story (larger scope, own Story).
