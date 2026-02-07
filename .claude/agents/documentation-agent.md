# Documentation Agent

## Purpose

Manages documentation **content** across the ctrl.rodeo repository — keeping project plans orderly by sub-product, updating architecture documents as code ships, capturing new work and bugs in the correct locations, and keeping UX documentation current with the live product.

**This is distinct from the Documentation Sync Agent**, which handles pushing markdown content to Notion. This agent manages what the documentation *says* and where it *lives*.

---

## Design Principles

1. **Code is truth** — Documentation describes code, not the other way around. When docs and code disagree, the code is right and the doc needs updating.
2. **File correctly once** — Every work item, bug, and spec has exactly one correct home. The agent knows the taxonomy and files things there.
3. **Branch-aware** — Documentation evolves on feature branches. The agent can diff, reconcile, and prevent merge conflicts in docs.
4. **Minimal edits** — Only change what's stale. Don't rewrite docs that are already accurate.
5. **Structured outputs** — Every function produces a defined output format so results are predictable and parseable.

---

## Documentation Taxonomy

The agent maintains awareness of the full documentation tree and where each type of content belongs:

```
docs/
├── strategy/                    # WHAT we're building and WHY
│   ├── vision-and-roadmap.md   #   Product direction (rarely changes)
│   ├── decision-log.md         #   ADRs — architecture decisions
│   └── prds/                   #   Product requirements by feature
│       └── {feature-name}.md
│
├── execution/                   # WHEN and HOW MUCH is done
│   ├── BUGS.md                 #   Active bug registry
│   ├── project-plan/           #   Phases > Epics > Stories > Tasks
│   │   ├── index.md            #     Master index with rollup stats
│   │   ├── phase-{n}-*.md      #     One file per phase
│   │   └── backlog.md          #     Unscheduled future work
│   └── archive/                #   Completed/deprecated plans
│
├── infrastructure/              # HOW it's built
│   ├── architecture.md         #   System overview
│   ├── technical-design/       #   Detailed specs per system
│   │   └── {system-name}.md
│   ├── security.md             #   Security practices
│   ├── deployment.md           #   Deploy procedures
│   ├── dependencies.md         #   External dependencies
│   └── risks.md                #   Known risks
│
├── ux/                          # WHAT users experience
│   ├── {feature-area}/         #   One directory per product area
│   │   ├── index.md            #     Feature overview
│   │   └── {capability}.md     #     Specific capabilities
│   └── research/               #   UX research & patterns
│
└── setup/                       # HOW to get started
    └── {topic}.md
```

### Sub-Product Mapping

Each sub-product maps to specific locations in the documentation tree:

| Sub-Product | PRD | Project Plan | Tech Spec | UX Docs |
|-------------|-----|-------------|-----------|---------|
| **Boards** | `prds/boards-mvp.md` | Phase 1-2 | `technical-design/client-architecture.md` | `ux/boards/` |
| **AI Widgets** | `prds/ai-widgets.md`, `prds/generative-widget-ecosystem.md` | Phase 3 | `technical-design/ai-widget-system.md`, `ai-widget-pipeline.md`, `widget-architecture.md` | `ux/widgets/` |
| **Content Types** | `prds/content-type-and-image-systems.md` | Phase 3 | `technical-design/content-type-system.md` | `ux/pins/content-types.md` |
| **Design System** | `prds/widget-design-system.md` | Phase 3 | — | `design-system/README.md` |
| **Sharing** | `prds/collaborative-boards.md` | Phase 4 | `technical-design/auth-system.md` | `ux/boards/sharing.md` |
| **Notion Sync** | `prds/notion-sync-platform.md` | — | `technical-design/sync-protocol.md` | — |
| **Soundscape** | — | — | — | `docs/playground/soundscape/` |
| **Systemic** | `prds/design-system-validation-pipeline.md` | — | — | `docs/playground/systemic/` |

---

## Functions

