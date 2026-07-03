# Ladder Recommendations — Scoring & Enrichment Follow-ups

Status: items 1-3, 9 shipped. Item 2 shipped 2026-07-02 (For You floors + wildcards strip). Items 4-5, 6-8 open. Use `/plan` to schedule the open ones.

**Shipped 2026-07-02 (recommendations v0.15.0-merged + ladder v2.14.2) — addresses items 1, 2, 3 (final iteration):**
- **#2 candidate floor (final):** raised 30→50. Graded rows with `candidate_score < 50` are hidden by default (applied at read time via `view=all&floor=1`); ungraded rows stay hidden until graded. Floors apply by default; toggle in header: "Below-floor hidden · show all" links to `view=all` (unfiltered audit surface).
- **#3 ranking (final):** blended score `0.6*candidate_score + 0.4*fit_score` for graded rows ≥50; ungraded rows ranked by fit_score; below-floor rows only visible when floor=0. Graded high-candidate + high-fit roles surface first.
- **Wildcards strip (new):** `view=wildcard` shows candidate_score ≥65, fit<50 roles as compact dashed cards with "why low fit" dimension labels — pressure-test surface to question search criteria. Lives on `/ladder/jobs/recommended/` as a separate strip.
- **Pre-save detail page (new):** `/ladder/jobs/<slug>/?rec=<id>` for For You roles — fit + strength breakdowns, match bullets, JD, Save/Dismiss/Open-posting. Clicking For You table rows/card titles opens it in new tab. Single-rec lookup via `?id=<uuid>` parameter.
- **#1 leakage:** addressed *via* #2/#3 — The Nava-PBC ops/proposals roles (high company-fit, low responsibilities-match) now sink or disappear once graded (candidate_score<50), rather than dominating the view. The substring title gate was intentionally removed by the earlier "surface all recs" change; we are NOT re-adding it — ranking + flooring on the candidate (responsibilities) grade is the durable fix. Revisit only if un-graded leakage proves persistent.

---

**Shipped 2026-06-16 (recommendations v0.9.0 + /ladder v2.3.6) — addresses items 1, 2, 3:**
- **#3 ranking:** For You now defaults to a "best overall match" sort — `candidate_score*0.6 + fit_score*0.4` for graded rows, `fit_score*0.8` for un-graded — so strong responsibilities-matches surface first and un-graded high-fit roles can't dominate the top. Clicking a column header still switches to that explicit sort.
- **#2 candidate floor:** graded rows with `candidate_score < 30` are dropped from the list (un-graded "verifying" rows are never dropped on this basis).
- **#1 leakage:** addressed *via* #2/#3 — this is the score-based approach the item itself called the target end-state. The Nava-PBC ops/proposals roles (high company-fit, low responsibilities-match) now sink or drop once graded, rather than being gated by brittle title strings. The substring title gate was intentionally removed by the earlier "surface all recs" change; we are NOT re-adding it — ranking on the candidate (responsibilities) grade is the durable fix. Revisit only if un-graded leakage proves persistent.

---

## 1. Title-filter leakage on greenlit companies (Nava PBC) — ADDRESSED via #2/#3

**Observation.** Roles from greenlit companies (e.g. Nava PBC) are getting past the job-title rules — surfacing titles that the title filter (`blocked_titles` / `target_titles` in `pull-recommendations`) should screen out. Symptom: a lot of **High Fit, Low Candidate** combos, where the heuristic fit score is high (company/domain/values match) but the Haiku candidate grade (roles & responsibilities match) is low.

**Why it happens (hypothesis).** Fit score is heavily weighted toward company/domain/values (`fit.ts` caps: values 25, role 25, domain 15…). A greenlit/on-domain company can score high on those axes even when the actual role is a poor match. The title filter is a coarse substring gate, not a responsibilities match.

**Question for investigation / definition.**
- How should title filtering work? Today it's substring-based (`titleMatchesAny`) against `vision.blocked_titles` / `target_titles`.
- **Target end-state:** filter/rank on *score* — i.e. roles & responsibilities match (the candidate grade), not title strings. Title strings are a proxy we'd retire.
- Interim: should greenlit-company roles get a title-filter bypass (intentional?) or should the title gate apply uniformly? Right now greenlit status may be letting them through.

