# Plan: Onboarding Prototype Redesign

## Context

These are interactive HTML prototypes of Livongo's health app onboarding flow, used as a UX case study / portfolio presentation. Three files: `index.html` (comparison page), `prereg.html` (optimized flow), `standard.html` (baseline flow). The previous session built v1 and pushed design improvements. Now we're doing a major content and design pass.

**Problem:** The current prototypes use confusing terminology ("Standard" / "Pre-Reg"), bury the impact data, have noisy per-field source attribution pills, and include fields/steps that should be restructured for trust and cost-to-value alignment.

**Goal:** Restructure content, improve terminology, redesign source attribution, and reorganize the optimized flow's step sequence.

---

## Key Decisions

### Terminology
- **"Standard Flow" → "Original Flow"** / **"Pre-Registration Flow" → "Optimized Flow"**
- **"Registration" → "Onboarding"** throughout
- Rationale: "Original" vs "Optimized" emphasizes the improvement angle for a portfolio/case study audience.

### Source Attribution Redesign
- **Remove verbose per-field text pills** (the `source-pill` text labels under every input and `source-pill-inline` text inside radio/checkbox cards)
- **Replace with three layers:**
  1. **Section-level source banner** at top of each step — tells the data story once
  2. **Colored left-border accent** (`3px`) on pre-filled inputs — marks which fields are pre-loaded
  3. **Small icon indicator** on pre-filled fields — a small colored dot or source icon (🏢/🏥) positioned at the label level or input corner for at-a-glance identification without text noise
- Pre-filled input styling (`#f9fbff` background, `#b3d4f5` border) already provides visual distinction
- Pre-selected radio/checkbox cards keep `.preselected` blue tint + get a small source icon instead of the text pill

### Optimized Flow Step Reorder
Current prereg.html: Confirm Identity → Shipping → Care Plan → Health Profile → Welcome
New structure: **Confirm Identity → Care Plan → Health Profile → Shipping → Welcome**
- Shipping moves later (address is less critical early — get health data first)
- Coaching & Alerts is **removed entirely** (moved to on-device onboarding — better cost-to-value moment)

### standard.html
- **No visual/structural changes** beyond title rename — preserves it as the baseline for comparison
- Keeps coaching/alerts step, coverage search, etc. as-is to show the "before" state

---

## Implementation Plan

### Phase 1 — index.html Terminology & Structure

**1.1 Rename all terminology**
- `<title>`: "Onboarding Flow Comparison — Livongo"
- Header title: "Onboarding Flow Comparison"
- Header subtitle: "Original Flow vs. Optimized Flow: Reducing friction through upstream data"
- Flow card titles: "Original Flow" (blue) / "Optimized Flow" (green)
- Buttons: "View Current Flow →" / "View Optimized Flow →"
- Table column: "Optimized Flow" (not "Pre-Reg Flow")
- All section text: replace "pre-registration", "pre-reg", "registration" with appropriate alternatives
- Architecture title: "How the Optimized Flow Works"
- Insight titles: "What the Redesign Changes"

**1.2 Move stats row to top of page**
- Cut `.stats-row` from current position (after flow comparison)
- Place immediately after `<main>` opens, before the flow comparison section
- Add section label "Impact at a Glance" above it
- Update stats to reflect new field counts after Phase 3 changes

**1.3 Change header to white**
- `.site-header`: `background: #ffffff`, `box-shadow: 0 1px 0 0 #e0e0e0`
- `.header-title`: `color: var(--gray-900)`
- `.header-subtitle`: `color: var(--gray-500)`
- `.header-divider`: `background: var(--gray-300)`
- SVG logo text: `fill="#333"` (currently white)

**1.4 Change "Skipped" color to yellow**
- `.status-chip--black` → yellow treatment: `background: var(--yellow-light); color: #856000`
- `.source-pill--eliminated` → same yellow treatment
- Skipped badges in flow card: use `badge--yellow`
- Step number circles for skipped steps: yellow instead of red
- Update status legend

