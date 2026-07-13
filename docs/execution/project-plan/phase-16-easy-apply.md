# Phase 16: Ladder Easy Apply

> Back to [Project Plan](./index.md)
>
> **Reference**: [PRD: Ladder Easy Apply](/docs/strategy/prds/ladder-easy-apply.md) (audit of live Saved/Drafting forms, 2026-07-13)
>
> **Vision**: Ladder knows which saved jobs are 2-minute submits and which are essay sessions — and for the easy ones, it fills the entire form from what it already knows about the user and submits with one reviewed click.

---

## Goal

**16.1 (Flag):** every Saved/Drafting role carries a simple, direct Easy Apply badge — no new flows, just truth in the table.
**16.2 (Feature):** an Easy Apply feature with its own feature-level onboarding that captures Tier 1/2/3 answers (prefilled from data already on record, resume upload as fallback), prefills the whole form, and submits via API where possible and an automated-browser path where not.

## Success Criteria

- [ ] ≥85% of Saved/Drafting roles carry a non-`unknown` `apply_ease` tier (requires LinkedIn URL resolution)
- [ ] `⚡ Easy apply` badge renders in Saved + Drafting tables within one nightly sweep of a role being saved
- [ ] Onboarding: a user with existing Ladder data (Job History, Narratives, base resume) confirms — not types — ≥70% of Tier 1/2 answers
- [ ] An `easy`-tier Greenhouse/Lever role goes from Saved → Applied in under 2 minutes with zero free typing
- [ ] Every submission stores a full answer snapshot in `job.application_draft` and emits an application event
- [ ] Zero CAPTCHA bypasses; zero submissions without an explicit user confirm

## Decisions locked (per PRD)

1. Easy = no required long-form free-response, no video/portfolio, no email-apply. Tiers: `easy | short_answer | essay | special | portal | unknown`.
2. Demographics (Tier 3) answered only from explicit user-set defaults; global default is decline-to-self-identify.
3. Legal/consent checkboxes (arbitration, privacy) always require an explicit per-application tap.
4. Review-then-submit in v1 — no silent submissions. Batch submit deferred.
5. Postings that ask candidates not to use AI (e.g. Splitwise) are tiered `special` and excluded permanently.
6. LinkedIn native Easy Apply not automated (none in the current bucket; ToS-hostile).

---

## Phase 16.1 — Flag: the Easy Apply badge

Simple and direct: classify every role's application form, show one chip.

### Epic 16.1-A: Classification backend

**Story: apply-ease schema**
- [ ] Migration: `pipeline_roles` + `recommended_roles` gain `apply_ease text`, `apply_ease_meta jsonb`, `apply_ease_checked_at timestamptz`, `canonical_apply_url text`
- [ ] `apply_ease_meta` shape: `{ats, questions, required_essays, short_answers, requires_cover_letter, video, email_apply, source_url}`

**Story: classifier**
- [ ] Pure tier function over `extract-application-fields` output (required `long_text` → essay; video/portfolio/email → special; non-whitelisted required `short_text` → short_answer; else easy)
- [ ] Unit-test against the 21 audited forms as fixtures (OpenAI/Airbnb/Speak → easy, Mindbody ×2 → short_answer, Midi/Galileo/Kiddom → essay, Solace/Splitwise → special)
- [ ] `extract-application-fields` version bump; classification returned alongside the schema

**Story: sweep + on-save**
- [ ] Nightly sweep (jobs-pipe action or dedicated cron): Saved + Drafting roles where `apply_ease_checked_at` is null or >14d, call extraction, store tier
- [ ] Fire-and-forget classify when a role enters Saved from the frontend
- [ ] Per-run cap + backoff so one sweep can't hammer an ATS

**Story: LinkedIn → ATS resolution**
- [ ] For `linkedin.com/jobs/view/*` URLs, resolve offsite `companyApplyUrl` (guest endpoint first, Haiku-over-careers-page fallback, same pattern as `enrich-job-source`)
- [ ] Store in `canonical_apply_url`; classify the resolved URL
- [ ] Closed-on-LinkedIn detection while we're there (audit found Symbium dead but `is_live=true`)

**Story: liveness fix (piggyback)**
- [ ] Greenhouse `302 → board root` counted as closed, not alive (audit: Anthropic + Garner false-alive)

### Epic 16.1-B: Badge UI

