# PRD: Intent Engine

**Version:** 1.0
**Date:** 2026-03-11
**Status:** Draft
**Depends on:** [Taste Engine PRD](./taste-engine.md)

---

## Overview

The Taste Engine knows *who you are*. The Intent Engine predicts *what you're doing next*.

Taste is stable — it shifts over months. Intent is dynamic — it shifts over hours. The taste engine aggregates upward from item signals to a durable aesthetic identity. The intent engine aggregates forward from item signals to active goals and predicted next actions.

ctrl.rodeo already captures per-pin intent (`pin_intent`: acquire/reference/appreciate + action_state + horizon). But this is flat — a bag of labeled pins with no temporal awareness, no journey detection, and no predictive capability. A user who saves 5 mid-century desks in one afternoon is clearly shopping for a desk, but the system doesn't know that. It sees 5 independent pins.

The Intent Engine adds the layers above pin-level intent:
- **Sessions** — temporal clusters of saves that represent a single activity burst
- **Journeys** — multi-session arcs that connect related activity across days or weeks toward a goal
- **Hypotheses** — LLM-generated natural-language predictions about what the user is trying to accomplish
- **Predictions** — actionable next-step suggestions derived from active journeys × taste profile

This is not a user-facing feature. Like the taste engine, it's infrastructure that other features consume: widgets become goal-aware, event recommendations match urgency, nudges resurface forgotten intentions, and the MCP connector can tell external tools what the user is actively working toward.

---

## Why Now

1. **The atomic data exists.** `pin_intent` captures intent/action_state/horizon per pin. `analyze-content` classifies content_type and content_structure. The signals are there — they're just not connected temporally.

2. **Taste without intent is half the picture.** The taste engine tells widgets "this user likes minimalist Scandinavian design." But it can't distinguish "show me inspiration" from "help me furnish my apartment this weekend." Every feature that generates recommendations needs both dimensions.

3. **Save timestamps are an untapped gold mine.** The `created_at` field on every pin encodes behavioral intent that no AI call is needed to extract. Temporal clustering is pure signal, zero cost.

4. **The industry pattern is established.** Pinterest's "shopping journeys," Spotify's "listening sessions," Google's "search journeys" — the concept of detecting multi-step user goals from sequential signals is well-proven at scale. Our version is simpler (hundreds of pins, not billions of queries) but the architecture translates directly.

---

## Goals

1. **Detect active user goals** from temporal and topical patterns in pin saves
2. **Predict next actions** by cross-referencing journey state with taste profile
3. **Track journey lifecycle** from exploration through completion or abandonment
4. **Produce LLM-injectable context** so every Claude call can be intent-aware alongside taste-aware
5. **Enable proactive features** — nudges, smart suggestions, stale-journey resurfacing — without requiring user configuration

---

## Who This Serves

The Intent Engine is infrastructure. Every persona benefits through the features it powers.

| Persona | What the Engine Enables |
|---------|------------------------|
| **The Visual Collector** | System recognizes when browsing shifts to active shopping and adjusts recommendations accordingly |
| **The DJ** | Playlist-building sessions detected — surfaces forgotten saves from past listening sessions |
| **The Cultural Omnivore** | Cross-domain journeys recognized — "you're planning a Japan trip" connects food, architecture, and travel pins |
| **The Researcher** | Deep-dive research sessions preserved as coherent journeys, not scattered pins |
| **The Deep-Dive Enthusiast** | Journey progression tracked — system knows when you've moved from "exploring" to "deciding" |
| **The Multidisciplinary Maker** | Project-oriented saving patterns detected and surfaced as actionable intent clusters |

### Jobs To Be Done

| When I... | I want the system to... | So I can... |
|-----------|------------------------|-------------|
| Save 5 related pins in an hour | Recognize I'm actively researching something specific | Get relevant suggestions without explaining my goal |
| Return to a topic after days away | Remember what I was working toward and where I left off | Pick up without reconstructing my mental state |
| Have stale "now" pins I forgot about | Nudge me about them at the right time | Follow through on intentions instead of letting them decay |
| Ask a widget for recommendations | Get answers calibrated to my current goal, not just my taste | Receive "you're shopping for a desk — here are 3 options" not "here's some furniture inspiration" |
| Finish a project or purchase | Have the system notice and mark the journey complete | Keep my active workspace clean without manual archiving |

---

## Design Principles

| Brand Principle | Application |
|-----------------|-------------|
| **Input shapes output** | Your save patterns — timing, clustering, topic drift — shape what the system predicts you'll do next |
| **Organize as you go** | Journeys form automatically from natural saving behavior. No manual project creation required |
| **One place, whole life** | Journeys can span categories. "Planning a dinner party" touches eat, listen, home — the engine connects them |
| **Show, don't decorate** | Journey hypotheses are transparent and correctable. Users can see and override what the system thinks they're doing |
| **Expand with the user** | Starts with simple session detection. Grows into predictive journey mapping as the collection deepens |

---

## The Intent Model

### Relationship to Taste

Taste and intent are orthogonal dimensions. Every pin has a position in both spaces:

```
                    TASTE (who you are)
                    ┌─────────────────────────┐
                    │ Warm Scandinavian        │
                    │ Minimalism               │
                    │                          │
     INTENT         │   [desk pin]  [lamp pin] │
  (what you're      │                          │
   doing next)      │        [chair pin]       │
                    │                          │
  acquire ──────────│──────── ✦ ───────────────│── "furnishing office"
  reference ────────│────────────── ✦ ─────────│── "design reference"
  appreciate ───────│─── ✦ ────────────────────│── "just vibes"
                    │                          │
                    └─────────────────────────┘
```

