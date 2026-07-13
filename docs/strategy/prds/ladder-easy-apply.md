# PRD: Ladder Easy Apply — flag, capture, auto-apply

**Status:** Draft · **Owner:** Ian · **Created:** 2026-07-13
**Scope:** Ladder (`/ladder`), `job.*` schema, `extract-application-fields`, `application-draft`, Updates queue

---

## Problem

Many applications in the Saved and Drafting buckets are "easy applies" — the form asks only for
contact info, resume, optional cover letter, demographics (EEOC), and short factual questions
(work authorization, sponsorship, location, comp expectations, years of experience). Ladder
already knows how to extract these forms (`extract-application-fields` v0.2.x) but only does so
on demand inside the Apply takeover. The user can't see, from the table, which jobs are a
2-minute submit vs. a 45-minute essay session — so cheap wins sit in Saved untouched.

Long-term we want Ladder to submit easy applies on the user's behalf. First step: **flag them.**

## Definition

A job is **Easy Apply** when its application form contains **no required long-form free-response
question** (essay), no video/portfolio requirement, and no apply-by-email flow. Allowed: contact
fields, resume upload, optional cover letter, EEOC/demographic sections, selects/yes-no,
and short factual one-liners (comp expectation, years of experience, preferred name, address).

Classification tiers (stored, not just boolean):

| Tier | Meaning | Example from audit |
|------|---------|--------------------|
| `easy` | Zero required free-response; fully auto-answerable | OpenAI, Airbnb, Speak, Clipboard |
| `short_answer` | 1–2 required *short* free-text answers (≤1 sentence each) | Twin Health, Mindbody ×2 |
| `essay` | ≥1 required long-form/essay question | Midi (3), Galileo (2), Kiddom (2) |
| `special` | Video, portfolio-with-password, apply-by-email, explicit no-AI policy | Solace (video), Splitwise (email + no-AI) |
| `portal` | Account-gated ATS (Google Careers, Workday w/ login) | Google Fonts PM |
| `unknown` | No apply URL, or LinkedIn link not yet resolved to the ATS | 9 LinkedIn saves + 6 null-URL roles |

## Audit findings (2026-07-13, Ian's live data)

36 roles in scope: 29 Saved + 7 Drafting.

- **8 easy (38% of the 21 classifiable live forms)** — Maven Clinic, OpenAI, Airbnb, Speak,
  Clipboard, Clarity Pediatrics, Everlywell, Twin Health(short-answer borderline).
- **2 short-answer** — both Mindbody roles (one required textarea each).
- **6 essay/special** — Midi, Galileo, Kiddom, Code for America, Solace (1-min video),
  Splitwise (email application, explicitly asks candidates not to use AI — excluded from
  automation permanently).
- **9 unknown — LinkedIn**: every live LinkedIn save is an *external* "Apply" (zero native
  LinkedIn Easy Apply). We cannot classify them until the LinkedIn URL is resolved to the
  underlying ATS URL. This is the single biggest coverage gap (~30% of the bucket).
- **6 unknown — no URL at all** (Candid Health, Tennr, Zillow, Clay, Harvey, Motiv).
- **Data hygiene:** 3 roles marked `is_live=true` are actually dead — Anthropic GTM and
  Garner (Greenhouse 302 → board root; liveness check reads 302 as alive), Symbium (closed
  on LinkedIn). Code for America is already `is_live=false` but still in Drafting.

Implication: flagging is high-value (roughly 4 in 10 saved jobs are near-zero-effort), and the
prerequisite work is URL enrichment for LinkedIn saves, not just form parsing.

## What already exists (build on, don't rebuild)

- `extract-application-fields` v0.2.x — ATS detection (Greenhouse/Lever/Ashby public APIs,
  Haiku fallback for others), returns typed `custom_questions` (`long_text` / `short_text` /
  `select` / `yes_no` / `file` / `url`, `required`) and persists to `job.application_draft.fields`.
  **The easy-apply classifier is a pure function over this output.**
- `generate-question-answer` — drafts answers to individual questions.
- `application-draft` fn + Apply takeover wizard (`ladder/js/apply.js`, `ladder-apply.js`).
- Updates queue (v2.29.0) — single notification surface with act-then-Undo semantics.
- `enrich-job-source` / `canonical_url` — existing pattern for URL resolution on recommended_roles.

## Plan

> Task-level breakdown: [Phase 16 — Ladder Easy Apply](/docs/execution/project-plan/phase-16-easy-apply.md).
> Two phases: **flag** (badge only), then **enable** (the Easy Apply feature: feature-level
> onboarding for Tier 1/2/3 answers, prefill from data on record with resume-upload fallback,
> and two submission subphases — API and headless browser).

### Phase 1 — Flag (ship first)

