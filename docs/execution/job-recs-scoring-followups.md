# Job Recs — Scoring & Enrichment Follow-ups

Status: open investigation items. Logged 2026-06-16 during the Gmail→recs pipeline recovery. Not yet scheduled into the plan — use `/plan` to break these into stories when prioritized.

---

## 1. Title-filter leakage on greenlit companies (Nava PBC)

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

## Investigation finding: enrichment-resolution gap (the "VERIFYING" ceiling)

Context for the above: ~half of Gmail/LinkedIn-sourced roles stay `enrichment_status='unresolved'` ("VERIFYING") and therefore **cannot be candidate-scored** (Haiku grading needs a JD).

**Root cause (from `enrich-job-source/index.ts`).** The resolver maps `(company, title)` → a canonical ATS posting (greenhouse/lever/ashby) to fetch the JD. It fails when:
- the company isn't detectable on a known ATS provider, or
- the company resolves but the **title doesn't match** a live posting (`resolved_company_no_title_match` / `cached_company_no_title_match`).

On failure it backs off with `nextRetryAt` capped at **7 days**, so unresolved roles linger as VERIFYING for up to a week (kept on their `linkedin.com/comm/jobs/view/<id>` URL with no JD).

**Highest-leverage fix (proposed, not yet built):** when ATS resolution fails, fetch the JD directly from the LinkedIn job page (the alert URL already in `url`) so candidate scoring can proceed without a canonical ATS match. Secondary: broaden ATS detection (Workday, etc.) and shorten the first-retry backoff (7d is too long for a fresh miss).

**Already shipped (2026-06-16):**
- Batched grading drain: `pull-recommendations?rescore=1&ungraded=1&limit=N` (v0.16.2) — grades only ungraded rows that have a JD, newest first.
- pg_cron `grade-ungraded-10min` — drains ungraded grading automatically every 10 min so candidate scores fill in without manual passes.