The taste engine asks: "What aesthetic identity connects these pins?"
The intent engine asks: "What goal connects these pins, and what happens next?"

Combined: "You're furnishing your office in your Warm Scandinavian Minimalism style — here are desks that match."

### Level Architecture

The intent engine models behavior at four levels (L2-L5), building on the existing L1 (`pin_intent`). Each level is derived from the level below it. L2-L3 are purely algorithmic. L4-L5 use LLM synthesis.

```
Level 5: Predictions        "You need a desk lamp — here are 3 that match your style"
  ^                         HOW: Journey state × taste profile × gap analysis
  |                         WHAT: Actionable next-step suggestions. Per active journey.
  |                         Used by: widgets, nudges, smart boards, MCP connector
  |
Level 4: Hypotheses         "Furnishing a home office — mid-century, under $2k"
  ^                         HOW: LLM synthesis of journey context (pins, timing, taste)
  |                         WHAT: Natural-language goal statement + confidence. Per journey.
  |                         Used by: LLM prompt conditioning, journey display, connector
  |
Level 3: Journeys           { topic: "office_furniture", state: "deciding", sessions: 4 }
  ^                         HOW: Algorithmic — link sessions by topic overlap across time
  |                         WHAT: Multi-session arcs with lifecycle state.
  |                         Used by: journey tracking, stale detection, nudges
  |
Level 2: Sessions           { pins: [5 items], topic: "desks", intent: "acquire", duration: 45min }
  ^                         HOW: Algorithmic — temporal clustering of pins
  |                         WHAT: Bounded activity bursts with dominant intent.
  |                         Used by: session history, journey construction, analytics
  |
Level 1: Pin Intent         { intent: "acquire", action_state: "active", horizon: "soon" }
                            HOW: Already exists — inferIntent() in taste-engine
                            WHAT: Per-pin intent/action_state/horizon
                            Used by: everything above
```

### What Each Level Actually Is

**Level 1 (Pin Intent)** is the raw material. Already exists in `pin_intent`. Each pin gets an intent (acquire/reference/appreciate), action_state (unprocessed/active/done/archived), and horizon (now/soon/someday/ongoing). Inferred algorithmically from content_type and content_structure. User can override (confidence >= 0.7 = user-set).

**Level 2 (Sessions)** answers "what was the user doing in this activity burst?" Sessions are temporal clusters — pins saved within a configurable time window (default: 60 minutes between consecutive saves). Each session has:
- A dominant topic (most frequent practical_tags)
- A dominant intent (most frequent pin intent)
- Momentum direction: narrowing (converging on specifics) or broadening (exploring a space)
- Duration and pin count

Sessions are the smallest unit of behavioral intent. A single pin is noise. A cluster of 3+ related pins in 45 minutes is a signal.

**Level 3 (Journeys)** answers "what is the user working toward over days/weeks?" Journeys connect sessions that share topic overlap across time. A journey has a lifecycle:

```
exploring → researching → deciding → acquiring → done
    │            │            │           │         │
    │            │            │           │         └─ All acquire pins → done
    │            │            │           └─ Intent shifts to acquire + now
    │            │            └─ Sessions narrow (fewer unique tags per session)
    │            └─ Multiple sessions on same topic, reference intent dominant
    └─ First session on a new topic cluster
```

The state machine is heuristic, not rigid. Transitions are detected from:
- **Intent distribution shift:** reference → acquire means researching → deciding
- **Horizon compression:** someday → soon → now means the goal is crystallizing
- **Topic narrowing:** session tag diversity decreasing means convergence
- **Action state progression:** unprocessed → active → done across pins in the journey
- **Temporal gaps:** > 30 days without a related session → journey goes dormant (not dead)

**Level 4 (Hypotheses)** generates a human-readable goal statement for each active journey. The LLM sees journey context — all constituent pins, their tags, their timing, plus the user's relevant taste domains — and produces:
- A natural-language goal: "Furnishing a home office — mid-century aesthetic, budget-conscious"
- Confidence level
- Key evidence (which pins/patterns support this hypothesis)
- Predicted completion signals (what would "done" look like?)

Hypotheses are regenerated when a journey's session count changes or when the lifecycle state transitions.

**Level 5 (Predictions)** cross-references active journeys with the taste profile to produce actionable suggestions:
- **Gap analysis:** "You've saved 4 desks and 3 chairs but no lighting" — surface categories the user hasn't covered yet
- **Style-matched recommendations:** "Based on your Warm Scandinavian Minimalism profile, here are desk lamps that fit"
- **Timing nudges:** "You saved 3 restaurants in Williamsburg last week — going this weekend?"
- **Stale resurfacing:** "You were researching turntables 3 weeks ago — still interested?"
- **Completion signals:** "You've marked 4 of 5 office furniture items as 'done' — journey almost complete"

---

## Data Schema

### Core Tables

