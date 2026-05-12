# /job — onboarding flow

**Status:** Draft → Phase 1 in progress
**Owner:** Ian
**Last updated:** 2026-05-12

---

## One-liner

A single-page, six-stage flow that turns a new user from cold-stranger into a scored pipeline in under 8 minutes. Upload → confirm → talk → tune → preview → go.

## Why now

`/job` is currently single-tenant (gated to `fike101@gmail.com` in `job/js/app.js` and `supabase/functions/_shared/job-auth.ts`). To open it up we need a frictionless way to collect the *seed* that powers Fit scoring, JD pulls, and cover-letter generation — without making it feel like a form.

## Success criteria

- New user finishes in <8 min, profile complete enough to score real JDs.
- Three sample roles render a believable Fit breakdown on Stage 5.
- Zero net-new schemas in `fit.ts` — onboarding output drops into existing `UserContext` shape.
- ≥70% of users skip Stage 1 upload and still finish (the chat path stands alone).

## Non-goals

- Team/org accounts.
- Recruiter view.
- Redesigning Fit scoring.

---

## Core information to gather

Mapped 1:1 to what the existing scorer + cover-letter generation already consume, so onboarding output drops straight into `vision` JSON + `narratives` rows with no schema gymnastics.

### A. Identity & contact
- Full name, email, phone, LinkedIn, optional portfolio/GitHub.

### B. Location (first-class)
Single canonical input — user types one city, everything else infers.

```
location: {
  city:               "Toronto"             // user-entered
  region:             "ON"                  // inferred
  country:            "CA"                  // inferred
  timezone:           "America/Toronto"     // inferred (IANA)
  remotePreference:   "remote" | "hybrid" | "onsite" | "any"
  willingToRelocate:  ["NYC", "SF", "Remote-EU"]
  workAuth:           ["CA-citizen", "US-TN-eligible"]
}
```

Drives the `geo` Fit bucket (`fit.ts`), JD pull pre-filter, and cover-letter "based in" line. Mirrored into `vision/intents.md` `**Geo:**` field so jobs-pipe reads it natively.

**Inference:** Resume parse returns `city` → static IANA city→tz map (bundled JSON, ~200kB, no external API) resolves region/country/tz. Ambiguous cities → disambiguator dropdown.

### C. Targeting seed (drives JD pulls + Fit score)
- Target roles — 2–4 title patterns.
- Target sectors — `targetSectors[]`.
- Stage preference — pre-seed / seed / A / B / growth / public.
- Comp floor — base + total OK range.
- Dealbreakers — `antiMissionTerms[]`.
- Mission required? — boolean → `missionRequired`.

### D. Values & worldview (drives `values` + `culture` buckets, 40% of Fit)
- Mission keywords — what impact themes resonate (3–6 phrases).
- Impact themes — the verbs.
- Culture keywords — what working environment they thrive in (3–6).
- Anti-culture.

### E. Capability seed (drives `role` + `domain` + `arc` buckets)
- Skills — `{name, years}[]` (top 8–12, self-rated proficiency).
- Past sectors — `pastSectors[]`.
- Arc tags — `arcTags[]` (zero-to-one, scale-up, turnaround, ic→manager…).
- Job history — companies, titles, dates, 1-line scope each.

### F. Stories (drives cover letters + Haiku role-match)
- Wins — 3–5 `{headline, metric}` (the Haiku-only signal).
- Narratives — 2–4 long-form stories: values, leadership, craft, failure/learning.

### G. Source docs (optional uploads)
- Resume (PDF/DOCX) → parse → pre-fill A/B/E.
- LinkedIn export / About blurb → pre-fill E/F.
- Past cover letters, writing samples → seed voice for cover-letter agent.
- Job descriptions of dream roles → reverse-engineer C/D.

---

## The flow

Single page, six stages, one question per screen on Stage 3. Wise tokens, sentence case, generous radius. Mobile = vertical stack.

