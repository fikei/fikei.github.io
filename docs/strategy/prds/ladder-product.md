# PRD: /ladder — Career Knowledge Base + Pipeline Web Product

**Version:** 1.0
**Date:** 2026-05-08
**Status:** Draft
**Owner:** Ian
**Tech design:** [`docs/infrastructure/technical-design/ladder-product.md`](../../infrastructure/technical-design/ladder-product.md)

---

## Overview

Ian's job search produces three concentric layers of artifact: **work history** (the truth of what he's done), **goals + intents** (what he wants next), and **active pipeline** (which roles are live). Today these live in three disconnected places: a private GitHub repo (`fikei/job` — markdown KB), a Google Sheet (Companies + Roles tabs), and a `/jobs` skill that scans careers pages on a schedule.

`/ladder` is the web product that pulls all three into one navigable surface at `ctrl.rodeo/ladder/`. It's a personal tool first — Ian as the only user — but it's built using the same ctrl.rodeo stack as Boards, Soundscape, and Systemic so it inherits auth, design tokens, and deployment patterns.

The product replaces three spreadsheet/file workflows with one product Ian can use end-to-end during a job search: read his story, refine his goals, prioritize the pipeline, draft assets.

---

## Goals

1. **Surface the career knowledge base** as a navigable resume (Job → Projects → Skills) instead of a folder of markdown files.
2. **Make Goals & Intents living state** — visible, editable, source-of-truth for the `/jobs` skill's relevance filter.
3. **Show the active pipeline with a relative fit score** so Ian can prioritize next-action without re-reading every row.
4. **Keep all knowledge editable in-place** so the markdown source files in `fikei/job` and the spreadsheet stay in sync with what's shown.
5. **Inherit ctrl.rodeo design + auth** so it feels native to the rest of the site and doesn't require duplicate infrastructure.
6. **Theme-swappable** between Wise and CTRL design systems via a single config flag, so Ian can preview the product in either visual language.

---

## Non-goals

- **Not a public-facing portfolio.** `/ladder` is auth-gated. The portfolio lives at `ctrl.rodeo/` root.
- **Not a job board.** It's a pipeline manager, not a discovery surface. Discovery happens via the `/jobs` skill (LinkedIn + ATS scrapes) and feeds in.
- **Not a multi-user product** for v1 or v2. Single-user (Ian). Could become multi-user later but auth + sharing are out of scope here.
- **Not a resume builder/PDF exporter** for v1. Drafting cover letters and resumes is a separate flow that consumes from this KB, not produces from it.

---

## Who this serves

| Persona | Why |
|---|---|
| **Ian during an active search** | Daily-driver tool. Open in the morning, see new pipeline + fit scores, drill into a role, pull supporting wins/projects to draft a cover letter. |
| **Ian between searches** | Lower-frequency. Capture wins as they happen so the KB stays current. Tweak Goals & Intents as priorities shift. |
| **Future iteration: collaborators** | If Ian opens this up to a small group (e.g. peer review of cover letters or fit-scoring), it inherits ctrl.rodeo auth so adding a collaborator is just sharing a link. |

---

## Three features

### 1. Job History

A LinkedIn-style resume view that drills three levels deep.

**Top level — Resume:**
- Header (name, title, location, contact)
- Career timeline (companies + role + dates), most recent on top
- Skills cluster (chips of top 6–8 skills)
- Awards + education

**Tap a company → Company detail:**
- Full company file (sector, stage at the time, tenure, why joined / why left, connections)
- Tabs or stacked sections: **Roles held**, **Projects**, **Wins**

**Tap a project → Project detail:**
- Full project narrative (problem / constraint / what I did / decisions / outcome / lessons / why-it-matters)
- Linked skills (which crafts this project demonstrates)
- Linked wins (quantifiable outcomes)

**Tap a skill → Skill detail:**
- Skill narrative
- Evidence (project + win backlinks)
- "How I talk about this" snippet (for cover letters)

**Editable views:** every detail page has an "Edit" affordance that opens a markdown editor against the source file in `fikei/job`. Save → commits to the repo via GitHub API. (See tech design for security model.)

**Source of truth:** the markdown files in `fikei/job`. The product reads them at build time + via Edge Function for live edits.

### 2. Job Vision

The "what I want next" surface, drawn from `fikei/job/02-goals-intents/`.

**Sections:**
- **Narrative arc** — the one-paragraph story Ian tells. Resume summary, LinkedIn About, intro DM source.
- **Stage + sector targets** — pre-seed → Series C, healthtech / edtech focus, etc.
- **Role titles** — what's primary, what's adjacent, what's not pursued.
- **Compensation** — base floor, equity expectations, fractional structure.
- **Geography** — SF / NYC / Remote US.
- **Deal-breakers** — hard filters.
- **Voice + cover letter rules** — referenced when drafting.

**Editable:** same model as Job History. Every section has an Edit button → opens the source markdown file → save commits to repo.