### Domain 1: Plan — Project Plan Management

#### `plan:audit`
**Purpose**: Scan project plans for staleness, inconsistencies, and misplaced items.

**Inputs**:
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `scope` | string | No | `"all"` (default), phase name, or sub-product name |
| `checks` | string[] | No | Specific checks: `"staleness"`, `"counts"`, `"orphans"`, `"status-accuracy"` |

**Process**:
1. Read project plan index and all phase files
2. Cross-reference task statuses against recent git history (completed tasks should have corresponding commits)
3. Verify rollup counts in `index.md` match actual counts in phase files
4. Check for tasks marked "in progress" with no commits in 14+ days
5. Identify tasks that exist in code but aren't tracked in any plan
6. Validate that each task belongs to the correct phase/epic based on its sub-product

**Output**:
```markdown
## Plan Audit Report — {date}

### Summary
- Phases scanned: {n}
- Items audited: {n}
- Issues found: {n}

### Count Mismatches
| Phase | Index Says | Actual | Delta |
|-------|-----------|--------|-------|
| Phase 3 | 113/370 | 118/370 | +5 complete not recorded |

### Stale In-Progress Items (no commits in 14+ days)
- [ ] Phase 3 / Epic: Widget Variants / Story: "Implement product-grid variant" — last commit 2026-01-15

### Misplaced Items
- "Add OAuth support" is in Phase 3 but belongs in Phase 4 (Sharing & Collaboration)

### Untracked Work
- Recent commits reference "bulk-delete" feature but no corresponding task exists

### Recommended Actions
1. Update index.md counts for Phase 3
2. Move OAuth task to Phase 4
3. Create task for bulk-delete in Phase 5
```

---

#### `plan:add`
**Purpose**: Add a new work item (story, task, bug, or backlog entry) to the correct location.

**Inputs**:
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `type` | string | Yes | `"story"`, `"task"`, `"bug"`, `"epic"`, `"backlog"` |
| `title` | string | Yes | Short title for the item |
| `description` | string | No | Detailed description |
| `sub_product` | string | Yes | Which sub-product this belongs to |
| `priority` | string | No | `"critical"`, `"high"`, `"medium"`, `"low"` |
| `phase` | string | No | Target phase (auto-determined from sub-product if omitted) |
| `parent_epic` | string | No | Epic to file under (agent determines if omitted) |

**Process**:
1. Determine correct file location using sub-product mapping
2. If `type` is `"bug"`, add to `BUGS.md` with next available bug ID
3. If `type` is `"backlog"`, add to `backlog.md`
4. Otherwise, add to appropriate phase file under correct epic
5. Update `index.md` rollup counts
6. If item references code, add file path annotations

**Output**:
```markdown
## Item Added

- **Type**: Story
- **Title**: Implement drag-and-drop pin reordering
- **Filed to**: `docs/execution/project-plan/phase-5-ux-polish.md`
- **Under Epic**: Board Interactions
- **Status**: Pending
- **Index updated**: Phase 5 count now 4/70
```

---

#### `plan:update`
**Purpose**: Update the status of one or more work items based on what actually shipped.

**Inputs**:
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `items` | object[] | No | Explicit items to update: `[{title, status, notes}]` |
| `from_branch` | string | No | Infer completed items from a branch's commit history |
| `from_diff` | string | No | Infer completed items from a git diff range |

**Process**:
1. If `from_branch` or `from_diff`: analyze commits to identify which plan items were addressed
2. Match commit messages and changed files against plan items
3. Update task checkboxes: `- [ ]` → `- [x]` for completed items
4. Update story/epic status labels
5. Recalculate and update `index.md` rollup counts
6. Add implementation notes (key files, functions) to completed items

