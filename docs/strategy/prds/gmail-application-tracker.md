# Gmail Application Tracker

**Status:** DRAFT brief — open questions resolved, ready for `/plan`
**Predecessor:** [Phase 1 Gmail → Jobs Pipe](./gmail-jobs-pipe.md), [Phase 1.5 Enrichment](./gmail-jobs-pipe-phase-1-5-enrichment.md)
**Last updated:** 2026-05-11

---

## TL;DR

Same Gmail OAuth + scan tick we already have, second pass: for each inbox message **not** classified as a job alert, ask "is this a response on an open application?" If yes, classify with Haiku, attach to a `pipeline_role`, and either auto-advance the stage forward or surface for confirmation. Capture per-role process detail (number of rounds, what each round is) without expanding the top-level `stage` enum.

---

## Why this is cheap to build

- **OAuth + scan tick already exist** (Phase 1). Same `listSinceCursor` cursor walks the inbox on a `*/30 * * * *` cadence.
- **`pipeline_roles` already has `stage` and `engaged_at`.** The new layer is *event-level* metadata, not a status taxonomy change.
- **Calendar OAuth already exists** (`calendar-api`). Interview-event linkage in Phase 2.1 is "scope an extra scope," not a new auth surface.
- **Haiku classification is the only LLM call** added per message. Cost is the same shape as the digest-fan-out we already pay.

---

## Architecture

```
gmail-scan tick (existing, every 30 min)
  ↓ listSinceCursor via existing token
  ↓ message stream
  ├── existing path: aggregator alerts → recommendations
  └── NEW path: message NOT classified as a job alert
       ↓
       1. Match message → pipeline_role
          a. Thread continuity: gmail_thread_id ∈ role.gmail_thread_ids → role X
          b. Sender domain matches role.company_domain  → role X candidates
          c. ATS-platform sender (greenhouse.io / ashby.com / lever / smartrecruiters):
             extract company + role from body, match against pipeline by company+title fuzzy
          d. None of the above → skip silently
       2. Haiku classify { event_type, stage_hint, summary, round_label, round_n,
                          expected_total_rounds, confidence }
       3. Insert job.application_events row (unique on Message-ID)
       4. Apply auto-advance: forward stages only, confidence ≥ floor
       5. Update role.last_activity_at + role.gmail_thread_ids + role.process_outline
```

Only messages from **companies already in pipeline** (or via known ATS sender domains). Inbox stays private by default; we never persist raw bodies.

---

## Event taxonomy

The Haiku classifier emits one of:

| event_type | → maps to stage | Confidence floor | Auto-advance? |
|---|---|---|---|
| `applied_confirmation` ("thanks for applying") | applied | 0.8 | **yes** |
| `screen_scheduled` (recruiter scheduling first call) | interviewing | 0.8 | **yes** |
| `next_round_invited` | interviewing | 0.7 | **yes** |
| `take_home_assigned` | interviewing | 0.8 | **yes** |
| `offer_received` | offer | 0.85 | no — surface for confirmation |
| `rejection_any_stage` | archive | 0.75 | no — surface, ask for `exit_reason` |
| `follow_up_needed` ("are you still interested?") | unchanged | — | no, surface |
| `interview_rescheduled` | unchanged | — | no, surface |
| `informational` (newsletter, no state change) | unchanged | — | no |

**Auto-advance policy (locked):** forward stages auto-apply. Offer + rejection require user touch — both for user trust and because rejection needs to capture `exit_reason` (the data feedback loop that powers preference tuning).

---

## Stage handling: structured at the top, unstructured underneath

Two layers:

### Top-level `stage` (structured)

The existing 4-value enum stays exactly as is:

```
drafting → applied → interviewing → offer
```

This drives the **filter tabs on the Active bucket** (already built), the count chips, the bucket logic. Predictable, queryable, comparable across companies — clean for ranking and filtering at scale.

### Per-event round metadata (unstructured)

Every `application_events` row carries optional fields the classifier extracts when the email is explicit:

- **`round_label`** (free text) — `"recruiter screen"`, `"hiring manager"`, `"system design"`, `"onsite — coding round 2"`. Whatever the email calls it.
- **`round_n`** (integer) — when the email says "round 2 of 4" or similar, capture it.