**1.5 Update Optimized flow card steps**
- Remove Coaching & Alerts step (step 7) from the pre-reg card
- Reorder: steps 1, 2, 6, 8, 9 → renumber as 1-5
- New step order in card: Confirm Identity → Care Plan → Health Profile → Shipping → Welcome
- Update badge to "5 Steps" and savings to "−4 Steps"
- Update step subtitles to reflect new content

**1.6 Make field table filterable**
- Add `data-status` attribute to every `<tr>` (confirm/user/skipped/partial)
- Add filter bar with pill buttons: All, Confirm, User Enters, Skipped, Partial
- JS: click handler filters rows by `data-status`, toggles group header visibility
- CSS: pill button styles with active state

**1.7 Update field table for product changes**
- First Name, Last Name, DOB → change to "User enters" status, source = "User Enters", notes = "Identity confirmation"
- Phone Type → remove row entirely
- Language → update notes to "Footer selection — defaults English"
- Coaching Thresholds, Contact Method → mark as "Skipped" (moved to device onboarding)
- Update field count header and stats to match new totals
- Update filter button counts

### Phase 2 — prereg.html Product Changes

**2.1 Make First Name, Last Name, DOB user-entered**
- Remove `value` attributes, remove `.prefilled` class, add placeholders
- Remove source pills from these fields
- Update welcome card: remove "Name, DOB" from employer source list, change greeting from "Welcome back, Steve" → "Welcome to Livongo"
- Add annotation below DOB field: "We ask you to enter your name and date of birth to confirm your identity"
- Keep Email pre-filled from employer (trust is established after identity confirmation)

**2.2 Remove Phone Type field**
- Delete the Phone Type `<div class="form-group">` from Step 1
- Make phone number field full-width (`form-row single`)
- Backend validation only — not surfaced to user

**2.3 Demote Language to footer**
- Remove Language `<select>` from Step 1 form
- Add "Language: English" link to all step footers
- Add language selection modal (English / Español) with simple JS open/close
- DOB field becomes full-width in its row

**2.4 Remove Coaching & Alerts step entirely**
- Delete `data-step="4"` (or whichever step is coaching) from HTML
- This step had: BG threshold sliders, coach contact method, coaching opt-out
- Rationale: moved to on-device onboarding for better cost-to-value timing
- Update `totalSteps` in JS
- Renumber remaining steps

**2.5 Reorder steps: move Shipping later**
- New step order:
  1. Confirm Identity (was step 1)
  2. Care Plan (was step 3)
  3. Health Profile (was step 4)
  4. Shipping & Supplies (was step 2)
  5. Welcome (was step 5)
- Update `data-step` attributes on all step divs
- Update all `goTo()` calls in button `onclick` handlers
- Update progress bar / step counter text
- Update "Next: ..." button labels to reflect new sequence
- Move the coverage-verified banner to appear somewhere contextually appropriate (perhaps Care Plan intro, since coverage is what enables the health data access)

**2.6 Redesign source attribution**
- **Remove all text-based per-field pills:** delete every `<span class="source-pill ...">From employer</span>` under inputs and every `<span class="source-pill-inline ...">From health records</span>` inside cards
- **Layer 1 — Section banners** at top of steps with pre-filled data:
  - Step 1: "🏢 Your email was pre-loaded from Pilot Trucking LLC. Enter your name and date of birth to confirm your identity."
  - Step 2 (Care Plan): "🏥 Your diabetes history was pre-loaded from health plan records. Review each item and correct anything that's changed."
  - Step 3 (Health Profile): "🏥 Your clinical data was pre-loaded from health records. Update anything that may have changed."
  - Step 4 (Shipping): "🏢 Your address was pre-loaded from employer records. Confirm or update for kit delivery."
- **Layer 2 — Left-border accent** on pre-filled inputs: `border-left: 3px solid #1976D2` on `.field-wrap.prefilled`
- **Layer 3 — Small source icons** on pre-filled fields: a compact colored dot or emoji icon (🏢 for employer, 🏥 for health records) positioned inline with the field label. CSS: `font-size: 12px; opacity: 0.7; margin-left: 4px` — visible but not dominant. For radio/checkbox cards, the icon replaces the removed text pill in the same position (right-aligned, small). Example:
  ```html
  <label>Legal Email <span class="req">*</span> <span class="source-icon source-icon--employer">🏢</span></label>
  ```
  For cards:
  ```html
  <label class="radio-card preselected selected">
    <input type="radio" ...> Male <span class="source-icon source-icon--employer">🏢</span>
  </label>
  ```
