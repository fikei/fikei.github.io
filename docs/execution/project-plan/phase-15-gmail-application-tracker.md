# Phase 15: Gmail Application Tracker (Phase 2.0)

> Back to [Project Plan](./index.md)
>
> **Reference**: [PRD: Gmail Application Tracker](/docs/strategy/prds/gmail-application-tracker.md)
>
> **Predecessor**: [Phase 14 — Gmail Jobs Pipe](./phase-14-gmail-jobs-pipe.md)
>
> **Vision**: Same Gmail OAuth + scan tick as Phase 1, second pass: classify inbox messages that look like progress on open applications, attach them to a `pipeline_role`, auto-advance forward stages, surface offers / rejections / stale / calendar-today / new-update as a single chip on the pipeline row and a Needs-Attention card on /ladder/jobs/.

---

## Goal

Every email response on an open application gets classified, attached to the role, and timestamped on a per-role timeline. Stage auto-advances forward on high-confidence signals; offers + rejections never auto-apply.

## Success Criteria

- [x] `job.application_events` table + `pipeline_roles` columns (`gmail_thread_ids`, `last_activity_at`, `process_outline`) live
- [x] Haiku classifier emits one of 9 event types with confidence + optional round metadata
- [x] gmail-jobs source plugin runs a second-pass scan over pipeline-domain / ATS-platform senders
- [x] Auto-advance writes `auto_applied=true` on forward stages (applied → interviewing); offers + rejections set `needs_review=true` instead
- [x] `application-events` function exposes `list` / `needs-attention` / `ack` / `backfill` actions
- [x] `needs_user_reply` derived per-thread on demand (walks Gmail thread, looks for outbound from fike101@gmail.com after latest inbound, ≥ 24h grace)
- [x] `calendar-api` `role-matched-events` action returns 48h-window events matched to roles by attendee domain → title-token (ambiguous = no match)
- [x] Drill page Activity tab + process-tracker strip live
- [x] Pipeline rows render single highest-priority signal chip
- [x] Needs-Attention widget above the Active table (hidden when 0 actionables)
- [x] Live-arrival banners (≤ 30 min) with persisted dismissal
- [ ] 30-day backfill triggered + complete

## Decisions locked (per PRD)

1. Auto-advance forward only. Offers + rejections wait for user touch.
2. Top-level `stage` enum unchanged. Granularity in `application_events.round_label` + `pipeline_roles.process_outline`.
3. Process detection ranking: recruiter_email > jd_extract > inferred_from_events. Higher source never overwritten by lower.
4. Backfill: 30 days, Active applied roles only. Explicit signals only for `process_outline` on backfill (no inferred).
5. Stale-14d nudge is **on-open only** — no banner, no push.
6. Calendar read pulled into 2.0 (narrow slice: 48h events.list + attendee-domain / title-token match).

---

## Out of Scope — Phase 2.1+ (Deferred)

- Calendar match precision tightening (recurring interviews, multi-role-per-company)
- Reply-cadence analytics ("they reply in 4d on average — it's been 5d")
- Multi-role-per-company disambiguation
- Cross-thread classifier retry / quarantine queue

---

## Epic 1: Schema + Classifier

### Story 1.1 — Migration

| Task | Status |
|------|--------|
| Migration 069 — `job.application_events` table with `event_type` check enum + indexes | ✓ |
| `pipeline_roles.gmail_thread_ids text[]`, `last_activity_at timestamptz`, `process_outline jsonb` | ✓ |
| GIN index on `gmail_thread_ids`; partial index on `last_activity_at` | ✓ |
| Applied via supabase-boards MCP | ✓ |

### Story 1.2 — Haiku Classifier

| Task | Status |
|------|--------|
| `_shared/gmail-application-classifier.ts` with 9-value event_type enum + per-type confidence floors + auto-advance mapping | ✓ |
| Tolerant JSON parser mirroring gmail-jobs.ts patterns | ✓ |
| `ATS_PLATFORM_DOMAINS` allowlist (Greenhouse / Lever / Ashby / Workday / Smart / etc.) | ✓ |

### Story 1.3 — Application-scan Module

| Task | Status |
|------|--------|
| `_shared/gmail-application-scan.ts` — match (thread → domain → ATS+name) → classify → insert → auto-advance | ✓ |
| Thread association only after confidence ≥ 0.8 (poison resistance) | ✓ |
| Forward stage rank check prevents backward auto-advance | ✓ |
| `process_outline` update with source ranking + backfill-explicit-only rule | ✓ |

---

## Epic 2: Edge Functions

### Story 2.1 — gmail-jobs side-effect

| Task | Status |
|------|--------|
| `scanApplicationResponses` called at end of `gmail-jobs.ts` `pull()`; non-fatal on error | ✓ |
| `pull-recommendations` v0.7.0 deployed | ✓ |

### Story 2.2 — application-events

| Task | Status |
|------|--------|
| New function `application-events` with `list` / `needs-attention` / `ack` / `backfill` actions | ✓ |
| `needs_user_reply` derived via Gmail thread walk (capped at 10 threads per request) | ✓ |
| Backfill self-paced batches of 5 messages | ✓ |
| Deployed to Boards | ✓ |

### Story 2.3 — calendar-api role-matched-events

| Task | Status |
|------|--------|
| `role-matched-events` action — 48h events.list + attendee-domain / title-token match | ✓ |
| Ambiguous matches → no chip (silent fail) | ✓ |
| `calendar-api` v1.5.0 deployed | ✓ |

---

## Epic 3: Frontend

### Story 3.1 — Shared client

| Task | Status |
|------|--------|
| `ladder/js/applicationEvents.js` — list / needs-attention / ack / backfill / role-matched-events | ✓ |
| `loadRoleSignals()` aggregates needs-attention + calendar matches into one `Map<roleSlug, highestPrioritySignal>` | ✓ |

