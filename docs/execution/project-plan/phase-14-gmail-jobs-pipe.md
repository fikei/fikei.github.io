# Phase 14: Gmail → Jobs Pipe (Phase 1 — Recommendations Only)

> Back to [Project Plan](./index.md)
>
> **Reference**: [PRD: Job Product](/docs/strategy/prds/ladder-product.md)
>
> **Vision**: Scan Gmail for recruiter outreach and surface scored, deduplicated, canonically-linked role recommendations inside the existing Jobs recommendations widget — with zero manual input from Ian. Phase 1 is strictly the recommendations pipe: Gmail OAuth, token storage, job-source enrichment, Gmail scanning, and source plugin wiring. Contacts, connections, network overlay, and LinkedIn CSV import are deferred to Phase 2.

---

## Goal

A Gmail-connected user sees scored, deduplicated, canonically-linked Gmail-sourced roles in the existing recommendations widget — automatically, without touching a spreadsheet.

## Success Criteria

- [ ] Ian can complete the Gmail OAuth flow and revoke access from the product UI
- [ ] `user_google_tokens` table stores tokens keyed by `(user_id, scope_set)` with refresh-token rotation working end-to-end
- [ ] Gmail scan runs on cron and surfaces new recruiter-inbound roles in the recommendations widget within one cron cycle
- [ ] Recruiter-blast emails (mass outreach to >N recipients) are skipped and logged to `gmail_skipped`, not surfaced as recommendations
- [ ] Roles from major aggregator domains (Greenhouse, Lever, Ashby, Workday, etc.) resolve to a canonical careers-page URL
- [ ] Deduplication prevents the same role appearing twice when contacted via multiple threads
- [ ] Fixture-based test path exercises the full scan → enrich → score → widget pipeline without hitting live Gmail

---

## Out of Scope — Phase 2 (Deferred)

The following are explicitly excluded from Phase 1. Do not add them here.

- **Contacts graph** — importing or maintaining a contact list from Gmail/LinkedIn
- **Connections enrichment** — mapping contacts to companies or investors
- **LinkedIn CSV upload** — network import flow
- **Network overlay** — showing connection signals on pipeline roles
- **Paid enrichment APIs** — Hunter.io, Clearbit, or similar for contact resolution

---

## Epic 1: Shared Gmail / Google Infrastructure

> **Goal**: Stand up the OAuth split architecture (Option B) — a dedicated `gmail-auth` edge function with a shared `_shared/google-tokens.ts` helper consumed by both `calendar-api` and `gmail-auth`. Tokens are stored in `user_google_tokens`, keyed by `(user_id, scope_set)`.

### Story 1.1 — Token Table Migration

| Task | Status |
|------|--------|
| Write migration `021_user_google_tokens.sql`: table `user_google_tokens (id, user_id, scope_set, access_token, refresh_token, expires_at, created_at, updated_at)` | Pending |
| Add unique constraint on `(user_id, scope_set)` | Pending |
| Add RLS policy: users can only read/write their own rows | Pending |
| Add index on `(user_id, scope_set)` for fast token lookup | Pending |
| Document migration in `docs/infrastructure/deployment.md` under Boards migrations | Pending |

### Story 1.2 — `_shared/google-tokens.ts` Helper

| Task | Status |
|------|--------|
| Create `supabase/functions/_shared/google-tokens.ts` | Pending |
| Implement `getToken(userId, scopeSet)` — reads from `user_google_tokens`, refreshes via Google token endpoint if `expires_at` is within 5 minutes, writes back updated tokens | Pending |
| Implement `storeToken(userId, scopeSet, tokenResponse)` — upsert on `(user_id, scope_set)` | Pending |
| Implement `revokeToken(userId, scopeSet)` — calls Google revoke endpoint + deletes row | Pending |
| Export typed `ScopeSet` union (`'calendar' | 'gmail'`) so call sites are compile-checked | Pending |
| Unit-test with Deno test fixtures: fresh token, expired token (triggers refresh), revoked token | Pending |

### Story 1.3 — `_shared/gmail.ts` Client

| Task | Status |
|------|--------|
| Create `supabase/functions/_shared/gmail.ts` | Pending |
| Implement `listMessages(accessToken, query, maxResults)` — wraps Gmail `users.messages.list` API | Pending |
| Implement `getMessage(accessToken, messageId)` — wraps `users.messages.get` with `format=full` | Pending |
| Implement `getThread(accessToken, threadId)` — wraps `users.threads.get` | Pending |
| Add typed interfaces: `GmailMessage`, `GmailThread`, `GmailHeader` | Pending |
| Handle 401 responses by surfacing a typed `TokenExpiredError` so callers know to refresh | Pending |

### Story 1.4 — `gmail-auth` Edge Function

