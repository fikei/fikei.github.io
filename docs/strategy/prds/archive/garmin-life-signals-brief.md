> **Archived from an orphaned branch.** Recovered from `claude/garmin-watch-integration-brief-jhvxsu` (last touched 2026-06-11),
> which shares no history with master after the repository history was rewritten.
> Kept for the thinking in it; nothing here is current.

# Garmin Life Signals Brief: A Compliant Health-OS Layer for ctrl.rodeo

**Status:** Draft
**Date:** 2026-06-11
**Author:** Claude (autonomous session)

---

## One-Liner

Pull continuous health and activity data from a Garmin watch into ctrl.rodeo, **let the user add their own context conversationally** (e.g. "I've been vaping again this week"), and **associate all of it with the other critical parts of life the platform already curates** — what you read and watch, the work you're chasing, the events on your calendar. Store every data point as a **FHIR-aligned observation from day one** so this becomes a portable, compliant personal health record (a "Health OS"), not a throwaway dashboard.

---

## Context

ctrl.rodeo already collects the *external* inputs of a life: links, content, boards, a Gmail jobs pipeline, events, and a taste profile that finds connections across categories. Its first brand principle is **"input shapes output — surface connections and patterns in what users collect."**

Two inputs are missing, and this brief adds both:

1. **The body (passive).** A Garmin watch produces the richest continuous personal dataset most people own — sleep, stress, HRV, Body Battery, heart rate, training load, workouts — trapped in Garmin Connect, disconnected from everything else.
2. **Lived context (self-reported).** The things a watch can't sense but that explain everything: nicotine, alcohol, caffeine, medication, mood, symptoms, a stressful meeting. The user must be able to **add these clearly, in natural language, and ask questions back** — *"how did my sleep track with the weeks I was off nicotine?"*

Both must be designed so the data can flow into a real **EHR / Health-OS framework in a compliant way** — structured, coded, provenance-stamped, and exportable to a clinician's system if the user ever chooses, without a rebuild.

**Why now:** Garmin's Connect Developer Program exposes exactly the passive data we need over OAuth 2.0 with push + backfill ([Health API](https://developer.garmin.com/gc-developer-program/health-api/), [Activity API](https://developer.garmin.com/gc-developer-program/activity-api/)), and there is now a published case study mapping **Garmin device data into FHIR** for EHR interoperability ([Frontiers in Digital Health, 2025](https://www.frontiersin.org/journals/digital-health/articles/10.3389/fdgth.2025.1636775/full)). The clinical standards for self-reported data already exist (FHIR social-history observations). We don't have to invent the schema — we have to adopt it.

---

## Two Design Pillars Added in This Revision

> The first draft of this brief covered passive ingestion + cross-domain correlation. This revision adds the two things that turn it from a quantified-self toy into a Health OS: **self-reported context with a conversational interface**, and **a compliant, EHR-portable data model.**

### Pillar A — Conversational input & query (ask + add context)

A single natural-language surface that does two jobs:

- **Add context.** "Add that I quit nicotine on June 1." / "I had 3 drinks last night." / "Started 50mg sertraline this morning." Claude parses the utterance into a **structured, coded observation** (see Pillar B), shows the user exactly what it's about to record, and writes it only on confirmation. Manual context is never free-text mush — it lands as queryable, typed data.
- **Ask questions.** "How's my resting HR trended since I quit nicotine?" / "Do I sleep worse the night before interviews?" Claude queries the observation store + the existing ctrl.rodeo entities (pins, jobs, events) and answers with honest, hedged correlations.

This reuses ctrl.rodeo's existing AI-narration + connector plumbing — the body/health data simply becomes another thing the connector can read and write, behind the dedicated biometric privacy tier.

### Pillar B — Compliant Health-OS data model (FHIR-native)

Every data point — whether it came from a Garmin sync or from the user saying "I vaped today" — is stored internally as a **FHIR `Observation`**, the same resource EHRs use. This is the single decision that makes everything else (portability, compliance, interoperability) fall out for free. Details below.

---

## Brand Fit

