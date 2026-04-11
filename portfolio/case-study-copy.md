# Portfolio Case Study Copy
> Draft copy for all 5 case studies. Headlines, narrative structure, key callouts.
> Tone: Direct, technically fluent, founder-adjacent. No portfolio clichés.

---

## 1. FIELD — AI-First Clinical Documentation

### Headline
**Field: Replacing paper with voice in wilderness medicine**

### Subhead
An AI-powered clinical documentation app for search & rescue first responders. Voice-driven SOAP notes, on-device language models, offline-first architecture.

### The Problem
Wilderness first responders document patient encounters on paper forms — in rain, darkness, with gloves, under stress. Notes are incomplete, handoffs are error-prone, and critical clinical data gets lost between the field and the hospital.

### What I Built
Field is a native iOS app that listens to the clinical conversation and builds a structured SOAP note in real-time. The provider talks to the patient; the app extracts chief complaints, vitals, history, and assessment findings — slotting each into the correct clinical section automatically.

### Key Design Decisions

**Voice-first, not voice-only.** The transcript is the primary input, but every extracted field can be manually edited. AI fills the structure; the provider confirms it. This is the same "recognition over recall" pattern that makes pre-populated forms faster than blank ones.

**Stoplight confidence states.** When the AI extracts a heart rate of 112 from speech, the field turns amber: "HR 112 — verify and confirm before handoff." Green means confirmed. Red means conflicting data. The provider sees at a glance which fields need attention before handing off the patient.

**On-device model management.** Not every SAR team has cell service. Field runs Whisper Small (242 MB) for transcription and Llama 3.2 3B (1.8 GB) for field extraction — both on-device. The Settings screen exposes model selection, download status, and device tier requirements without requiring the user to understand ML infrastructure.

**Glove-compatible vital entry.** Heart rate input uses ±1/±10 increment buttons plus quick-select chips (60, 70, 80, 90, 100, 120). No keyboard. No precision tapping. Designed for cold hands and high adrenaline.

**Contextual field guidance.** Each SOAP section has an expandable guide: "What goes here," a clinical example, and Quick Insert chips for common findings (Fall from height, Twisted ankle, Chest pain). This turns junior providers into competent documenters without training.

### Business Case
The wilderness medicine documentation market is underserved. Current solutions are either paper-based or adapted from EMS software designed for ambulances with connectivity. Field targets the gap: offline-capable, AI-assisted, built for the specific constraints of backcountry and SAR environments.

### Design System
Field uses SF Pro with a dark-first palette (pure black backgrounds, orange/green accents for clinical urgency). The component system is deliberately constrained — 4 tab types, 3 input patterns, 2 sheet styles — to keep the cognitive load low in high-stress situations. The design review annotations document 8 specific improvements for the next iteration, written as a handoff to the engineering team.

---

## 2. INVOY — Weekly Lifecycle

### Headline
**Invoy: Designing a behavioral configuration engine**

### Subhead
A closed-loop system where members plan their week, execute daily, reflect on results, and adapt — powered by breath-test metabolic data and coach-guided interventions.

### The System
Invoy's Check-in Flow is not a single feature — it's a behavioral loop that runs weekly:

**Plan** → Members set weekly intentions. The system asks about upcoming events (travel, holidays, social meals) and adapts the plan: Busy Week triggers Suggested Accelerants. A planned splurge activates the Cheat & Rebound flow. A base week generates the standard nutrition plan.

**Execute** → Daily check-ins collect breath scores, feelings, events, and plan adherence. Each day's data feeds the triage engine — score drops trigger coach escalation, score increases trigger celebration and reinforcement.

**Reflect** → "A Look at Your Week" synthesizes 7 days of data into weight change, plan completion rates, fat burn trends, and an AI-generated summary. The weekly activity matrix shows Check In, Base Plan, Events, Splurge & Rebound, and Accelerants across each day.

**Adapt** → Trends & Changes surfaces multi-week patterns (energy, hunger, cravings, sleep) and feeds them back into the next week's plan. The coach uses the analyst portal to identify intervention points.

### Why This Matters for CPQ
This is configuration logic applied to human behavior. The "products" are interventions (nutrition plans, accelerants, coaching calls). The "pricing" is metabolic data (breath scores, weight trends). The "quote" is a personalized weekly plan that adapts based on real-time data. The structural pattern — configure → execute → measure → reconfigure — is identical to what Roadrunner is building for sales workflows.

### Key Design Decisions

