# Gmail → Jobs Pipe — Phase 1.5: Canonical-URL Enrichment

**Status:** DRAFT brief
**Last updated:** 2026-05-10
**Predecessor:** Phase 1 ([gmail-jobs-pipe.md](./gmail-jobs-pipe.md)) — ships Gmail-sourced recs into the widget using aggregator URLs (LinkedIn / Wellfound / Otta)
**Successor:** Phase 2 — network graph + warm-intro overlay

---

## TL;DR

Phase 1 emits recommended roles with the aggregator URL (LinkedIn alert, Wellfound listing, etc.). That URL goes to a page with the JD + Apply button — fine for the user, but means three things:

1. Click-through requires one extra hop (LinkedIn → company ATS) instead of going straight to Greenhouse / Lever / Ashby.
2. The same Acme role coming from three aggregators dedupes to three rows in the widget instead of one.
3. We have no JD text on hand for downstream features (better fit-scoring, inline JD preview on the card, reading-comprehension match bullets).

Phase 1.5 adds canonical-URL enrichment: take `(company, title)` from the Haiku extraction, resolve to the company's ATS slug, fetch the matching posting, return canonical apply URL + JD text. Wire it back into `gmail-jobs` between extraction and emit.

---

## Why now (vs. defer further)

- The infrastructure already exists in code — `enrich-job-source` function is committed but unreferenced. Phase 1.5 is plumbing it back in, not building from scratch.
- Cross-aggregator dedup is a real UX issue once volume picks up. Three cards for the same role is noise.
- Better fit scoring needs JD text. Right now `computeFit` runs against the alert snippet, which is shallow.

## Why not now (counter-argument)

- The aggregator URL satisfies "user can see JD + apply." We don't have evidence yet that the extra hop or duplicate cards bother the user enough to fix.
- The cache layer is the lever, but it's also the source of failure modes (collisions, name conflicts, FK loops — the entire patch saga of 2026-05-10). Schema changes carry tax.

Decision: ship Phase 1 first, validate user actually wants enrichment via dogfood, then ship Phase 1.5.

---

## Scope

**In:**
- New table `job.hiring_companies` — cache of `(name, domain, ats_provider, ats_slug, careers_url, resolution_status, retry_at)`. Keyed by `name_norm` (lowercase trim) for case-insensitive lookup.
- FK from `job.recommended_roles.company_id` (column already exists, added in Phase 1) → `job.hiring_companies.id`.
- Re-enable `enrich-job-source` call inside `_shared/sources/gmail-jobs.ts` between Haiku extract and emit. Use canonical URL when resolved; fall back to alert URL with `enrichment_status='unresolved'` flag when not.
- Backoff retry on unresolved companies (already implemented in `enrich-job-source`).
- Widget: render an "unresolved source" badge on cards where `enrichment_status='unresolved'` so user knows the URL is the aggregator, not the canonical posting. Honest UI.

**Out:**
- Workday tenant resolution (slugs aren't predictable from company name; route to unresolved bucket).
- iCIMS / Bamboo / lesser ATS support — Greenhouse + Lever + Ashby covers the long tail of YC / startup hiring.
- Cross-user cache reuse — single user means cache is single-tenant for now.

---

## Architecture (already designed in Phase 1)

```
gmail-jobs source plugin
  → Haiku extract { company, title, location, alert_url }
  → enrich-job-source(company, title, hintAtsUrl)
      ├─ hiring_companies cache hit  → fetch canonical posting on known ATS
      └─ cache miss                  → probe Greenhouse/Lever/Ashby slugs
                                     → cache result → fetch canonical
  → { canonical_url, jd_text, ats_provider }  (or unresolved + retry_at)
  → emit RecommendedRoleInput
```

`enrich-job-source` exists. `_shared/sources/gmail-jobs.ts` had this wired in Phase 1 — was stripped before ship. Adding it back is < 30 lines.

---

## Schema (one migration)

```sql
create table if not exists job.hiring_companies (
  id                  uuid primary key default gen_random_uuid(),
  name                text not null,
  name_norm           text generated always as (lower(trim(name))) stored,
  domain              text,
  ats_provider        text,            -- 'Greenhouse' | 'Lever' | 'Ashby'
  ats_slug            text,
  careers_url         text,
  resolution_status   text not null default 'unresolved'
                       check (resolution_status in ('resolved','unresolved','failed')),
  last_resolved_at    timestamptz,
  next_retry_at       timestamptz,
  retry_count         int not null default 0,
  notes               text,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  unique (name_norm)
);
create index if not exists hiring_companies_domain_idx
  on job.hiring_companies (domain) where domain is not null;
create index if not exists hiring_companies_unresolved_idx
  on job.hiring_companies (next_retry_at)
  where resolution_status <> 'resolved';
alter table job.hiring_companies enable row level security;

alter table job.recommended_roles
  add constraint recommended_roles_company_id_fkey
  foreign key (company_id) references job.hiring_companies(id) on delete set null;
```

The `recommended_roles.company_id`, `enrichment_status`, `enrichment_retry_at`, `canonical_url` columns already exist from Phase 1 — they're orphan placeholders right now and become live in this phase.

---

## Open questions to lock before /plan

1. **Title-match strictness.** Current implementation uses ≥2 shared meaningful tokens AND ≥50% overlap. Validate against real Gmail data; tune if it's too strict (false negatives) or too loose (wrong-role canonical URLs). Consider location as a tiebreaker.
2. **Workday handling.** Default to unresolved bucket, or attempt a tenant-name guess against `myworkdayjobs.com/{tenant}`? Lean: bucket. Workday tenants are unpredictable.
3. **Retry budget.** `enrich-job-source` backoff is `[60m, 4h, 24h, 3d, 7d]`. Confirm cap at 7d and stop after N attempts vs. retry forever.
4. **Cache invalidation.** Companies migrate ATS providers. When does a `resolved` row go stale? Lean: never auto-stale; manual reset via admin endpoint. Re-evaluate if we see drift.

---

## Success criteria

- A Gmail-sourced recommendation that resolves cleanly shows `Greenhouse · Acme` (or Lever / Ashby) as `source_label` and links to the company's ATS posting, not the LinkedIn alert.
- Two Gmail alerts for the same Acme role from different aggregators dedup to a single recommended row (matched on canonical URL).
- Unresolved companies display the aggregator URL with a "verifying source" or equivalent badge.
- `job.hiring_companies` accumulates resolutions over time so steady-state hits the cache, not the ATS APIs.

---

## Risks

- Title drift between aggregator and ATS may cause false-positive matches (canonical URL points to a similar but different role). Token overlap heuristic needs validation.
- Greenhouse / Lever / Ashby rate limits — unlikely to hit at a single-user scale, but worth a 429 backoff in the resolver.
- Generated-column collisions: the existing `job.companies` table is your career history, NOT a hiring cache. Phase 1.5 ships `job.hiring_companies` (separate table) to avoid the collision that bit Phase 1.

---

## Effort estimate

~2–3 hours of work. Most code exists; this is plumbing + a single migration + widget badge.