```sql
-- ============================================================
-- intent_sessions: Level 2 — temporal activity clusters
-- A session is a bounded burst of saving activity.
-- Sessions are immutable once computed — they represent
-- a historical activity window, not a live state.
-- ============================================================
CREATE TABLE intent_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  started_at TIMESTAMPTZ NOT NULL,           -- first pin's created_at
  ended_at TIMESTAMPTZ NOT NULL,             -- last pin's created_at
  pin_count INTEGER NOT NULL DEFAULT 1,
  pin_ids TEXT[] NOT NULL DEFAULT '{}',       -- link IDs in this session
  dominant_intent TEXT NOT NULL DEFAULT 'appreciate'
    CHECK (dominant_intent IN ('acquire', 'reference', 'appreciate')),
  dominant_topics TEXT[] DEFAULT '{}',        -- top practical_tags
  dominant_taste_tags TEXT[] DEFAULT '{}',    -- top taste_tags
  topic_diversity REAL DEFAULT 0.0,          -- 0=focused, 1=broad (unique tags / total tags)
  momentum TEXT DEFAULT 'exploring'
    CHECK (momentum IN ('broadening', 'steady', 'narrowing')),
  journey_id UUID,                           -- FK to intent_journeys, set when claimed
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_sessions_user ON intent_sessions(user_id);
CREATE INDEX idx_sessions_time ON intent_sessions(user_id, started_at DESC);
CREATE INDEX idx_sessions_journey ON intent_sessions(journey_id);

-- ============================================================
-- intent_journeys: Level 3 — multi-session goal arcs
-- A journey connects sessions that share topic overlap.
-- Journeys are mutable — they grow as new sessions attach
-- and their lifecycle state evolves.
-- ============================================================
CREATE TABLE intent_journeys (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  state TEXT NOT NULL DEFAULT 'exploring'
    CHECK (state IN ('exploring', 'researching', 'deciding', 'acquiring', 'done', 'dormant', 'abandoned')),
  core_topics TEXT[] NOT NULL DEFAULT '{}',   -- the topic cluster that defines this journey
  core_taste_tags TEXT[] DEFAULT '{}',        -- aesthetic tags associated with this journey
  taste_domain_ids UUID[] DEFAULT '{}',       -- which taste domains this journey intersects
  session_count INTEGER NOT NULL DEFAULT 1,
  pin_count INTEGER NOT NULL DEFAULT 0,
  intent_distribution JSONB DEFAULT '{}',     -- { "acquire": 0.4, "reference": 0.5, "appreciate": 0.1 }
  horizon_distribution JSONB DEFAULT '{}',    -- { "now": 0.2, "soon": 0.5, "someday": 0.3 }
  first_session_at TIMESTAMPTZ NOT NULL,
  last_session_at TIMESTAMPTZ NOT NULL,
  dormant_since TIMESTAMPTZ,                  -- set when >30 days since last session
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_journeys_user ON intent_journeys(user_id);
CREATE INDEX idx_journeys_state ON intent_journeys(user_id, state);
CREATE INDEX idx_journeys_active ON intent_journeys(user_id, state)
  WHERE state NOT IN ('done', 'abandoned');

-- ============================================================
-- intent_hypotheses: Level 4 — LLM-generated goal predictions
-- One hypothesis per active journey. Regenerated on state
-- transitions or significant new sessions.
-- ============================================================
CREATE TABLE intent_hypotheses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  journey_id UUID NOT NULL REFERENCES intent_journeys(id) ON DELETE CASCADE,
  hypothesis TEXT NOT NULL,                   -- "Furnishing a home office — mid-century, under $2k"
  confidence REAL NOT NULL DEFAULT 0.5,
  evidence JSONB DEFAULT '{}',               -- { "key_pins": [...], "patterns": [...] }
  completion_signals TEXT[] DEFAULT '{}',     -- predicted "done" indicators
  predicted_next_actions TEXT[] DEFAULT '{}', -- what the user likely needs next
  model_version TEXT,
  generated_at TIMESTAMPTZ DEFAULT NOW(),
  expires_at TIMESTAMPTZ,                    -- 14-day TTL, regenerated on journey update
  UNIQUE(journey_id)                         -- one active hypothesis per journey
);

CREATE INDEX idx_hypotheses_user ON intent_hypotheses(user_id);
CREATE INDEX idx_hypotheses_journey ON intent_hypotheses(journey_id);

-- ============================================================
-- intent_predictions: Level 5 — actionable next-step suggestions
-- Generated per journey, consumed by widgets/nudges/connector.
-- Short-lived — regenerated frequently as journeys evolve.
-- ============================================================
CREATE TABLE intent_predictions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  journey_id UUID REFERENCES intent_journeys(id) ON DELETE CASCADE,  -- NULL = global prediction
  prediction_type TEXT NOT NULL
    CHECK (prediction_type IN ('gap', 'recommendation', 'nudge', 'completion', 'resurface')),
  content TEXT NOT NULL,                      -- "You've saved 4 desks but no lighting"
  action_url TEXT,                            -- deep link to relevant view
  priority REAL NOT NULL DEFAULT 0.5,         -- 0-1, higher = more urgent
  dismissed BOOLEAN DEFAULT false,
  acted_on BOOLEAN DEFAULT false,
  generated_at TIMESTAMPTZ DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL,            -- short TTL: 7 days
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_predictions_user ON intent_predictions(user_id);
CREATE INDEX idx_predictions_active ON intent_predictions(user_id, dismissed, acted_on)
  WHERE dismissed = false AND acted_on = false;

-- ============================================================
-- intent_snapshots: Periodic state for journey drift detection
-- ============================================================
CREATE TABLE intent_snapshots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  snapshot_date DATE NOT NULL DEFAULT CURRENT_DATE,
  active_journeys JSONB NOT NULL,             -- current journey states and topics
  session_count_30d INTEGER NOT NULL,         -- sessions in last 30 days
  dominant_intent_30d TEXT,                    -- overall intent trend
  pin_count INTEGER NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, snapshot_date)
);

-- RLS
ALTER TABLE intent_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE intent_journeys ENABLE ROW LEVEL SECURITY;
ALTER TABLE intent_hypotheses ENABLE ROW LEVEL SECURITY;
ALTER TABLE intent_predictions ENABLE ROW LEVEL SECURITY;
ALTER TABLE intent_snapshots ENABLE ROW LEVEL SECURITY;

CREATE POLICY intent_sessions_user ON intent_sessions FOR ALL USING (auth.uid() = user_id);
CREATE POLICY intent_journeys_user ON intent_journeys FOR ALL USING (auth.uid() = user_id);
CREATE POLICY intent_hypotheses_user ON intent_hypotheses FOR ALL USING (auth.uid() = user_id);
CREATE POLICY intent_predictions_user ON intent_predictions FOR ALL USING (auth.uid() = user_id);
CREATE POLICY intent_snapshots_user ON intent_snapshots FOR ALL USING (auth.uid() = user_id);
```