**5 flow variants from one entry point.** Week Planning branches into Base Flow, Busy Week + Suggested Accelerants, Cheat & Rebound, Edit Base Plan, and Edit Accelerants — all documented with orange annotation cards explaining the branching logic. One question ("Tell us about upcoming events this week") routes the member into the right configuration path.

**Data density without cognitive overload.** The Review of Week screen shows weight delta, 3 plan progress bars, an AI-generated natural language summary, a 7-day sparkline chart, and a 5×7 activity dot matrix — all on one scrollable mobile screen. Every data point is glanceable; nothing requires interpretation.

**Rebound as a first-class flow.** Most health apps treat plan deviations as failures. Invoy designed Rebound as its own state machine: Starting Rebound → Positive/Neutral/Negative Progress → Rebound Complete. Score drops show "What we know," "Possible Causes," and actionable next steps (Schedule a Coach Call, Add Fasting Boost). This normalizes deviation and keeps members engaged.

### Shipped at Scale
This system shipped as part of Livongo's metabolic health product, serving members through the Teladoc Health platform. The component library (30 components) and page template system enabled a small design team to ship across 15+ distinct sub-flows with consistent quality.

---

## 3. INVOY — Design System

### Headline
**Invoy CIF Design System: Governance, not just components**

### Subhead
A 30-component mobile design system built for a behavior change product — where the rules for when and why each component is used matter more than the components themselves.

### The System