**Why this matters operationally:** the `/jobs` skill reads `RELEVANCE.md` for filtering. Updating Job Vision should propagate to the skill's RELEVANCE.md (either the file IS RELEVANCE.md, or the product writes both). See tech design for the sync approach.

### 3. Jobs

The active pipeline, driven by the existing **Job Search** Google Sheet for the MVP.

**View: pipeline table**
Columns:
- **Status** (New / Apply / Talking / Applied / Pass / Rejected / Closed / Not Listed)
- **Fit score** (0–100, computed; see below)
- **Company** (link → opens company tracking detail)
- **Role title** (link → opens role detail with full JD if scraped)
- **Source** (LinkedIn Saved / LinkedIn Recommended / From Company Pages / Network / Manual)
- **Salary** (when known)
- **Sector**
- **Last seen** (from sheet col M)
- **Posting URL** (external link icon)

**Sort:** default by Fit Score desc, then by Last Seen desc.

**Filter:** by Status (multi-select), Source (multi-select), Sector (free text), Fit Score range (slider).

**Quick actions per row:**
- Mark Applied / Pass / Rejected → updates sheet
- Open posting → external link
- Promote to "prep mode" → opens per-role prep page (links to `03-jobs/{slug}.md` in the KB)

**Per-role detail:**
- Full JD (cached from the original posting if available)
- Computed fit-score breakdown: which factors helped, which hurt
- Linked KB sections (which projects, skills, wins map to this role)
- Cover letter drafting handoff (links to existing cover letter or "Start new")

#### Fit Score (the core innovation of this view)

A 0–100 score showing how well a role matches Ian's Goals & Intents. Recomputed when:
- A new role is added
- Job Vision is edited
- Status changes

**Inputs:**
- Title match — "Founding PM" / "Product Lead" / "Senior PM" → strong; "Director of Product" → moderate; "Group PM" → weaker; below seniority floor → 0.
- Stage match — pre-seed/seed/A/B/C → +; D+ → -; public → drop.
- Sector match — Health/Health AI / EdTech → +; AI-native / SaaS / Fintech → +; ad-tech / crypto → drop.
- Geography match — SF / Remote US / NYC → +; hybrid elsewhere → drop.
- Compensation match — meets floor → +; below → -; missing → neutral.
- Source weighting — Network > LinkedIn Saved > LinkedIn Recommended > From Company Pages > Manual.
- Connection signal — investors/contacts the user knows (KPCB, a16z, etc. in the VCs tab).

**Formula:** weighted sum normalized to 0–100. Hard filters (geo fail, below seniority floor) cap the score at 30 regardless of other factors so the user can still see the role but it stays out of the top quintile.

**Algorithm lives server-side** (Edge Function) so it's deterministic and computed once per role+vision pairing rather than re-run by every client.

---

## User flows

### Daily flow during active search

1. Open `ctrl.rodeo/ladder/`.
2. Land on Jobs view, sorted by Fit Score desc.
3. New roles since last visit show a "New" badge.
4. Drill into the highest-fit new role → see fit breakdown + linked KB sections.
5. Click "Draft cover letter" → handoff to the existing `/ladder-assets` skill which pulls voice rules + relevant projects from the KB.

### Refining Job Vision

1. Open Job Vision tab.
2. Edit `narrative-arc.md` — adjust the one-paragraph version.
3. Save → commit to `fikei/job` repo.
4. (Phase 2) Trigger fit-score recompute across the pipeline.

### Capturing a new win

1. Open Job History → Companies → current/most-recent company.
2. Click "Add Win" → opens a new markdown file in the appropriate `wins/` folder.
3. Fill in the template (headline / story / interview version / what made it possible).
4. Save → commit. Win immediately appears in linked project + skill detail pages.

---

## Phasing

### Phase 1 — MVP (Sheet-driven Jobs)

**Scope:**
- Job History — full read view, basic edit (textarea → save → GitHub API commit). Drilldown navigation.
- Job Vision — full read view, basic edit.
- Jobs — pipeline table reading directly from the Google Sheet via Edge Function. Fit Score computed in Edge Function. Status changes write back to the sheet.

**Out of scope:**
- Real-time sync (sheet edits show after page refresh, not live)
- Per-role prep notes UI (use `fikei/job/03-jobs/` markdown files for now)
- Fit Score breakdown UI (just show the score; explain it later)
- Mobile-optimized layout (desktop-first; mobile responsive but not redesigned)

**Time estimate:** ~2 weeks of focused build time (frontend + edge functions + service-account wiring).

**Success criteria:**
- Ian uses `/ladder` instead of opening the sheet for daily pipeline review.
- One full cover letter drafted using the KB drilldown as context.
- Fit Score correlates with Ian's gut: top-5 by fit should be the same top-5 he'd pick by hand.

### Phase 2 — Supabase-backed