### Schema Design Decisions

**Why separate from taste engine tables?** Taste is about stable identity (slow-moving). Intent is about active goals (fast-moving). Different update cadences, different TTLs, different query patterns. Coupling them would mean over-refreshing taste data when intent changes or under-refreshing intent data when using taste's cadence.

**Why `intent_sessions` stores `pin_ids` as an array instead of a junction table?** Sessions are immutable historical records. We never need to query "which sessions contain pin X" — we need to query "what pins are in session Y." An array is simpler, faster for that access pattern, and avoids a junction table that would grow linearly with total saves.

**Why `intent_distribution` on journeys is JSONB, not separate columns?** The distribution shifts constantly as new sessions attach. JSONB allows atomic upsert of the full distribution without schema changes if we add new intent types later.

**Why predictions have short TTLs (7 days)?** Predictions are perishable. "You need a desk lamp" is irrelevant once you've bought one. Short TTLs force regular regeneration, which keeps predictions aligned with current journey state. Dismissed/acted-on flags let us track effectiveness.

**Why `journey_id` on predictions is nullable?** Some predictions are global — "You have 3 dormant journeys from last month. Want to revisit any?" These don't belong to a specific journey.

---

## Derivation Pipeline

### Overview: What Generates What

Levels 2-3 are purely algorithmic (no LLM calls, deterministic, fast). Level 4 uses one LLM call per active journey. Level 5 uses one LLM call for all predictions combined. The foundation is cheap and always fresh; the expensive layers regenerate only on meaningful state changes.

```
Pin saved (or batch of pins from import)
  → pin_intent inferred (already exists in taste-engine)
  → created_at timestamp recorded
                    │
                    ▼
  ┌─────────────────────────────────────────────────────────────┐
  │  LEVEL 1→2: SESSION DETECTION (algorithmic, no LLM)         │
  │  Trigger: every new pin save                                 │
  │  Method: temporal clustering with configurable gap threshold  │
  │  Cost: ~5ms compute, $0                                      │
  └─────────────────────────┬───────────────────────────────────┘
                            │
              intent_sessions upserted (or new row created)
              e.g., { dominant_intent: 'acquire', topics: ['desk', 'furniture'] }
                            │
  ┌─────────────────────────────────────────────────────────────┐
  │  LEVEL 2→3: JOURNEY LINKING (algorithmic, no LLM)           │
  │  Trigger: every new session (or session update)              │
  │  Method: topic overlap matching against active journeys      │
  │  Cost: ~10ms compute, $0                                     │
  └─────────────────────────┬───────────────────────────────────┘
                            │
              intent_journeys upserted
              e.g., { state: 'researching', core_topics: ['desk', 'office'] }
              session claimed by journey (journey_id set)
                            │
  ┌─────────────────────────────────────────────────────────────┐
  │  LEVEL 3→4: HYPOTHESIS GENERATION (LLM)                     │
  │  Trigger: journey state transition, or 3+ new sessions       │
  │  Method: LLM reads journey context → generates goal          │
  │  Cost: 1 Claude Haiku call per journey (~$0.002)             │
  └─────────────────────────┬───────────────────────────────────┘
                            │
              intent_hypotheses upserted
              e.g., { hypothesis: "Furnishing home office — mid-century" }
                            │
  ┌─────────────────────────────────────────────────────────────┐
  │  LEVEL 4→5: PREDICTION GENERATION (LLM)                     │
  │  Trigger: daily batch, or on hypothesis update               │
  │  Method: LLM reads active hypotheses × taste profile         │
  │  Cost: 1 Claude Haiku call for all predictions (~$0.003)     │
  └─────────────────────────┬───────────────────────────────────┘
                            │
              intent_predictions upserted
              e.g., { type: 'gap', content: "No lighting saved for office" }
```

---

### Level 1→2: Session Detection

**What it does:** Groups pins into temporal activity clusters. A session represents a single focused activity burst — the user sat down, saved a bunch of related things, then stopped.

**Algorithm:**

