# Known Risks & Mitigations

> Technical, operational, and architectural risks with status-tracked mitigations

---

## Risk Matrix

| # | Risk | Severity | Likelihood | Status | Mitigation |
|---|------|----------|-----------|--------|-----------|
| R1 | [CORS proxy shutdown](#r1-cors-proxy-dependency) | High | Medium | Open | Server-side scraping fallback |
| R2 | [Single-file monolith](#r2-single-file-monolith) | Medium | Certain | Open | Incremental modularization |
| R3 | [No sync retry queue](#r3-no-sync-retry-queue) | High | Medium | Open | Offline queue with retry |
| R4 | [CORS Allow-Origin: *](#r4-cors-wildcard-origin) | Medium | Medium | Open | Restrict to ctrl.rodeo |
| R5 | [Permissive Systemic RLS](#r5-permissive-systemic-rls) | Medium | Low | Open | Tighten policies |
| R6 | [No automated testing](#r6-no-automated-testing) | High | Certain | Open | Add critical-path tests |
| R7 | [localStorage data loss](#r7-localstorage-data-loss) | High | Low | Partial | Supabase sync exists, but gaps remain |
| R8 | [Supabase free tier limits](#r8-supabase-free-tier-limits) | High | Low | Mitigated | Monitoring + caching strategies |
| R9 | [No CSP headers](#r9-no-csp-headers) | Medium | Low | Open | Add Content-Security-Policy |
| R10 | [No rate limiting](#r10-no-rate-limiting) | Medium | Medium | Open | Add function-level rate limits |
| R11 | [CDN supply chain](#r11-cdn-supply-chain-risk) | High | Very Low | Open | Self-host critical SDK |
| R12 | [Manual function deploys](#r12-manual-function-deploys) | Low | Certain | Accepted | CI/CD for functions (future) |
| R13 | [Third-party URL logging](#r13-third-party-url-logging) | Low | Medium | Accepted | Move scraping server-side |

---

## Risk Details

### R1: CORS Proxy Dependency

**Risk**: Client-side metadata scraping depends on two free, third-party CORS proxies (allorigins.win, corsproxy.io) with no SLA. If both go down, new pins get placeholder titles and no images.

**Current state**: Two proxies provide redundancy. If the first fails, the second is tried. But both are free services that could disappear.

**Mitigation**: Build a `scrape-metadata` Supabase Edge Function that fetches URLs server-side. The client would call this as a third fallback after the two CORS proxies, or as the primary strategy for authenticated users.

**Dev work**: Epic in backlog — "Server-side scraping fallback"

---

### R2: Single-File Monolith

**Risk**: `boards/index.html` is 9,100 lines containing HTML, CSS, and JS in a single file. This makes it hard to navigate, increases merge conflicts, and makes it impossible to tree-shake or lazy-load.

**Current state**: The file has logical sections (documented in [client-architecture.md](./technical-design/client-architecture.md)) but no actual module boundaries.

**Mitigation**: Incremental extraction of logical modules into separate JS files loaded via `<script>` tags. No bundler needed — just separate files served by Jekyll. Priority targets: widget system (~1,000 lines), sync layer (~500 lines), enrichment pipeline (~400 lines).

**Dev work**: Epic in backlog — "Client modularization"

---

### R3: No Sync Retry Queue

**Risk**: When an authenticated user edits a pin and the `syncLinkToSupabase()` call fails (network error), the change exists only in localStorage. There's no retry queue — the change is silently lost from the cloud. The 30-second polling only pulls, it doesn't push.

**Current state**: Fire-and-forget sync. Failed writes are logged to console but never retried.

**Mitigation**: Implement a `pendingSyncs` queue in localStorage. On each sync failure, push the operation to the queue. On next successful sync or on a timer, drain the queue.

**Dev work**: Story in Phase 6 — "Sync retry queue"

---

### R4: CORS Wildcard Origin

**Risk**: All Supabase Edge Functions return `Access-Control-Allow-Origin: *`. Any website can call `generate-widget` or `enrich-link`, consuming AI credits and Supabase invocations.

**Current state**: RLS protects user data (requires valid auth token), but unauthenticated endpoints (if any) and the function invocation cost itself are exposed.

**Mitigation**: Set `Access-Control-Allow-Origin: https://ctrl.rodeo` in all edge functions. This is a one-line change per function.

**Dev work**: Task in Phase 6 — "Restrict CORS origins"

---

### R5: Permissive Systemic RLS

**Risk**: Migration 005 (systemic_ai tables) has `true` policies for INSERT and UPDATE, allowing any anonymous user to write to `audit_jobs`, `design_systems`, `design_tokens`, `design_components`, etc.

**Current state**: Low risk because the Systemic tool is experimental and the data isn't sensitive. But it could be abused to fill the database.

**Mitigation**: Restrict INSERT/UPDATE to authenticated users or admin only.

**Dev work**: Task in Phase 6 — "Tighten Systemic RLS policies"

---

### R6: No Automated Testing

**Risk**: Zero test files, no test runner, no CI test step. Regressions can only be caught manually. The 9,100-line monolith has no safety net.

**Current state**: All testing is manual in-browser.

**Mitigation**: Add a lightweight test suite for critical paths. No need for full coverage — focus on:
1. URL extraction/normalization (pure functions, easy to test)
2. Category/content type classification rules (pure functions)
3. Sync protocol (mock localStorage + fetch)
4. Widget eligibility evaluation (pure config evaluation)

Use a zero-config runner (Deno test for edge functions, browser-based for client code).

**Dev work**: Epic in backlog — "Critical-path test suite"

---

### R7: localStorage Data Loss

**Risk**: If a user clears browser data, uses incognito, or switches browsers, localStorage is gone. Anonymous users lose everything. Authenticated users recover from Supabase, but any unsynced changes are lost.

**Current state**: Partial mitigation — authenticated users have Supabase backup. But the sync gap from R3 means some writes may not have reached the server.

**Mitigation**:
1. Fix R3 (sync retry queue) to ensure all writes reach Supabase
2. Add a periodic full-sync (every 5 minutes, upload entire local state) as a safety net
3. Prompt anonymous users to sign in after adding N pins ("Sign in to save your pins to the cloud")

**Dev work**: Story in Phase 5 — "Anonymous user save prompt", Story in Phase 6 — "Periodic full sync"

---

### R8: Supabase Free Tier Limits

**Risk**: Supabase free tier allows 500K function invocations/month and 1GB database. Exceeding these would require upgrading to a paid plan ($25/month).

**Current state**: Current usage is ~15-30K invocations/month (~3-6% of limit). Database is ~10MB (~1% of limit). Well within limits.

**Mitigation**: Already mitigated through:
- Domain profile caching (reduces AI classification calls)
- Client-side enrichment first (reduces server calls)
- Widget caching (1-hour TTL reduces repeated generation)
- Monitoring via Supabase Dashboard

**Dev work**: None needed currently. Watch metrics if user count grows.

---

### R9: No CSP Headers

**Risk**: No Content-Security-Policy header. This increases XSS risk — if an attacker injects a script, there's no browser-level block on what it can load.

**Current state**: GitHub Pages doesn't support custom headers natively. Would need a `<meta>` tag CSP or a Cloudflare Workers/Pages proxy.

**Mitigation**: Add a `<meta http-equiv="Content-Security-Policy">` tag to `boards/index.html` restricting `script-src`, `style-src`, `connect-src` to known origins.

**Dev work**: Task in Phase 6 — "Add CSP meta tag"

---

### R10: No Rate Limiting

**Risk**: Edge functions have no rate limiting. A malicious actor could spam `generate-widget` to burn through Anthropic API credits, or spam `enrich-link` to exhaust Supabase invocations.

**Current state**: RLS requires auth for user-data operations, but the function invocation itself isn't gated.

**Mitigation**: Add rate limiting at the function level. Options:
1. Supabase-native: Track request count per IP/user in a `rate_limits` table
2. Simple: In-memory counter with per-IP limits (resets on function cold start)

**Dev work**: Story in Phase 6 — "Edge function rate limiting"

---

### R11: CDN Supply Chain Risk

**Risk**: The Supabase JS SDK is loaded from jsDelivr CDN (`cdn.jsdelivr.net`). If jsDelivr is compromised or goes down, auth, sync, and sharing all break.

**Current state**: jsDelivr is a major CDN with high uptime, but it's a single point of failure for the app's most critical dependency.

**Mitigation**: Self-host the Supabase JS SDK as a local file in the repo. Bundle it once, serve from GitHub Pages. Eliminates the CDN dependency entirely.

**Dev work**: Task in backlog — "Self-host Supabase SDK"

---

### R12: Manual Function Deploys

**Risk**: Edge functions are deployed manually via `supabase functions deploy`. A developer could forget to deploy after a code change, leaving production out of sync with the repo.

**Current state**: Accepted risk for current team size (1 developer). The function deploy commands are documented in [deployment.md](./deployment.md).

**Mitigation** (future): Add a GitHub Actions workflow that deploys functions on push to main. Requires storing `SUPABASE_ACCESS_TOKEN` in GitHub Secrets.

**Dev work**: Task in backlog — "CI/CD for edge function deploys"

---

### R13: Third-Party URL Logging

**Risk**: CORS proxy services (allorigins.win, corsproxy.io) can see every URL the client scrapes. This includes any URL the user saves — potentially sensitive internal company links, personal bookmarks, etc.

**Current state**: Accepted risk. The proxies are HTTPS so the URLs aren't visible in transit to third parties beyond the proxy operator, but the proxy operator itself can log them.

**Mitigation**: Same as R1 — move to server-side scraping via a Supabase Edge Function. Authenticated users would bypass the proxies entirely.

**Dev work**: Shared with R1 — "Server-side scraping fallback"

---

## Summary by Priority

### Do Now (security + data integrity)

| Risk | Fix | Effort |
|------|-----|--------|
| R4: CORS wildcard | Change `*` to `https://ctrl.rodeo` in 4 functions | ~30 min |
| R5: Systemic RLS | Update migration 005 policies | ~30 min |
| R9: No CSP | Add `<meta>` CSP tag | ~1 hour |

### Do Soon (reliability)

| Risk | Fix | Effort |
|------|-----|--------|
| R3: No sync retry | Implement pending sync queue | ~4 hours |
| R1: CORS proxy | Build `scrape-metadata` edge function | ~1 day |
| R10: No rate limiting | Add per-IP counters to edge functions | ~4 hours |
| R11: CDN supply chain | Download and self-host Supabase SDK | ~1 hour |

### Do Later (quality + maintainability)

| Risk | Fix | Effort |
|------|-----|--------|
| R6: No testing | Critical-path test suite | ~2-3 days |
| R2: Monolith | Modularize into separate JS files | ~1-2 weeks |
| R12: Manual deploys | GitHub Actions for function deploy | ~4 hours |

---

*Last updated: 2026-02-06*