**Backend**
1. Migration: add to `job.pipeline_roles` (and `job.recommended_roles` for For You reuse):
   - `apply_ease text` (`easy | short_answer | essay | special | portal | unknown`)
   - `apply_ease_meta jsonb` — `{ats, required_essays: n, short_answers: n, questions: n, requires_cover_letter, video, email_apply, checked_at, source_url}`
   - `apply_ease_checked_at timestamptz`
2. Classifier: pure function over the `extract-application-fields` schema. Rules:
   - any required `long_text` → `essay`
   - video/portfolio/email-apply detected → `special`
   - required `short_text` beyond contact/comp/linkedin whitelist → `short_answer`
   - else → `easy`. ATS unknown + Haiku extraction failed → `unknown`.
3. Sweep: extend the nightly pipeline (or new `classify-apply-ease` action on jobs-pipe) —
   for Saved + Drafting roles where `apply_ease_checked_at is null` or > 14 days old, call
   `extract-application-fields`, store tier. Also classify on save (fire-and-forget from the
   frontend when a role enters Saved).
4. LinkedIn resolution: for `linkedin.com/jobs/view/*` URLs, resolve the offsite apply URL
   (guest jobPosting endpoint exposes `companyApplyUrl`; fallback: Haiku over company careers
   page, same pattern as `enrich-job-source`). Write to a `canonical_apply_url` and classify that.
5. Liveness fix (piggyback): treat Greenhouse `302 → board root` as **closed**, not alive —
   the audit found 2 false-alive roles this way.

**UI/UX**
1. **Table badge** — new chip in Saved / Drafting tables next to title:
   `⚡ Easy apply` (green), `✍️ 2 short answers` (neutral), `📝 Essays` (muted), `🎥 Video` /
   `✉️ Email` (special). Unknown gets no chip (absence = not yet classified). Tooltip shows
   `apply_ease_meta` breakdown (ATS, #questions, cover letter needed).
2. **Filter/sort** — "Easy apply" quick filter pill on Saved page; default sort unchanged.
3. **Role detail** — "Application requirements" card: ATS, field list grouped
   (auto-fillable ✅ / needs your input ✍️), estimated effort ("~2 min"), CTA into the
   existing Apply takeover.
4. **Updates queue** — digest row, one per sweep run, only when new easy applies appear:
   "⚡ 3 saved jobs are easy applies (Airbnb, OpenAI, Speak) — ~2 min each" → click filters
   the Saved table. Follows the existing one-action-per-row pattern; Dismiss supported.

### Phase 2 — Enable: the Easy Apply feature

One feature, four subphases: answer bank + prefill (2a), feature-level onboarding (2b),
then submission — API path (2c) and headless-browser path (2d).

**2a — Answer bank + prefill from data on record**
1. `job.application_answers` — user answer bank keyed by canonical question, covering the
   PRD appendix Tiers 1–3 (`work_auth`, `sponsorship`, `location`, onsite-by-metro rules,
   `comp_expectation` + phrasing policy, years-of-experience facts, `start_date`,
   `hear_about_us`, EEOC set, rare-question defaults). Each answer carries a `source`
   (`onboarding | resume_extract | derived | writeback`).
2. **Prefill first, ask second**: seed the bank from what Ladder already knows — profile
   contact info, Job History (years-of-PM / years-managing / domain experience / prior
   employers), Narratives + base resume (links), `global_assets` (default resume file),
   `company_connections` (referral prompts at apply time). Seeded answers render as
   *confirm* cards, not blank inputs.
3. **Resume upload as secondary prefill**: when seeding coverage is low (new or thin
   profile), onboarding offers a resume upload — `pdf-extract` + Haiku extract contact,
   location, links, employers → seed Tier 1/2 for confirmation. The upload also becomes the
   default application resume if none exists.
4. Question matcher: Haiku + heuristics map a form's questions onto the bank (the audited
   forms are ~90% covered by ~15 canonical questions; sponsorship alone appears in 6
   phrasings). Unmatched required questions are the only thing the wizard asks.

**2b — Feature-level onboarding flow**
Triggered on first Easy Apply use (not account onboarding), Apt-style conversational pass:
1. Confirm-what-we-know card (Tier 1, prefilled from 2a) → 2. Tier 2 quick pass (onsite
   metros + max days/week, comp, start date, how-heard default) → 3. Tier 3 consent card
   (saved demographic answers vs decline-everywhere; default decline; never inferred) →
   4. Policies (cover letter: never / when required / auto-generate; review mode; daily cap).
   Resume-upload branch per 2a-3. Total target: ~3 minutes.
2. Settings → "Easy Apply" section mirrors the full bank; every Apply-wizard answer writes
   back, so coverage converges after the first 2–3 applications.
3. New state: a role whose form is 100% covered becomes **"Ready to submit"** — filled ⚡
   chip, Updates queue row upgrades to "Ready to submit — review".