- [ ] Chip in Saved/Drafting table rows: `⚡ Easy apply` / `✍️ Short answers` / `📝 Essays` / `🎥 Video` / `✉️ Email` — no chip when `unknown`
- [ ] Tooltip renders `apply_ease_meta` (ATS, #questions, cover letter y/n)
- [ ] "Easy apply" quick-filter pill on the Saved page
- [ ] Role detail: "Application requirements" card (auto-fillable ✅ vs needs-your-words ✍️, estimated effort)
- [ ] Updates queue digest row when a sweep finds new easy applies ("⚡ 3 saved jobs are easy applies — ~2 min each"), click → filtered Saved table; Dismiss supported
- [ ] Ladder version bump + `design-system/README.md` entry for the chip variants

---

## Phase 16.2 — Feature: Easy Apply with onboarding, prefill, submission

### Epic 16.2-A: Answer bank + prefill backend

**Story: answer bank schema**
- [ ] Migration: `job.application_answers` (`user_id`, `canonical_key`, `value jsonb`, `source text` — `onboarding | resume_extract | derived | writeback`, `updated_at`), RLS to owner
- [ ] Canonical key registry (Tier 1/2/3 from the PRD appendix): identity/contact, work-auth pair, links, onsite-by-metro rules, comp expectation + phrasing policy, years-of-experience facts, how-heard default, start date, EEOC set, rare-question defaults (family relationship, non-compete, procurement, SMS consent)

**Story: prefill from data already on record**
- [ ] Seeding service: profile/settings → contact; Job History → years-of-PM / years-managing / domain-experience derivations + prior-employer flags; Narratives + base resume → LinkedIn/links; `global_assets` → default resume file; `company_connections` → referral prompts at apply time
- [ ] Seeded answers marked `source='derived'` and shown as "confirm" not "type" in onboarding

**Story: resume upload as secondary prefill**
- [ ] If Tier 1/2 coverage after seeding is below threshold, onboarding offers resume upload ("or upload a resume and I'll fill most of this")
- [ ] Reuse `pdf-extract` + Haiku to extract name, contact, location, links, employers, dates → seed bank as `source='resume_extract'` for user confirmation
- [ ] Uploaded file becomes the default application resume in `global_assets` if none exists

**Story: question matcher**
- [ ] Edge function: map a form's `custom_questions` → canonical keys (heuristics for the ~6 sponsorship phrasings; Haiku for the tail; cache matches per question hash)
- [ ] Coverage calculator: % of required fields answerable from the bank → drives "Ready to submit" state

### Epic 16.2-B: Feature-level onboarding flow

Triggered on first Easy Apply use (badge click / "Set up Easy Apply" card) — not part of account onboarding.

- [ ] Step 1 — confirm what we know: prefilled Tier 1 card (contact, work auth, links) rendered from seeded answers; edit-in-place; Apt-style conversational framing
- [ ] Step 2 — Tier 2 quick pass: onsite-metros + max days/week, comp number + phrasing policy, start date/notice, how-heard default (~90s)
- [ ] Step 3 — Tier 3 consent card: saved demographic answers vs decline-everywhere (default decline); shown once, editable in Settings
- [ ] Step 4 — policies: cover letter (never / when required / auto-generate), review mode (always review in v1), daily cap
- [ ] Resume-upload branch when seeding coverage is low (see 16.2-A)
- [ ] Settings → "Easy Apply" section mirroring the whole bank; every Apply-wizard answer writes back (`source='writeback'`)
- [ ] "Ready to submit" chip state (filled ⚡) when a role's form is 100% covered; Updates queue row upgrades to "Ready to submit — review"

### Epic 16.2-C (subphase): API submissions — Greenhouse & Lever

- [ ] `submit-application` edge function: multipart form-POST to the ATS public application endpoint; resume streamed from `global_assets`/`role_assets`; EEOC answers mapped to ATS field ids
- [ ] Review screen: every field + answer + consent checkboxes itemized; explicit Submit tap; no Undo after submit (copy says so)
- [ ] Post-submit: stage → applied, application event logged, full snapshot into `application_draft`, confirmation email watched by the existing Gmail tracker
- [ ] Guardrails: liveness + posting-age check at submit time; per-day cap; failure → wizard fallback with fields still prefilled
- [ ] Start Greenhouse-only behind a flag; add Lever after N clean submissions

### Epic 16.2-D (subphase): Headless-browser path — Ashby & the long tail

- [ ] Headless worker (Playwright) that loads the apply page, fills from the answer bank, uploads resume — for ATSes without a form-POST path
- [ ] CAPTCHA handoff: worker fills everything, then hands the user a live session/prefilled page to complete the CAPTCHA and tap Submit themselves (Ashby ships reCAPTCHA — never bypassed, by decision #6 → decision 3/4 above)
- [ ] Degraded "assisted apply" mode when headless is blocked: deep-link + copy-paste panel of prepared answers next to the form
- [ ] Same review screen, guardrails, event logging, and snapshot as 16.2-C
- [ ] Selector drift detection: form-fill mismatch aborts before submit and falls back to assisted mode

---

## Out of Scope — deferred

- Batch submit ("apply to all ready") — revisit after 2 weeks of clean single submissions
- For You (pre-save) classification — lazily, floor-1 only, after 16.1 proves out
- LinkedIn native Easy Apply automation
- Auto-submitted essays (essay-tier keeps the wizard + `generate-question-answer` assist)
