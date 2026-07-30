> **Archived from an orphaned branch.** Recovered from `claude/setup-openclaw-context-m1JKS` (last touched 2026-02-15),
> which shares no history with master after the repository history was rewritten.
> Kept for the thinking in it; nothing here is current.

# OpenClaw → Claude Code Build Prompt Protocol

> Defines the exact format, fields, and structure that OpenClaw should use when generating build prompts for Claude Code sessions on **ctrl.rodeo**.

---

## 1. Required Fields

Every build prompt must include these fields. Claude Code will ask clarifying questions for anything missing — which is wasted round-trips.

| # | Field | Purpose | Example | Required? |
|---|-------|---------|---------|-----------|
| 1 | **Goal** | One sentence: what should be true when done | "Users can share a board via public URL" | **Must** |
| 2 | **Scope** | Explicit boundaries — what to change and what NOT to touch | "Modify `boards/index.html` and add a new edge function. Do not change the design system." | **Must** |
| 3 | **Acceptance Criteria** | Testable conditions (see §3) | "Given a board with 3 pins, when I click Share, a public URL is generated and loads in incognito" | **Must** |
| 4 | **Affected Files** | Files to read/modify (paths from repo root) | `boards/index.html`, `supabase/functions/share-board/index.ts` | **Must** |
| 5 | **Branch** | Branch name to work on | `claude/share-boards-Xk9mT` | **Must** |
| 6 | **Context Snippet** | Relevant code excerpts, PRD sections, or architectural constraints | See §4 for format | **Must** |
| 7 | **Constraints** | Tech stack rules, patterns to follow, things to avoid | "No frameworks. Vanilla JS only. Dark mode first. Must work on mobile." | **Must** |
| 8 | **Category** | Type of work: `feature`, `bugfix`, `refactor`, `docs`, `infra` | `feature` | *High leverage* |
| 9 | **Related Docs** | Links to PRDs, tech specs, or design system references | `docs/strategy/prds/boards-mvp.md` | *High leverage* |
| 10 | **Test Commands** | How to verify the work | "Open `boards/index.html` in browser, add a pin, click Share" | *High leverage* |
| 11 | **Deploy Steps** | Post-merge actions | `supabase functions deploy share-board --project-ref yfhudwakpgzswiylhfbh` | *High leverage* |
| 12 | **Dependencies** | Other tasks/PRs this depends on or blocks | "Requires #98 merged first" | *Optional* |

---

## 2. Ideal Prompt Order

The sections should appear in this exact order. The rationale: I parse top-down, and each section narrows the solution space for everything below it.

```
1. GOAL          — Sets the mental model. Everything else is evaluated against this.
2. CATEGORY      — Tells me the shape of the work (new code vs. fixing existing).
3. SCOPE         — Eliminates 90% of the codebase from consideration.
4. CONSTRAINTS   — Prevents me from reaching for wrong patterns.
5. CONTEXT       — Now I'm ready to absorb details with the right frame.
6. AFFECTED FILES — Directs my file reads.
7. ACCEPTANCE CRITERIA — I now know what "done" looks like.
8. TEST COMMANDS — How to verify.
9. DEPLOY STEPS  — What happens after merge.
10. RELATED DOCS — Background reading, lowest priority but available.
```

**Why this order reduces errors:**
- **Goal + Category first** prevents me from solving the wrong problem.
- **Scope + Constraints before Context** means I don't waste time reading irrelevant code or proposing forbidden patterns.
- **Acceptance Criteria after Context** means I can cross-reference them against reality.
- **Deploy Steps last** because they're post-implementation; putting them early creates noise.

---

## 3. Acceptance Criteria Standard

### Format: Given/When/Then checklist

Every criterion must be **independently testable**. Use this format:

```markdown
## Acceptance Criteria
- [ ] Given [precondition], when [action], then [observable result]
- [ ] Given [precondition], when [action], then [observable result]
- [ ] Build completes without errors
- [ ] No new lint warnings introduced
- [ ] Works on mobile viewport (375px)
- [ ] Dark mode renders correctly
```

### Standard verification checklist (append to every prompt)

