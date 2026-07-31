# Brief: Commune Atlas — house claims & room applications

**Status:** Draft for review · 2026-07-31
**Product:** SF Commune Atlas (`communes/`, ctrl.rodeo/communes/)
**Author:** Claude (session: interactive-coops-map)

---

## Problem

The Atlas is a read-only editorial artifact. The houses it describes have no voice in it, and seekers who discover a house have no path from "this looks like home" to "I applied." Two gaps:

1. **Claims** — a house can't correct its profile, post updates, or control its presence (including asking for more/less location precision).
2. **Applications** — when a house has an open room, the Atlas knows (we hand-curate `open room` events) but can't route interest. Haight St Commons already runs a shared "Common App" Google Form; the Atlas could become its front door.

## Why us / why now

- The Atlas already aggregates 60+ houses with structured data — it's the closest thing the scene has to a directory with reach.
- We have the infra: Supabase (Ops project), edge functions, Discord OAuth gating (recruiting app), magic-link email patterns. No new platform needed.
- Trust design is the hard part, not the code — that's a product decision worth making deliberately (hence this brief).

## Users

| User | Job to be done |
|---|---|
| **House steward** | Claim profile, fix facts, set privacy level, post/close a room listing, receive applications |
| **Seeker** | Browse, follow houses, get notified of openings, apply once, reuse application across houses |
| **Atlas maintainer (Ian)** | Approve claims, moderate listings, keep data quality |

## Core flows

### 1. Claim a house
1. Profile card gets a quiet **"Is this your house? Claim it"** link.
2. Claimant signs in (email magic link; Discord optional later) and submits: role in house, evidence (house email domain, link from house site/IG to the Atlas, or a mutual in HSC).
3. Claim lands in a review queue (single decider model, like recruiting: one approver, required comment, three verdicts — approve / reject / need-more-info).
4. Approved stewards get an edit token: profile text, links, events, resident count, **privacy level** (block-anonymized ⟷ exact pin ⟷ neighborhood-only), and listing rights. Edits over facts we sourced editorially show a "steward-maintained" badge.

### 2. Post a listing
1. Steward posts: room description, rent range, move-in window, what the house is looking for, application deadline, and the house's own process (interview dinner, trial stay, etc.).
2. Listing renders on the house card + a new **"open rooms"** filter chip; optional cross-post text for the HSC mailing list.
3. Listings auto-expire at deadline (no zombie listings — same hygiene rule as Ladder's job-expiry pipeline).

### 3. Apply
1. Seeker taps **Apply** on a listing → one-page form: who you are, why this house, links, availability. Saved to their account; reusable across houses (à la HSC Common App — with per-house extra questions if the steward adds them).
2. Application is delivered to the steward (email + dashboard). The Atlas does **not** rank, score, or gatekeep — it's a courier, not a judge.
3. Status is steward-controlled: received → in conversation → closed. Seekers see status changes; no rejection copy beyond "closed."

## MVP cut

**In:** claim + review queue, steward edit of profile/events/privacy, one listing per house, apply form with email delivery, open-rooms chip.
**Out (later):** seeker accounts with saved/reusable apps, notifications/follows, per-house custom questions, HSC Common App integration, analytics for stewards, multi-steward roles.

## Data model sketch (Supabase, Ops project)

- `atlas_houses` — mirror of `data.js` (migrate data.js → DB-backed JSON at build or runtime; keep static fallback)
- `atlas_claims` — house_id, claimant contact, evidence, verdict, reviewer comment
- `atlas_stewards` — house_id, user_id, role
- `atlas_listings` — house_id, body, rent_range, deadline, status
- `atlas_applications` — listing_id, applicant fields, status
- Edge functions: `atlas-claim`, `atlas-listing`, `atlas-apply` (versioned per repo convention); RLS: stewards write own house only.

## Trust & safety

- **Verification is the product.** A false claim = someone impersonating a home. Default to slow-and-manual review; approval SLA over automation.
- Privacy inversion: today the *map* anonymizes houses; a claimed listing is the house *choosing* visibility. Never auto-upgrade pin precision on claim — steward opts in.
- Applications contain personal info → applications table locked down by RLS, no public reads, retention window (e.g. purge 90 days after listing closes).
- Abuse: rate-limit applications per email; steward can close listing instantly; maintainer kill-switch per house.

## Open decisions (1:3:1)

**1. Who counts as a verified claimant?**
- Loose (any resident w/ plausible evidence) maximizes claims but risks intra-house disputes
- Strict (house-designated steward, confirmed via house's public channel) is slower but survives drama
- HSC houses could be bulk-verified through the network itself — one trusted intro unlocks many
- **Recommendation:** strict per-house steward, with an HSC fast-lane.

**2. Auth: email magic links or Discord?**
- Magic links are frictionless for non-Discord houses (most of the 60+)
- Discord reuses the existing gating infra and identity continuity with recruiting/events
- Two systems = more surface; but seekers and stewards are different populations
- **Recommendation:** magic links for both; Discord as a later add for HSC-affiliated flows.

**3. Where do applications live?**
- Email-only delivery is simplest and most private (Atlas stores nothing long-term)
- Dashboard + DB enables status, reuse, and the Common App vision
- Hybrid: DB with aggressive retention limits and email mirror
- **Recommendation:** hybrid — DB is required for the reusable-application promise, retention policy makes it safe.

## Rough phasing

1. **Phase 1 — Claims** (schema, claim form, review queue, steward edits, privacy control)
2. **Phase 2 — Listings** (post/expire, open-rooms chip, email applications)
3. **Phase 3 — Seeker accounts** (reusable apps, follows/notifications, HSC Common App bridge)

Each phase is independently shippable; Phase 1 alone already fixes the "about us, without us" problem.