### Stage 0 — Pitch
One screen, ~40 words:
> "/job is your career operating system. Upload what you've already written, answer a few open questions, and we'll start pulling roles that match what you actually want — and draft the cover letters too."

CTA: **Get started**.

### Stage 1 — Upload (skippable)
Drop resume · LinkedIn · cover letters · dream JDs. Haiku parses → staged draft profile. Strong nudge but skip allowed.

### Stage 2 — Confirm what we found
Three editable cards (skipped if Stage 1 skipped):

- **You** — name, contact, links.
- **Location** — city input + inferred region/country/tz (read-only with edit override) + relocate chips + work auth chips.
- **Career** — companies/titles/dates (chips, click to edit).
- **Skills we spotted** — chips, click to remove or add.

### Stage 3 — Open questions (chat-style, 5–6 prompts, one per screen)
Each prompt is a textarea with placeholder example + "skip for now". Haiku auto-extracts structured tags between screens. Extracted tags surface on next screen ("we heard: civic-tech, public services, calm teams") — the magic moment.

1. **"What problem do you want to spend the next five years on?"**
   → `missionKeywords`, `impactThemes`, `targetSectors`
2. **"Describe a time at work where you felt most yourself. What were you doing, and what made it click?"**
   → `cultureKeywords`, `arcTags`, Narrative #1
3. **"What's a win you're proud of — ideally with a number attached?"** (×2)
   → `wins[]` + Narrative #2
4. **"What kind of company or team would make you walk away from a great offer?"**
   → `antiMissionTerms`, anti-culture, dealbreakers
5. **"What roles and titles should we be hunting for? Anything off-limits?"**
   → target titles, stage prefs