**2c — Subphase: API submissions (Greenhouse, Lever)**
1. `submit-application` edge function: multipart form-POST to the ATS public application
   endpoint, resume streamed from `global_assets`/`role_assets`, EEOC mapped to ATS field ids.
2. **Review-then-submit, never silent**: fully-itemized review screen (every field, every
   consent checkbox); explicit Submit tap; no Undo after submission, and the copy says so.
3. Post-submit: stage → applied, application event, full snapshot into `application_draft`;
   the Gmail tracker picks up the confirmation email as corroboration.
4. Guardrails: liveness + posting-age check at submit time, per-day cap, failure falls back
   to the wizard with fields still prefilled. Greenhouse first behind a flag; Lever after
   N clean submissions.

**2d — Subphase: headless-browser path (Ashby + long tail)**
1. Headless worker (Playwright) loads the apply page, fills from the answer bank, uploads
   the resume — for ATSes with no form-POST path.
2. **CAPTCHA handoff, never bypass**: Ashby ships reCAPTCHA — the worker fills everything,
   then hands the user a live/prefilled page to complete the CAPTCHA and tap Submit.
3. Degraded "assisted apply" mode when headless is blocked: deep link + a prepared-answers
   panel beside the form. Selector-drift detection aborts before submit, falls back to assisted.
4. Same review screen, guardrails, event logging, and snapshot as 2c.
5. **Portal/special**: never automated. Splitwise-style "please don't use AI" postings are
   respected: flagged `special`, excluded, with the reason shown in the detail card.

### Out of scope
- LinkedIn native Easy Apply automation (none present in the current bucket; ToS-hostile).
- CAPTCHA bypass of any kind.
- Auto-generated essays submitted without user review (essay-tier jobs keep the current
  wizard flow with `generate-question-answer` assist).

## Success metrics
- % of Saved/Drafting roles with a non-`unknown` tier (target ≥85% after LinkedIn resolution).
- Saved → Applied conversion for `easy`-tier roles (expect step change).
- Median time from Save → Applied for easy-tier roles.
- Misclassification reports (user opens an "easy" job and finds an essay) — target ~0.

## Open questions (1:3:1 resolved in review)
1. Should For You (recommended_roles) also get the chip pre-save? Cost: extraction call per
   recommendation. Proposal: classify lazily — only floor-1 recommendations, nightly.
2. Batch submit ("apply to all 5 ready") in 2c v1, or per-role only? Proposal: per-role
   first; batch after 2 weeks of clean submissions.

**Decided 2026-07-13:** answer capture is a feature-level onboarding flow (first Easy Apply
use) with a Settings mirror — not account onboarding, not Settings-only. Resume upload is the
secondary prefill path when existing data gives low coverage.

---

## Appendix — Onboarding capture set (from the form audit)

Ordered by form coverage; onboarding asks Tiers 1–3, Tier 4 defaults + write-back, Tier 5 is policy.

**Tier 1 — on nearly every form (must capture)**
| Key | Question | Format |
|---|---|---|
| `legal_name` / `preferred_name` | Legal name as on ID; preferred name | text |
| `email` / `phone` | Contact | text |
| `location` | Current city / state / country | structured |
| `work_auth_us` | Authorized to work in the US? | y/n — ~90% of forms |
| `sponsorship` | Require sponsorship now or in future? | y/n — most common custom question, 6+ phrasings |
| `linkedin_url` | LinkedIn profile | url — ~70% of forms |
| `resume_default` | Default resume file | file (exists in `global_assets`) |

**Tier 2 — on 20–50% of forms**
| Key | Question | Format |
|---|---|---|
| `onsite_rules` | Metros you're in/near + max in-office days/week | rules — answers every "can you work from X n days?" gate |
| `comp_expectation` | Number + phrasing policy (range / floor / flexible) | number+policy |
| `experience_years` | Years: PM total, managing PMs, 0→1, consumer, enterprise, growth | numbers — also feeds 1–5 self-rating scales |
| `hear_about_us` | Default source answer | select policy |
| `start_date` | Start date / notice period | text |

**Tier 3 — EEOC/demographics (one consent card, never inferred)**
`gender`, `race_ethnicity`, `veteran_status`, `disability`; Lever adds `pronouns`,
`transgender`, `sexual_orientation`, `age`. One question: use saved answers everywhere, or
decline-to-self-identify everywhere (default: decline).

**Tier 4 — rare/conditional (defaults + write-back, never asked up front)**
family-financial-relationship (No), non-compete/obligations (No), prior-employee (derive from
Job History), state-procurement (No), SMS consent (standing pref), referral (per-role prompt
from `company_connections`).

**Tier 5 — automation policy**
cover-letter policy (never / when required / auto-generate), review mode (always review in v1),
daily submit cap, excluded companies (`blocked_companies`), standing note that legal acks are
always per-application taps.
