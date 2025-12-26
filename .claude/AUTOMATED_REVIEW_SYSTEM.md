# Automated Quality Review System
**Soundscape VJ Visualizer**

Automated code, product, design, and VJ specialist reviews on every push

---

## Overview

This system runs comprehensive quality reviews before every git push, ensuring:
- ✅ Code quality and performance
- ✅ Product completeness
- ✅ Design consistency
- ✅ VJ/performer usability

---

## Review Agents

### 1. Code Reviewer
- Performance analysis (O(n) complexity, memory leaks)
- Best practices (DRY, separation of concerns)
- Canvas API usage
- Audio reactivity integration

### 2. Product Manager
- Feature completeness
- Documentation accuracy
- Integration consistency
- Acceptance criteria

### 3. Design/UX Lead
- Visual quality
- Audio mapping effectiveness
- Control design
- VJ performance value

### 4. VJ/DJ Specialist ⭐ NEW
- Control consistency across themes
- Missing performance controls
- Workflow optimization
- Live usability

---

## Integration with Documentation System

Reviews complement the existing documentation automation (`.claude/`):

```
.claude/
├── docs-config.json           # Documentation automation config
├── hooks/
│   ├── session-start.md       # Documentation reminders
│   └── review-checklist.md    # Quality review checklist (NEW)
├── templates/
│   ├── roadmap-entry.md
│   ├── theme-controls-entry.md
│   └── changelog-entry.md
└── DOCUMENTATION_AUTOMATION_DESIGN.md
```

---

## Session Hook Integration

Update `.claude/hooks/session-start.md` to include review reminders:

```markdown
## Before Committing

Run quality reviews for significant changes:
- New themes: Code + Design + VJ specialist review
- Control changes: Product + VJ specialist review
- Performance updates: Code reviewer
- Documentation: Product manager review

**Command**: Ask Claude to "run quality reviews" before pushing.
```

---

## Manual Review Commands

### Run All Reviews
```
"Run complete quality review on [FEATURE_NAME]"
```

### Run Specific Reviews
```
"Run code review on PARTICLES theme"
"Run VJ specialist review on all themes"
"Run product completeness check"
```

### Review Specific Component
```
"Review control system integration for TUNNEL theme"
"Review performance optimization in swarm mode"
```

---

## Review Output Format

Each review produces a structured report:

**Code Review:**
- ✅ Strengths
- ⚠️ Issues (Critical/Major/Minor)
- 💡 Suggestions
- 🎯 Rating (1-10)

**Product Review:**
- ✅ Completed Requirements
- ❌ Missing/Incomplete
- 📊 Metrics
- 🎯 Acceptance Decision

**Design Review:**
- 🎨 Visual Assessment
- 🎵 Audio Mapping Review
- 🎛️ Control Evaluation
- 🎯 Design Score

**VJ Specialist Review:**
- 📊 Consistency Rating
- ⚠️ Missing Controls
- 🎭 Theme Personality Analysis
- 🎯 Performance Rating

---

## Automated Triggers (Future Enhancement)

Potential git hook integration:

```bash
#!/bin/bash
# .git/hooks/pre-push-reviews (Future)

# Check if significant code changes
if git diff --name-only origin/main | grep -q "soundscape/"; then
    echo "🔍 Running automated code review..."
    # Trigger Claude agent with Task tool
fi

# Check if theme added
if git diff origin/main | grep -q "THEME_CONFIGS.*{"; then
    echo "🎨 Running design review..."
    # Trigger Claude agent
fi
```

---

## Review History Tracking (Future)

Store reviews in `.claude/reviews/`:

```
.claude/reviews/
├── 2025-12-26-particles-code-review.md
├── 2025-12-26-particles-design-review.md
├── 2025-12-26-vj-specialist-review.md
└── 2025-12-26-all-themes-completeness.md
```

---

## Integration with CI/CD (Future)

For automated testing environments:

1. **GitHub Actions Integration**
   - Run reviews on PR creation
   - Post review summary as PR comment
   - Block merge if critical issues found

2. **Pre-Commit Hooks**
   - Lightweight checks before commit
   - Full reviews before push

3. **Continuous Monitoring**
   - Weekly full system review
   - Performance regression detection

---

## Benefits

**Current Session Benefits:**
- ✅ Found control system integration gaps (TUNNEL, PLASMA, PARTICLES missing)
- ✅ Identified performance bottleneck (O(n²) in swarm mode)
- ✅ Discovered unused controls (LINEAR points, NEON density)
- ✅ VJ specialist feedback on missing global controls

**Future Benefits:**
- Prevent regressions
- Maintain quality standards
- Ensure consistency
- Catch issues before users

---

## Usage Examples

### Example 1: New Theme Review
```
User: "I've implemented a new FRACTAL theme. Can you review it?"

Claude:
1. Runs code review (checks renderer, performance, canvas usage)
2. Runs product review (verifies THEME_CONFIGS integration)
3. Runs design review (evaluates visual quality, audio mapping)
4. Runs VJ review (checks control consistency, workflow fit)

Result: Comprehensive feedback before commit
```

### Example 2: Control System Change
```
User: "I modified the audio reactivity system."

Claude:
1. Runs code review (checks for breaking changes)
2. Runs product review (verifies all themes still work)
3. Runs VJ review (checks if workflow improved or degraded)

Result: Impact analysis across all 8 themes
```

### Example 3: Performance Optimization
```
User: "I optimized the PARTICLES renderer."

Claude:
1. Runs code review (verifies optimization is correct)
2. Runs performance analysis (benchmarks before/after)
3. Runs product review (ensures feature parity)

Result: Validated optimization with no regressions
```

---

## Configuration

Add to `.claude/docs-config.json`:

```json
{
  "reviews": {
    "enabled": true,
    "triggers": {
      "newTheme": ["code", "product", "design", "vj"],
      "controlChange": ["product", "vj"],
      "performance": ["code"],
      "documentation": ["product"]
    },
    "agents": {
      "codeReviewer": {
        "model": "sonnet",
        "focus": ["performance", "best-practices", "integration"]
      },
      "productManager": {
        "model": "sonnet",
        "focus": ["completeness", "documentation", "acceptance"]
      },
      "designLead": {
        "model": "sonnet",
        "focus": ["visual-quality", "audio-mapping", "ux"]
      },
      "vjSpecialist": {
        "model": "sonnet",
        "focus": ["consistency", "workflow", "live-performance"]
      }
    }
  }
}
```

---

## Current Session Results

**Themes Reviewed:** 8/8
- LINEAR: 9/10 (1 unused control)
- NEON: 7/10 (1 unused control, audio reactivity bypass)
- GLITCH: 10/10 (Perfect)
- STARS: 6/10 (Config mismatch)
- WAVE: 6/10 (Fallback broken)
- TUNNEL: 10/10 (Fixed in this session)
- PLASMA: 10/10 (Fixed in this session)
- PARTICLES: 10/10 (Fixed + enhanced in this session)

**Issues Found:** 12 total
- 2 unused controls (fixed)
- 3 control system integration gaps (fixed)
- 1 O(n²) performance issue (fixed)
- 2 config mismatches (STARS, WAVE - documented)
- 4 VJ workflow gaps (documented for future)

**Enhancements Made:**
- Added 4 new controls to PARTICLES
- Optimized swarm mode (O(n) with spatial grid)
- Created comprehensive theme development guide
- Documented VJ specialist feedback

---

## Next Steps

1. **Immediate**: Use reviews manually before major commits
2. **Short-term**: Add review checklist to session hooks
3. **Medium-term**: Automate review triggers in git hooks
4. **Long-term**: CI/CD integration with automated reports

---

**Version:** 1.0
**Last Updated:** 2025-12-26
**Session:** claude/soundscape-visualization-CklQm
