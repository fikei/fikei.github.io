---
name: job-radar
description: "Sweep ~55 soft-goods, outdoor, bag-brand, and outdoor-tech company job boards LIVE via their first-party ATS APIs (Greenhouse, Lever, Workday, Workable, Rippling, SmartRecruiters), verify every rec is actually open, fit-rank against Ian's profile, and produce a detailed tiered report. Use this skill whenever the user asks about job openings, open roles, active recs, hiring, or careers at outdoor/bag/soft-goods companies (Peak Design, Db, Bellroy, Cotopaxi, Mountain Hardwear, Strava, HydraPak, etc.), says '/job-radar', 'scan the boards', 'what's open', 'any new roles', or wants to re-check whether previously found roles are still live. Also trigger for 'production side of soft goods' or PLM/product-developer role searches."
---

# Job Radar — Live ATS Sweep for Soft-Goods & Outdoor Roles

You are running a job scan for Ian: verified-open roles only, fit-ranked, with the honesty of a good recruiter. This skill exists because a previous scan built from search-engine snippets reported closed roles as open. The prime directive follows from that:

**A role may only be reported as OPEN if it appeared in a first-party fetch executed during this run.** Never supplement from web search, Google/Built In/Glassdoor/LinkedIn/Malakye/ZipRecruiter listings, or memory of previous scans. If a board can't be reached, the company is reported as UNVERIFIED with its board link — an honest gap beats a confident stale answer.

## Step 1: Fetch the boards

```bash
python3 .claude/skills/job-radar/scripts/fetch_boards.py            # full sweep
python3 .claude/skills/job-radar/scripts/fetch_boards.py --segments bay-area outdoor-tech
python3 .claude/skills/job-radar/scripts/fetch_boards.py --companies "Peak Design" Strava HydraPak
```

Segments: `bag-boutique`, `outdoor-brand`, `ultralight`, `large`, `bay-area`, `outdoor-tech`. Default the sweep to what the user asked for; full sweep if unscoped. Output lands in `job-scans/raw-<date>/` — one JSON per company plus `summary.json`. Each record carries `fetched_at`, the proof of liveness.

The registry is `companies.json` (sibling of this file). It encodes which ATS each company uses and hard-won notes (who's outreach-only, who left the Bay Area, which reqs recur). When you discover a new company, a changed ATS, or a dead slug, **update companies.json in the same session** — the registry is the asset.

## Step 2: Handle the three result kinds

- **`structured`** — normalized jobs straight from the ATS API. These are verified-open. Use them as-is.
- **`html-text`** — the careers page text (with `[link: …]` markers). Read the JSON file and extract role titles/locations/links yourself. Some pages (JazzHR, GoHire, Teamtailor, SuccessFactors) list jobs inline; others are shells — if the text clearly links to a board subpage, follow it with WebFetch. Roles extracted this way count as verified (first-party page, this run).
- **`error` / failures** — the company goes in the UNVERIFIED section, with its careers URL for manual checking. Common fixable failures: a Greenhouse/Lever slug changed (try the careers page to find the new board and update the registry), or a Workday `site` name changed. Try one fix; don't burn the run on a stubborn board.

`no-board` companies (DSPTCH, Black Ember, Rickshaw…) are outreach targets — list them in the report's outreach section, never as "no openings found."

## Step 3: Fit-rank

Read `references/profile.md` and score every open role into Track A (production side of soft goods) or Track B (digital), applying the hard filters and geography ordering there. Judgment calls to apply consistently:

- A role's *content* beats its title — an "eCommerce Merchant" doing CRO/site ownership may outrank a "Product Manager" doing delivery ops.
- State comp trade-offs plainly (production roles often pay half of senior PM rates).
- Titles below seniority at priority companies are "signals," not targets — one line, not a table row.

## Step 4: Report

Save to `job-scans/scan-<YYYY-MM-DD>.md` and present in conversation. Use exactly this structure:

```markdown
# Job Radar — <date> (<segments swept>)

**TLDR:** <2-3 sentences: how many verified-open fits, the single best role per track, anything time-sensitive>

## ⏰ Time-sensitive
<roles with stated deadlines, or "None">

## Track A — Production side (verified open)
| Role | Company / Location | Posted | Fit |
|---|---|---|---|
| [Title](url) | Company — City (hybrid/remote) | date | STRONG/MODERATE — one-line why, incl. comp reality |

## Track B — Digital (verified open)
<same table>

## Signals & near-misses
<one-liners: junior roles at priority companies, recurring req patterns worth watching>

## Outreach targets (no board / nothing posted)
<company — contact channel — one-line pitch angle>

## ⚠️ Unverified (board unreachable this run)
<company — board URL — reason. These are NOT "no openings.">

## Changes since last scan
<diff vs the most recent previous job-scans/scan-*.md: new roles, disappeared roles (likely filled/closed), still-open carryovers. Skip section if no previous scan exists.>
```

The "Changes since last scan" diff is the recurring value: disappeared = probably filled (note if it was a target), new = act fast. Compare against the newest previous scan file in `job-scans/`.

## Step 5: Push into Ladder

Every sweep also feeds /ladder — verified-open roles become graded recommendations in the Inbox, and boards that disappeared close their stale recs:

```bash
python3 .claude/skills/job-radar/scripts/push_to_ladder.py
```

This uploads the raw scan to the `ats-radar-ingest` edge function (staging table `job.ats_radar_scans`) and force-runs the recommendations worker. Only `structured` (first-party verified) jobs are ingested; UNVERIFIED and `html-text` boards travel along as health metadata and can never close recs — the Sources row on /ladder/vision/?section=sources shows "N boards unverified" so an unreachable board is never mistaken for "no openings". Auth comes from the Supabase CLI login (or `LADDER_CRON_SECRET` / `SUPABASE_SERVICE_ROLE_KEY` env).

## Housekeeping

- `job-scans/` is scratch output — keep it gitignored (there's an entry in `.gitignore`); reports contain no repo-relevant code.
- If the sweep runs where boards are network-blocked (e.g., a sandboxed remote session), `summary.json` will show mass failures: say so plainly, produce only the UNVERIFIED section, and stop — do not fall back to web search for postings.
- Speed: the script parallelizes fetches (~1–2 min full sweep). For the report, prioritize depth on the user's asked-for segment over covering everything thinly.