```markdown
## Verification Checklist
- [ ] All acceptance criteria met
- [ ] No hardcoded secrets or API keys in committed code
- [ ] Mobile responsive (tested at 375px width)
- [ ] Dark mode first (no light-mode-only styles)
- [ ] Commit messages are clear and descriptive
- [ ] PR created and merged to master
- [ ] Edge functions deployed (if changed)
```

---

## 4. Repo Context & File Handling

### File paths
Always use **repo-root-relative paths**. Never absolute paths in prompts.

```
Good: boards/index.html
Good: supabase/functions/enrich-link/index.ts
Bad:  /Users/ian/Documents/GitHub/fikei.github.io/boards/index.html
```

### File excerpts
Provide the **function or block** that matters, with line numbers and file path. Keep excerpts under 100 lines — I can read the full file myself.

```markdown
### Context: `boards/index.html:1842-1870`
```js
function addPin(url, category) {
  const pin = {
    id: crypto.randomUUID(),
    url: url,
    category: category || 'uncategorized',
    created: new Date().toISOString()
  };
  pins.push(pin);
  saveToLocalStorage();
  renderBoard();
}
`` `
```

### Referencing existing functions/classes
Use the format `file_path:function_name` or `file_path:line_number`:

```
boards/index.html:addPin
boards/index.html:1842
supabase/functions/enrich-link/index.ts:enrichUrl
```

### Minimum repo snapshot needed
I have full file access, so I don't need a repo dump. Instead provide:

1. **Affected file paths** (I'll read them myself)
2. **Relevant excerpts** only if they save me from reading a 5000-line file to find the right section
3. **Architecture constraints** — which Supabase project, which edge function pattern to follow

**Do not** paste entire files into the prompt. Point me to them and I'll read what I need.

---

## 5. Diff / Patch Preference

### Preferred: Stepwise natural-language edits

I work best when told **what to change and why**, not given pre-computed diffs. I generate my own edits using the Edit tool.

```markdown
## Changes Needed
1. In `boards/index.html`, add a "Share" button to the board header (after the board title)
2. Create `supabase/functions/share-board/index.ts` following the pattern in `enrich-link/index.ts`
3. Add a `shared_boards` table — provide the schema below
```

### Acceptable: Unified diffs (for precise, surgical changes)

If the change is very specific (e.g., a one-line config fix), a unified diff is fine:

```diff
--- a/boards/index.html
+++ b/boards/index.html
@@ -42,7 +42,7 @@
-  const API_VERSION = 'v5';
+  const API_VERSION = 'v6';
```

### Avoid
- File-by-file full replacements (wasteful, error-prone)
- Pseudo-code descriptions of changes ("make it better", "optimize this")

---

## 6. Resume-Session Method

When resuming work across sessions, provide this state bundle:

```markdown
## Resume Context

### Branch
claude/share-boards-Xk9mT

### Last completed step
3 of 7 — "Created share-board edge function"

### Remaining work
4. Wire Share button to edge function call
5. Add clipboard copy feedback
6. Test on mobile
7. Create PR and merge

### Key decisions already made
- Using signed URLs (not public by default)
- 24-hour expiry on share links
- No authentication required to view shared board

### Current blockers
None

### Files modified so far
- boards/index.html (Share button HTML added)
- supabase/functions/share-board/index.ts (created)
- supabase/migrations/20260215_shared_boards.sql (created)
```

**Minimum fields for resume:**
1. **Branch name** — so I can check git log and diff
2. **Last completed step** — so I don't redo work
3. **Remaining work** — so I know what's next
4. **Key decisions** — so I don't re-debate settled choices

If the branch exists, I can reconstruct most context from `git log` and `git diff master...HEAD`. But explicit decisions and remaining work save significant time.

---

## 7. Noise to Exclude

### Do not include
| Noise | Why it hurts |
|-------|-------------|
| Product philosophy / brand manifesto | Already in CLAUDE.md; repeating it wastes tokens |
| Full file dumps | I have file access; point me to paths |
| Conversation history | Start fresh; use Resume Context (§6) if continuing |
| Multiple competing approaches | Pick one. If unsure, say "recommend an approach" as the goal |
| Vague praise/motivation | "Make it awesome" adds nothing |
| Implementation details I should decide | "Use whatever data structure works best" — just state the constraint |

### Common failure modes in prompts

| Failure Mode | Result | Prevention |
|-------------|--------|------------|
| **No acceptance criteria** | I build something, you reject it, repeat 3x | Always include testable criteria (§3) |
| **Scope too broad** | I touch 20 files, introduce regressions | Limit scope to one feature/fix per prompt |
| **Contradictory constraints** | I stall asking for clarification | Review constraints for conflicts before sending |
| **Missing file references** | I search the wrong area of the codebase | List affected files explicitly (§1, field 4) |
| **Assumed knowledge** | I hallucinate how your auth works | Include relevant excerpts or point to docs |
| **"Fix everything" goal** | Unfocused work, nothing ships | One goal per prompt, always |
| **Pre-computed solution** | You paste a diff but it doesn't apply; I waste time debugging your diff | Describe the change; let me implement it |

---

## 8. Example: Perfect Feature Prompt

```markdown
## Goal
Users can share a board via a public URL that shows a read-only view of their pins.

## Category
feature

## Scope
- Modify: `boards/index.html` (add Share button, share modal, public view mode)
- Create: `supabase/functions/share-board/index.ts`
- Create: `supabase/migrations/20260215_shared_boards.sql`
- Do NOT modify: design system files, other edge functions, events page

## Constraints
- Vanilla JS only, no frameworks
- Dark mode first
- Mobile responsive (must work at 375px)
- Follow edge function pattern from `supabase/functions/enrich-link/index.ts`
- Supabase project: Boards (ref: yfhudwakpgzswiylhfbh)
- Share links expire after 24 hours
- No authentication required to view a shared board

## Context
### How pins are stored: `boards/index.html:1842-1860`
[relevant excerpt here]

### Current board header: `boards/index.html:320-335`
[relevant excerpt here]

### Edge function pattern: `supabase/functions/enrich-link/index.ts:1-30`
[relevant excerpt showing the Deno serve pattern, CORS headers, etc.]

## Affected Files
- boards/index.html
- supabase/functions/share-board/index.ts (new)
- supabase/migrations/20260215_shared_boards.sql (new)

## Acceptance Criteria
- [ ] Given a board with 3+ pins, when I click "Share", a modal appears with a generated URL
- [ ] Given a share URL, when I open it in incognito, the board renders read-only with all pins visible
- [ ] Given a share link older than 24 hours, when I open it, I see an "expired" message
- [ ] Given a mobile viewport (375px), the share modal and public view are usable
- [ ] Given dark mode, all share UI elements render correctly
- [ ] Build completes without errors
- [ ] No hardcoded secrets in committed code

## Test Commands
1. Open `boards/index.html` locally
2. Add 3 test pins
3. Click Share, copy URL
4. Open URL in incognito — verify read-only view
5. Verify mobile layout at 375px

## Deploy Steps
supabase link --project-ref yfhudwakpgzswiylhfbh
supabase functions deploy share-board
supabase db push (for migration)

## Related Docs
- docs/strategy/prds/boards-mvp.md
- docs/infrastructure/technical-design/ai-widget-system.md (for Supabase patterns)
```

---

## 9. Example: Bugfix Prompt

```markdown
## Goal
Fix: Pins with YouTube URLs show a broken thumbnail instead of the video preview image.

## Category
bugfix

## Scope
- Modify: `boards/index.html` (pin rendering logic)
- Possibly modify: `supabase/functions/enrich-link/index.ts` (if the enrichment response is wrong)
- Do NOT modify: widget system, design system, other categories

## Constraints
- YouTube URLs come in multiple formats: youtube.com/watch?v=, youtu.be/, youtube.com/shorts/
- Must handle all three formats
- Do not break existing thumbnail rendering for non-YouTube URLs

## Context
### Bug reproduction
1. Add pin with URL: https://www.youtube.com/watch?v=dQw4w9WgXcQ
2. Pin appears with broken image icon instead of thumbnail
3. Expected: YouTube thumbnail from img.youtube.com/vi/{id}/hqdefault.jpg

### Current thumbnail logic: `boards/index.html:2100-2130`
```js
function getThumbnail(pin) {
  if (pin.enrichment?.image) return pin.enrichment.image;
  return pin.metadata?.ogImage || '/img/placeholder.png';
}
`` `

### Enrich-link response for YouTube URLs
The `enrich-link` function returns `ogImage` but it's a relative URL without the domain prefix.

## Affected Files
- boards/index.html (getThumbnail function, ~line 2100)
- supabase/functions/enrich-link/index.ts (YouTube-specific handling, if needed)

## Acceptance Criteria
- [ ] Given a youtube.com/watch?v= URL, the correct thumbnail renders
- [ ] Given a youtu.be/ short URL, the correct thumbnail renders
- [ ] Given a youtube.com/shorts/ URL, the correct thumbnail renders
- [ ] Given a non-YouTube URL with a valid ogImage, thumbnails still work as before
- [ ] Given a URL with no image at all, the placeholder still renders

## Test Commands
1. Add pins for all 3 YouTube URL formats
2. Verify thumbnails render for each
3. Add a non-YouTube pin (e.g., nytimes.com article) — verify it still works
4. Add a pin with no og:image — verify placeholder appears

## Related Docs
- docs/infrastructure/technical-design/ai-widget-system.md §Pin Enrichment
```

---

## 10. ctrl.rodeo Product Context (For OpenClaw Reference)

When generating prompts for ctrl.rodeo, OpenClaw should know these constants — they don't need to be repeated in every prompt because they live in `CLAUDE.md`, but OpenClaw needs them to generate correct prompts.

### Product Identity
- **Name**: ctrl.rodeo
- **What it is**: Personal curation platform — collect, organize, build on everything that matters
- **Primary audience**: Creatives (artists, designers, musicians, DJs)
- **Tagline**: Your likes. Your saves. Your life — organized.

### Brand Principles (inform every feature decision)
1. Input shapes output
2. Organize as you go (AI handles categorization)
3. One place, whole life (no silos)
4. Show, don't decorate (minimal UI, content is the design)
5. Expand with the user (progressive complexity)

### Tech Stack Constants
- Frontend: HTML/CSS/vanilla JS (no frameworks, ever)
- Backend: Supabase Edge Functions (TypeScript/Deno)
- AI: Claude 3 Haiku (primary), GPT-4o mini (fallback)
- Database: Supabase PostgreSQL
- Hosting: GitHub Pages at ctrl.rodeo
- Design: Dark mode first, mobile responsive, black/white aesthetic

### Supabase Projects
| Project | Ref ID | Purpose |
|---------|--------|---------|
| Boards | `yfhudwakpgzswiylhfbh` | Main app |
| Ops | `ycilriwjnmcelkspmfmg` | Automation |
| Systemic | `atdqdfpdeytfuvvpsasz` | Design tools |

### Content Categories
home, wear, watch, listen, use, eat, go, follow, read

### Process Rules
- Always create feature branch (`claude/<topic>-<random>`)
- Always create PR to merge to master (never push directly)
- Always merge the PR when done
- Deploy edge functions after merge if changed
- GitHub is source of truth for all documentation

### What CLAUDE.md Already Covers
OpenClaw should **not** repeat these in prompts — Claude Code reads them automatically:
- Directory structure
- Design system rules
- Commit practices
- Documentation agent commands
- Supabase config and deploy commands
- Widget design audit workflow
- Autonomous operation permissions

---

## Quick Reference: Prompt Template

Copy and fill in:

```markdown
## Goal
[One sentence: what should be true when done]

## Category
[feature | bugfix | refactor | docs | infra]

## Scope
- Modify: [file paths]
- Create: [new file paths]
- Do NOT modify: [exclusions]

## Constraints
[Tech rules, patterns to follow, things to avoid]

## Context
[Relevant code excerpts with file_path:line_numbers]

## Affected Files
[List of all files to read or modify]

## Acceptance Criteria
- [ ] Given [precondition], when [action], then [result]
- [ ] ...

## Verification Checklist
- [ ] All acceptance criteria met
- [ ] No hardcoded secrets
- [ ] Mobile responsive (375px)
- [ ] Dark mode correct
- [ ] Commits are clean
- [ ] PR created and merged
- [ ] Edge functions deployed (if changed)

## Test Commands
[Steps to verify manually]

## Deploy Steps
[Post-merge commands, if any]

## Related Docs
[Paths to PRDs, specs, design docs]
```
