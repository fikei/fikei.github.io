# Technical Design: `/ladder` — Career KB + Pipeline Web Product

**Version:** 1.0
**Date:** 2026-05-08
**Status:** Draft
**PRD:** [`docs/strategy/prds/ladder-product.md`](../../strategy/prds/ladder-product.md)

---

## System overview

```
┌──────────────────────────────────────────────────────────────────────────┐
│  ctrl.rodeo/ladder/  (Jekyll-served static + vanilla JS)                    │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐                      │
│  │ History     │  │ Vision      │  │ Jobs        │                      │
│  │ (3-level    │  │ (resume     │  │ (pipeline + │                      │
│  │  drilldown) │  │  + intent)  │  │  fit score) │                      │
│  └─────────────┘  └─────────────┘  └─────────────┘                      │
└────────────┬─────────────────┬─────────────────┬─────────────────────────┘
             │                 │                 │
             ▼                 ▼                 ▼
   ┌───────────────────────────────────────────────────────┐
   │  Supabase Edge Functions (Boards project)             │
   │  ┌──────────┐  ┌──────────┐  ┌────────────┐  ┌─────┐ │
   │  │ kb-read  │  │ kb-write │  │ jobs-pipe  │  │ fit │ │
   │  └──────────┘  └──────────┘  └────────────┘  └─────┘ │
   └────┬────────────────┬────────────────┬────────┬───────┘
        │                │                │        │
        ▼                ▼                ▼        │
   ┌──────────┐   ┌──────────┐    ┌──────────┐    │
   │ GitHub   │   │ GitHub   │    │ Google   │    │
   │ raw.md   │   │ commit   │    │ Sheets   │    │
   │ (read)   │   │ (write)  │    │ API      │    │
   └──────────┘   └──────────┘    └──────────┘    │
   fikei/job      fikei/job        Job Search      │
                                  spreadsheet      │
                                                   ▼
                                          (computed in-process,
                                           no external call)
```

---

## Stack decisions

| Layer | Choice | Why |
|---|---|---|
| Front-end | Jekyll + vanilla JS (no framework) | Matches existing ctrl.rodeo apps (Boards, Soundscape). No new tooling. |
| Routing | Jekyll-generated HTML pages | Static at build time; pages exist on disk so SEO/sharing works. |
| Data fetching | `fetch()` against Edge Functions | Same pattern as Boards. |
| Auth | `auth/ctrl-auth.js` (existing) | Reuses session across ctrl.rodeo. Allowlist Ian's email. |
| Backend | Supabase Edge Functions (Deno) | Existing infra. Service-account secrets live here. |
| Styles | CSS custom properties + token files | Theme-swap via `data-theme` attr. |
| Design system | Wise tokens (default) + CTRL tokens (alternate) | Both as separate `tokens-*.css` files. Component CSS reads from the abstract `--color-bg`, `--font-body`, etc. |

---

## Routes

```
/ladder/                    → redirect to /ladder/jobs/ (default landing)
/ladder/history/            → resume view
/ladder/history/{company}/  → company detail
/ladder/history/{company}/{project}/ → project detail
/ladder/history/skills/{skill}/      → skill detail
/ladder/history/wins/{win}/          → win detail
/ladder/vision/             → goals + intents view
/ladder/jobs/               → pipeline table
/ladder/jobs/{role-slug}/   → per-role detail (fit-score breakdown + linked KB)
```

Each route is a Jekyll layout that fetches data on load via Edge Function calls.

---

## Edge Functions

All hosted on the **Boards Supabase project** (`yfhudwakpgzswiylhfbh`) for v1. Promote to dedicated project in v2.

### `kb-read`

`GET /functions/v1/kb-read?path={file_path}`

Reads a markdown file from the `fikei/job` GitHub repo (private). Used by the Job History + Job Vision views.

**Auth:** caller must be a signed-in allowlisted user.
**Secrets:** `GITHUB_PAT` (read-only on `fikei/job`).
**Response:** `{ content: string, sha: string, path: string }` — sha needed for safe writes (optimistic concurrency).

**Caching:** Edge Function caches per-path response for 60 seconds (LRU in-memory) to avoid hammering GitHub raw on rapid drilldown navigation.