- New CSS:
  ```css
  .source-icon { font-size: 12px; opacity: 0.6; margin-left: 4px; }
  .source-icon--employer { /* blue context — uses 🏢 emoji */ }
  .source-icon--records  { /* teal context — uses 🏥 emoji */ }
  ```

**2.7 Redesign Welcome screen (final step)**
- Current: bare green hero banner with checkmark + "Go to Dashboard" button + webinar list
- New design — a forward-looking "what's next" page with three sections:
  1. **Success hero** (keep green, but add app preview context): "You're all set, Steve!" + "Your Welcome Kit is on its way — expect it in 5–7 business days."
  2. **What's next cards** (3-column grid):
     - **📱 Download the App** — "Track readings, set goals, and get personalized tips. Your health data syncs automatically from your meter." + app store badges
     - **👤 Meet Your Coach** — "A dedicated certified health coach will reach out within 48 hours. They'll help with diet, exercise, medication, motivation, and mental health." + "Available in English and Spanish"
     - **📦 Set Up Your Kit** — "When your Welcome Kit arrives: unbox your meter, download the app, and take your first reading. Your coach will help you get started."
  3. **Quick stats** (optional motivational): "Members using Livongo see: 48% reduced diabetes incidence, 15mmHg blood pressure reduction"
- Remove the webinar list (outdated mock data with hardcoded dates)
- Keep "Go to Dashboard" button but restyle as secondary action
- This gives the Welcome screen purpose: it sells the user on what comes next rather than just saying "done"

**2.8 Step transition animations**
- Add fade-out/fade-in on step changes (~300ms total)
- JS approach: on `goTo()`, fade out current step (opacity 0, translateY -8px over 150ms), then after timeout switch `.active` class and let new step fade in via CSS animation
- CSS: `@keyframes stepFadeIn { from { opacity:0; translateY(12px) } to { opacity:1; translateY(0) } }`
- Smooth scroll to top: `window.scrollTo({ top: 0, behavior: 'smooth' })`

**2.9 Field design improvements**
- Better focus ring: `box-shadow: 0 0 0 3px rgba(25,118,210,0.15)` on focus
- Uppercase labels with tighter letter-spacing (11px, 600 weight, 0.04em)
- Minimum 48px touch target on mobile for inputs, buttons, cards
- Success state on pre-filled fields: green left border after user confirms/interacts
- No floating labels (too complex for prototype, marginal benefit)

### Phase 3 — standard.html Minimal Update

**3.1 Rename page title only**
- `<title>`: "Livongo — Original Onboarding Flow"
- No other changes — standard.html stays as-is to preserve the baseline

---

## File Inventory

| File | Changes |
|------|---------|
| `registration-flows/index.html` | Terminology, header, stats position, yellow skipped, filter table, field table updates, flow card reorder |
| `registration-flows/prereg.html` | Field changes, step reorder, coaching removal, source redesign, animations, field design |
| `registration-flows/standard.html` | Title rename only |

---

## Verification

1. Open `index.html` — verify white header, stats at top, "Current/Optimized" terminology, yellow skipped badges, filter buttons work on field table
2. Open `prereg.html` — verify new 5-step flow order (Identity → Care Plan → Health Profile → Shipping → Welcome)
3. Verify First Name/Last Name/DOB are blank with identity confirmation annotation
4. Verify Phone Type is gone, Language is in footer
5. Verify Coaching & Alerts step is gone
6. Verify no per-field source pills — section banners and left-border accents instead
7. Verify step transitions animate (fade in/out)
8. Verify field table filter buttons show/hide correct rows
9. Test arrow key navigation in prereg.html
10. Test mobile viewport on all pages