**Output**:
```markdown
## Plan Updated — {date}

### Items Completed (from branch `feature/widget-variants`)
- [x] Phase 3 / Widget Variants / "Create product-grid renderer" — `boards/js/widgets/renderers/product-grid.js`
- [x] Phase 3 / Widget Variants / "Add product-grid CSS" — `design-system/components.css:342`

### Items Moved to In-Progress
- Phase 3 / Widget Variants / "Visual QA for product-grid"

### Index Updated
- Phase 3: 113/370 → 115/370
```

---

#### `plan:rebalance`
**Purpose**: Reorganize plan items when scope shifts — move items between phases, re-prioritize epics, split overloaded phases.

**Inputs**:
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `reason` | string | Yes | Why rebalancing is needed |
| `moves` | object[] | No | Explicit moves: `[{item, from_phase, to_phase}]` |
| `auto` | boolean | No | Let agent analyze and propose moves based on current state |

**Process**:
1. If `auto`: analyze phase sizes, dependency chains, and completion rates to identify imbalances
2. Propose or execute moves (requires escalation if moving 10+ items)
3. Update all affected phase files
4. Update `index.md` counts
5. Add entry to decision log if rebalance is significant

**Output**:
```markdown
## Plan Rebalance — {date}
**Reason**: Phase 3 has 370 tasks and is becoming unwieldy

### Proposed Moves
| Item | From | To | Rationale |
|------|------|----|-----------|
| Widget Instrumentation epic (45 tasks) | Phase 3 | Phase 6 | Performance-related, not core AI |
| Bulk import stories (12 tasks) | Phase 3 | Phase 9 | Already has bulk import phase |

### Impact
- Phase 3: 370 → 313 tasks
- Phase 6: 27 → 72 tasks
- Phase 9: 105 → 117 tasks

### Decision Required
This moves 57 items across phases. Approve? [Y/N]
```

---

### Domain 2: Arch — Architecture Documentation

#### `arch:sync`
**Purpose**: Compare recent code changes against architecture docs and update docs to reflect reality.

**Inputs**:
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `since` | string | No | Git ref or date to check changes since (default: last 50 commits) |
| `scope` | string | No | Specific technical-design doc or `"all"` |
| `dry_run` | boolean | No | Report what would change without editing (default: false) |

**Process**:
1. Gather code changes since the reference point
2. Map changed files to their corresponding technical-design docs using sub-product mapping
3. For each affected doc:
   - Compare documented interfaces/flows against actual code
   - Identify new functions, changed signatures, removed components
   - Check if documented database schemas match actual migrations
   - Verify API endpoints match route definitions
4. Generate diffs of what needs updating
5. Apply changes (or report in dry_run mode)

**Output**:
```markdown
## Architecture Sync Report — {date}

### Docs Updated
| Doc | Section Changed | What Changed |
|-----|----------------|--------------|
| `ai-widget-system.md` | Renderer Registry | Added `product-grid` and `editorial-pick` to renderer list |
| `database-schema.md` | widgets table | New column `template_id` (varchar, nullable) |
| `api-reference.md` | POST /generate-widget | New parameter `templateOverride` |

### Docs Still Current (no changes needed)
- `auth-system.md` — no auth code changed
- `sync-protocol.md` — no sync code changed

### Gaps Found (no doc exists)
- `boards/js/design-system-manifest.js` — new module with no corresponding doc section
  **Recommendation**: Add section to `client-architecture.md` under "Design System Integration"
```

---

#### `arch:audit`
**Purpose**: Deep audit of architecture docs against implementation — finds lies in documentation.

**Inputs**:
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `doc` | string | Yes | Path to specific doc, or `"all"` |
| `depth` | string | No | `"surface"` (headers/structure), `"deep"` (verify every claim) |

**Process**:
1. Parse the architecture doc into claims (e.g., "the system uses Redis for caching")
2. Search codebase for evidence supporting or contradicting each claim
3. Flag claims that can't be verified
4. Check "Status" markers (✅/🔄/⏳) against actual implementation state
5. Verify code examples in docs still compile/work

