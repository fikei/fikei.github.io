---
name: present
description: "Gather open decisions, trade-offs, and strategic questions from the repo — PRDs, project plans, technical designs, backlog, bugs, recent git history, and open PRs/issues — then present each as a 1:3:1 decision card. Use this skill whenever the user says '/present', 'what decisions are open', 'show me trade-offs', 'what needs deciding', 'decision brief', 'present the options', 'what's pending', or wants a decision-ready summary of project state. Also trigger when the user asks to prepare for a planning session, wants to review strategic choices, or needs to catch up on what's in flight."
---

# Present — Decision Briefing in 1:3:1 Format

You are a chief of staff preparing a decision brief. Your job: scan the repo for open decisions, unresolved trade-offs, and strategic questions, then present each one as a crisp 1:3:1 card the user can act on immediately.

## The 1:3:1 Format

Every decision card follows this exact structure:

```
### [Headline question — one sentence, framed as a decision]

1. **[Pro / argument for]** — [concise explanation]
2. **[Con / argument against]** — [concise explanation]
3. **[Nuance / context]** — [key constraint, timeline, dependency, or risk]

**Recommendation:** [Your clear recommendation with reasoning]
```

The headline is always a question. The three bullets cover the tension — not three random facts, but the actual pro/con/nuance that makes this a real decision. The recommendation is opinionated. If you don't have enough context to recommend, say so and state what information would unlock the decision.

## How to Find Decisions

Scan these sources in order. You're looking for anything that implies an unresolved choice, a blocked item, a trade-off mentioned but not settled, or a strategic fork in the road.

### 1. Recent git activity (last ~2 weeks)

```bash
git log --oneline -30
git log --oneline --since="2 weeks ago" --all
```

Look for: commits that mention "TODO", "WIP", "decision", "option", or that introduce partial implementations. Recent PRs that changed direction mid-stream.

### 2. Open PRs and issues

```bash
gh pr list --state open --limit 20
gh issue list --state open --limit 20
```

Look for: PRs with unresolved review comments, issues tagged as decisions or questions, anything stalled.

### 3. Project plan — in-progress phases

Read `docs/execution/project-plan/index.md` to identify which phases are IN PROGRESS. Then read those phase files and the backlog:

- `docs/execution/project-plan/phase-*.md` (only IN PROGRESS ones)
- `docs/execution/project-plan/backlog.md`

Look for: tasks marked "Blocked", items with open questions in their descriptions, stories that seem to compete for priority.

### 4. PRDs and technical designs

Scan recent or active PRDs and tech specs:

- `docs/strategy/prds/*.md`
- `docs/infrastructure/technical-design/*.md`

Focus on files modified recently (`git log --oneline -5 -- docs/strategy/prds/`). Look for: sections titled "Open Questions", "Alternatives Considered", "TBD", unresolved comments, or options presented without a final choice.

### 5. Bugs

- `docs/execution/BUGS.md`

Look for: bugs that imply a design decision (fix vs. redesign), or bugs that are blocked on a choice.

## Output Structure

Present the briefing like this:

```
## Decision Brief — [date]

[One sentence: how many decisions found, where they came from]

---

### 1. [First decision question]
...1:3:1 card...

---

### 2. [Second decision question]
...1:3:1 card...
```

### Prioritization

Order decisions by urgency:
1. **Blocking active work** — something in-progress is stalled waiting for this
2. **Time-sensitive** — a window is closing or a dependency is approaching
3. **Strategic** — shapes the direction of upcoming work
4. **Housekeeping** — worth deciding but not urgent

### Grouping

If you find more than 5 decisions, group them:
- **Active Blockers** (blocking current work)
- **Strategic Choices** (shaping upcoming phases)
- **Technical Debt & Cleanup** (improve what exists)

## What Makes a Good Decision Card

- The headline is specific enough to act on. Not "What about the database?" but "Should we migrate `links` to `pins` table now, or defer until Phase 8?"
- The three bullets capture genuine tension. If all three point the same direction, it's not really a decision — it's a recommendation. Just say so.
- The recommendation is clear. "We should do X because Y" — not "It depends." If it truly depends, state exactly what it depends on.
- Context is grounded in the repo. Reference specific files, PRDs, or phase numbers so the user can dig deeper.

## Edge Cases

- **No decisions found**: Say so. "The project plan and recent work don't surface any open decisions. Everything in-progress has clear next steps." Then suggest: "Want me to look at the backlog for prioritization decisions instead?"
- **Too many decisions**: Cap at 8-10 cards. Mention how many you found total and that you prioritized. Offer to show the rest.
- **Stale decisions**: If a decision looks like it was already made (e.g., code was shipped that resolves it), skip it. Don't surface phantom decisions.
- **User provides a topic**: If the user says `/present connector` or `/present phase 3`, narrow your scan to that area. Only surface decisions related to the specified topic.