| Task | Status |
|------|--------|
| Create `supabase/functions/gmail-auth/index.ts` with `const VERSION = '1.0.0'` | Pending |
| Implement `GET /gmail-auth/connect` — redirects to Google OAuth consent screen with `gmail.readonly` scope, `access_type=offline`, `prompt=consent` | Pending |
| Implement `GET /gmail-auth/callback` — exchanges code for tokens, calls `storeToken(userId, 'gmail', ...)`, redirects to product UI with success param | Pending |
| Implement `POST /gmail-auth/revoke` — calls `revokeToken(userId, 'gmail')`, returns 200 | Pending |
| Implement `GET /gmail-auth/status` — returns `{ connected: boolean, scopeSet: 'gmail' }` for the authenticated user | Pending |
| Wire `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` from Supabase Edge Function secrets (document in `deployment.md`) | Pending |
| Update `calendar-api` to import `getToken` from `_shared/google-tokens.ts` instead of its own token logic | Pending |

---

## Epic 2: Job-Source Enrichment

> **Goal**: Given a company name or careers-page URL extracted from Gmail, resolve it to a canonical `job.companies` entry with a verified careers-page URL. Enrichment uses a cascade: cache → tracked-ATS domain patterns → careers-page scrape → unresolved bucket with retry timestamp.

### Story 2.1 — `job.companies` Cache Migration

| Task | Status |
|------|--------|
| Write migration `022_job_companies.sql`: table `job_companies (id, name_canonical, careers_url, ats_domain, ats_type, resolved_at, retry_after, created_at, updated_at)` | Pending |
| Add unique index on `name_canonical` (lowercased, trimmed) | Pending |
| Add index on `ats_domain` for ATS-pattern lookups | Pending |
| Add `retry_after TIMESTAMPTZ` column — NULL means resolved; non-NULL means unresolved, retry after that timestamp | Pending |
| RLS: service-role only (no user-facing reads needed in Phase 1) | Pending |

### Story 2.2 — `enrich-job-source` Edge Function

| Task | Status |
|------|--------|
| Create `supabase/functions/enrich-job-source/index.ts` with `const VERSION = '1.0.0'` | Pending |
| Implement cascade Step 1 — cache lookup: query `job_companies` by `name_canonical`; return immediately if `resolved_at` is set and `retry_after` is NULL | Pending |
| Implement cascade Step 2 — ATS domain pattern match: check if the inbound URL's domain matches known ATS patterns (Greenhouse `greenhouse.io`, Lever `jobs.lever.co`, Ashby `jobs.ashbyhq.com`, Workday `myworkdayjobs.com`, SmartRecruiters, iCIMS, BambooHR, Jobvite); if match, extract company slug and construct canonical URL | Pending |
| Implement cascade Step 3 — careers-page scrape: fetch company root domain, look for `<a>` hrefs containing `/careers`, `/jobs`, `/join`; score candidates by keyword density; return highest-confidence URL | Pending |
| Implement cascade Step 4 — unresolved bucket: if all steps fail, upsert row with `retry_after = NOW() + INTERVAL '24 hours'`; return `{ resolved: false }` | Pending |
| On successful resolution (Steps 2 or 3), upsert `job_companies` with `resolved_at = NOW()`, `retry_after = NULL`, `careers_url` | Pending |
| Expose `POST /enrich-job-source` accepting `{ companyName: string, hintUrl?: string }` | Pending |

---

## Epic 3: Gmail-Jobs Source Plugin

> **Goal**: Wire Gmail as a job-recommendation source. The plugin reads Gmail threads matching recruiter-outreach patterns, extracts company + role signals, skips recruiter blasts, deduplicates against existing pipeline roles, and feeds enriched candidates into the recommendations widget via the existing source registry.

### Story 3.1 — `_shared/sources/gmail-jobs.ts` Plugin

| Task | Status |
|------|--------|
| Create `supabase/functions/_shared/sources/gmail-jobs.ts` | Pending |
| Implement `GmailJobsSource` class conforming to the existing source plugin interface | Pending |
| Query Gmail with search string: `(subject:"opportunity" OR subject:"role" OR subject:"position" OR subject:"opening" OR "I'd love to connect") in:inbox newer_than:14d` | Pending |
| For each matching thread, extract: sender domain, subject, body snippet, any URLs in body | Pending |
| Pass extracted company name + hint URL to `enrich-job-source`; skip threads where enrichment returns `{ resolved: false }` and `retry_after` is in the future | Pending |
| Extract role title from subject line using pattern list (title-case noun phrases preceding "at", "with", "—", " @ ") | Pending |
| Deduplicate against existing `roles_pipeline` rows by `(name_canonical, role_title_normalized)` — skip if already tracked | Pending |

### Story 3.2 — Recruiter-Blast Skip Logic