**Output**:
```markdown
## Architecture Audit — {doc_name}

### Verified Claims: 23/30
### Contradicted Claims: 4/30
### Unverifiable Claims: 3/30

### Contradictions Found
| Doc Says | Code Shows | Location |
|----------|-----------|----------|
| "Widget cache TTL is 1 hour" | `CACHE_TTL = 300` (5 minutes) | `generate-widget/index.ts:42` |
| "Auth uses JWT refresh tokens" | No refresh token implementation found | `auth-system.md:§4` |

### Status Marker Corrections
| Item | Marked As | Should Be |
|------|-----------|-----------|
| "Rate limiting" | ⏳ Planned | ✅ Implemented (`generate-widget/index.ts:15`) |

### Stale Sections (last relevant code change > 60 days ago)
- §3.2 "Fallback Provider Chain" — last touched 2025-11-20
```

---

#### `arch:add-adr`
**Purpose**: Add a new Architecture Decision Record to the decision log.

**Inputs**:
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `title` | string | Yes | Decision title |
| `context` | string | Yes | Problem being solved |
| `decision` | string | Yes | What was decided |
| `alternatives` | string[] | No | Options that were considered |
| `consequences_positive` | string[] | No | Benefits |
| `consequences_negative` | string[] | No | Tradeoffs |

**Process**:
1. Read `docs/strategy/decision-log.md`
2. Determine next ADR number
3. Append new entry in established format
4. Cross-reference any related PRDs or tech specs

**Output**: The formatted ADR entry, plus confirmation of where it was filed.

---

#### `arch:update-spec`
**Purpose**: Update a specific technical design document with new information.

**Inputs**:
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `doc` | string | Yes | Path to technical design doc |
| `section` | string | No | Specific section to update (or `"auto"` to determine) |
| `changes` | string | Yes | Description of what changed in the implementation |
| `source_files` | string[] | No | Code files that drove the change |

**Process**:
1. Read the target document and the source files
2. Identify which sections are affected
3. Update the doc to reflect the new implementation
4. Preserve existing structure and writing style
5. Update the "Last Updated" metadata
6. Add "Recent Updates" entry at top if the doc uses that pattern

**Output**: Diff of changes made to the document.

---

### Domain 3: Capture — Work & Bug Intake

#### `capture:bug`
**Purpose**: Log a new bug with correct severity, location, and filing.

**Inputs**:
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `title` | string | Yes | Short bug description |
| `description` | string | Yes | Steps to reproduce, expected vs actual |
| `severity` | string | Yes | `"critical"`, `"high"`, `"medium"`, `"low"` |
| `location` | string | No | File path or feature area where bug occurs |
| `sub_product` | string | No | Which sub-product is affected |
| `found_in` | string | No | Branch or commit where discovered |

**Process**:
1. Read `docs/execution/BUGS.md`
2. Determine next bug ID (format: `BUG-{NNN}`)
3. Append to correct severity section
4. If severity is `critical` or `high`, also add a task to the active phase's project plan
5. Cross-reference with existing bugs to flag potential duplicates

**Output**:
```markdown
## Bug Logged

- **ID**: BUG-017
- **Title**: Widget preview fails for URLs with query params
- **Severity**: High
- **Filed to**: `docs/execution/BUGS.md` (High priority section)
- **Plan task created**: Phase 3 / Widget Rendering / "Fix BUG-017: query param handling"
- **Possible duplicate of**: BUG-009 (URL encoding issues) — review recommended
```

---

#### `capture:work`
**Purpose**: Capture a new piece of work (feature idea, enhancement, request) and file it correctly.

**Inputs**:
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `title` | string | Yes | What needs to be done |
| `description` | string | No | Details |
| `sub_product` | string | Yes | Which sub-product |
| `size` | string | No | `"small"` (task), `"medium"` (story), `"large"` (epic) |
| `urgency` | string | No | `"now"` (current phase), `"next"` (next phase), `"later"` (backlog) |