| Principle | How this honors it |
|-----------|----------------------------|
| **Input shapes output** | Body data + lived context become first-class inputs the connection engine reasons over. |
| **Organize as you go** | Garmin pushes automatically; spoken context is parsed and coded automatically. Zero-friction capture. |
| **One place, whole life** | Stop siloing the body — and the habits that drive it — away from the rest of life. |
| **Show, don't decorate** | Surface only correlations that mean something. No vanity dashboards. |
| **Expand with the user** | Start with passive ingestion + a few self-reported types; grow into a full portable health record. |

---

## What Garmin Exposes (Passive Inputs)

The Garmin Connect Developer Program is a suite of OAuth 2.0 APIs. ([overview](https://developer.garmin.com/gc-developer-program/))

### Health API — continuous wellness ([source](https://developer.garmin.com/gc-developer-program/health-api/))

| Data type | Gives us |
|-----------|------------------|
| **Daily summaries** | Steps, floors, active/BMR calories, intensity minutes, all-day stress |
| **Sleep** | Stages, duration, sleep score, restlessness |
| **Stress** | All-day stress as 3-minute averages |
| **Body Battery** | Proprietary 0–100 energy reserve (blends HRV, stress, sleep) |
| **HRV** | Overnight beat-to-beat variation (recovery signal) |
| **Heart rate / resting HR** | Continuous + daily resting baseline |
| **Respiration & Pulse Ox (SpO2)** | Breathing rate, blood-oxygen |
| **User metrics** | VO2 Max, fitness-age estimates |
| **Epochs** | Minute-level activity rollups |

### Activity API — detailed per-workout data (GPS, splits, HR zones, power, training effect). ([source](https://developer.garmin.com/gc-developer-program/activity-api/))

### Delivery model
- **Push/Ping** — Garmin POSTs to our callbacks within seconds of a sync; no polling. ([source](https://www.spikeapi.com/blog/why-integrate-garmin-api-directly))
- **Backfill** — request months of history on connect, so correlations work day one.
- **Auth** — OAuth 2.0 (PKCE-compatible), same shape as ctrl.rodeo's existing connector OAuth.

### Access constraint
The Garmin program is **free of fees but gated to "business use"** and requires approval — not a self-serve consumer API ([Program FAQ](https://developer.garmin.com/gc-developer-program/program-faq/)). Aggregators (Terra, Spike, Thryve) offer a faster, paid, multi-wearable path. See Decision #1.

---

## Self-Reported Inputs (Lived Context)

These are entered by the user — typed, spoken, or in conversation — and parsed into the same observation model. Launch vocabulary (extensible):

| Category | Examples | Clinical mapping |
|----------|----------|------------------|
| **Substance use** | Nicotine/vaping, alcohol, caffeine, cannabis | FHIR **Social History** observation. Nicotine → LOINC **72166-2** "Tobacco smoking status", value from SNOMED/LOINC answer set (e.g. `LA18976-3` "current every day smoker"). ([LOINC 72166-2](https://loinc.org/72166-2), [US Core Smoking Status](https://build.fhir.org/ig/HL7/US-Core/StructureDefinition-us-core-smokingstatus.html)) |
| **Medication** | "Started 50mg sertraline" | FHIR `MedicationStatement` (self-reported) |
| **Mood / mental state** | "Anxious all day", energy, focus | Observation, survey category |
| **Symptoms** | Headache, poor sleep, soreness | Observation / `Condition` |
| **Life events** | "Big presentation", travel, illness | Observation, social/contextual — also linkable to ctrl.rodeo events |

**Design rule:** self-reported data is *never* second-class. It is coded, timestamped, provenance-stamped as `patient-reported`, and queryable on the same axis as Garmin data — that's what lets "resting HR since I quit nicotine" actually work.

---

## The Health-OS Data Model (FHIR-native)

**One canonical internal resource: `Observation`.** Garmin pushes and user utterances both normalize into it.

```
 SOURCE                     CANONICAL STORE                 CONSUMERS
┌──────────────┐
│ Garmin push  │──┐        ┌────────────────────┐        ┌─ correlation engine
│ (sleep, HRV, │  │        │  observations       │        │  (time-joins vs.
│  HR, stress) │  ├───────►│  (FHIR Observation) │───────►│   pins/jobs/events)
└──────────────┘  │        │  + provenance       │        │
┌──────────────┐  │        │  + code system map  │        ├─ conversational Q&A
│ User utterance│ │        │  + privacy tier     │        │  (Claude)
│ "vaped today"│──┘        └─────────┬──────────┘        │
└──────────────┘                     │                    └─ FHIR export bundle
                                      │                       (→ clinician EHR,
                              ┌───────▼────────┐                Apple Health, etc.)
                              │  Provenance     │
                              │  who/what/when/  │
                              │  source/method   │
                              └─────────────────┘
```

### Why FHIR, internally, from the start
- **It's the EHR lingua franca.** `Observation` is *the* resource EHRs use for vitals, labs, social history, and wearable data — quantitative and qualitative alike ([FHIR Observation](https://hl7.org/fhir/observation.html)). Adopting it now means "incorporate into an EHR framework later" is an *export*, not a migration.
- **Provenance is built in.** The FHIR **`Provenance`** resource records who/what created each observation and keeps audit reviewers happy; **`derivedFrom`** chains a computed value back to its raw source. This is the backbone of compliant, trustworthy health data — every point can answer "where did this come from?"
- **Self-reported fits natively.** `performer` = the patient and a `patient-reported` provenance tag distinguish "I said so" from "the device measured it" — without leaving the standard.
- **Coded, not free-text.** LOINC for vitals/social-history codes, SNOMED for clinical values. The conversational parser's job is text → code, so the store stays queryable and interoperable.

### Pragmatic implementation
We don't run a full FHIR server on day one. Store a Postgres `observations` table whose columns map 1:1 to the FHIR `Observation` fields (`code`, `category`, `value[x]`, `effectiveDateTime`, `performer`, `derivedFrom`, `provenance`), plus ctrl.rodeo's `user_id` and privacy tier. A thin serializer emits valid FHIR R4 bundles on export. **FHIR-shaped storage, lightweight runtime.**

---

## Compliance Design

The ambition ("EHR framework, compliant") raises the bar past the first draft. Here's the posture.

### Regulatory reality
- A **direct-to-consumer, self-entered personal health record is generally NOT a HIPAA covered entity or business associate** — HIPAA mostly doesn't apply to a PHR the individual controls and self-populates ([AccountableHQ](https://www.accountablehq.com/post/hipaa-compliance-guide-are-personal-health-records-covered-entities)).
- **But other regimes do apply:** the **FTC Health Breach Notification Rule** reaches most non-HIPAA health apps; state consumer-health laws (notably **Washington's My Health My Data Act**) and **GDPR special-category data** impose consent, breach, and minimization duties ([Mobile Health Apps Tool, FTC](https://www.ftc.gov/business-guidance/resources/mobile-health-apps-interactive-tool)).
- **The line moves the moment a provider is involved.** If ctrl.rodeo ever ingests data *from* or pushes *to* a clinician's EHR on their behalf, the covered-entity/business-associate bar engages. Design so that's an explicit, gated step — not an accident.

### What we build to be compliant *and* portable
| Control | Implementation |
|---------|---------------|
| **Provenance + audit** | Every observation carries a FHIR `Provenance` (source, method, device vs. patient-reported, timestamp). Immutable audit log of writes/exports/AI-access. |
| **Consent & scope** | Dedicated **biometric/health privacy tier, off by default**, never bundled into existing `library`/`full_access` connector scopes. Per-category opt-in (Garmin separate from self-reported). |
| **Data minimization** | Store only enabled categories. Disconnect = one-tap purge of tokens + observations + derived insights. |
| **Encryption & isolation** | Health observations encrypted at rest; row-level security in Supabase; never logged in plaintext analytics. |
| **Right to export / delete** | FHIR R4 bundle export and full delete are first-class user actions — satisfies GDPR/MHMDA and means the data is genuinely *yours* and portable. |
| **AI access gating** | The connector and conversational agent can only read health observations when the user has explicitly granted the health tier; access is logged. |
| **Honest framing** | Clear in-product language: this is a personal health record, not a medical/diagnostic device. No clinical claims. |

---

## Proposed Architecture

Reuse the connector pattern from the [Multi-LLM Connector Brief](./multi-llm-connector-brief.md): thin protocol adapter → shared core → Supabase.

| Layer | Implementation |
|-------|---------------|
| **OAuth + consent** | Extend `connect/` with a "Connect Garmin" path + health-tier consent; `garmin_tokens` table. |
| **Garmin ingestion** | `garmin-ingest/index.ts` Edge Function — receives push callbacks, verifies, normalizes Garmin payloads → FHIR `Observation` rows. |
| **Conversational capture/query** | `health-agent` flow (Claude): NL → structured coded observation (confirm before write); NL question → query over observations + pins/jobs/events. |
| **Canonical store** | `observations` table (FHIR-Observation-shaped) + `provenance` + immutable `health_audit_log`. |
| **Correlation core** | `_shared/signals-core.ts` — time-joins observations against pins/jobs/events; computes + thresholds candidate correlations. |
| **Narration** | Claude Haiku turns flagged correlations + answers into honest connection cards (reuse widget/insight pipeline). |
| **FHIR export** | Serializer emits an R4 bundle for clinician/Apple Health/Google Health Connect handoff. |
| **Surface** | A "Health" lens in the UI + connector read/write, all behind the biometric tier. |

---

## Phasing

| Phase | Scope | Size |
|-------|-------|------|
| **0. Access** | Decide direct Garmin vs. aggregator; get approved/keyed. | Small (mostly waiting) |
| **1. Canonical store + ingest** | FHIR-shaped `observations` schema + `provenance` + audit log; Garmin OAuth + `garmin-ingest` webhook + backfill. Land passive data, correctly modeled. | Medium |
| **2. Self-reported + conversational capture** | NL → coded observation with confirm-before-write; nicotine/alcohol/caffeine/med/mood vocabulary. **The "add context clearly" ask.** | Medium |
| **3. Conversational query + associate** | Ask questions; time-join body + context against pins/jobs/events; first honest correlation cards. **The actual point.** | Medium–Large |
| **4. Compliance hardening + FHIR export** | Encryption, purge, consent UX, audit surfacing, R4 export bundle. Makes it a real Health OS. | Medium |

Phases 1–2 de-risk the model and the capture UX; Phase 3 delivers the brand promise; Phase 4 makes it portable and compliant. Don't let scope creep in 1–2 starve 3.

---

## Open Questions (1:3:1)

> Per the connector brief's format requirement: **1 headline / 3 context bullets / 1 recommendation.**

### 1. Direct Garmin integration or a wearable aggregator?
- **Pro (direct):** No fees, richest first-party data, no third party touching health data.
- **Con (direct):** "Business use" approval gate, Garmin-only, you own normalization + webhook ops.
- **Nuance:** Aggregators ship in days, normalize many wearables (Apple Watch/Oura/Whoop later free), but cost money and add a processor to the compliance map.
- **Recommendation:** **Aggregator for Phase 1 to validate fast and keep multi-wearable open; apply for direct Garmin in parallel since at n=1 it's free.** Revisit if volume makes fees the bottleneck.

### 2. FHIR-native internally now, or normalize later?
- **Pro (FHIR now):** "Incorporate into an EHR framework" becomes a cheap export, not a migration; provenance/coding designed in from the first row.
- **Con (FHIR now):** Slightly more modeling effort up front; FHIR has a learning curve.
- **Nuance:** We adopt the *shape* (FHIR-mapped Postgres + serializer), not a full FHIR server — most of the cost, little of the weight.
- **Recommendation:** **FHIR-shaped storage from Phase 1.** The user explicitly wants EHR portability; retrofitting a canonical clinical model onto an ad-hoc schema later is the expensive path.

### 3. Conversational capture — how much confirmation friction?
- **Pro (always confirm):** Health data must be accurate; show the parsed observation ("Tobacco use: quit, 2026-06-01 — save?") before writing.
- **Con (always confirm):** Adds a tap to every entry; could feel heavy for quick logging.
- **Nuance:** Tier it — high-stakes types (meds, substances) always confirm; low-stakes (mood, caffeine) can quick-add with easy undo.
- **Recommendation:** **Confirm-by-default for clinical/substance/med types; quick-add-with-undo for soft signals.** Accuracy where it matters, speed where it doesn't.

### 4. Regulatory posture at launch?
- **Pro (consumer PHR):** Self-entered + self-controlled keeps us out of HIPAA covered-entity scope; fastest to value.
- **Con (consumer PHR):** Still bound by FTC Health Breach Notification Rule + state laws (WA MHMDA) + GDPR special-category — real obligations.
- **Nuance:** The moment we exchange data with a provider's EHR *on their behalf*, the covered-entity/BA bar engages — that must be an explicit gated feature, never implicit.
- **Recommendation:** **Launch as a self-controlled consumer PHR; build to FHIR/provenance/consent/export standards so a future clinical-integration mode is a gated add-on, not a re-architecture.**

### 5. Personal tool or product feature?
- **Pro (personal-first):** Fastest value for the one user who asked; free Garmin access at n=1; no support burden.
- **Con (personal-first):** Multi-tenant consent/compliance differs if generalized.
- **Nuance:** The connector/shared-core + FHIR model means a personal build is ~80% of the productized build.
- **Recommendation:** **Personal-first, on the multi-tenant connector + FHIR pattern**, so productizing is wiring, not a rewrite.

---

## Success Criteria

- Garmin data flows into FHIR-shaped `observations` within seconds of a sync, with backfill present day one.
- The user can **add context in plain language** ("quit nicotine June 1") and have it land as a coded, provenance-stamped observation — and **ask questions** ("HR since I quit nicotine?") with honest answers.
- At least one **genuinely non-obvious** cross-domain association surfaces in month one (body/context ↔ work/calendar/curation).
- Health data is opt-in, isolated, auditable, and **exportable as a valid FHIR bundle** — portable into a real EHR if the user chooses.
- Insights read as honest connection cards, not a quantified-self reskin. No clinical claims.

---

## Out of Scope (for now)

- Pushing structured workouts back to the watch (Garmin Training API).
- Direct, live two-way EHR integration with a provider (gated future mode — raises the compliance bar deliberately).
- Medical/diagnostic claims of any kind.
- Real-time streaming — daily + per-activity + per-entry granularity is plenty.
- Rebuilding Garmin Connect's native dashboards.

---

## Sources

- [Garmin Connect Developer Program — Overview](https://developer.garmin.com/gc-developer-program/) · [Health API](https://developer.garmin.com/gc-developer-program/health-api/) · [Activity API](https://developer.garmin.com/gc-developer-program/activity-api/) · [Program FAQ](https://developer.garmin.com/gc-developer-program/program-faq/)
- [Streamlining wearable (Garmin) data integration using FHIR — Frontiers in Digital Health, 2025](https://www.frontiersin.org/journals/digital-health/articles/10.3389/fdgth.2025.1636775/full)
- [FHIR Observation resource — HL7](https://hl7.org/fhir/observation.html)
- [US Core Smoking Status Observation](https://build.fhir.org/ig/HL7/US-Core/StructureDefinition-us-core-smokingstatus.html) · [LOINC 72166-2 Tobacco smoking status](https://loinc.org/72166-2)
- [Are Personal Health Records Covered Entities? — AccountableHQ](https://www.accountablehq.com/post/hipaa-compliance-guide-are-personal-health-records-covered-entities)
- [Mobile Health Apps Interactive Tool — FTC](https://www.ftc.gov/business-guidance/resources/mobile-health-apps-interactive-tool)
- [Why Integrate the Garmin API Directly in 2026 — Spike](https://www.spikeapi.com/blog/why-integrate-garmin-api-directly)

---

*Next steps:*
1. Resolve Decision #1 (direct vs. aggregator) and #4 (regulatory posture) — they gate the build.
2. Stand up the FHIR-shaped `observations` schema + `provenance` + audit log (Phase 1 foundation).
3. Build `garmin-ingest` webhook + OAuth connect flow.
4. Prototype the conversational capture parser (NL → coded observation) on nicotine as the first type.
5. Run `/plan` to break Phases 0–4 into epics/stories.