### `kb-write`

`POST /functions/v1/kb-write`
Body: `{ path: string, content: string, baseSha: string, message?: string }`

Writes a markdown file back to `fikei/job` via GitHub Contents API. Uses `baseSha` for optimistic concurrency — if the file changed since read, returns 409 with the new content for client-side merge.

**Auth:** allowlisted user only.
**Secrets:** `GITHUB_PAT` (read+write on `fikei/job`).
**Commit:** authored as Ian via the PAT user. Commit message defaults to `chore: edit {path} via /ladder product`.
**Cache invalidation:** clears the `kb-read` cache for that path on success.

### `jobs-pipe`

`GET /functions/v1/jobs-pipe`

Returns the full pipeline view. In v1: reads from the Google Sheet via service account; computes fit scores; returns JSON.

**Auth:** allowlisted user.
**Secrets:**
- `SHEETS_SERVICE_ACCOUNT_JSON` (the `claude-sheets@...` service account already shared with the Job Search sheet).
- `JOB_SEARCH_SHEET_ID` (`1YtZp3vxlsVP8t_eWpcYzYEVjaSKu8rVYmVRPr4AGeAU`).

**Process:**
1. Fetch Companies tab (`gid=0`) and Roles tab (`gid=958939782`) via the Sheets API.
2. Pull current Vision (Goals & Intents markdown files) via `kb-read`.
3. For each role: compute fit score (see `fit` function below).
4. Return enriched rows: `{ ...rowFromSheet, fitScore, fitBreakdown, companyData }`.

**Caching:** 5-minute response cache. The `/jobs` skill is the canonical writer to the sheet; cache TTL bounds staleness.

`POST /functions/v1/jobs-pipe`
Body: `{ row: number, status?: string, fitScoreOverride?: number, ... }`

Writes back to a specific Roles row. Used for Status changes (Pass / Apply / Talking).

### `fit`

Internal module imported by `jobs-pipe`. Pure function:

```ts
function computeFitScore(role: Role, vision: Vision): {
  score: number;       // 0–100
  breakdown: {
    title: number;     // 0–25
    stage: number;     // 0–20
    sector: number;    // 0–20
    geo: number;       // 0–15
    comp: number;      // 0–10
    source: number;    // 0–5
    network: number;   // 0–5
  };
  hardFails: string[]; // e.g. ['below seniority floor']
}
```

**Hard fails** cap the score at 30. Otherwise, sum of weighted components.