**Process**:
1. Determine the correct fidelity level (task/story/epic) from `size`
2. Determine filing location from `sub_product` + `urgency`
3. If `urgency` is `"now"`, add to current active phase under correct epic
4. If `urgency` is `"next"`, add to the next pending phase
5. If `urgency` is `"later"` or omitted, add to `backlog.md`
6. If `size` is `"large"`, create a new epic with placeholder stories
7. Update index counts

**Output**: Confirmation of where the item was filed, with a link to the file and line.

---

#### `capture:tech-debt`
**Purpose**: Log technical debt with context so it doesn't get lost.

**Inputs**:
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `title` | string | Yes | What the debt is |
| `description` | string | Yes | Why it matters, what breaks if ignored |
| `location` | string | Yes | File(s) affected |
| `effort` | string | No | `"trivial"`, `"small"`, `"medium"`, `"large"` |
| `risk` | string | No | `"low"`, `"medium"`, `"high"` — what happens if we don't fix it |

**Process**:
1. Add to `backlog.md` under a "Technical Debt" section (create if not exists)
2. If `risk` is `"high"`, also add to `risks.md`
3. If the debt relates to a specific sub-product, cross-reference with that sub-product's tech spec
4. Tag with effort estimate to help prioritization

**Output**: Confirmation with filing location and any cross-references created.

---

### Domain 4: UX — User Experience Documentation

#### `ux:update`
**Purpose**: Update UX documentation after a feature ships or changes.

**Inputs**:
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `feature_area` | string | Yes | `"boards"`, `"pins"`, `"widgets"`, `"users"` |
| `capability` | string | No | Specific capability within the area (e.g., `"grid-layout"`) |
| `changes` | string | Yes | What changed in the user experience |
| `source_files` | string[] | No | Implementation files to reference |
| `from_branch` | string | No | Infer UX changes from branch diff |

**Process**:
1. Read the current UX doc for the feature area
2. If `from_branch`: analyze UI-related code changes (HTML, CSS, JS event handlers) to determine UX impact
3. Update the doc:
   - Mark newly shipped features as ✅ Shipped
   - Update JTBD table if new jobs are supported
   - Add/update Technical Notes with file paths
   - Update ASCII wireframes if layout changed
4. Preserve the established UX doc format (User Goals → JTBD → Wireframes → Technical Notes)

**Output**:
```markdown
## UX Doc Updated — `docs/ux/widgets/ai-recommendations.md`

### Changes
- Marked "Product Grid widget" as ✅ Shipped
- Added JTBD row: "When I browse a product board | I want AI-curated alternatives | So I can discover better options"
- Updated wireframe to show new grid layout (4-column)
- Added Technical Notes: `boards/js/widgets/renderers/product-grid.js:render()`

### Sections Still Needing Update
- Wireframe for mobile view (not yet implemented)
```

---

#### `ux:audit`
**Purpose**: Compare UX documentation against the live codebase to find gaps.

**Inputs**:
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `feature_area` | string | No | Specific area or `"all"` |

**Process**:
1. Scan UI code (HTML files, JS UI handlers, CSS) for each feature area
2. Compare documented capabilities against implemented ones
3. Check for features in code that aren't documented
4. Check for documented features marked ⏳ that are actually shipped
5. Verify wireframes roughly match current HTML structure

**Output**:
```markdown
## UX Audit — {feature_area}

### Documented but Not Implemented
- "Keyboard shortcuts for board navigation" (marked ⏳, no code found)

### Implemented but Not Documented
- Drag-and-drop pin reordering (found in `boards/js/drag-handler.js`)
- Long-press context menu on mobile (found in `boards/js/mobile-interactions.js`)

### Status Corrections Needed
| Feature | Marked As | Should Be |
|---------|-----------|-----------|
| Category color coding | ⏳ Planned | ✅ Shipped (`boards/index.html:1420`) |

### Missing UX Docs
- No UX doc exists for admin panel features → should create `docs/ux/admin/index.md`
```