**Foundations**
- **Color**: Semantic token system — colorPrimary (#477e63, sage green), colorTertiary (#5C7FB3), functional colors (Success, Error, Warning, Info), state colors (Active, Focus, Down, Disabled). Built on the Invoy Design System with explicit extension guidance.
- **Typography**: San Francisco by Apple. 4 type categories (Headline, Body, Label, Display) × 3 sizes each. UI copy rules documented: "Down style headlines & buttons. Punctuation on sentences. No punctuation elsewhere."
- **Spacing**: Base-4 scale (xs-12, s-16, m-24, L-32, XL-48, XXL-72).
- **Icons**: Curated set for clinical/health context.

**Components**
- **ActionBlock**: The primary CTA pattern — 3 fill states (primary dark, secondary, accent yellow) + ghost text variant. Governs every screen's bottom action area.
- **Selection Controls**: Radio-style rows with green check + highlight on selection. Used for single-choice questions throughout the check-in flow.
- **Text Inputs**: Single-line (4 states) and textarea (4 states + word count + character limit). Error states with orange border + supporting text.
- **Chip Entry**: Multi-select input with inline chips, dismissible tags, suggestion row, and error state. Used for food logging, event tagging, and symptom capture.
- **Navigation**: Status bar (analyzing/ready states with score badge), header (back/title/close), page base templates.
- **Page Templates**: Page/Title (intro screens), Page/Questions (data capture), Page/Breathscore (score display). These templates enforce layout consistency across 15+ sub-flows.

### Governance Layer
The design system isn't just a component library — it's a decision framework:

- **When to use Page/Title vs Page/Questions**: Title pages are entry points with context-setting copy. Questions pages capture data. This distinction governs flow architecture.
- **ActionBlock hierarchy**: Primary (dark fill) = single forward action. Secondary (light fill) = alternative path. Ghost (text only) = dismissable option ("Remind Me Later"). This hierarchy is consistent across every screen.
- **Score state → component mapping**: Breath score values map to specific triage component combinations. Score drop → amber card + "What we know" summary + coach CTA. Score increase → green celebration card + reinforcement copy. This mapping is documented, not improvised.

---

## 4. TODAY'S WORKFLOW — Designing with AI

### Headline
**How I work: Design systems as the API between human intent and AI execution**

### Subhead
A solo designer's toolkit for scaling across 5+ products — where the design system is simultaneously the source of truth, the constraint engine, and the AI's instruction set.

### The Stack

**Design System (ctrl.rodeo)**
The CTRL Design System is CSS-first: tokens.css defines the vocabulary, components.css defines the grammar, widgets.css defines the AI-specific patterns. Dark-first, monospace-forward, high-contrast. Used across Boards, Events, Soundscape, Systemic, and Favicon.

The design system isn't a Figma library — it's executable code. When I need a new component, I write it in CSS, run `node scripts/parse-design-system.js` to regenerate the manifest, and the constraint engine picks it up automatically. No sync step. No handoff document.

**Systemic (Design System Auditor)**
Systemic is a tool I built to reverse-engineer and audit design systems. Point it at any URL → it crawls the CSS → extracts tokens (colors, type, spacing) → maps them to Material Design 3 semantics → generates documentation. For the CTRL Design System, it runs as a QA frontend with stoplight-based variant auditing: Green = approved, Yellow = needs dev action, Orange = needs review, Red = blocked.

This is the governance layer. When a new widget template is added, Systemic audits it against the constraint manifest — checking sizes, component modifiers, template structure. Violations are logged, not silently accepted.

**AI Widget Framework**
The CTRL Design System includes 11 body templates for AI-powered content (verdict, list, spectrum, split, narrative, suggestion, stats, comparison, choices, checklist, grouped). Each template has defined atoms (w-text, w-badge, w-btn, w-img) and molecules (w-headline, w-tag-group, w-row, w-stat). Claude Haiku generates content constrained to these templates — the AI outputs structured data, the design system renders it.

**Claude Code as Design Partner**
I use Claude Code for: writing components, generating page layouts, building features, running tests, deploying. The design system tokens give Claude a shared vocabulary — I say "use --accent-cyan on the focus ring" and we're referencing the same value. The CLAUDE.md file in the repo gives Claude the full context: brand principles, code style, version conventions, deployment commands.

### The Workflow
```
Intent → Design System Tokens → Claude Code generates code →
Systemic audits compliance → Runtime constraint engine validates →
Ship
```

### Why This Matters
Roadrunner needs one designer who can hold the design vision and scale output. This workflow is the proof: 5 products, one person, consistent quality. The design system isn't documentation — it's the API between my intent and the AI's execution.

---

## 5. LIVONGO — Product Configuration (Bonus)

### Headline
**From spreadsheet to system: Taming 3,700 configuration decisions at Livongo**

### Subhead
How a 50×74 configuration matrix became a streamlined registration experience — and why this is the same problem Roadrunner is solving.

### The Problem
Livongo offered 5 health programs — Diabetes (DBT), Hypertension (HTN), Weight Management (WM), Diabetes Prevention (DPP), and Behavioral Health (BH) — sold as standalone products or bundled into "Whole Person" solutions. Each client purchased a different combination. Each combination changed which registration fields were shown, required, or hidden.

The configuration lived in a spreadsheet: 50 client configurations × 74 registration fields = 3,700 decision points. Operations managed this manually. New client onboarding required cross-referencing dozens of field visibility rules, qualification criteria, eligibility checks, and billing types.

### The Architecture
Three layers of the system needed to work together:

**Salesforce Configuration** — Sales reps configured client deals in Salesforce CPQ. Program bundles, pricing tiers, enrollment caps, and eligibility rules were captured at deal close.

**API Translation Layer** — Configuration data flowed from Salesforce through internal APIs that resolved: Which programs is this member eligible for? What fields does their employer require? What data can we pre-populate from HR records, health records, or carrier data?

**Registration Experience** — The member-facing registration flow adapted per-client configuration. For a standalone DBT client: 9 steps, all manual entry. For a Whole Person bundle with pre-registration data: 6 steps, 57% of fields pre-populated.

### The Optimization
The original registration required members to manually enter all 35 fields across 9 steps. By resolving member data from three upstream sources (Employer HR, Health Records, Carrier data) before the first screen loaded, the optimized flow:

- **Sourced 57% of fields** from existing data
- **Reduced steps from 9 to 6** (33% fewer)
- **Saved ~5 minutes** per registration
- Shifted the UX from **data entry to data confirmation** — recognition instead of recall

### The Roadrunner Parallel
This is structurally identical to CPQ:
- **Configure**: Client purchases a product bundle (programs = SKUs)
- **Price**: Qualification criteria determine eligibility (pricing rules = field visibility rules)
- **Quote**: The registration flow is the "quote" — a personalized experience generated from configuration data

The spreadsheet that governed Livongo's registration is the same kind of artifact that Salesforce CPQ generates today — and the same kind of artifact Roadrunner is replacing. The design challenge is identical: surface the right fields, in the right order, with the right defaults, for a configuration that might be one of thousands of possible combinations.

---

## Portfolio Shell Copy

### Hero Section
**Ian Fike** — Product Designer

I design systems that tame configuration complexity — and I use AI to do it at the speed of a solo designer.

Currently building Field (AI clinical documentation) and ctrl.rodeo (AI-powered curation platform). Previously Livongo/Teladoc Health, where I designed the behavioral coaching system serving members across 5 health programs.

### Navigation Labels
1. Field
2. Weekly Lifecycle
3. Design System
4. Workflow
5. Configuration (Bonus)
