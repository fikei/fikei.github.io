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

### Phase 2 — Capture & auto-answer

1. `job.application_answers` — user answer bank keyed by canonical question
   (`work_auth`, `sponsorship`, `location`, `comp_expectation`, `start_date`, `pronouns`,
   `veteran_status`, `disability`, `gender`, `race`, `hear_about_us`, `referral`, plus
   fuzzy-matched frees). Seeded from Settings → new "Application defaults" section; every
   answer given in the Apply wizard is written back to the bank.
2. Question matcher: Haiku maps a form's questions onto the bank (the forms in the audit
   are ~90% covered by ~15 canonical questions). Unmatched required questions are the only
   thing the wizard asks the user.
3. New state: a Saved role whose form is 100% covered becomes **"Ready to submit"** — stronger
   chip (filled ⚡), and the Updates queue row upgrades to "Ready to submit — review".
4. EEOC handling: demographics are answered only from explicit user-set defaults, never
   inferred. "Decline to self-identify" is the fallback.

### Phase 3 — Auto-apply (assisted submit)

1. **Review-then-submit, never silent**: user clicks "Submit" on a fully-prefilled review
   screen (per-role, or batch "submit all ready"). Post-submit lands in Applied with an
   application event; Undo is not possible after submission, so the confirm is explicit.
2. Transport per ATS:
   - **Greenhouse / Lever**: direct form POST to the public application endpoint from an edge
     function (multipart with resume from `role_assets` / `global_assets`). Most reliable.
   - **Ashby**: has reCAPTCHA (`recaptchaPublicSiteKey` in appData) → cannot and should not be
     submitted headlessly. Route through a browser-assisted flow where the user completes the
     CAPTCHA; everything else is prefilled.
   - **Portal/special**: never automated. Splitwise-style "please don't use AI" postings are
     respected: flagged `special`, excluded, with the reason shown in the detail card.
3. Legal/consent checkboxes (arbitration agreements, privacy policies — seen at OpenAI,
   Airbnb) always require an explicit user tap, itemized on the review screen.
4. Rate/quality guardrails: per-day submit cap; posting-age check + liveness check at submit
   time; every submission stores a snapshot of answers into `application_draft` for the record.

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
2. Batch submit ("apply to all 5 ready") in Phase 3 v1, or per-role only? Proposal: per-role
   first; batch after 2 weeks of clean submissions.
3. Where does the answer bank live in Settings vs. onboarding chat? Proposal: Settings section
   now; onboarding-chat capture later.
