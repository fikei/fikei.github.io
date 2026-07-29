# Security Model

> How data is protected, who can access what, and known gaps

---

## Authentication

| Aspect | Implementation |
|--------|---------------|
| **Method** | Passwordless magic link (Supabase Auth OTP) |
| **Session** | JWT stored in localStorage |
| **Token refresh** | Automatic (Supabase JS client) |
| **Token expiry** | Supabase default (1 hour access, 1 week refresh) |

### Keys in Client Code

The Supabase **anon key** is intentionally public in `boards/index.html` ~L3497. This is standard Supabase architecture — the anon key identifies the project but grants only the `anon` role. All data access is gated by RLS policies.

The **service role key** is never exposed in client code. It's only used in:
- Edge functions (via `Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')`)
- GitHub Actions (via repository secrets)

---

## Row-Level Security (RLS)

All tables have RLS enabled. Policies enforce user isolation.

### User Data Tables

| Table | Anon (no auth) | Authenticated | Service Role |
|-------|----------------|---------------|-------------|
| `links` | No access | Own rows only (`auth.uid() = user_id`) | Full |
| `link_order` | No access | Own rows only | Full |
| `expanded_cards` | No access | Own rows only | Full |

### Sharing Tables

| Table | Anon | Authenticated | Service Role |
|-------|------|---------------|-------------|
| `shared_boards` | SELECT where visibility = link/public | Owner: ALL. Others: SELECT public | Full |
| `board_views` | INSERT (anonymous tracking) | INSERT + SELECT own board views | Full |
| `board_invites` | No access | Owner: ALL. Invitee: SELECT own | Full |

### Classification Tables

| Table | Anon | Authenticated | Service Role |
|-------|------|---------------|-------------|
| `content_types` | SELECT | SELECT | Full |
| `domain_profiles` | SELECT | SELECT + UPSERT | Full |
| `classification_log` | No access | Own rows only | Full |
| `image_strategies` | SELECT | SELECT | Full |
| `strategy_performance` | SELECT | SELECT | Full (INSERT) |

### Systemic Tables

| Table | Anon | Authenticated | Service Role |
|-------|------|---------------|-------------|
| All systemic tables | SELECT, INSERT, UPDATE | Same | Full |

**Known issue**: Systemic tables (`migration 005`) have overly permissive policies allowing public INSERT/UPDATE. These should be restricted to authenticated users or admin only.

### Notion Sync Tables (deprecated 2026-07-29)

The `notion-sync` edge function and its GitHub Actions workflow were removed; the sync tables (migration 006) remain in the Ops project but are unused.

---

## CORS Configuration

All edge functions use:
```
Access-Control-Allow-Origin: *
Access-Control-Allow-Headers: authorization, x-client-info, apikey, content-type
```

**Known issue**: `Allow-Origin: *` permits any website to call the edge functions. While RLS protects user data, this could allow:
- Unauthorized widget generation calls (consuming AI credits)
- Unauthorized enrichment calls
- Abuse of the categorize endpoint

**Recommendation**: Restrict to `https://ctrl.rodeo` in production.

---

## Data Protection

### In Transit

| Path | Encryption |
|------|-----------|
| Browser → Supabase | HTTPS (TLS 1.2+) |
| Browser → Edge Functions | HTTPS |
| Browser → CORS Proxies | HTTPS |
| GitHub Actions → Supabase | HTTPS |

### At Rest

| Location | Encryption |
|----------|-----------|
| Supabase PostgreSQL | Encrypted at rest (Supabase default) |
| localStorage | **Not encrypted** (plain JSON) |
| GitHub repository | Not encrypted (public/private repo access controls) |

### Sensitive Data in localStorage

| Key | Contains | Risk |
|-----|----------|------|
| `sb-*-auth-token` | JWT access + refresh token | Session hijack if device compromised |
| `things-i-like` | All pins with URLs, titles, descriptions | Privacy if device accessed |

**Mitigation**: This is standard for browser apps. Sign out clears the auth token.

---

## Input Validation

| Input | Validation | Location |
|-------|-----------|----------|
| URLs | `new URL()` constructor (throws on invalid) | `boards/index.html` ~L3553 |
| Categories | Whitelist check against 8 allowed values | `boards/index.html` ~L5890 |
| Emails | Delegated to Supabase Auth | `boards/index.html` ~L8570 |
| AI JSON responses | Regex extraction + `JSON.parse()` in try/catch | `boards/index.html` ~L3651 |
| URL query params | `encodeURIComponent()` | `boards/index.html` ~L5281 |

### Missing Validation

- No CSP (Content-Security-Policy) header
- No rate limiting on edge functions
- No input length limits on URL or description fields

---

## Admin Access

| Aspect | Implementation |
|--------|---------------|
| Admin check | Email whitelist: `['fike101@gmail.com']` |
| Admin capabilities | Widget management UI |
| Database admin | Supabase Dashboard (requires Supabase account login) |
| Repository admin | GitHub owner (Ian) |

---

## Secrets Management

| Secret | Stored In | Rotation |
|--------|-----------|----------|
| `ANTHROPIC_API_KEY` | Supabase Secrets + GitHub Secrets | 2026-02-04 |
| `OPENAI_API_KEY` | Supabase Secrets | Previous |
| `NOTION_API_KEY` | Unused since 2026-07-29 (notion-sync removed) — safe to delete | 2026-02-04 |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase (auto-managed) + GitHub Secrets | N/A |
| `SUPABASE_ANON_KEY` | Client code (public by design) | N/A |

### Automated Secret Scanning

The `on-push` GitHub Actions job greps for hardcoded secrets in `supabase/` and `.env` files on every push.

---

## Third-Party Risk

| Service | Data Exposed | Risk |
|---------|-------------|------|
| allorigins.win | URLs being scraped | URL logging by proxy operator |
| corsproxy.io | URLs being scraped | URL logging by proxy operator |
| Anthropic API | Pin titles, descriptions, categories | Processed per Anthropic's data policy |
| Google Favicons | Domain names | Minimal (public domains) |
| Unsplash | Search queries | Minimal |
| jsDelivr CDN | None (serves Supabase SDK) | Supply chain risk if CDN compromised |

---

## Incident Response

### If API Key Exposed

1. Rotate the key in the provider dashboard immediately
2. `supabase secrets set KEY=new_value`
3. Update GitHub Secrets if applicable
4. Review provider logs for unauthorized usage
5. Document in this file's Audit Log

### If Supabase Anon Key Abused

The anon key is public and can't be "leaked." If abuse occurs:
1. Add rate limiting to edge functions
2. Restrict CORS to `https://ctrl.rodeo`
3. Review RLS policies for gaps

---

## Audit Log

| Date | Action | By |
|------|--------|-----|
| 2026-02-04 | Rotated Anthropic + Notion API keys | Ian |
| 2026-02-04 | Set up Supabase secrets | Claude |
| 2026-02-04 | Enabled GitHub Actions with secret scanning | Ian |

---

*Last updated: 2026-02-05*