The drill page timeline renders these as a chain (`recruiter screen → take-home → onsite round 1 → …`) without forcing every company into the same shape. A company that runs 3 onsites and a company that runs 1 phone screen both fit the same model.

### Per-role process outline (semi-structured)

Add `pipeline_roles.process_outline` (jsonb, nullable):

```json
{
  "expected_total_rounds": 5,
  "rounds": [
    { "label": "recruiter screen", "order": 1, "completed": true },
    { "label": "take-home assessment", "order": 2, "completed": true },
    { "label": "onsite — coding", "order": 3, "completed": false },
    { "label": "onsite — system design", "order": 4, "completed": false },
    { "label": "debrief / final", "order": 5, "completed": false }
  ],
  "source": "recruiter_email | jd_extract | inferred_from_events",
  "confidence": 0.0–1.0,
  "last_updated_at": "ISO8601"
}
```

This stays *per role* — never aspires to be a shared taxonomy. The point is to answer "how many phases am I expected to go through?" for *this* application.

---

## Process / round detection — three signals

How we populate `process_outline.expected_total_rounds` and `rounds`:

### 1. Explicit recruiter email (highest confidence)

Recruiter intros often describe the process upfront:

> *"Our interview process has 4 stages: a 30-min recruiter call, a take-home assessment, an onsite (4 rounds), and a debrief with the team."*

Haiku is good at extracting this kind of structured language. Confidence: 0.85+. Source = `recruiter_email`.

### 2. JD body extract (mid confidence)

Some JDs describe their process. We already have JD text via Phase 1.5 enrichment (`recommended_roles.description` once canonical URL is resolved). On role-add, run a one-shot Haiku extract: "does this JD describe the interview process? If yes, return the rounds." Source = `jd_extract`.

### 3. Inferred from events (low confidence, but always available)

If no explicit statement exists, the timeline of `application_events` itself is the process: every distinct `round_label` becomes a round. `expected_total_rounds` is the running max — "you've had 3 rounds so far, total unknown." Source = `inferred_from_events`.

**Reconciliation rule:** when both explicit and inferred exist, explicit wins. We never overwrite a higher-confidence outline with a lower one.

---

## Schema

```sql
create table job.application_events (
  id                uuid primary key default gen_random_uuid(),
  role_slug         text not null references job.pipeline_roles(slug) on delete cascade,
  gmail_message_id  text not null,                  -- Message-ID header
  gmail_thread_id   text not null,
  gmail_api_id      text,                           -- for the "📧 source email" link
  sender            text,
  subject           text,
  event_type        text not null,                  -- applied_confirmation | screen_scheduled | …
  detected_stage    text,                           -- applied | interviewing | offer | rejected
  summary           text,                           -- 1-line Haiku summary
  confidence        numeric,                        -- 0..1
  round_label       text,                           -- "phone screen", "onsite #2", etc.
  round_n           int,                            -- when explicit, e.g. "round 2 of 4"
  auto_applied      boolean default false,
  needs_review      boolean default false,
  received_at       timestamptz not null,
  created_at        timestamptz default now(),
  unique (gmail_message_id)
);
create index ae_role_idx on job.application_events (role_slug, received_at desc);
create index ae_review_idx on job.application_events (needs_review) where needs_review;

alter table job.pipeline_roles
  add column gmail_thread_ids   text[] not null default '{}',
  add column last_activity_at   timestamptz,
  add column process_outline    jsonb;
```

**Privacy posture stays the Phase 1 contract:** raw bodies never persist. Only:
- `Message-ID` header (dedup key)
- `gmail_api_id` (for the source-email link)
- Haiku-generated `summary` + structured fields
- Subject + sender (already in From header, low-risk)

---

## UI surfaces

### 1. Drill page — Activity timeline tab

New tab next to Resume / Cover / Analysis. Reverse-chronological list of events for this role:

- Type chip (`Applied`, `Screen scheduled`, `Take-home assigned`, `Rejected`)
- Round label when present (`onsite — system design`)
- 1-line summary
- Received time + `📧 source email` link (same pattern as the rec card)
- Visual indicator on auto-applied transitions ("auto-advanced to Interviewing")

### 2. Process tracker on drill page header

Below the Apply / Source-email buttons: a small progress strip rendering `process_outline.rounds`:

