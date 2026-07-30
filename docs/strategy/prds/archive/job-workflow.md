> **Archived from an orphaned branch.** Recovered from `claude/job-workflow-website-lqmLs` (last touched 2026-04-24),
> which shares no history with master after the repository history was rewritten.
> Kept for the thinking in it; nothing here is current.

# Job Workflow Brief

**Date:** 2026-04-24
**Scope:** Personal tool, not a product.

---

## Context

Job search today runs out of a spreadsheet. It tracks but doesn't work. The move is to a ctrl sub-app at `/jobs` built on the ctrl design system, with Claude Code routines as the execution layer. Storage lives in the existing Boards Supabase project; criteria and rejection lists live as files in this repo so routines can read them without DB roundtrips.

---

## Core use cases

### 1. Declare criteria

**Page:** `/jobs/criteria`
**Storage:** `docs/job-search/criteria.md` (+ a JSON companion for routines)

A single page (and repo file) that captures what I'm looking for — role titles, seniority, industries, stage/size, comp floor, location/remote, domain preferences, values, deal-breakers, and a free-text "what I'm optimizing for." Every routine below reads from this file. Editing the page commits the file.

### 2. Save companies I like → watch their job boards

**Page:** `/jobs/companies`
**Routine (scheduled, daily):** `watchlist-scrape`

Mark any company as watched. Each watched company stores its careers URL and detected ATS (Greenhouse, Lever, Ashby, Workday, custom). A daily Claude Code routine polls each source, diffs against last run, matches new postings against criteria, and creates `sourced` jobs for hits.

### 3. Pull saved jobs from LinkedIn

**Trigger:** browser extension button on LinkedIn's saved-jobs page
**Routine (API-triggered):** `linkedin-saved-import`

Extend the existing ctrl extension with "Import saved jobs." It scrapes the list and POSTs to a routine that dedupes against existing rows and inserts as `sourced`. Email-forward fallback if the extension breaks.

### 4. Recommend 5 jobs a day from my sources

**View:** `/jobs/for-you`
**Routine (scheduled, daily):** `daily-five`

Aggregates the day's pool (new watchlist postings + LinkedIn saves + any connected feeds), reads criteria, picks 5 with a one-line rationale each. Accept sends it to `sourced`; reject feeds back into the routine's rejection file so the same role never shows up twice.

### 5. Recommend similar companies

**Routine (scheduled, weekly):** `similar-companies`

Reads the saved-companies list, derives attributes (industry, stage, size, product category), proposes N new companies with rationale. Each shows up in `/jobs/companies` as a suggestion — add to watchlist or dismiss.

### 6. Find connections at target companies

**Routine (API-triggered on save):** `connection-sweep`

For any company entering the active pipeline, the routine:
- Uses the Gmail MCP connector to search for `@company.com` correspondents and surfaces them with last-contact date.
- Pulls 1st/2nd-degree LinkedIn connections via the extension.

Results land as `job_contacts` tagged `warm_source=gmail|linkedin` and show up on the role detail as "people you already know here."

### 7. Draft cold email, resume, cover letter

**Routines (API-triggered per job):** `draft-cold-email`, `tailor-resume`, `tailor-cover-letter`

- **Cold email** — reads criteria + job + chosen contact + shared context (mutual employers, schools, ctrl pins); writes a short draft to `job_events` for review.
- **Resume** — pulls resume source from the repo, tailors against JD + criteria, opens a PR on `claude/resume-<company>-<role>`.
- **Cover letter** — same flow, sibling file on the same PR.

All three read the single criteria file so voice stays consistent.

---

## Data

```
jobs                 id, company, role, status, source, link,
                     comp_raw, applied_at, last_touch_at, created_at

job_events           id, job_id, type, payload_jsonb, created_at
                     -- status_change, note_added, draft_generated,
                     --   routine_run, contact_added

job_contacts         id, job_id, name, title, email, linkedin,
                     warm_source, last_evidence_at

companies            id, domain, name, industry, stage, size,
                     careers_url, ats_vendor, is_watchlisted,
                     enrichment_jsonb, last_scraped_at

company_postings     id, company_id, external_id, title, link,
                     first_seen_at, last_seen_at, raw_jsonb

recommendations      id, job_id|posting_id, score_rationale,
                     surfaced_at, decision  -- accept|reject|snooze
```

Repo files (routine-readable):
- `docs/job-search/criteria.md` + `criteria.json`
- `docs/job-search/rejections.json`
- `docs/resume/resume.md` (source of truth for tailoring)

---

## Routines at a glance

| Routine | Trigger | Writes |
|---------|---------|--------|
| `watchlist-scrape` | Daily | `company_postings`, `jobs` (sourced) |
| `daily-five` | Daily | `recommendations` |
| `similar-companies` | Weekly | company suggestions |
| `linkedin-saved-import` | API (extension) | `jobs` (sourced) |
| `connection-sweep` | API (on save) | `job_contacts` |
| `draft-cold-email` | API (per job) | `job_events` |
| `tailor-resume` | API (per job) | repo PR |
| `tailor-cover-letter` | API (per job) | repo PR |

---

## Views

- `/jobs` — kanban by status, default view
- `/jobs/for-you` — daily five
- `/jobs/companies` — watchlist + similar-company suggestions
- `/jobs/criteria` — editable criteria
- `/jobs/:id` — role detail: events, contacts, drafts, linked pins/boards

All styled from `design-system/tokens.css` + `components.css`. Kanban may need `ds-kanban-column` + `ds-kanban-card`; documented in `design-system/README.md` if so.

---

## My choices

- **Storage:** Supabase (Boards project) for rows that power the UI; repo files for criteria, rejections, and resume source.
- **Execution:** Claude Code routines on my account. No pg_cron, no edge functions.
- **Views:** kanban + for-you + companies + criteria + detail. No separate table view unless I miss it.
- **Capture paths:** extension (LinkedIn saved + "Save as job"), watchlist scrape, manual add. No email forwarding at launch.

---

## Build order

1. Criteria file + schema + one-shot spreadsheet import.
2. `/jobs` kanban + `/jobs/:id` detail reading from Supabase.
3. `/jobs/companies` watchlist CRUD.
4. First routine: `watchlist-scrape`.
5. `/jobs/for-you` + `daily-five` routine.
6. Extension "Import saved jobs" + `linkedin-saved-import` routine.
7. `connection-sweep` + `/jobs/:id` "people you know" panel.
8. Drafters: `draft-cold-email`, `tailor-resume`, `tailor-cover-letter`.
9. `similar-companies` routine.
