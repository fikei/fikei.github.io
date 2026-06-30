# Brief: Productizing "Who do I know here?" (LinkedIn connection mining)

**Status:** Pilot shipped (manual mining, 6 companies) · **Owner:** Ian · **Date:** 2026-06-30

## 1. What shipped (the pilot)

For every saved lead in `/ladder`, the app now shows Ian's 1st-degree LinkedIn
connections who **currently work at that company**, so a warm intro or referral
is one click away.

- **Detail page** (`/ladder/jobs/{slug}/`) — a "People you may know here" card:
  avatar, name, current title, link to their LinkedIn profile.
- **Leads table** (`?bucket=leads`) — a "Network" column with an
  overlapping-avatar stack per row.
- **Data** — `job.company_connections` (migration 085), keyed on
  `company_slug`; joined into every role at that company by `jobs-pipe`
  (`r.connections`).

The pilot was mined **by hand** for 6 companies: Anthropic (3), Abridge (1),
Mercury (1), OpenAI (1); Plaid and Code for America returned no current
1st-degree connections. Result: 6 connections, all with photos.

## 2. How the pilot was actually done (and why it's not yet a product)

The mining loop, end to end:

1. Open LinkedIn people search filtered to 1st-degree connections
   (`network=["F"]`) with the company name as the keyword.
2. Scroll to force-render lazy cards, then parse each result card out of
   LinkedIn's (obfuscated, frequently-changing) DOM: name, headline,
   `Current:` line, profile URL, photo URL.
3. Filter to **current** employees — keep rows whose `Current:`/headline reads
   `at <Company>` / `@<Company>`; drop investors/advisors/founders/portfolio
   and client-list false positives ("our portfolio includes…", "backed by…").
4. Write rows into Postgres.

Friction encountered (all of which a real product must absorb):

- **DOM fragility.** LinkedIn ships hashed class names and lazy-virtualized
  cards; selectors broke repeatedly and mutual-connection face-piles polluted
  results. Parsing is brittle and will rot.
- **Transport.** The browser automation couldn't return photo URLs (token
  query strings get filtered) and **couldn't POST to Supabase from
  linkedin.com** (CSP `connect-src`). `window.name` is cleared on cross-origin
  nav; the SPA strips URL hashes. The working channel was a throwaway
  edge function reachable by a **top-level GET navigation** with the payload in
  the query string.
- **Precision.** Keyword search conflates current + past + investor + client
  mentions. Even with filters, ~30% of raw hits were false positives needing a
  manual prune.
- **Coverage.** Only page 1 (~10 results) per company was mined; no pagination.
- **Photo durability.** Stored URLs are `media.licdn.com` CDN links with signed
  expiry (`?e=…`); they will 404 in weeks.

## 3. Target product

> When a lead enters the pipeline, automatically attach the people Ian knows
> there, refreshed on a schedule, with durable photos — no manual step.

### Recommended architecture

1. **Ingestion — own LinkedIn data the supported way.**
   - **Best:** ask the user to upload their **LinkedIn data export**
     (Settings → Get a copy of your data → *Connections*, a CSV of
     name/headline/company/profile URL). One upload, no scraping, ToS-clean.
     Re-prompt quarterly. Covers the whole network, not page 1.
   - **Alternative:** a **browser extension / userscript** the user runs on
     their own session that reads the company People view and posts to an
     authenticated ingest endpoint. Higher coverage, but maintenance-heavy and
     ToS-grey.
   - **Avoid:** server-side scraping / unofficial APIs — brittle and against
     LinkedIn ToS.

2. **Company matching.** Connections' employer strings → canonical company.
   Reuse the existing `job.hiring_companies` / `tracked_companies` normalizer so
   a connection at "Anthropic PBC" matches the `anthropic` lead. Match on
   normalized name + domain, not substring (kills the "Plaid"/"Mercury"
   false-positive class).

3. **Current-employer filter.** From the export, current company is a structured
   field — no `Current:`-line heuristics, no investor/portfolio leakage.

4. **Photo durability.** On ingest, fetch each profile photo once and cache it
   in **Supabase Storage**; store the stable public URL. Refresh lazily on 404.
   (Pilot hotlinks licdn and will decay.)

5. **Refresh cadence.** A `pg_cron` job (mirror the existing enrich-backfill
   pattern, migration 084) re-attaches connections when new leads land and
   re-validates employer/photo monthly.

6. **Surface (already built).** `company_connections` + the `jobs-pipe` join +
   the two UI affordances stay as-is. Add: a one-click **"Draft intro request"**
   that pipes the connection + role into the existing outreach/cover-letter
   generator — that's the actual payoff (warm intro > cold application).

### Multi-user note

`/ladder` is multi-user. `company_connections` is currently global (single
tenant). Productizing requires a `user_id` column + RLS scoping so each user
sees only their own network. Fold this in with the ingestion endpoint.

## 4. Effort / sequencing

| Phase | Scope | Rough size |
|------|-------|-----------|
| 1 | CSV-export upload + parser + company-match + `user_id`/RLS | M |
| 2 | Photo caching to Storage + 404 refresh | S |
| 3 | `pg_cron` re-attach + monthly revalidation | S |
| 4 | "Draft intro request" action wired to outreach generator | M |

## 5. Cleanup owed from the pilot

- **Delete the throwaway `connections-ingest` edge function** (CORS-open,
  shared-secret, GET-ingest) — it exists only to bootstrap the pilot and should
  not live in production. *(Removed at end of pilot session.)*
- Pilot rows in `company_connections` are real and can stay; they'll be
  superseded by the export-driven set.