```
Phone screen ✓  Take-home ✓  Onsite (coding) ◐  Onsite (system design) ○  Debrief ○
```

Tooltip on each pill shows when it was completed (via event timestamps). Source-attribution (e.g. "process detected from recruiter intro") shown on hover of the strip header.

### 3. Recent activity chip on row

Saved/Active pipeline rows get a 🔔 chip with relative time of last event:

> Acme · Senior PM · 🔔 update 2h ago

Clickable → drill page Activity tab.

### 4. "Needs your attention" widget on /ladder/jobs/

Above the Active table. Surfaces:

- **Offers received** ("Acme sent an offer — open the email and confirm to move to Offer stage")
- **High-confidence rejections** ("Stripe followed up — looks like a no. Set exit reason?")
- **Low-confidence classifications queue** ("Acme replied — looks like a screen invite. Accept?")

---

## Backfill

**Scope:** all `pipeline_roles` with `status = 'Active'` (or `Saved` with `engaged_at` set) where `applied_at >= now() - interval '30 days'`. Bounded — likely <15 roles right now.

**Approach:** one-off `enrich-job-source`-style backfill function, paged through batches of 5 messages. Each batch:
1. For each in-scope role, look up its company domain.
2. Search Gmail (`from:company.com OR thread mentions company` constrained by `after:30d`).
3. Classify each unique Message-ID found.
4. Write events; update `process_outline` from explicit signals only (don't infer from sparse history).

**Why we'd consider it dangerous and don't:** Haiku classifying old emails without full conversational context can guess wrong (e.g., "thanks for chatting" could be after a screen or after a rejection). The 30-day bound + "explicit signals only" rule on `process_outline` for backfilled events keeps the worst case bounded — we ingest the data but don't promote it to confident structure.

---

## Auto-advance flow

```
event lands → confidence ≥ floor for event_type → is it forward (applied/interviewing)?
  ├── yes: update pipeline_roles.stage; mark event.auto_applied=true; fire UI event so the drill page refreshes
  └── no (offer / rejection): set event.needs_review=true; appear in "Needs attention" widget
```

User can override anything from the drill page menu (existing flow). Override removes `needs_review`.

---

## Decisions locked

1. **Auto-advance forward only.** Applied, screen-scheduled, next-round, take-home all auto-apply. Offers + rejections wait for the user.
2. **Stage taxonomy unchanged.** Top-level `stage` stays the 4-value enum. Granularity (which round, what kind) lives in `application_events.round_label` and `pipeline_roles.process_outline`.
3. **Process detection: 3 sources, ranked.** Recruiter email > JD extract > inferred from events. Higher-confidence source never gets overwritten by a lower one.
4. **Backfill: 30 days, Active applied roles only.** Process_outline only updated from explicit signals on backfill; inferred-from-events is disabled retroactively.
5. **Stale-14d nudge is on-open only.** No banner, no push. Renders as a yellow chip on row + Needs-Attention card only when the user lands on /ladder/jobs/. Reason: banners are reserved for live arrivals in the last 30 min; a 14d-quiet signal is the inverse of live and would dilute the banner contract.
6. **Calendar read pulled into 2.0 (narrow slice).** `calendar-api` already holds the `calendar` scope from Phase 1. 2.0 adds a single `events.list(timeMin=now, timeMax=now+48h)` query, matched to a role by attendee email domain first, title-token second. No write-back, no recurring-event handling, no calendar-event creation. Ambiguous matches → no chip (silent fail beats wrong chip). Tightening match precision + reply-cadence analytics move to 2.1.

---

## Feedback-loop UI — the five-signal catalog

The UI exposes exactly five signal types per role. Each role surfaces **the single highest-priority signal that applies** — never two chips on one row. Priority (highest → lowest):

| Priority | Signal | Trigger condition | Color | Render surfaces |
|---|---|---|---|---|
| 1 | **Action needed** | `application_events.needs_review = true` AND not yet acted on (offer / rejection / low-confidence classification) | red | row chip · Needs-Attention card · banner if live |
| 2 | **Calendar today/tomorrow** | A calendar event in the next 48h matches this role (attendee-domain or title-token) | blue | row chip · Needs-Attention card · banner if within 2h |
| 3 | **Reply pending** | Latest inbound event has no outbound message from `fike101@gmail.com` after it on the same thread, and inbound is ≥ 24h old | amber | row chip · Needs-Attention card |
| 4 | **New update** | An event landed in the last 72h that did NOT auto-advance (informational, rescheduled, follow-up) and user hasn't opened the drill page since | green | row chip · Needs-Attention card · banner if landed in last 30 min |
| 5 | **Stale — quiet for 14d** | `last_activity_at < now() - 14d` AND `status = 'Active'` | yellow | row chip · Needs-Attention card *(on-open only, no push)* |

### Surface rules

- **Row chip**: single highest-priority signal only. No chip = nothing actionable.
- **Needs-Attention widget** (above /ladder/jobs/?bucket=active table): one card per actionable role. Hidden entirely when the actionable set is empty. Cards are clickable → drill page.
- **Banner**: ONLY for live arrivals in the last 30 min — auto-advance just happened, offer just arrived, or calendar event within 2h. Auto-fades after 30 min. Same trigger never re-banners. Stale + reply-pending are *never* banners (no live arrival).
- **Auto-advance toast** (sub-case of banner): when auto-advance moves a role forward, the banner names the transition ("Auto-advanced Acme → Interviewing"). User can undo within 30 min.

### Honest-UI guardrails

- `needs_review=true` events remain visible (red chip + Needs-Attention card) until the user explicitly acts. Never silently fade.
- Rejection events never auto-archive — they always surface as Action-needed so user captures `exit_reason`.
- A role with `status='Archived'` never produces signals, even if events land afterward.

---

## Phasing

- **Phase 2.0** (this brief): Schema + classifier + drill timeline + process tracker + forward auto-advance + "Needs attention" widget + 30-day backfill
- **Phase 2.1**: Calendar-event linkage (use existing `calendar-api` OAuth — interview events on your calendar tie back to role timelines)
- **Phase 2.2**: Reply-cadence analytics on the timeline ("they reply in 4d on average — it's been 5d")
- **Phase 2.3**: Multi-role-per-company disambiguation (if you applied to 2 Acme roles, route emails to the right one)

---

## Risks

- **Haiku misclassification on rejection.** "We're moving forward with other candidates" is clear but "we'll get back to you" is ambiguous. Confidence floor (0.75) plus "rejection never auto-applies" is the guardrail.
- **Thread association poisoning.** If we wrongly link a thread to a role, every future email on that thread inherits the bad link. Mitigation: only persist `thread_id ↔ role` after first event lands with confidence ≥ 0.8.
- **ATS platform false positives.** A recruiter for a different company contacting from `greenhouse.io` could match the wrong role. Mitigation: require company-name match in body when sender is an ATS platform.
- **Cost.** Every inbox message NOT classified as a job alert hits Haiku. For a normal inbox that's hundreds of messages/day. Mitigation: domain pre-filter against `pipeline_roles.company_domain` + ATS allowlist — only Haiku-classify if the message could plausibly be about a tracked role.
- **Backfill data quality.** Old conversations can be misread. Mitigation: 30-day cap + "explicit signals only" for `process_outline` on backfill.
- **Privacy.** Inbox content is the most sensitive surface in the product. Same Phase 1 contract: never persist raw bodies. Audit by checking `application_events.summary` length stays bounded.

---

## What lands when this is done

- Every email response on an open application gets classified, attached to the role, and timestamped on a per-role timeline
- Stage auto-advances forward on high-confidence signals — "you've moved to Interviewing at Acme" appears without you doing anything
- Offers and rejections never auto-apply; they show up in a "Needs your attention" surface so you confirm + capture context
- A per-role process tracker shows how many rounds you're expected to go through and which you've completed, populated from explicit recruiter language when available
- Existing 30 days of mail for currently-active roles backfilled to seed the timeline

---

## Next actions

1. `/plan` to slot Phase 2.0 stories into `docs/execution/project-plan/`
2. Migration drafts: `application_events`, `pipeline_roles.gmail_thread_ids`, `pipeline_roles.last_activity_at`, `pipeline_roles.process_outline`
3. Stub `_shared/gmail-application-classifier.ts` with the event taxonomy + Haiku prompt
4. Wire into `gmail-jobs.ts` source plugin as a second emitter (or split into its own scan plugin if the path overhead matters)