```javascript
function detectSessions(pins, existingSessions) {
  // Sort pins by created_at ascending
  const sorted = [...pins].sort((a, b) => a.created_at - b.created_at);

  const SESSION_GAP_MS = 60 * 60 * 1000; // 60 minutes between saves = new session

  let currentSession = null;
  const sessions = [];

  for (const pin of sorted) {
    if (!currentSession ||
        (pin.created_at - currentSession.lastPinAt) > SESSION_GAP_MS) {
      // Start new session
      if (currentSession) sessions.push(finalizeSession(currentSession));
      currentSession = {
        started_at: pin.created_at,
        lastPinAt: pin.created_at,
        pins: [pin],
      };
    } else {
      // Extend current session
      currentSession.lastPinAt = pin.created_at;
      currentSession.pins.push(pin);
    }
  }

  if (currentSession) sessions.push(finalizeSession(currentSession));

  // Filter: sessions with < 2 pins are noise, not signal
  return sessions.filter(s => s.pin_count >= 2);
}

function finalizeSession(raw) {
  const pins = raw.pins;
  const allPracticalTags = pins.flatMap(p => p.practical_tags || []);
  const allTasteTags = pins.flatMap(p => p.taste_tags || []);
  const intents = pins.map(p => p.intent || 'appreciate'); // from pin_intent

  // Dominant = most frequent
  const dominantTopics = topN(frequency(allPracticalTags), 5);
  const dominantTaste = topN(frequency(allTasteTags), 5);
  const dominantIntent = mode(intents);

  // Topic diversity: unique tags / total tags (0 = all same tag, 1 = all different)
  const uniqueTopics = new Set(allPracticalTags).size;
  const topicDiversity = allPracticalTags.length > 0
    ? uniqueTopics / allPracticalTags.length
    : 0;

  // Momentum: compare first-half tags to second-half tags
  // If second half has fewer unique tags → narrowing (converging on specifics)
  // If second half has more unique tags → broadening (exploring)
  const midpoint = Math.floor(pins.length / 2);
  const firstHalfTags = new Set(pins.slice(0, midpoint).flatMap(p => p.practical_tags || []));
  const secondHalfTags = new Set(pins.slice(midpoint).flatMap(p => p.practical_tags || []));
  const momentum = secondHalfTags.size < firstHalfTags.size * 0.7 ? 'narrowing'
    : secondHalfTags.size > firstHalfTags.size * 1.3 ? 'broadening'
    : 'steady';

  return {
    started_at: raw.started_at,
    ended_at: raw.lastPinAt,
    pin_count: pins.length,
    pin_ids: pins.map(p => p.id),
    dominant_intent: dominantIntent,
    dominant_topics: dominantTopics,
    dominant_taste_tags: dominantTaste,
    topic_diversity: topicDiversity,
    momentum,
  };
}
```

**Why 60 minutes?** Empirically, most focused save-sessions on bookmarking tools last 10-45 minutes. A 60-minute gap is generous enough to keep a session intact through short breaks but tight enough to separate distinct activity windows. This is configurable.

**Single-pin sessions are discarded.** One save in isolation doesn't signal intent — it could be anything. Two or more saves within the time window establish a behavioral pattern worth tracking.

**Trigger:** Runs incrementally on every new pin save. Only recomputes the most recent session (checks if the new pin extends an existing session or starts a new one). Full recomputation on import batches.

---

### Level 2→3: Journey Linking

**What it does:** Connects sessions into multi-session arcs representing sustained goals. A journey is the thread connecting "I looked at desks on Monday" to "I compared desk prices on Thursday" to "I saved a specific desk on Saturday."

**Algorithm:**

```javascript
function linkSessionToJourney(newSession, activeJourneys) {
  const TOPIC_OVERLAP_THRESHOLD = 0.3; // 30% of session topics must match journey topics
  const DORMANCY_DAYS = 30;            // journey goes dormant after 30 days without a session

  // Score each active journey by topic overlap with the new session
  const candidates = activeJourneys.map(journey => {
    const sessionTopics = new Set(newSession.dominant_topics);
    const journeyTopics = new Set(journey.core_topics);

    // Jaccard similarity on topic sets
    const intersection = [...sessionTopics].filter(t => journeyTopics.has(t)).length;
    const union = new Set([...sessionTopics, ...journeyTopics]).size;
    const overlap = union > 0 ? intersection / union : 0;

    // Boost score for taste_tag overlap (aesthetic consistency)
    const tasteOverlap = computeTagOverlap(
      newSession.dominant_taste_tags,
      journey.core_taste_tags
    );

    // Combined score: 70% topic overlap + 30% taste overlap
    const score = (overlap * 0.7) + (tasteOverlap * 0.3);

    return { journey, score, topicOverlap: overlap };
  });

  // Find best match above threshold
  const best = candidates
    .filter(c => c.topicOverlap >= TOPIC_OVERLAP_THRESHOLD)
    .sort((a, b) => b.score - a.score)[0];

  if (best) {
    // Attach session to existing journey
    return updateJourney(best.journey, newSession);
  } else {
    // No match — start a new journey
    return createJourney(newSession);
  }
}

function updateJourney(journey, newSession) {
  // Merge topics (union, weighted by frequency across sessions)
  const mergedTopics = mergeTopicSets(journey.core_topics, newSession.dominant_topics);
  const mergedTaste = mergeTopicSets(journey.core_taste_tags, newSession.dominant_taste_tags);

  // Recompute intent distribution across all sessions in this journey
  const allSessions = [...journey.sessions, newSession];
  const intentDist = computeIntentDistribution(allSessions);
  const horizonDist = computeHorizonDistribution(allSessions);

  // Detect state transition
  const newState = detectStateTransition(journey.state, intentDist, horizonDist, newSession);

  return {
    ...journey,
    core_topics: mergedTopics,
    core_taste_tags: mergedTaste,
    session_count: journey.session_count + 1,
    pin_count: journey.pin_count + newSession.pin_count,
    intent_distribution: intentDist,
    horizon_distribution: horizonDist,
    state: newState,
    last_session_at: newSession.ended_at,
    dormant_since: null,  // reset dormancy
  };
}

function detectStateTransition(currentState, intentDist, horizonDist, latestSession) {
  // State machine transitions based on observed signals

  // exploring → researching: multiple sessions now exist with reference-heavy intent
  if (currentState === 'exploring' &&
      intentDist.reference > 0.4) {
    return 'researching';
  }

  // researching → deciding: sessions narrowing + acquire intent appearing
  if (currentState === 'researching' &&
      latestSession.momentum === 'narrowing' &&
      intentDist.acquire > 0.2) {
    return 'deciding';
  }

  // deciding → acquiring: acquire dominates + horizon shifting to now/soon
  if (currentState === 'deciding' &&
      intentDist.acquire > 0.5 &&
      (horizonDist.now || 0) + (horizonDist.soon || 0) > 0.5) {
    return 'acquiring';
  }

  // acquiring → done: most pins in the journey have action_state = 'done'
  // (This check happens at the pin level, not session level — see lifecycle section)

  return currentState; // no transition
}
```