**Title scoring** (max 25):
- "Founding PM" / "Product Lead" / "Senior PM" exact → 25
- "Staff PM" / "Principal PM" / "Group PM" → 20
- "Head of Product" → 22 (if co < 50 ppl) else 12
- "Director of Product" → 15
- "Product Manager" (no senior prefix) → 10 (cap if Ian's vision floor is "Senior+")
- Anything containing deal-breaker terms → 0 with hardFail

**Stage scoring** (max 20):
- Pre-seed / seed / A / B / C → 20
- D / E → 10
- Public / mega-cap (without breakout) → 5 with hardFail

**Sector scoring** (max 20):
- Health / EdTech → 20
- AI-native / SaaS / Fintech (in nice-to-have list) → 15
- Adjacent → 10
- Off-thesis → 0

**Geo scoring** (max 15):
- SF Bay Area / Remote US / NYC → 15
- Hybrid elsewhere → 0 with hardFail

**Comp scoring** (max 10):
- Meets floor ($200k+ base) → 10
- Below → 0
- Unknown → 5

**Source scoring** (max 5):
- Network → 5
- LinkedIn Saved → 4
- LinkedIn Recommended → 3
- From Company Pages → 2
- Manual → 1

**Network scoring** (max 5):
- Investor in Ian's VCs tab → +3
- Direct connection at the company (Network tab match) → +5

---

## Job liveness / expiry detection

The system maintains two separate tables for job recommendations and tracks their liveness independently:

**For You (recommended_roles):** Hidden from view when `closed_at is not null`. Filtering happens in the `recommendations` edge function (`recommendations/index.ts`). Closed rows are retained for historical analysis.

**Saved (pipeline_roles):** Closed rows get `status='Closed'` and `archived_at` timestamp. Separate liveness tracking and status.

### For You liveness (three layers)

**Layer 1 — ATS board re-pulls** (every 15 minutes)
- Edge function: `pull-recommendations`
- Cron: `pull-recommendations-15min` (x-cron-secret auth)
- Process: Re-pulls tracked ATS boards (Greenhouse, Lever, Ashby, etc.) and compares against stored recommendations by ID. If a rec ID disappears from the live board, sets `closed_at` + `closure_reason='delisted'`. If the same ID reappears later, clears `closed_at` (reopens the rec).
- Data retention: Closed recs stay in the DB for history.

**Layer 2 — ATS open-id API checks** (every 6 hours)
- Edge function: `enrich-job-source` with `action=liveness`
- Cron: `liveness-check-6h` (anon Bearer auth)
- Process: Re-checks recs whose URL resolves to Greenhouse/Lever/Ashby against each ATS's open-id API. Sets `closure_reason='ats-delisted'` on closure.

**Layer 3 — URL liveness probes + age-out** (every 6 hours, same call as Layer 2)
- Edge function: `enrich-job-source` with `action=liveness` (v0.7.0+)
- Process:
  1. **genericLivenessBatch:** HEAD/GET-probes remaining non-ATS active recs (LinkedIn, weworkremotely, remotive, misc ATS). Closes on HTTP 404/410/451 → `closure_reason='url-dead'`. LinkedIn is probed via its public `jobs-guest` posting API (the posting page itself is bot-blocked).
  2. **ageOutStale:** Closes any active rec not confirmed open in STALE_TTL_DAYS (45 days) → `closure_reason='stale'`. Tracks freshness via `last_seen_at` (set by Layer 1/2/3 on confirmation), falling back to `suggested_at`. This is the backstop for LinkedIn and aggregator URLs that return HTTP 200 even after expiration.

**Known limitation:** LinkedIn returns 200 even for expired postings. Neither HEAD probes nor the guest-API check reliably closes them. The 45-day age-out is the real mechanism.

**UX signal (v0.13.0+):** The `recommendations` GET endpoint returns `recentlyExpired` = count of recs closed in the last 7 days. The For You table header displays a "· N expired removed" note, making pruning visible instead of silent.

### Saved liveness

**URL probing** (every 3 hours)
- Edge function: `check-liveness` (verify_jwt=true, single-user auth)
- Cron: `saved-liveness-3h` (migration 087, requires both anon Bearer + x-cron-secret to bypass per-user auth)
- Process: HEAD-probes `job.pipeline_roles` URLs. Closes only on 404/410/451 → sets `status='Closed'`, `archived_at`, `is_live=false`.
- Frontend also runs this on 1h debounce when the Saved tab opens (optimistic liveness check from the user's perspective).

**Auth note:** `check-liveness` verifies JWT, so the cron task must include both an anon Bearer token (satisfying the Supabase gateway) and `x-cron-secret` (the function checks this to bypass per-user auth).

### Data schema

**recommended_roles columns:**
- `closed_at` — null while active; timestamp when closed
- `closure_reason` — one of: `'delisted'` (Layer 1, ID no longer on ATS board), `'ats-delisted'` (Layer 2, failed open-id check), `'url-dead'` (Layer 3, HTTP 404/410/451), `'stale'` (Layer 3, age-out after 45 days)
- `last_seen_at` — timestamp of last confirmation by any liveness layer
- `suggested_at` — timestamp of initial recommendation
- `dismissed_at` — user-dismissal timestamp (independent of liveness)
- `added_to_pipeline_slug` — if user saved this rec to their pipeline

**pipeline_roles columns:**
- `liveness_checked_at` — timestamp of last `check-liveness` probe
- `is_live` — boolean; false if closed
- `liveness_status_code` — last HTTP status from probe (200, 404, 410, 451, etc.)
- `closed_detected_at` — timestamp when closure detected
- `status` — user-facing status: `'New'`, `'Apply'`, `'Talking'`, `'Applied'`, `'Pass'`, `'Rejected'`, `'Closed'`, `'Not Listed'`
- `archived_at` — when marked Closed

### Design notes

- **Non-interchangeable layers:** `check-liveness` (Saved) and `enrich-job-source action=liveness` (For You) are separate functions serving distinct tables. They are not interchangeable.
- **Closure is idempotent:** re-probing a closed rec and re-closing it writes the same `closure_reason` and timestamp (no double-entry).
- **History preservation:** closed recs stay in the DB indefinitely. The UI hides them (For You) or marks them Closed (Saved), but analysis queries can still reference them.
- **Cron auth pattern:** functions with verify_jwt=true need cron tasks to send both anon Bearer (for the gateway) and x-cron-secret (to bypass JWT check). This is documented in migration 087.

---

## Data sources (v1)

| What | Where | Read by | Write by |
|---|---|---|---|
| Companies (KB) | `fikei/job/01-job-history/companies/*.md` | `kb-read` | `kb-write` |
| Projects (KB) | `fikei/job/01-job-history/projects/*.md` | `kb-read` | `kb-write` |
| Skills (KB) | `fikei/job/01-job-history/skills/*.md` | `kb-read` | `kb-write` |
| Wins (KB) | `fikei/job/01-job-history/wins/*.md` | `kb-read` | `kb-write` |
| Vision | `fikei/job/02-goals-intents/*.md` | `kb-read` | `kb-write` |
| RELEVANCE (skill) | `~/.claude/skills/jobs/RELEVANCE.md` | local file (skill side) | manual sync |
| Companies (pipeline) | Google Sheet, Companies tab | `jobs-pipe` | (read-only in v1; user edits sheet directly) |
| Roles (pipeline) | Google Sheet, Roles tab | `jobs-pipe` | `jobs-pipe POST` (Status only) |

**Vision ↔ RELEVANCE.md sync (v1):** out of band. When Ian edits Vision in the product, he separately edits `~/.claude/skills/jobs/RELEVANCE.md` to match. v2 unifies these.

---

## Data sources (v2 — Supabase-backed)

Migrate to Postgres tables in the Boards project (or a new `career` project):

```sql
-- Career KB
create table companies (
  slug text primary key,
  name text not null,
  sector text,
  stage_at_time text,
  tenure_start date,
  tenure_end date,         -- null = "Present"
  location text,
  body_md text,            -- the long-form narrative
  updated_at timestamptz default now()
);

create table projects (
  slug text primary key,
  company_slug text references companies(slug),
  title text not null,
  start_date date,
  end_date date,
  role text,
  team_size text,
  status text,
  body_md text,
  updated_at timestamptz default now()
);

create table skills (
  slug text primary key,
  name text not null,
  type text,               -- 'craft' | 'strategic' | 'technical' | 'leadership'
  level text,              -- 'foundational' | 'working' | 'expert' | 'world-class'
  years_practiced int,
  body_md text,
  updated_at timestamptz default now()
);

create table wins (
  slug text primary key,
  company_slug text references companies(slug),
  project_slug text references projects(slug),
  headline text not null,
  body_md text,
  metric_value text,       -- '+12%' / '10x' / '$X' for quick display
  updated_at timestamptz default now()
);

create table project_skills (
  project_slug text references projects(slug),
  skill_slug text references skills(slug),
  primary key (project_slug, skill_slug)
);

-- Vision (single-row table for v2; multi-vision in v3)
create table vision (
  id int primary key default 1 check (id = 1),
  narrative_arc text,
  target_titles text[],
  target_stages text[],
  target_sectors text[],
  target_geographies text[],
  comp_floor_base int,
  comp_floor_total int,
  deal_breakers text[],
  raw_md text,             -- full markdown for round-trip with skill RELEVANCE.md
  updated_at timestamptz default now()
);

-- Pipeline
create table tracked_companies (
  slug text primary key,
  name text not null,
  sector text,
  presence text,
  website_url text,
  careers_url text,
  ats text,                -- 'Greenhouse' | 'Ashby' | 'Lever' | 'Workday' | 'Other'
  ats_slug text,           -- the company-specific slug
  notes text,
  updated_at timestamptz default now()
);

create table pipeline_roles (
  id uuid primary key default gen_random_uuid(),
  company_slug text references tracked_companies(slug),
  title text not null,
  url text not null unique,
  source text not null,    -- 'LinkedIn Saved' | 'LinkedIn Recommended' | 'From Company Pages' | 'Network' | 'Manual'
  status text not null default 'New', -- 'New' | 'Apply' | 'Talking' | 'Applied' | 'Pass' | 'Rejected' | 'Closed' | 'Not Listed'
  salary_range text,
  sector text,             -- redundant with company.sector but allows per-role override
  fit_score int,           -- cached, recomputed by trigger or job
  fit_breakdown jsonb,
  hard_fails text[],
  first_seen date default current_date,
  last_seen date,
  miss_count int default 0,
  notes_md text,           -- per-role prep notes (used to be in fikei/job/03-jobs/)
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);
```

**Migration path:** a one-time import Edge Function reads the Google Sheet + the markdown KB files, populates the tables, then flips the front-end to read from Postgres. The sheet becomes a download/export, not a source of truth.

**Fit-score recompute:** trigger on `vision` update → recompute `fit_score` for all `pipeline_roles`. Trigger on `pipeline_roles` insert → compute fit on insert.

**RELEVANCE.md sync:** an Edge Function (`vision-sync`) writes the `vision.raw_md` field out to `~/.claude/skills/jobs/RELEVANCE.md` via the GitHub API on every vision update. (Or restructure RELEVANCE to read from a small endpoint.)

---

## Theme system

```
/ladder/css/
├── base.css              # layout, reset, primitives that don't depend on theme
├── components.css        # uses var(--*) custom properties
├── tokens-wise-light.css # Wise design tokens, light variant
├── tokens-wise-dark.css  # Wise design tokens, dark variant
├── tokens-ctrl-light.css # CTRL design tokens, light (sourced from existing design-system/)
└── tokens-ctrl-dark.css  # CTRL design tokens, dark
```

**Switch mechanism:**

```html
<html data-theme="wise-dark">
```

```css
/* base.css */
@import "components.css";

[data-theme="wise-light"] { @import "tokens-wise-light.css"; }
[data-theme="wise-dark"]  { @import "tokens-wise-dark.css"; }
[data-theme="ctrl-light"] { @import "tokens-ctrl-light.css"; }
[data-theme="ctrl-dark"]  { @import "tokens-ctrl-dark.css"; }
```

JS in nav:

```js
const themeToggle = document.querySelector('#theme-toggle');
themeToggle.addEventListener('change', e => {
  document.documentElement.dataset.theme = e.target.value;
  localStorage.setItem('job:theme', e.target.value);
});

document.documentElement.dataset.theme =
  localStorage.getItem('job:theme') ||
  (matchMedia('(prefers-color-scheme: dark)').matches ? 'wise-dark' : 'wise-light');
```

**Token contract** — both Wise and CTRL token files MUST expose at least these custom properties (full list in a separate `theme-contract.md`):

```
--bg, --bg-surface, --bg-elevated
--fg, --fg-muted, --fg-subtle
--accent, --accent-fg, --accent-muted
--border, --border-strong
--success, --error, --warning
--font-body, --font-display, --font-mono
--radius-sm, --radius-md, --radius-lg
--shadow-sm, --shadow-md, --shadow-lg
--space-1 through --space-8
```

Components written against this contract render correctly in either theme.

---

## Auth

```html
<script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"></script>
<script src="/auth/ctrl-auth.js"></script>
<script>
  CtrlAuth.init({
    supabaseUrl: 'https://yfhudwakpgzswiylhfbh.supabase.co',
    supabaseAnonKey: '...',
    redirectTo: window.location.origin + '/ladder/',
    adminEmails: ['fike101@gmail.com']  // single-user allowlist for v1+v2
  });

  document.addEventListener('ctrl:auth:signedin', async (e) => {
    if (e.detail.email !== 'fike101@gmail.com') {
      // gracefully kick the unrelated user
      window.location.href = '/ladder/not-authorized.html';
      return;
    }
    // load the page data
    initJobApp();
  });
</script>
```

---

## Edge Function security

| Function | Auth check | Validation |
|---|---|---|
| `kb-read` | Verify Supabase JWT, check email is in allowlist | Path must match `^[a-z0-9-_/]+\.md$`; reject `..` |
| `kb-write` | Same | Same path validation; size cap 64KB; require `baseSha` |
| `jobs-pipe GET` | Same | None |
| `jobs-pipe POST` | Same | `row` must be int 2–500; `status` must be in enum |

**Secrets storage:** Supabase Edge Function secrets (`supabase secrets set GITHUB_PAT=...`).

**Service account key:** stored as `SHEETS_SERVICE_ACCOUNT_JSON` (the same key already used by the local Sheets MCP).

---

## Build + deployment

**Frontend:**
- Lives in `job/` at the repo root, alongside `boards/`, `soundscape/`.
- Jekyll picks it up at build. New routes added to the site automatically.
- Push to `main` → GitHub Pages deploys in ~30s.

**Edge Functions:**
- Live in `supabase/functions/kb-read/`, `kb-write/`, `jobs-pipe/`.
- Deploy: `supabase functions deploy kb-read --project-ref yfhudwakpgzswiylhfbh` (etc.).
- Per repo CLAUDE.md: include `const VERSION = 'X.Y.Z'` + `console.log` at entry, bump on changes.

---

## Open technical questions

1. **GitHub raw-content latency on deep drilldowns.** A user clicking from Jobs → Role → Linked Project → Linked Skill triggers 3+ `kb-read` calls in sequence. Cache TTL of 60s helps, but consider prefetching adjacent files when a parent is loaded.

2. **Sheet write latency.** Status updates from the pipeline view round-trip ~1.5s through the Sheets API. Consider optimistic UI (update locally, reconcile on response).

3. **Markdown rendering.** Use `marked` or `markdown-it` client-side for rendering. Sanitize with `DOMPurify` before injection. Both libraries are small and CDN-deliverable.

4. **Wiki-link resolution.** The KB uses Obsidian-style `[[slug]]` links. The renderer must resolve these to in-app routes (`/ladder/history/companies/livongo-teladoc/`). Implement as a marked extension or post-process.

5. **Phase 2 cutover.** When migrating to Supabase, do we keep the markdown files in `fikei/job` as a backup/export? Recommendation: yes, with an Edge Function that writes the markdown back to GitHub on every Postgres mutation. The repo becomes the durable export; Postgres is the live source.

---

## Estimated build effort

| Phase | Frontend | Backend (Edge Funcs) | Design / theme | Auth + secrets | Total |
|---|---|---|---|---|---|
| Phase 1 (sheet-driven) | ~5d | ~3d | ~2d | ~0.5d | **~10–12d** |
| Phase 2 (Supabase-backed) | ~3d | ~5d | ~1d | ~0.5d | **~9–11d** |

Effort assumes solo + AI-assisted; adjust accordingly.

---

## Decision log

| Date | Decision | Rationale |
|---|---|---|
| 2026-05-08 | Default theme = Wise; CTRL as alternate. | Wise is more product-feeling for a job-search tool; CTRL is the house style and worth previewing. |
| 2026-05-08 | Edge Functions live on the existing Boards Supabase project for v1+v2. | Reuse auth + simpler ops. Promote to dedicated project only if scaling needs warrant. |
| 2026-05-08 | Phase 1 Jobs reads directly from Google Sheet. | Fastest path to value; no migration cost; the sheet is already authoritative. |
| 2026-05-08 | Editing model = markdown textarea, not structured form. | Preserves voice; lower build cost; aligns with how Ian already writes. |
| 2026-05-08 | Service account = reuse `claude-sheets@claude-jobs-494219` JSON. | Already shared with the Job Search sheet; no new GCP setup. Stored as Edge Function secret `SHEETS_SERVICE_ACCOUNT_JSON`. |
| 2026-05-08 | GitHub auth for `kb-write` = PAT scoped to `fikei/job` only. | Simplest path for a single-user product. GitHub App overkill at this scope. Stored as `GITHUB_PAT`. |
| 2026-05-08 | Fit-score weights = fixed in v1; tuning surface deferred to v2. | Ship a sane default + iterate from real use rather than over-design upfront. |