6. **"Where are you based, and how far are you willing to go?"** *(only if Stage 2 didn't capture location)*
   → `city`, `willingToRelocate[]`, `remotePreference`

### Stage 4 — Fast knobs
- Comp floor slider.
- Stage multi-select chips.
- Remote/hybrid/onsite (binds to `location.remotePreference`).
- "Mission alignment is a hard requirement" toggle.

### Stage 5 — Preview + commit
Live Fit-score breakdown on 3 sample JDs using the seed they just gave us. CTAs: **Start the pipeline** / **Tweak something**.

Commits to `vision/*.md`, `narratives` table, `user_profile` JSON; flips `onboarding_complete_at`.

---

## Data spine — what each stage produces

| Stage | Lands in… | Used by… |
|---|---|---|
| 1 Upload | staged draft (memory only) | feeds Stage 2 |
| 2 Confirm — You | `user_profile.identity` | resume gen, cover-letter header |
| 2 Confirm — Location | `user_profile.location` + `vision/intents.md` `**Geo:**` | Fit `geo` bucket, JD pull filter, cover letter |
| 2 Confirm — Career | `user_profile.history[]` | resume bones |
| 2 Confirm — Skills | `user_profile.skills[]` | Fit `role` bucket |
| 3 Q1 | `vision/goals.md` → `missionKeywords`, `impactThemes`, `targetSectors` | Fit `values` + `domain` |
| 3 Q2 | `narratives` row (tagged) + `vision/narrative.md` `cultureKeywords`, `arcTags` | Fit `culture` + `arc`, cover-letter voice |
| 3 Q3 | `user_profile.wins[]` + `narratives` row | Haiku role-match, cover-letter hooks |
| 3 Q4 | `vision/filters.md` → `antiMissionTerms` | Fit hard-fail cap |
| 3 Q5 | `vision/intents.md` → titles, stage | JD pull queries |
| 3 Q6 | `user_profile.location` (if not set in Stage 2) | same as Stage 2 Location |
| 4 Knobs | `user_profile.preferences` | Fit `stage`, `comp`, `geo` |
| 5 Commit | flips `onboarding_complete_at` | unlocks rest of /job |

---

## Structured vs. freeform — capture mode per field

Guiding rule: **structured wherever a finite taxonomy exists, freeform wherever the prose itself is the signal.** Every freeform field has a "tags we extracted" preview the user can click-edit. Every chip palette has "Add custom" so the taxonomy never locks them in.

| Field | Mode | Stage |
|---|---|---|
| Name, email, phone, LinkedIn, portfolio | Structured | 2 |
| City | Structured (autocomplete) | 2 |
| Region / country / timezone | Inferred (read-only + override) | 2 |
| Remote / hybrid / onsite | Structured (segmented) | 4 |
| Willing to relocate | Structured (chip palette) | 4 |
| Work auth | Structured chips + "Other" | 4 |
| Target roles | Hybrid (chips + write-in) | 4 |
| Target sectors | Structured (chip palette + custom) | 4 |
| Stage preference | Structured (multi-select chips) | 4 |
| Comp floor | Structured (slider + $ override) | 4 |
| Skills + years | Structured (chip + years selector) | 2 pre-fill / 4 |
| Job history (company, title, dates) | Structured (form rows) | 2 |
| Job history scope (1-line per role) | Freeform | 2 |
| Arc tags | Structured (chip palette) | 4 |
| Dealbreakers | Hybrid (chips: defense / gambling / crypto / adtech / surveillance / fossil + "anything else") | 4 |
| Mission alignment required | Structured (toggle) | 4 |
| Culture keywords | Hybrid (chip palette + Q2 prose auto-tagging) | 4 |
| Q1 "problem to spend 5 yrs on" | Freeform → extracts `missionKeywords`, `impactThemes`, `targetSectors` | 3 |
| Q2 "felt most yourself" | Freeform → Narrative + `cultureKeywords`, `arcTags` | 3 |
| Q3 wins (×2) | Hybrid (freeform headline + structured metric field) | 3 |
| Q4 walk-away criteria | Freeform → `antiMissionTerms` + anti-culture | 3 |
| Q5 titles to hunt | Hybrid (chips + "or describe") | 3 |
| Q6 location (fallback if Stage 2 didn't capture) | Freeform → extracts city, relocate, remote pref | 3 |

**Two design rules that fall out of this:**
1. Every freeform field surfaces an "we heard:" tag strip after the user types. They click-remove any wrong ones — closes the loop without forcing manual chip work.
2. Every chip palette ships an "Add custom" inline text input. Never lock the user into our taxonomy.

**Net effect on flow:** Stage 3 stays *focused on freeform stories* (the magic moment). All structured chips, sliders, toggles consolidate into **Stage 4 — Fast knobs**, which is now meatier. Stage 2 confirm cards stay structured.

## Settings access for existing users

So Ian (and any user with `onboarding_complete_at IS NOT NULL`) can re-test the flow without losing their committed data:

- New rail link **"Settings"** (subdued, bottom of `<job-rail>`) → `/job/settings/`.
- `/job/settings/` lists profile fields with an "Edit your profile" link to `/job/onboarding/?demo=1`.
- `?demo=1` query param tells the onboarding component to enter **demo mode**: stepping through works exactly the same, but Stage 5's commit is replaced by a "this would commit X" preview that does not write to `user_profile` or flip `onboarding_complete_at`. localStorage draft state still persists so the user can step in and out.
- Without `?demo=1`, the page enforces the live commit path.

## Design language

**Reference:** [wise.design](https://wise.design) — form patterns, stepper, inline help text.

**Token contract (mandatory, per `job/DESIGN.md`):**
- All color from `--bg / --fg / --accent / --accent-strong / --border / --muted`. No hex.
- Spacing: `var(--space-N)` only (4px base).
- Radii: cards 30px, buttons `--radius-pill`, inputs 16px. Never 4px.
- Type: `--font-size-title-1` (36) pitch H1, `--font-size-title-3` (22) step headers, `--font-size-body` prompts, `--font-size-small` helpers.
- Sentence case everywhere. No emoji.

**Components to reuse:**

| Need | Existing | Source |
|---|---|---|
| Sign-in / magic link | `ctrl-auth` | `auth/ctrl-auth.js` |
| Page shell (rail + main grid) | `<job-rail>` | `job/js/components/job-rail.js` |
| Footer + theme toggle | `<job-footer>` | injected via `app.js` |
| Markdown rendering | `renderMarkdown` | `job/js/markdown.js` |
| KB read/write | `kb-read` / `kbwrite.js` | `job/js/kbwrite.js` |
| Narrative create + AI tag | existing `narratives` POST | `supabase/functions/narratives/index.ts` |
| Fit preview Stage 5 | `scoreRole()` | `supabase/functions/jobs-pipe/fit.ts` |
| Card / chip / button / input | `job/css/components.css` classes | same |
| Lit component pattern | mirror `<job-vision>` | `job/js/components/job-vision.js` |
| Diff/edit affordance | `diff.js` | same |

**New shared CSS (promote into `job/css/components.css`):**
- `.stepper` — horizontal pill stepper. Current = `--accent-strong` fill, complete = `--accent` outline, future = `--muted`. Sentence case.
- `.dropzone` — 30px radius, dashed `--border`, hover lifts to `--accent`.
- `.chat-prompt` — large textarea (min 120px), Inter, helper-text caption above, ghost "skip for now" below-right.
- `.chip--editable` — extends existing chip with inline `×` and click-to-edit.

---

## Build phases

### Phase 1 — Schema + auth ungate *(this PR)*
- New table `user_profile` keyed by `auth.users.id`. JSONB columns: `identity`, `location`, `targeting`, `values`, `capability`, `preferences`, `wins`. Plus `onboarding_step` int, `onboarding_complete_at` timestamptz. RLS: user can only read/write own row.
- Seed `fike101@gmail.com`'s row with `onboarding_complete_at = now()` so existing access is preserved.
- Replace `ALLOWED_EMAIL` hardcode in `job/js/app.js` and `ALLOWLIST` in `_shared/job-auth.ts` with a `user_profile` row check.
- Sign-in flow: authenticated user with no `user_profile` row → redirect to `/job/onboarding` (placeholder page in this PR; real flow in Phase 3).

### Phase 2 — Upload + parse
- New edge function `onboard-ingest`: file upload → Haiku JSON-schema prompt → draft profile + extracted narratives.
- Storage bucket `onboarding-uploads` (private).
- Reuse JSON-fence parser from `narratives/index.ts`.

### Phase 3 — Onboarding page
- `/job/onboarding/index.html` + `job/js/components/job-onboarding.js` (Lit, mirror `<job-vision>` pattern).
- Stepper, one-question-per-screen on Stage 3, localStorage draft persistence.
- Dropzone, chip editors, chat prompts. Per-prompt Haiku tag extraction with visible "we heard:" surfacing.

### Phase 4 — Profile commit + preview
- New edge function `onboard-finalize`: staged JSON → writes `vision/narrative.md`, `vision/goals.md`, `vision/intents.md`, `vision/filters.md` (matches existing KB shape) + inserts narratives + flips `onboarding_complete_at`.
- Stage 5 preview calls existing `pull-recommendations` against a 3-role sample set and runs `fit.ts` live.

### Phase 5 — Sign-in entry
- `/job/not-authorized.html` → "Create your /job" CTA (or just remove the page now that onboarding is the default).
- Magic-link auth via existing `ctrl-auth` → row create → `/job/onboarding`.

### Phase 6 — Demo + QA
- Chrome MCP walkthrough: cold user → upload resume → 5 prompts → Fit preview.
- Bump `VERSION` in `app.js`.

---

## Open decisions

- **Storage of `user_profile` JSON vs. per-user KB markdown files:** dual-write for now — `user_profile` JSONB is canonical for fast reads (Fit scoring, JD pulls); markdown files mirror it for human editing in `<job-vision>`. Finalize step keeps them in sync.
- **Q3 wins repetition (×2):** if first answer is rich (>40 words + has a number), skip the second. Detect via Haiku.
- **Profile editability post-onboarding:** existing `<job-vision>` already supports editing `vision/*.md`. We add a "Profile" tab to it rather than building a separate settings page.