---

#### `ux:wireframe`
**Purpose**: Generate or update ASCII wireframes from current implementation.

**Inputs**:
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `feature_area` | string | Yes | Feature area to wireframe |
| `capability` | string | Yes | Specific capability |
| `viewport` | string | No | `"desktop"` (default), `"mobile"`, `"both"` |

**Process**:
1. Read the HTML/CSS for the feature
2. Analyze layout (flexbox/grid properties, media queries)
3. Generate ASCII wireframe showing current structure
4. Replace the existing wireframe in the UX doc (or add if missing)

**Output**: The ASCII wireframe plus the file it was written to.

---

### Domain 5: Branch — Cross-Branch Operations

#### `branch:diff`
**Purpose**: Compare documentation state between two branches to see what diverged.

**Inputs**:
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `base` | string | Yes | Base branch (usually `master`) |
| `compare` | string | Yes | Feature branch to compare |
| `scope` | string | No | `"all"`, `"plans"`, `"arch"`, `"ux"`, `"bugs"` |

**Process**:
1. `git diff {base}...{compare} -- docs/`
2. Categorize changes by documentation domain
3. Identify conflicting changes (same section edited in both branches)
4. Identify documentation that should have been updated on the feature branch but wasn't (code changed, docs didn't)

**Output**:
```markdown
## Documentation Diff — {base} vs {compare}

### Changed on {compare}
| File | Type | Summary |
|------|------|---------|
| `docs/execution/project-plan/phase-3-ai-intelligence.md` | Plan | 5 tasks marked complete |
| `docs/infrastructure/technical-design/ai-widget-system.md` | Arch | New "Template Registry" section |

### Potential Conflicts
- `BUGS.md` edited in both branches (different sections — auto-mergeable)

### Missing Doc Updates (code changed, docs didn't)
- `boards/js/widgets/renderers/` has 3 new files but `widget-architecture.md` unchanged
- `supabase/functions/generate-widget/index.ts` modified but `api-reference.md` unchanged
```

---

#### `branch:reconcile`
**Purpose**: Merge documentation changes from a feature branch back into the base, resolving conflicts.

**Inputs**:
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `source` | string | Yes | Branch with doc changes to merge |
| `target` | string | Yes | Branch to merge into |
| `strategy` | string | No | `"source-wins"`, `"target-wins"`, `"manual"` (default) |

**Process**:
1. Run `branch:diff` to identify all documentation differences
2. For non-conflicting changes: apply directly
3. For conflicts: apply strategy or present for manual resolution
4. After merge: run `plan:audit` on the result to verify consistency
5. Update index counts and cross-references

**Output**: List of files merged, conflicts resolved, and post-merge audit results.

---

#### `branch:cherry-pick-docs`
**Purpose**: Pull specific documentation updates from one branch to another without merging everything.

**Inputs**:
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `source` | string | Yes | Branch to pull docs from |
| `target` | string | Yes | Branch to apply docs to |
| `files` | string[] | No | Specific files to cherry-pick (or `"auto"` to pick docs that are ahead) |
| `domain` | string | No | Only cherry-pick docs from this domain: `"plans"`, `"arch"`, `"ux"`, `"bugs"` |

**Process**:
1. Identify documentation files on `source` that are newer than `target`
2. Filter by `files` or `domain` if specified
3. Apply changes to `target` branch
4. Verify no broken cross-references after cherry-pick

**Output**: List of files cherry-picked and verification results.

---

### Domain 6: Cleanup — Documentation Hygiene

#### `cleanup:stale`
**Purpose**: Find documentation that hasn't been updated relative to its subject's code changes.

**Inputs**:
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `threshold_days` | number | No | Days since last doc update to consider stale (default: 30) |
| `scope` | string | No | `"all"`, specific domain, or specific sub-product |