**Journey creation vs. attachment:** A new session creates a new journey only when it doesn't overlap enough with any active journey. This means a user who saves 3 restaurants in one session (creating a "dining" journey) and then saves 2 architecture pins (no overlap) starts a separate journey. Later, if they save pins that overlap with both, the higher-scoring match wins.

**Dormancy detection:** A daily cron job checks all active journeys. Any journey whose `last_session_at` is > 30 days ago gets marked `dormant`. Dormant journeys are not deleted — they can be reactivated when a new session matches them. After 90 days dormant with no reactivation, the journey transitions to `abandoned`.

**Done detection:** When > 75% of `acquire`-intent pins in a journey have `action_state = 'done'` in `pin_intent`, the journey transitions to `done`. This is checked on pin_intent updates, not just session creation.

**Taste domain linking:** When a journey is created or updated, the engine matches its `core_taste_tags` against existing `taste_domains` to find which taste domains the journey intersects. This enables "show me all journeys in my Dark Industrial Techno world" queries.

---

### Level 3→4: Hypothesis Generation

**What it does:** Produces a human-readable goal statement for each active journey. This is the "what are they trying to accomplish?" synthesis.

**Trigger:** Hypothesis is generated or regenerated when:
- A journey is newly created (initial hypothesis)
- Journey state transitions (exploring → researching, etc.)
- 3+ new sessions attach to the journey since last hypothesis
- User manually requests refresh

**Input assembly:**

```javascript
function buildHypothesisContext(journey, sessions, pins, tasteProfile) {
  // Get all pins in this journey (across all sessions)
  const journeyPins = pins.filter(p => journey.pinIds.includes(p.id));

  // Get relevant taste domains
  const relevantDomains = tasteProfile.domains
    .filter(d => journey.taste_domain_ids.includes(d.id));

  return {
    journey_state: journey.state,
    session_count: journey.session_count,
    span_days: daysBetween(journey.first_session_at, journey.last_session_at),
    core_topics: journey.core_topics,
    intent_distribution: journey.intent_distribution,
    horizon_distribution: journey.horizon_distribution,
    sample_pins: journeyPins.slice(0, 15).map(p => ({
      title: p.title,
      url: truncate(p.url, 80),
      content_type: p.content_type,
      category: p.category,
      taste_tags: p.taste_tags,
      practical_tags: p.practical_tags,
      intent: p.intent,
      created_at: p.created_at,
    })),
    taste_context: {
      domains: relevantDomains.map(d => d.label),
      global_sensibility: tasteProfile.sensibility,
    },
    momentum_pattern: sessions.map(s => ({
      date: s.started_at,
      pin_count: s.pin_count,
      momentum: s.momentum,
      dominant_intent: s.dominant_intent,
    })),
  };
}
```

**Prompt:**

```
A user's save pattern suggests they're working toward a goal.

JOURNEY CONTEXT:
- State: ${context.journey_state}
- ${context.session_count} save sessions over ${context.span_days} days
- Core topics: ${context.core_topics.join(', ')}
- Intent mix: ${JSON.stringify(context.intent_distribution)}
- Horizon mix: ${JSON.stringify(context.horizon_distribution)}

SESSION MOMENTUM:
${context.momentum_pattern.map(s =>
  `${s.date}: ${s.pin_count} pins, ${s.dominant_intent}, ${s.momentum}`
).join('\n')}

SAMPLE PINS (most recent first):
${context.sample_pins.map(p =>
  `- "${p.title}" [${p.content_type}] ${p.taste_tags.join(', ')} | intent: ${p.intent}`
).join('\n')}

USER'S TASTE CONTEXT:
- Relevant taste domains: ${context.taste_context.domains.join(', ')}
- Overall sensibility: ${context.taste_context.global_sensibility}

Based on these save patterns, what is this user trying to accomplish?

Return JSON:
{
  "hypothesis": "1-2 sentence goal statement, specific and actionable",
  "confidence": 0.0-1.0,
  "evidence": {
    "key_signals": ["signal 1", "signal 2", "signal 3"],
    "key_pins": ["pin title 1", "pin title 2"]
  },
  "completion_signals": ["what would 'done' look like — e.g., 'purchased a desk'"],
  "predicted_next_actions": ["what the user likely needs next — e.g., 'compare pricing', 'find matching chair'"]
}

RULES:
- Be specific. "Shopping for furniture" is too vague. "Furnishing a home office with mid-century pieces under $2000" is good.
- Ground the hypothesis in the actual pins, not generic assumptions.
- If confidence is low (< 0.4), say what would increase confidence (more sessions? different pin types?).
- predicted_next_actions should be things the SYSTEM can help with (suggestions, searches, comparisons), not generic life advice.
```

**Hypothesis TTL:** 14 days. If the journey doesn't change in 14 days, the hypothesis expires and the journey is checked for dormancy.

---

### Level 4→5: Prediction Generation

**What it does:** Produces actionable suggestions by cross-referencing active journey hypotheses with the taste profile. These are the outputs that features consume.

**Trigger:** Daily batch job + on-demand when a hypothesis is regenerated.

**Prediction types:**