**Scope:**
- Migrate Job History from markdown → Postgres tables. Markdown files stay in repo for portability + grep, but Supabase is the live data store.
- Migrate Goals & Intents → Postgres `vision` table.
- Migrate Jobs → Postgres `roles_pipeline` table.
- Real-time fit-score recompute via Edge Function triggered on RELEVANCE changes.
- Per-role prep notes UI stored in Postgres (`role_notes` table).
- The Google Sheet becomes a one-way export target, not source of truth (export on demand for backups + sharing).
- Better mobile layout.
- (Stretch) Multi-vision support — save multiple "Vision configurations" and switch the active one to see how the pipeline reranks.

**Time estimate:** ~3 weeks after Phase 1 lands.

**Success criteria:**
- The `/jobs` skill reads `RELEVANCE.md` from Supabase, not the local file.
- Job Vision changes propagate to fit scores within seconds.
- Sheet is read-only / archive — all live changes happen through the product.

### Phase 3 (out of scope for this PRD, kept for context)

- Multi-user collaboration — share a vision with a peer for feedback, share a role for "should I apply?" advice.
- Public-facing portfolio mode — render the Job History as a hireable-looking resume page that can be shared via link.
- AI-assisted edit suggestions — "your narrative arc is 70% similar to Q3's; here's what changed."

---

## Design

### Design system

**Default:** [Wise design system](https://transferwise.github.io/neptune-css/) — open-source, has light + dark token sets, well-documented.

**Swappable:** the existing CTRL design system at `design-system/` (already built for ctrl.rodeo's other apps). A single config flag at the app entry switches all token resolution to CTRL.

**Mechanism:** all components consume CSS custom properties (`var(--color-bg)`, `var(--font-body)`, etc.). Wise tokens and CTRL tokens both expose the same property names but with different values. Switching is `<html data-theme="wise-light">` → `<html data-theme="ctrl">`.

**Why both:** Wise is mature and product-feeling; CTRL is the existing house style. Building against tokens (not Wise components directly) means we can swap or A/B without rewrites.

### Light / dark

Both Wise and CTRL provide light + dark variants. User toggle in nav; remembered per device. Default follows OS preference.

### Layout

Three-pane on desktop:
- **Left rail:** persistent nav (History / Vision / Jobs) + theme toggle + sign-out.
- **Center:** primary view content.
- **Right rail (optional, contextual):** related links, e.g. when viewing a project show backlinks to skills/wins; when viewing a role show fit-score breakdown.

Single-column on mobile with bottom-nav.

---

## Auth

**Standard ctrl.rodeo auth** via `auth/ctrl-auth.js`. Email magic link primary; Google OAuth supported. Session persists across the site so signing in once at `ctrl.rodeo/boards/` carries to `ctrl.rodeo/ladder/`.

**Authorization:** single allowlisted user (Ian's email) for v1 + v2. Anyone else hitting the page sees a "this is Ian's tool" message and a link back to `ctrl.rodeo/`.

---

## Decisions locked in (2026-05-08)

These were the open questions in v1.0 — resolved before build kickoff so the next session can focus on implementation.

1. **Editing UX:** **Markdown textarea** for v1+v2. Preserves voice quirks. Re-evaluate structured forms only if mobile editing becomes a real need.
2. **Supabase project home:** **Boards (`yfhudwakpgzswiylhfbh`)**. Reuses auth wiring. Promote to a dedicated project only if scale demands it.
3. **Service account for Sheets:** **Reuse the existing `claude-sheets@claude-jobs-494219` JSON** that's already shared with the Job Search sheet. Stored as Edge Function secret `SHEETS_SERVICE_ACCOUNT_JSON`. No new GCP setup needed.
4. **GitHub commit on edit:** **Personal Access Token** scoped read+write on `fikei/job` only. Stored as Edge Function secret `GITHUB_PAT`.
5. **Fit-score weights:** **Fixed in v1.** Tunable knobs in Job Vision deferred to v2.

---

## Success metrics

| Metric | Phase 1 target | Phase 2 target |
|---|---|---|
| Daily-active usage during active search | 1 session/day | 2+ sessions/day |
| Time to drill from pipeline → KB content backing a role | < 30s | < 10s |
| Fit-score top-5 match Ian's intuition (manual gut-rank) | 4 of 5 overlap | 5 of 5 overlap |
| Cover letters drafted with KB as primary context source | 1+ per week during search | 3+ per week |
| Markdown source files edited via the product (vs. IDE) | 50% | 80% |

---

## Dependencies

- **Existing:** ctrl.rodeo Jekyll site, ctrl-auth.js, Supabase (Boards project), `fikei/job` repo, `/jobs` skill + RELEVANCE.md, Job Search Google Sheet.
- **New:** Wise design system tokens + components (npm install), service-account JSON for Sheets API in Edge Function secrets, GitHub PAT in Edge Function secrets.

See [tech design](../../infrastructure/technical-design/ladder-product.md) for implementation specifics.
