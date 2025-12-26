# Documentation Maintenance Instructions

You are working in the **Soundscape Audio-Reactive Visualizer** repository with automated documentation tracking.

## Your Responsibilities

### 1. After Significant Changes

Update the following documents when you make changes:

- **`VJ_FEATURES_ROADMAP.md`**
  - Mark completed features with ✅
  - Move completed items from IN PROGRESS to appropriate sections
  - Update Phase 1.5 progress when themes are completed
  - Add new features to appropriate priority sections

- **`THEME_CONTROLS_REFERENCE.md`**
  - Add new themes with complete control listings
  - Update control tables when parameters change
  - Recalculate total control counts
  - Update summary table with new theme entries
  - Update theme status (PLANNED → NEW → UPDATED)

- **`CHANGELOG.md`** (if it exists)
  - Add entries for new features
  - Document breaking changes
  - Note bug fixes and improvements

### 2. Before Committing

Ensure documentation reflects the current state of the codebase:
- All new themes are documented
- Control counts are accurate
- Roadmap status markers are current
- Code changes are reflected in docs

### 3. Update Triggers

Update documentation when you:
- ✅ Complete a theme implementation
- ✅ Add new controls to existing themes
- ✅ Modify control ranges or defaults
- ✅ Complete a feature from the roadmap
- ✅ Make breaking changes to the API

### 4. Configuration Reference

See `.claude/docs-config.json` for:
- Which files to track
- Update frequency rules
- Template locations
- Project-specific settings

## Automation Support

- **Git pre-push hook**: Validates documentation is current before allowing push
- **Configuration file**: Defines what to track and how
- **Templates**: Guide content structure (`.claude/templates/`)

## Quality Reviews

### When to Run Reviews

Before committing significant changes, consider running quality reviews:

**New Theme:**
- Code reviewer (performance, best practices)
- Design lead (visual quality, audio mapping)
- VJ specialist (control consistency, workflow)
- Product manager (completeness check)

**Control System Changes:**
- Product manager (integration check)
- VJ specialist (workflow impact)

**Performance Optimizations:**
- Code reviewer (verify correctness)
- Product manager (feature parity)

**Command**: Ask Claude to "run quality reviews on [FEATURE_NAME]"

### Review Types Available

1. **Code Review** - Performance, best practices, canvas usage
2. **Product Review** - Completeness, documentation, acceptance
3. **Design Review** - Visual quality, UX, audio reactivity
4. **VJ Specialist Review** - Control consistency, live usability

See `.claude/AUTOMATED_REVIEW_SYSTEM.md` for details.

## Quick Reference

### Theme Documentation Template
When adding a new theme:
1. Add theme to `THEME_CONTROLS_REFERENCE.md` using template
2. Update summary table with control count
3. Mark theme as complete in `VJ_FEATURES_ROADMAP.md`

### Roadmap Updates
When completing a feature:
1. Change `[ ]` to `[x]` for completed items
2. Add ✅ marker to feature name
3. Move from IN PROGRESS to COMPLETED if entire feature is done

### Control Count Formula
Total controls = Sum of all theme control counts
- Count sliders, selects, and toggles
- Don't count read-only displays
- Update summary table when count changes

---

**Read `.claude/docs-config.json` for project-specific tracking details**
**See `.claude/AUTOMATED_REVIEW_SYSTEM.md` for quality review system**