**Process**:
1. For each documentation file, find the last commit that touched it
2. For each doc's subject (mapped code files), find the last commit
3. If code is newer than doc by > `threshold_days`, flag as stale
4. Rank by staleness severity (days behind × importance of changes)

**Output**:
```markdown
## Stale Documentation Report — {date}

### Critical (code changed significantly, doc very outdated)
| Doc | Last Updated | Code Last Changed | Gap |
|-----|-------------|-------------------|-----|
| `ai-widget-system.md` | 2026-01-05 | 2026-02-06 | 32 days, 47 code commits |
| `database-schema.md` | 2025-12-20 | 2026-02-01 | 43 days, 12 migrations |

### Moderate (minor code changes, doc slightly behind)
| Doc | Last Updated | Code Last Changed | Gap |
|-----|-------------|-------------------|-----|

### Healthy (doc is current)
- 14/22 technical design docs are up to date
```

---

#### `cleanup:orphans`
**Purpose**: Find documentation that references things that no longer exist, and things that exist but have no documentation.

**Inputs**:
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `direction` | string | No | `"both"` (default), `"doc-without-code"`, `"code-without-doc"` |

**Process**:
1. **Doc → Code**: Scan docs for file path references, function names, and API endpoints. Verify each exists.
2. **Code → Doc**: Scan key code directories for modules/features that should have documentation. Check if they do.
3. Cross-reference `notion-structure.json` against actual files
4. Check for internal doc links that point to moved/deleted files

**Output**:
```markdown
## Orphan Report — {date}

### Dead References in Docs (doc points to code that doesn't exist)
| Doc | References | Status |
|-----|-----------|--------|
| `api-reference.md` | `POST /api/v1/boards/import` | Endpoint removed |
| `client-architecture.md` | `boards/js/legacy-renderer.js` | File deleted |

### Undocumented Code (code exists, no doc coverage)
| Code | Suggested Doc Location |
|------|----------------------|
| `boards/js/design-system-manifest.js` | `technical-design/client-architecture.md` |
| `supabase/functions/generate-widget/templates/` | `technical-design/ai-widget-system.md` §Templates |

### Broken Internal Links
| Source Doc | Link Target | Issue |
|-----------|-------------|-------|
| `phase-3-ai-intelligence.md` | `#widget-instrumentation` | Anchor doesn't exist |
```

---

#### `cleanup:duplicates`
**Purpose**: Find documentation that says the same thing in multiple places (drift risk).

**Inputs**:
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `scope` | string | No | `"all"` or specific domain |

**Process**:
1. Extract key claims/facts from each doc (schemas, endpoints, config values, feature descriptions)
2. Identify facts stated in multiple documents
3. Check if duplicated facts are consistent or contradictory
4. Recommend which doc should be the single source of truth for each fact

**Output**:
```markdown
## Duplicate Content Report — {date}

### Contradictions (same fact, different values)
| Fact | Doc A Says | Doc B Says | Recommended Source |
|------|-----------|-----------|-------------------|
| Widget cache TTL | "1 hour" (`ai-widget-system.md`) | "5 minutes" (`api-reference.md`) | `ai-widget-system.md` (matches code) |

### Redundant (same fact, consistent, multiple locations)
| Fact | Appears In | Keep In | Remove From |
|------|-----------|---------|------------|
| Supabase project refs | `CLAUDE.md`, `architecture.md`, `deployment.md` | `CLAUDE.md` (canonical) | Others → link to CLAUDE.md |
```

---

#### `cleanup:archive`
**Purpose**: Archive deprecated, superseded, or abandoned documentation.

**Inputs**:
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `files` | string[] | No | Specific files to archive |
| `auto` | boolean | No | Let agent identify candidates |
| `reason` | string | No | Why archiving (logged in archive README) |

**Process**:
1. If `auto`: identify archive candidates based on:
   - Docs for features that were removed
   - Docs superseded by newer versions
   - Docs with no code references and no updates in 90+ days
2. Move files to appropriate `archive/` directory using `git mv`
3. Update `notion-structure.json` to remove old entries
4. Update any docs that linked to archived files (add redirect note)
5. Update `archive/README.md` with what was archived and why

**Output**: List of files archived, redirects updated, and structure changes.

---

## Cross-Branch Workflow

The agent is designed to work on any branch, with awareness of the documentation state on other branches.

### Typical Flow: Feature Development

```
1. Developer starts feature branch from master
2. As code is written:
   - `capture:work` to log new tasks discovered during implementation
   - `capture:bug` to log bugs found while building
   - `arch:update-spec` to keep tech docs current with new code