| Type | What it detects | Example |
|------|----------------|---------|
| `gap` | Missing category/topic in a journey | "You've saved 4 desks and 3 chairs but no lighting for your office" |
| `recommendation` | Style-matched suggestion based on taste × intent | "Based on your aesthetic: [specific product/content type] would complement your office setup" |
| `nudge` | Stale active journey or "now" horizon items with no progress | "You saved 3 restaurants in Williamsburg 2 weeks ago — still planning dinner?" |
| `completion` | Journey near done state | "4 of 5 office items purchased — just need that desk lamp" |
| `resurface` | Dormant journey with potential relevance | "You researched turntables last month — new save in 'listen' category suggests renewed interest" |

**Prompt:**

```
Generate actionable predictions for a user based on their active goals and taste profile.

ACTIVE JOURNEYS:
${activeJourneys.map((j, i) => `
Journey ${i + 1}: "${j.hypothesis.hypothesis}"
  State: ${j.state} | Confidence: ${j.hypothesis.confidence}
  Topics: ${j.core_topics.join(', ')}
  Predicted next: ${j.hypothesis.predicted_next_actions.join(', ')}
  Pin count: ${j.pin_count} | Last active: ${j.last_session_at}
`).join('\n')}

DORMANT JOURNEYS (30+ days inactive):
${dormantJourneys.map(j => `"${j.hypothesis?.hypothesis || j.core_topics.join(', ')}" — dormant since ${j.dormant_since}`).join('\n')}

USER'S TASTE PROFILE:
- Domains: ${taste.domains.map(d => d.label).join(', ')}
- Key axes: ${taste.axes.map(a => `${a.axis}: ${a.position.toFixed(1)}`).join(', ')}
- Sensibility: ${taste.sensibility}

For each active journey, generate 1-3 predictions. For dormant journeys,
generate resurface predictions only if there's a reason to re-engage.

Return JSON:
{
  "predictions": [
    {
      "journey_index": 1,
      "type": "gap|recommendation|nudge|completion|resurface",
      "content": "Short, actionable statement",
      "priority": 0.0-1.0,
      "reasoning": "Why this prediction matters now"
    }
  ]
}

RULES:
- Predictions must be actionable — the user or system should be able to DO something with them.
- Priority is based on urgency (horizon) × confidence × journey activity recency.
- Gap predictions require at least 3 pins in a journey (too early to detect gaps otherwise).
- Resurface predictions should include WHY now (e.g., related new save, seasonal relevance).
- Maximum 10 predictions total. Quality over quantity.
```

**Priority scoring formula (for sorting/displaying predictions):**

```javascript
function scorePriority(prediction, journey) {
  const urgency = {
    now: 1.0, soon: 0.7, someday: 0.3, ongoing: 0.5
  }[journey.dominant_horizon] || 0.3;

  const recency = Math.exp(-0.03 * daysSince(journey.last_session_at)); // decay over ~30 days
  const confidence = prediction.confidence || journey.hypothesis?.confidence || 0.5;

  return urgency * 0.4 + recency * 0.3 + confidence * 0.3;
}
```

---

## Key Signals for Journey Detection

| Signal | Source | What it indicates | Level |
|--------|--------|-------------------|-------|
| 3+ pins same topic within 60min | `links.created_at` + `practical_tags` | Active research session | L2 |
| Pin intent shift: reference → acquire | `pin_intent.intent` across sessions | Moving toward purchase/action | L3 |
| Horizon compression: someday → now | `pin_intent.horizon` changes | Intent crystallizing | L3 |
| Topic narrowing across sessions | Session `topic_diversity` decreasing | Convergence on a specific goal | L3 |
| Cross-domain saves (furniture + floor plans) | `practical_tags` + `links.category` | Composite goal (e.g., redecorating) | L3 |
| Stale "now" items (>14 days, no `done`) | `pin_intent.horizon` + `action_state` | Forgotten or abandoned intention | L5 |
| Repeated saves in same practical category across weeks | Session `dominant_topics` consistency | Long-running journey | L3 |
| Action_state progression (unprocessed → done) | `pin_intent.action_state` | Journey completing | L3 |
| Custom board name matches journey topics | `board_metadata` | Explicit user-declared intent | L3 |
| Secondary signals (Spotify recently played → music pins) | `secondary_signals` + `intent_sessions` | External confirmation of active intent | L2 |

---

## Downstream Consumers

### Widget Generation

**Current:** Widgets receive `tasteContext` (domains, axes, sensibility). They know the user's aesthetic but not their current goals.

**With intent engine:** Widgets additionally receive `intentContext`:

```javascript
function buildIntentContextForPrompt(intentProfile) {
  return {
    activeJourneys: intentProfile.journeys
      .filter(j => !['done', 'abandoned'].includes(j.state))
      .map(j => ({
        hypothesis: j.hypothesis?.hypothesis,
        state: j.state,
        topics: j.core_topics,
      })),
    predictions: intentProfile.predictions
      .filter(p => !p.dismissed && !p.acted_on)
      .slice(0, 5)
      .map(p => ({
        type: p.prediction_type,
        content: p.content,
      })),
    dominantIntent30d: intentProfile.snapshot?.dominant_intent_30d,
  };
}
```

This enables widgets to generate goal-aware responses:
- "Best desk lamps" widget → filters by the user's office journey aesthetic
- "Weekend plans" widget → surfaces the Williamsburg restaurant journey
- "Reading list" widget → focuses on the active research journeys, not all reference pins

### Event Recommendations

**Current:** `recommend-events` uses taste context to rank events by aesthetic fit.

**With intent engine:** Events are additionally scored by intent urgency:
- Active journey with `now` horizon + matching topic → priority boost
- Dormant journey with matching topic → lower boost (resurface opportunity)
- No matching journey → default taste-only ranking