### Story 3.2 — Pipeline row chip + widget + banners

| Task | Status |
|------|--------|
| `signal` column added to pipeline table with single highest-priority chip per row | ✓ |
| `Needs-Attention` widget above Active table — one card per actionable role, hidden when empty | ✓ |
| Live-arrival banners (< 30 min, auto-fade, dismissal persisted) | ✓ |
| `.signal-chip` + `.needs-attention` + `.live-banner` CSS using existing semantic tokens | ✓ |

### Story 3.3 — Drill page

| Task | Status |
|------|--------|
| Activity tab on drill page — reverse-chron event list + per-event "you haven't replied yet" flag | ✓ |
| Source-email link per event (📧) | ✓ |
| Ack button on `needs_review` events | ✓ |
| Process-tracker strip below role header rendering `process_outline.rounds` | ✓ |
| Auto-load activity on drill page open (process tracker visible on all tabs) | ✓ |

---

## Epic 4: Backfill + Verification

### Story 4.1 — 30-day backfill

| Task | Status |
|------|--------|
| Trigger `application-events { action: 'backfill', batchSize: 5 }` until empty | Pending |
| Verify Active roles with applied_at >= 30d picked up | Pending |

### Story 4.2 — Live verification in Chrome

| Task | Status |
|------|--------|
| Drill page Activity tab renders for a role with events | Pending |
| Pipeline row chip visible on Active rows | Pending |
| Needs-Attention widget shows when actionables exist | Pending |
| Process-tracker strip renders when `process_outline` populated | Pending |

---

## Epic 5: Updates Queue — Proactive Resolution (v2.29)

Rev 2 of the post-application journey. The system now ACTS on high-confidence
outcomes instead of parking them behind acknowledgment, and all notification
surfaces collapse into one Updates queue at the top of every Jobs bucket page.
Design pattern documented in `ladder/DESIGN.md` (Updates queue / Signal chips).

### Story 5.1 — Proactive auto-resolution (backend)

| Task | Status |
|------|--------|
| Migration 103: `auto_action`, `prev_state`, `undone_at`, `dismissed_at` on application_events; `no_response_timeout` event type; `stale-sweep` source | ✓ |
| `AUTO_RESOLVE` policy: offer ≥0.85 → stage Offer; rejection ≥0.75 → Archive with stage-mapped exit_reason (`mapRejectionExitReason`) | ✓ |
| New exit reason `rejected_no_interview` (jobs-pipe + frontend EXIT_REASONS) | ✓ |
| 30-day applied-quiet sweep → Archive as `applied_no_response` (synthetic event, undo-sticky) | ✓ |
| application-events v1.6.0: `updates` feed, `resolve`, `undo` (from `prev_state`, any time), `dismiss` (server-persisted) | ✓ |
| reply_pending in the aggregated feed (events ≤14d, ≤10 thread walks) | ✓ |

### Story 5.2 — Updates queue UI (frontend)

| Task | Status |
|------|--------|
| `.updates-queue` card on every Jobs bucket page — inbox-row pattern, one action per row + × dismiss | ✓ |
| Live banners + Needs-Attention widget deleted (markup, handlers, CSS) | ✓ |
| Signal chips unified with queue taxonomy (icon + short label, click → scroll/highlight queue row) | ✓ |
| Emoji replaced with inline SVG line icons (queue, chips, activity tab) | ✓ |
| Toast host supports inline action (Undo, 8s) | ✓ |
| Role-detail Activity tab: Undo on auto-actions, one-click resolve on prompts | ✓ |

### Story 5.3 — Verification

| Task | Status |
|------|--------|
| Seed offer/rejection/low-confidence events; verify auto_action + prev_state + role mutations | Pending |
| Undo restores prior status/stage/exit_reason; queue row clears; re-sweep blocked | Pending |
| Chrome pass: queue on all buckets, chip click highlight, dismissals persist across reload | Pending |

### Story 5.4 — Updates queue → Inbox (Today surface MVP) (v2.32)

| Task | Status |
|------|--------|
| Extract queue into standalone `<ladder-updates>` (feed + calendar + closures + easy-apply digest, actions, dismissals) | ✓ |
| Role closures (liveness `closedDetectedAt`) become queue rows; red closed-banner deleted (markup + CSS) | ✓ |
| Mount at top of Inbox (/ladder/jobs/recommended/) — Inbox is the MVP "Today" surface | ✓ |
| Queue removed from Jobs bucket pages; Signal chips stay (click falls through to role page) | ✓ |
| Mutations dispatch `job:pipeline:refresh` so open tables re-sync | ✓ |

### Story 5.5 — Type batching in the Updates queue (v2.33)

| Task | Status |
|------|--------|
| Same-kind rows collapse into one group row (count badge, company preview, latest timestamp) | ✓ |
| "Show all N" expander → inset drawer of individual rows, each with its own action + × | ✓ |
| Group × dismisses every instance (server dismiss for event rows, local keys for synthetic) | ✓ |
| Bespoke closure digest replaced by the generic grouping (closures emit per-role again) | ✓ |

### Story 5.6 — Closures as first-class events (v2.34)

| Task | Status |
|------|--------|
| check-liveness v0.3.0: closure → status=Archive + exit_reason=role_closed + role_closed event (prev_state, idempotent per role) | ✓ |
| Migration 107: role_closed event type, liveness source, archived_closed auto_action; backfill legacy 'Closed' roles + last-7d closure events | ✓ |
| application-events v1.7.0: archived_closed records in the updates feed | ✓ |
| Client-side closure synthesis removed — dismissals now server-persisted (cross-device) | ✓ |