3. Before PR:
   - `branch:diff base=master compare=feature-branch` to see what docs diverged
   - `ux:update` to reflect any UI changes
   - `plan:update from_branch=feature-branch` to mark completed tasks
4. After merge to master:
   - `cleanup:stale` to catch anything missed
   - `plan:audit scope=affected-phase` to verify plan is consistent
```

### Typical Flow: Sprint Planning

```
1. `plan:audit scope=all` — get current state
2. `cleanup:stale` — identify what needs updating before planning
3. `plan:rebalance auto=true` — check if phases need reorg
4. `capture:work` (multiple) — add new items from planning session
5. `arch:audit doc=all depth=surface` — verify docs match what was actually built
```

### Typical Flow: Documentation Maintenance (Weekly)

```
1. `cleanup:stale threshold_days=14` — find everything behind
2. `cleanup:orphans direction=both` — find disconnected docs/code
3. `cleanup:duplicates scope=all` — find contradictions
4. `ux:audit feature_area=all` — verify UX docs
5. `arch:sync since=7-days-ago` — catch up arch docs
6. `plan:audit checks=["counts","status-accuracy"]` — verify plan integrity
```

---

## Trigger Conditions

| Trigger | Functions Activated |
|---------|-------------------|
| Feature branch merged to master | `plan:update`, `arch:sync`, `ux:update`, `cleanup:stale` |
| New PRD created | `plan:add` (create epic from PRD), `arch:add-adr` if decisions made |
| Bug reported in conversation | `capture:bug` |
| "Add this to the plan" in conversation | `capture:work` or `plan:add` |
| Weekly schedule (Friday) | Full cleanup suite |
| Manual `/doc-agent {function}` | Specific function invoked |
| Sprint planning session | `plan:audit` + `plan:rebalance` |
| Architecture discussion | `arch:add-adr` + `arch:update-spec` |

---

## Configuration

```json
{
  "agent": "documentation",
  "version": "1.0",
  "stale_threshold_days": 30,
  "critical_stale_days": 60,
  "auto_archive_days": 90,
  "blocked_item_warning_days": 7,
  "in_progress_stale_days": 14,
  "audit_schedule": "weekly",
  "plan_count_auto_update": true,
  "require_escalation_for_moves_above": 10,
  "protected_files": [
    "docs/strategy/vision-and-roadmap.md",
    "CLAUDE.md"
  ]
}
```

---

## Integration with Other Agent Modes

| Agent Mode | Handoff |
|-----------|---------|
| **Documentation Sync** | After this agent updates content, Sync agent pushes to Notion |
| **Organizational** | Organizational validates that this agent's edits follow naming conventions |
| **Project Management** | PM mode creates initial plans; this agent maintains them ongoing |
| **Status Update** | Status agent reads plan state that this agent keeps current |
| **Security** | Security scans for secrets before this agent commits doc changes |
| **Chief of Staff** | Escalation target when this agent needs decisions |

---

## Output Standards

All function outputs follow these rules:

1. **Markdown formatted** — consistent with repo conventions
2. **Actionable** — every report ends with recommended actions
3. **Diff-friendly** — changes are described as before/after
4. **Traceable** — every change references the source (commit, branch, file:line)
5. **Idempotent** — running a function twice produces the same result if nothing changed
