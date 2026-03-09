# Claude Code Context - ctrl.rodeo

Personal curation platform — collect, organize, and build on everything that matters. Jekyll static site + Supabase backend + AI (Claude Haiku). Hosted at ctrl.rodeo via GitHub Pages.

**Stack:** Vanilla JS/HTML/CSS | Supabase Edge Functions (TypeScript/Deno) | Supabase PostgreSQL

### Brand Principles (Guide All Feature Decisions)
1. **Input shapes output** — surface connections and patterns in what users collect
2. **Organize as you go** — AI handles categorization; zero-friction capture
3. **One place, whole life** — don't silo interests; let connections emerge across categories
4. **Show, don't decorate** — minimal interface; the user's content is the design
5. **Expand with the user** — start simple, grow deep; progressive complexity

---

## Working With Me

**Repo:** `/Users/ian/Documents/GitHub/fikei.github.io`

1. **Plan hierarchy:** Phases > Epics > Stories > Tasks. "Work item" = any item; determine fidelity level and place in the project plan.
2. **Show complete code blocks** with full paths. Don't summarize when exact text is needed.
3. **End every response** with a "Next Steps" section (numbered steps + commands) or "No action needed."
4. **Plans** live in `docs/execution/project-plan/`. Never edit manually — use `/plan`.
5. **Notion sync:** update markdown in `docs/`, list in `notion-structure.json`, push. Details: `docs/infrastructure/NOTION-SYNC-GUIDE.md`.
6. **After significant work:** run `/pm changelog`.
7. **Design system:** check `design-system/` before any UI work. Document new CSS classes in `design-system/README.md`.
8. **Announce doc changes:** state file path and what changed.
9. **After shipping a feature:** `/plan` to update tasks + `/ux <area>` if UI changed.
10. **Widget work:** check `design-system/widgets.html` stoplight audit before starting (Green=ok, Yellow=needs dev action, Orange=needs review, Red=blocked).
11. **Never edit docs directly** — use Documentation Agent slash commands. After code work, recommend `/plan`, `/arch` (if architecture changed), `/ux` (if UI changed). See `.claude/agents/documentation-agent.md`.

---

## Autonomous Operations

### Session Startup (MANDATORY)
1. **Always create a new unique branch** — never reuse an existing feature branch
2. Branch naming: `claude/<topic>-<random-5-chars>` (e.g., `claude/fix-events-nav-Xk9mT`)
3. Base on `master` (pull latest first) unless user says to continue on a specific branch
4. Stay on that branch for the entire session
5. Stash uncommitted changes from previous sessions before creating new branch

### Git & GitHub
- **Always create a PR to merge into master** — never push directly
- **Always merge the PR when finished** — do not leave PRs open
- **Assign all PRs to `fikei`**
- **Close stale branches** after successful merges
- **Bump product versions** when their code changes (semver: Z=fix, Y=feature, X=breaking). Include bump in same commit.

  | Product | Version location | Console pattern |
  |---------|-----------------|-----------------|
  | Boards | `boards/index.html` ~line 6483: `const VERSION = 'X.Y.Z'` | `[boards] vX.Y.Z - description` |
  | Supabase functions | Each function's `index.ts` top: `const VERSION = 'X.Y.Z'` | `[function-name] vX.Y.Z - description` |

  New products/functions: add `const VERSION` + `console.log` at entry point.

### Supabase Deployment
- **Deploy updated edge functions after merge** — `supabase functions deploy <name>` without asking
- **Run database migrations** when migration files are in merged PR
- Deploy commands and project refs: `docs/infrastructure/deployment.md`

### Guardrails (require human approval)
- Force pushes
- Deleting branches with open PRs
- Schema changes that drop tables/columns
- Changing env vars or secrets in Supabase
- Modifying GitHub Actions workflows

---

## Code Style
- Read existing code before proposing changes. Check `/docs/` for relevant PRDs.
- Vanilla JS. No frameworks. Minimal abstraction.
- Dark mode first. Mobile responsive.
- Clear commit messages. Test locally before pushing.

---

## Applications

| App | Path | Key File | Purpose |
|-----|------|----------|---------|
| Boards | `boards/` | `boards/index.html` | Link curation + AI categorization |
| AI Widgets | `supabase/functions/generate-widget/` | `index.ts` | Product recommendations (Claude Haiku) |
| Soundscape | `soundscape/` | `PROJECT_PLAN.md` | Audio-reactive visualization |
| Systemic | `systemic/` | `js/crawler.js` | Design system analyzer |

**Supabase projects:** Boards (`yfhudwakpgzswiylhfbh`), Ops (`ycilriwjnmcelkspmfmg`), Systemic (`atdqdfpdeytfuvvpsasz`)

---

## Agents

One agent (Claude Code) with 8 operational modes. Definition: `.claude/agents/AGENT-DEFINITION.md`
Slash commands (`/plan /arch /capture /ux /branch /cleanup /pm`): `.claude/agents/documentation-agent.md`

---

**Docs layout:** `docs/strategy/prds/` (PRDs) | `docs/infrastructure/technical-design/` (tech specs) | `docs/execution/project-plan/` (plans) | `docs/ux/` (UX docs) | `*/archive/` (archived)

## Reference
- [Brand Positioning](./docs/strategy/brand-positioning.md) | [Personas](./docs/ux/personas.md)
- [Project Plan](./docs/execution/project-plan/index.md) | [Backlog](./docs/execution/project-plan/backlog.md) | [Bugs](./docs/execution/BUGS.md)
- [Deployment + Supabase Commands](./docs/infrastructure/deployment.md) | [Notion Sync Guide](./docs/infrastructure/NOTION-SYNC-GUIDE.md)
- [Design System](./design-system/README.md) | [AI Widget Architecture](./docs/infrastructure/technical-design/ai-widget-system.md)