### MCP Connector

**New tool:** `get_intent_profile` returns active journeys and predictions. External AI tools can use this to understand what the user is actively working toward.

```typescript
// connector-core.ts
async function toolGetIntentProfile(userId: string) {
  const journeys = await supabase
    .from('intent_journeys')
    .select('*, intent_hypotheses(*)')
    .eq('user_id', userId)
    .not('state', 'in', '("done","abandoned")')
    .order('last_session_at', { ascending: false })
    .limit(10);

  const predictions = await supabase
    .from('intent_predictions')
    .select('*')
    .eq('user_id', userId)
    .eq('dismissed', false)
    .eq('acted_on', false)
    .order('priority', { ascending: false })
    .limit(10);

  return {
    active_journeys: journeys.map(j => ({
      hypothesis: j.intent_hypotheses?.hypothesis,
      state: j.state,
      topics: j.core_topics,
      session_count: j.session_count,
      last_active: j.last_session_at,
    })),
    predictions: predictions.map(p => ({
      type: p.prediction_type,
      content: p.content,
      priority: p.priority,
    })),
  };
}
```

### Smart Nudges (Future)

The intent engine enables a proactive notification layer:
- **Morning digest:** "You have 2 active journeys — office furniture (deciding) and dinner planning (exploring)"
- **Stale intent:** "3 'now' items from 2 weeks ago haven't been marked done"
- **Journey completion:** "Looks like your office setup is complete — archive this journey?"
- **Resurface:** "You saved turntable research last month — new vinyl store opened nearby"

---

## Implementation as Edge Function

### Actions

The intent engine extends the existing `taste-engine` pattern with a new `intent-engine` Edge Function (or as additional actions on the existing `taste-engine` function).

| Action | What it does | LLM? | Cost |
|--------|-------------|------|------|
| `detect-sessions` | L1→L2: Temporal clustering of recent pins | No | ~5ms, $0 |
| `link-journeys` | L2→L3: Attach sessions to journeys, detect state transitions | No | ~10ms, $0 |
| `generate-hypotheses` | L3→L4: LLM hypothesis for active journeys | Yes | ~$0.002/journey |
| `generate-predictions` | L4→L5: LLM predictions from hypotheses × taste | Yes | ~$0.003 total |
| `full-pipeline` | All of the above in sequence | Yes | ~$0.01 total |
| `get-intent-profile` | Read-only: return current intent state | No | ~20ms, $0 |
| `lifecycle-check` | Cron: mark dormant/abandoned journeys | No | ~50ms, $0 |

### Invocation Patterns

| Trigger | Actions Run | Who Invokes |
|---------|------------|-------------|
| New pin saved | `detect-sessions` + `link-journeys` | `analyze-content` post-hook or client |
| Import batch | `full-pipeline` | Import flow |
| Daily cron | `lifecycle-check` + `generate-predictions` | Scheduled function |
| Journey state change | `generate-hypotheses` for that journey | `link-journeys` internally |
| User opens intent view | `get-intent-profile` | Client |
| Widget requests context | `get-intent-profile` | `generate-widget` |

---

## Costs

| Level | Computation | Per-user cost per month |
|-------|------------|------------------------|
| L2 (Sessions) | Algorithmic | $0 |
| L3 (Journeys) | Algorithmic | $0 |
| L4 (Hypotheses) | 1 Haiku call per journey state change | ~$0.01 (assuming 5 active journeys) |
| L5 (Predictions) | 1 Haiku call daily | ~$0.09 (30 days × $0.003) |
| **Total** | | **~$0.10/user/month** |

This is comparable to the taste engine's cost profile. The algorithmic foundation (L2-L3) carries the load; LLM calls are reserved for synthesis and prediction.

---

## Phase Plan

### Phase 1: Sessions + Journeys (L2-L3)
- Implement session detection from pin timestamps
- Implement journey linking with state machine
- Add `detect-sessions` and `link-journeys` actions to edge function
- Hook into pin save flow
- No LLM cost. Pure infrastructure.

### Phase 2: Hypotheses (L4)
- Add hypothesis generation for active journeys
- Integrate hypothesis into widget `intentContext`
- Add `get-intent-profile` to MCP connector

### Phase 3: Predictions (L5)
- Add daily prediction generation
- Integrate predictions into widget context
- Add prediction dismissal/acted-on tracking from UI

### Phase 4: Smart Nudges
- Build notification layer consuming predictions
- Morning digest, stale intent alerts, completion celebrations
- Requires notification infrastructure (out of scope for this PRD)

---

## Open Questions

1. **Should the intent engine live in the same Edge Function as taste-engine or be separate?** Same function is simpler (shared DB access, one deployment). Separate is cleaner (independent scaling, independent versioning). Recommendation: same function with separate action namespace (`intent-*` actions).

2. **How do we handle intent for secondary signals (Spotify, YouTube)?** Currently secondary signals only have taste_tags. Should Spotify "recently played" create sessions with `appreciate` intent? This would enable "you've been listening to jazz a lot — here are jazz events."

3. **Should journey state transitions be reversible?** A journey in `deciding` state could revert to `researching` if the user starts broadening again. The current model supports this but the state machine doesn't explicitly model backward transitions.

4. **What's the right dormancy threshold?** 30 days is a guess. Some journeys (e.g., "planning a wedding") have natural multi-month gaps. Could use journey-specific thresholds based on the hypothesis.

5. **How do we handle multi-user journeys?** A couple both saving furniture pins for the same apartment — each has their own journey, but the journeys are related. Collaborative intent detection is Phase 4+ but worth noting.