| Task | Status |
|------|--------|
| Write migration `023_gmail_skipped.sql`: table `gmail_skipped (id, thread_id, user_id, reason, skipped_at)` with index on `(user_id, thread_id)` | Pending |
| In `GmailJobsSource`, detect blast emails: fetch thread recipient count via `getThread`; skip and log to `gmail_skipped` if `to` header contains >5 addresses or BCC indicators are present | Pending |
| Also skip and log if sender domain is on the aggregator allowlist (see Story 3.3) — these are sourced separately, not from Gmail body | Pending |
| Skip and log if the same `thread_id` has already been processed (idempotency guard) | Pending |

### Story 3.3 — Aggregator Allowlist

| Task | Status |
|------|--------|
| Define `AGGREGATOR_DOMAINS` constant in `gmail-jobs.ts`: `['linkedin.com', 'indeed.com', 'glassdoor.com', 'ziprecruiter.com', 'dice.com', 'monster.com', 'simplyhired.com', 'builtinsf.com', 'wellfound.com', 'otta.com']` | Pending |
| Skip threads where sender domain is in `AGGREGATOR_DOMAINS` — log to `gmail_skipped` with `reason: 'aggregator'` | Pending |
| Document rationale: aggregator emails are handled by other source plugins, not Gmail body parsing | Pending |

### Story 3.4 — Source Registry Wiring

| Task | Status |
|------|--------|
| Register `GmailJobsSource` in the existing source registry under key `'gmail-jobs'` | Pending |
| Add `user-sources` support for `type='gmail-jobs'`: a user with a connected Gmail account auto-gets this source enabled | Pending |
| Ensure the source only activates when `gmail-auth/status` returns `{ connected: true }` for the user | Pending |
| Add `'gmail-jobs'` to the recommendations widget eligibility check so Gmail-sourced roles can appear in the widget | Pending |

---

## Epic 4: Cron Tick + E2E

> **Goal**: A `gmail-scan` edge function runs on a cron schedule, invokes the `GmailJobsSource` plugin for each connected user, and feeds results into the recommendations pipeline. A fixture-based test path validates the full flow without hitting live Gmail.

### Story 4.1 — `gmail-scan` Edge Function

| Task | Status |
|------|--------|
| Create `supabase/functions/gmail-scan/index.ts` with `const VERSION = '1.0.0'` | Pending |
| On invocation, query `user_google_tokens` for all rows where `scope_set = 'gmail'` and `retry_after IS NULL` | Pending |
| For each user, instantiate `GmailJobsSource`, call `scan()`, collect candidate roles | Pending |
| For each candidate, call `enrich-job-source` (or call inline if colocated), then upsert into `roles_pipeline` with `source = 'gmail-jobs'` and `status = 'New'` | Pending |
| Log scan summary per user: threads scanned, roles added, roles skipped (blast), roles skipped (aggregator), roles skipped (already tracked) | Pending |
| Schedule via Supabase cron: `0 8 * * *` (08:00 UTC daily) — document in `deployment.md` | Pending |

### Story 4.2 — Fixture-Based Test Path

| Task | Status |
|------|--------|
| Create `supabase/functions/gmail-scan/fixtures/` directory with 5 sample Gmail thread JSON blobs: genuine recruiter outreach, blast email, aggregator-domain sender, already-tracked role, unresolvable company | Pending |
| Implement `runFixture(fixtureName)` function in `gmail-scan` invocable via `POST /gmail-scan?fixture=<name>` when `GMAIL_FIXTURE_MODE=true` env var is set | Pending |
| Assert expected outcomes per fixture: genuine → role upserted; blast → logged to `gmail_skipped`; aggregator → logged to `gmail_skipped`; already-tracked → skipped silently; unresolvable → `retry_after` set | Pending |
| Write Deno test file `gmail-scan.test.ts` that runs all 5 fixture assertions | Pending |

### Story 4.3 — Deploy + Run Migrations

| Task | Status |
|------|--------|
| Run migration `021_user_google_tokens.sql` against Boards Supabase project | Pending |
| Run migration `022_job_companies.sql` against Boards Supabase project | Pending |
| Run migration `023_gmail_skipped.sql` against Boards Supabase project | Pending |
| Deploy `gmail-auth` edge function: `supabase functions deploy gmail-auth` | Pending |
| Deploy `enrich-job-source` edge function: `supabase functions deploy enrich-job-source` | Pending |
| Deploy `gmail-scan` edge function: `supabase functions deploy gmail-scan` | Pending |
| Verify `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` are set in Supabase Edge Function secrets | Pending |
| Manually trigger first scan via `POST /gmail-scan` and confirm roles appear in recommendations widget | Pending |
| Update `calendar-api` deployment after `_shared/google-tokens.ts` refactor: `supabase functions deploy calendar-api` | Pending |