**Where:** `supabase/functions/pull-recommendations/index.ts` (`loadBlockedTitles`, `titleMatchesAny`, `scoreAndFilter`), `supabase/functions/jobs-pipe/fit.ts` (weights).

---

## 2. Candidate-score low-end threshold

**Want.** Incorporate a low-end threshold for **candidate score** (the Haiku roles-&-responsibilities grade) — so very-low-candidate roles are dropped or visually de-emphasized even when their heuristic fit is high. This is the direct counter to the High-Fit/Low-Candidate leakage in (1).

**Open questions.** Threshold value? Hard drop vs. soft (sort to bottom / collapse)? Applies at insert time (`enrichAndScoreNewRows`) or read time (`recommendations` API)? Only when a candidate score exists (don't penalize un-graded `c —` rows)?

---

## 3. Backend ranking so pagination shows the best first

**Problem.** The For You list is now paginated (infinite scroll, 100/page). Pagination is ordered by `fit_score desc`. A role with a high **fit AND high candidate** score that happens to sort below the fit-only cut could land past page 1 and never be seen.

**Want.** Rank on the backend by a combined/blended score (fit + candidate) — or at least surface the highest *candidate*-scored roles near the top — so the best combos always appear first regardless of pagination. Order should reflect "best overall match," not just heuristic fit.

**Where:** `supabase/functions/recommendations/index.ts` (the `ORDER BY` — currently `r.fit_score desc`). Candidate score is `r.candidate_score`. Consider `order by coalesce(candidate_score, fit_score) desc` or a weighted blend, with a tie-break on `suggested_at`.

---

## 4. Duplicate entries — make a best-effort dedup to keep the list clean

**Observation.** The recs list has visible duplicates (e.g. OpenAI PM roles, plus many others). A scan of active recs (`group by lower(company), lower(title) having count(*) > 1`) shows three distinct duplication modes:

1. **Same LinkedIn job, different tracking params (most common).** The same posting appears 3-5× because the dedup keys on the full `url`, but LinkedIn alert URLs carry per-email `?trackingId=…&refId=…&eid=…` query strings that differ every send. Examples: Talently SPM (`/jobs/view/4405461200`) ×4, Curana SPM (`/jobs/view/4378986845`) ×3, BioRender Product Lead (`/jobs/view/4377259538`) ×3 — **same `/jobs/view/<id>`**, different query string.
   → **Fix:** normalize LinkedIn URLs to canonical `linkedin.com/jobs/view/<id>` (strip query) before any dedup/insert.

2. **Cross-source duplicates.** The same role arrives from multiple sources and all land, because insert-time dedup only checks `pipeline_roles`, not existing `recommended_roles`. Examples: Heidi "PM, Integrations" from `gmail-jobs` + `tracked-ats`; Collectly SPM from `gmail-jobs` + `theirstack`.
   → **Fix:** dedup new inserts against existing active `recommended_roles` on a normalized key (canonical_url when resolved, else `lower(company)|lower(title)`), merging source labels rather than inserting a second row.

3. **Same canonical posting via different resolved URLs.** Once enrichment resolves `canonical_url`, two rows that resolve to the same ATS posting should collapse into one.
   → **Fix:** dedup/merge on `canonical_url` after enrichment resolves.

**Note:** not every same-company/same-title cluster is a dupe — Heidi legitimately has many distinct openings. Key dedup on normalized URL / canonical posting id, with `(company,title)` as a secondary signal, not the sole key. Goal is best-effort cleanliness, not aggressive collapsing that hides real distinct roles.

**Where:** `supabase/functions/pull-recommendations/index.ts` (insert/dedup path — currently only the `pipeline_roles` NOT EXISTS check), `gmail-jobs.ts` (`hasMultipleJobLinks` already normalizes `/jobs/view/<id>` — reuse that normalization for dedup keys), `recommended_roles` (consider a normalized-url unique index or a merge-on-insert).

---

## 6. Use the decline signal from "For You" (we log it; we don't use it)

**Question raised:** are we logging all the roles I decline in For You? **Yes** — dismissing a rec sets `recommended_roles.dismissed_at = now()` and the row persists with full data (company, title, fit_score, candidate_score, breakdown). As of 2026-06-16 there are **243 dismissed roles** spanning 2026-05-09 → today. So the data exists and is queryable.

**The gap:** we capture the dismissal *event* but (a) no **reason**, and (b) we don't **use** it. This is high-value negative-preference data — "what roles Ian doesn't like."

**Proposed:**
- Optional lightweight reason on dismiss (e.g. quick chips: wrong role / wrong domain / wrong seniority / comp / location / not interested). UI: `job-recommendations-table` dismiss button → small reason popover; store `dismissed_reason`.
- A "what you decline" analysis (cluster dismissed roles by domain/title/seniority) to surface patterns.
- Feed the signal back into scoring/preferences: recurring dismissed titles → suggest `vision.blocked_titles`; dismissed-domain skew → down-weight; or a learned negative-preference term in `fit.ts`. Closes the loop with follow-up #1 (move filtering toward responsibilities/preference signal, not title strings).

**Where:** `recommendations/index.ts` (dismiss POST — add `dismissed_reason`), `job-recommendations-table.js` (reason UI), a new analysis surface (could live on `/ladder/vision` or a settings insight).

---

## 7. Capture Jack & Jill curated roles (high-value, not currently ingested)

**What:** [Jack & Jill](https://www.jackandjill.ai/) is an AI recruiting platform (raised $20M seed, 2025). "Jack" is a candidate-side AI agent that interviews the user and emails **curated, comp-included, pre-matched roles** — i.e. a similar product to what /ladder is building, already doing the matching + scoring. Emails come from **`jack@jackandjill.ai`** (to `fikei@uw.edu`, same connected inbox). Example subjects: "Role details: Hinge Health, Roger, Sailor, Abridge, Everlywell, Luro + more"; "Following up: Healthtech roles and a new Director of Product lead"; "Deep dive: Paraform, Protagonist, Incredible Health".

**Why high value:**
- Human+AI-curated roles with **salary** ($232k–$320k base + equity), location, stage — richer than LinkedIn alerts.
- Each digest has a **"TOP PICKS YOU'VE LIKED"** section = explicit *positive*-preference signal (pairs with item 6's negative signal).
- These are already filtered to Ian's healthtech / zero-to-one sweet spot by a peer product.

**Are we capturing them? No.** `DEFAULT_ALLOW_SENDERS` in `gmail-jobs.ts` covers linkedin/wellfound/otta/builtin/yc/hnhiring/workatastartup — **not `@jackandjill.ai`** — so these are silently skipped (out-of-allowlist).

**Proposed:**
- Add `@jackandjill.ai` to the allowlist.
- The format is **conversational prose with multiple roles + comp**, not clean `/jobs/view/<id>` links — route to the Haiku multi-extractor (`extractJobsMulti`) with a prompt variant tuned for this digest shape (extract company, title, comp, location, and the like/recommended status per role).
- Mine the "roles you've liked" as explicit positive-preference signal into vision/preferences and the candidate scorer.

**Where:** `gmail-jobs.ts` (`DEFAULT_ALLOW_SENDERS`, `looksLikeDigest`/`hasMultipleJobLinks`, `extractJobsMulti` prompt), preference plumbing for the like-signal.

---

## 9. Concrete role-closure detection — when is a role closed, and how do we log it?

**Shipped 2026-06-19** (`pull-recommendations` v0.22.0, `enrich-job-source` v0.5.0, `recommendations` v0.11.0):
- **Migration 082_role_liveness.sql:** `recommended_roles` gained `closed_at timestamptz`, `last_seen_at timestamptz`, `closure_reason text` ('delisted' | 'ats-delisted'), plus partial index on active rows.
- **Layer 1 — tracked-ats "disappeared since last pull" diff:** POST `pull-recommendations` v0.22.0. After each pull, diff full board against active recs. Ids present → stamp `last_seen_at`, clear `closed_at`; ids in fetched-slug set but absent → `closed_at = now()`, `closure_reason = 'delisted'`. Only operates on fetched slugs (safe from transient failures). Known v1 limit: zero-open-postings tail uncaught by layer 1; layer 2 catches via age-out.
- **Layer 2 — ATS board-API liveness re-check:** `enrich-job-source` v0.5.0, new `action: 'liveness'`. Selects up to `limit` (default 40) active ATS roles ordered `last_seen_at nulls first`, fetches live open-id set per provider:slug, closes roles absent from live set (`closure_reason = 'ats-delisted'`); skips on fetch error. Returns {checked, open, closed, skipped}.
- **Read filter:** `recommendations` v0.11.0: `and r.closed_at is null` added to whereClause — closed roles hidden from For You + widget, kept for history (like dismissed).
- **Cron:** `liveness-check-6h` (`0 */6 * * *`) POSTs `{action:'liveness', limit:40}` to enrich-job-source.
- **Verification (2026-06-19):** forced tracked-ats pull closed 2 (sane), seen 55, `last_seen_at` populated; liveness ×3 closed only genuinely-gone roles (3/3 verified absent from live boards); read-filter passed (0 closed-row leaks). PRs #941 merged, functions deployed, cron registered.
- **Open/deferred:** grace period before closing; distinguishing "filled" vs "paused"; zero-open-postings tail; gmail/LinkedIn non-ATS roles (Phenom, etc.) lack liveness signal.

**Question raised (pre-ship):** how do we know a role has actually been closed/filled, and how do we record it? Today a `recommended_roles` row lives forever once created; we have no closure signal, so the list accumulates stale (filled/expired) postings.

**Closure signals, by source:**
- **tracked-ats (strongest):** we re-pull the company's FULL open-roles list each cycle. A previously-seen `source_id` that's no longer returned = the posting was taken down = closed. (The `/jobs` careers-page skill already does exactly this — marks disappeared roles "Not Listed".) Implement: stamp `last_seen_at` on every pull; if a tracked-ats `source_id` isn't in the latest pull for its company, mark it closed.
- **gmail / LinkedIn / canonical ATS:** re-fetch the canonical posting (or the LinkedIn page) on a schedule; a `404`/`410`, a "No longer accepting applications" banner, or the title vanishing from the company's board = closed. The enrich-retry cron is a natural place to also do a liveness re-check on resolved roles.
- **Greenhouse/Lever/Ashby:** the posting id disappearing from the board list API = closed (same as tracked-ats).

**How to log:** add `closed_at timestamptz` (+ maybe `closure_reason` = not_listed / 404 / delisted) and a rolling `last_seen_at` to `recommended_roles`. A closed role is filtered out of For You (like dismissed) but kept for history/analytics — it pairs with the decline signal (item 6) to understand the full lifecycle. Consider a small `liveness-check` cron (or fold into enrich-retry) that re-verifies resolved roles and the tracked-ats "disappeared since last pull" diff.

**Open questions:** grace period before marking closed (1 missed pull vs N)? Re-open if it reappears? Distinguish "filled" from "paused/expired" (we usually can't from the outside — `closure_reason='delisted'` is the honest default).

**Where:** `tracked-ats.ts` (diff seen-vs-pulled per company), `enrich-job-source` (liveness re-check), `recommended_roles` (schema), `recommendations` read filter, a new cron.

---

## 8. Backfill cursor-lock on all-duplicate batches (gmail-jobs)

Surfaced while backfilling the post-outage gap. In timestamp/backfill mode (re-listing a window), a message whose extracted role(s) all dedup at insert (on_conflict on source_id, or the new #4 cross-rec dedup) leaves **no trace** — no rec row carries its `gmailApiId`, no `gmail_skipped` row — so the pre-fetch dedup doesn't skip it next run, it's re-processed, `newWork` increments, the run caps, and the cursor never advances. Result: the window re-scans forever, `inserted=0`, cursor stuck. Item #4's dedup makes this MORE likely (more inserts collapse to dup).

Note: this only bites in **re-list/backfill mode**. Normal `history.list` incremental operation returns each message once, so it's unaffected (and the cursor was restored to incremental mode after the gap backfill yielded ~0 net-new — recurring LinkedIn digests meant the gap's still-open roles were already re-captured).

**Fix:** when a message is fully processed (Haiku'd) but produces no NEW insert, still record it so the pre-fetch dedup skips it next run — e.g. log a lightweight `gmail_skipped` row with reason `all_dup`, or don't count dedup-collision messages toward `newWork`. Required before any future windowed backfill.

---

## Investigation finding: enrichment-resolution gap (the "VERIFYING" ceiling)

Context for the above: ~half of Gmail/LinkedIn-sourced roles stay `enrichment_status='unresolved'` ("VERIFYING") and therefore **cannot be candidate-scored** (Haiku grading needs a JD).

**Root cause (from `enrich-job-source/index.ts`).** The resolver maps `(company, title)` → a canonical ATS posting (greenhouse/lever/ashby) to fetch the JD. It fails when:
- the company isn't detectable on a known ATS provider, or
- the company resolves but the **title doesn't match** a live posting (`resolved_company_no_title_match` / `cached_company_no_title_match`).

On failure it backs off with `nextRetryAt` capped at **7 days**, so unresolved roles linger as VERIFYING for up to a week (kept on their `linkedin.com/comm/jobs/view/<id>` URL with no JD).

**Highest-leverage fix (proposed, not yet built):** when ATS resolution fails, fetch the JD directly from the LinkedIn job page (the alert URL already in `url`) so candidate scoring can proceed without a canonical ATS match. Secondary: broaden ATS detection (Workday, etc.) and shorten the first-retry backoff (7d is too long for a fresh miss).

### ATS-gap investigation (2026-06-16): where do unresolved companies actually list?

Researched 16 currently-unresolved companies (all hiring PMs) to answer "do they have a durable listing beyond LinkedIn, and on what platform?" **Answer: yes — nearly all have a durable ATS-backed careers page.** Our detector (`detectAts` in `enrich-job-source/index.ts`) only probes **Greenhouse, Lever, Ashby** and guesses the slug from a normalized company name.

Two distinct gaps:

**A. Slug-guessing fails for companies that ARE on a supported ATS (higher ROI).** 8 of 16 are on Greenhouse/Lever/Ashby — which we already probe — yet stay unresolved, because `probeSlug` guesses the wrong slug from the company name:
- Ashby (already supported): Ambience Healthcare → `ambiencehealthcare`, Ascertain → `ascertain`, Baseten → `baseten`, Benepass → `benepass`, BetterUp → `betterup`, Brain Co. → `brainco`
- Greenhouse: BetterHelp → `betterhelpcom`
- Lever: Beam (Benefits) → `beam`
- **Fix:** extract the real ATS slug/URL from the email body (LinkedIn alerts often include the apply link), and/or generate better slug candidates (drop "Inc/Co/Health/Healthcare" suffixes, try concatenated + hyphenated + `…com` variants). This alone would resolve ~half the misses with no new providers.

**B. Missing ATS providers.** Companies on platforms we don't probe at all:
- **Workday** — Alteryx (`alteryx.wd5.myworkdayjobs.com`), Availity (`availity.wd1…`), Bonterra (`bonterra.wd1…`). Public JSON: `POST https://{tenant}.wd{N}.myworkdayjobs.com/wday/cxs/{tenant}/{site}/jobs`. Highest-value add (enterprise/healthcare default).
- **Workable** — Applause (`apply.workable.com/applause-4`). Public: `apply.workable.com/api/v3/accounts/{slug}/jobs`.
- Low ROI / no public API: UltiPro (Baylor Genetics), Gem (BioRender, `jobs.gem.com`), Phenom (Actalent).

**Staffing-agency caveat:** Actalent is a staffing agency — the "company" is the recruiter, not the employer. These are fundamentally unresolvable and should be flagged/down-weighted, not retried.

**Recommended build order:** (1) extract apply-URL from email body + stronger slug candidates → fixes gap A; (2) add Workday detector (covers the enterprise tail) → biggest chunk of gap B; (3) add Workable; (4) LinkedIn-JD fallback for the genuinely-unresolvable remainder so they can still be candidate-scored.

### ATS-gap, EMPIRICALLY REVISED (2026-06-16, second pass)

Direct testing against the live ATS APIs **disproved the "slug-guessing bug" hypothesis** — slug detection already works:
- Ashby `ambiencehealthcare` → 200, `betterup` → 200 (with jobs), `baseten` → 200; Greenhouse `betterhelp`/`betterhelpcom` → 200. The `compact` candidate slug already generates these.
- `job.hiring_companies` confirms Ambience/Baseten/Beam/Benepass/BetterUp are all **`resolution_status='resolved'`** with the correct provider+slug, `retry_count=0`. The COMPANY resolves fine.

**The actual blocker is `resolveCanonicalForTitle` (title → posting match), not slug detection.** Example: our LinkedIn role "Senior Product Manager @ Ambience Healthcare", but Ambience's Ashby board only lists "**Product Lead, Platform**" / "Product Lead, Emergency Department" — no "Product Manager". `titleSimilar` (needs ≥2 shared tokens after `product manager`→`pm` normalization) can't bridge "Senior PM" ↔ "Product Lead", so it returns no match → role stays `unresolved` with a 7-day backoff. Re-running enrichment after resetting the backoff resolved **0/15** — same matcher, same miss.

**Two confirmed gaps:**
1. **Brittle title matching.** Token overlap can't handle synonymy (Product Lead / Head of Product / Director of Product ≈ PM-family) or qualifier drift ("Senior PM" vs "PM, Platform"). **Proposed fix (the right one): Haiku-assisted match** — `resolveCanonicalForTitle` already fetches the company's full board list; replace the `titleSimilar` find() with a Haiku call that picks the best-matching posting *or returns none* (conservative, to avoid attaching the WRONG JD → wrong candidate score). Cheaper/safer interim: expand the role-core synonym normalization (product lead/head of product/director of product → pm) and relax the shared-token rule for short titles **with a seniority-conflict guard**.
2. **No enrichment-retry cron.** `enrich-job-source?action=backfill` exists but nothing calls it on a schedule — so once a role is `unresolved` with a future `enrichment_retry_at`, it's only retried if re-pulled (which only happens for NEW messages). Unresolved roles are effectively stuck. **Proposed:** a pg_cron (like `grade-ungraded-10min`) that POSTs `enrich-job-source {action:backfill, limit:N}` every ~10 min. (Auth: needs an `Authorization: Bearer` JWT, not just apikey.)

**Net:** the durable-listing answer to "do these companies have a source of truth beyond LinkedIn?" is **yes** — they're on Ashby/Greenhouse/Lever/Workday and we resolve the company; the unlock is matching the *role title* to the right posting (Haiku) + an auto-retry cron, NOT slug detection.

### LinkedIn "Apply" → real ATS (third pass, 2026-06-16)

For the LinkedIn-sourced roles that stay unresolved, clicking **"Apply on company website"** on the LinkedIn job page redirects to the company's real ATS — a reliable way to discover where they actually list. Sampled:
- **Humana** "Lead PM, Automation" → `centerwellcareers.com/us/en/job/HUMCEN…` — **Phenom People** career site (`utm_medium=phenom-feeds`).
- **LivaNova** "Digital Health Sr PM" → `careers.livanova.com/us/en/job/LIKLIV…` — **Phenom People** (same `/us/en/job/<ID>` + `phenom-feeds` signature).
- (Cadence and others followed the same enterprise-careers-site pattern.)

**Takeaway:** a big slice of the "unmatchable" enterprise/healthcare roles are on **Phenom People** hosted career sites (`*careers.com` / `careers.*.com`, path `/us/en/job/<id>`), which we don't detect. Phenom pages embed JSON-LD `JobPosting` structured data, so the JD IS scrapable even without a clean API.

**Two concrete unlocks:**
1. **Follow the LinkedIn apply redirect during enrichment.** The LinkedIn job page's "Apply on company website" link resolves (via a LinkedIn redirect) to the canonical careers URL. Capturing that gives us the durable ATS URL + a page to scrape the JD from — no slug/title guessing needed. This is likely the single highest-yield fix for the LinkedIn remainder.
2. **Add a Phenom detector + JSON-LD JD scraper** (`/us/en/job/` host pattern → fetch page → parse `<script type="application/ld+json">` JobPosting.description). Covers Humana/CenterWell/LivaNova and the enterprise tail.

**Already shipped (2026-06-16):**
- Batched grading drain: `pull-recommendations?rescore=1&ungraded=1&limit=N` (v0.16.2) — grades only ungraded rows that have a JD, newest first.
- pg_cron `grade-ungraded-10min` — drains ungraded grading automatically every 10 min so candidate scores fill in without manual passes.
