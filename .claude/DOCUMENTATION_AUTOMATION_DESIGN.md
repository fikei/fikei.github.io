# Documentation Automation System Design

## Problem Statement
Need a **permanent, evolvable** system that automatically updates documentation on every push, works across all repositories, and can be maintained by Claude agents.

## Design Goals
1. **Automatic**: Updates on every git push
2. **Permanent**: Git hooks + session hooks
3. **Evolvable**: Configuration-driven, easy to modify
4. **Portable**: Templates work across all repos
5. **Smart**: Claude agents understand context and update appropriately

---

## Architecture

### Three-Layer System

```
┌─────────────────────────────────────────────────┐
│  Layer 1: Session Hooks                         │
│  - Instructs Claude to maintain docs            │
│  - Loaded at conversation start                 │
└─────────────────────────────────────────────────┘
              ↓
┌─────────────────────────────────────────────────┐
│  Layer 2: Configuration                          │
│  - Defines what to track                         │
│  - Specifies documentation files                 │
│  - Update rules and templates                    │
└─────────────────────────────────────────────────┘
              ↓
┌─────────────────────────────────────────────────┐
│  Layer 3: Git Hooks                              │
│  - Pre-push: Update docs before push            │
│  - Commit changes automatically                  │
└─────────────────────────────────────────────────┘
```

---

## Component Details

### 1. Session Start Hook
**File**: `.claude/hooks/session-start.md`

**Purpose**: Instructs Claude at the beginning of every session to maintain documentation

**Triggers**: Automatically at session start

**Content**:
```markdown
# Documentation Maintenance Instructions

You are working in a repository with automated documentation tracking.

## Your Responsibilities

1. **After significant changes**: Update the following documents:
   - `{PROJECT_ROADMAP}` - Mark completed features, update IN PROGRESS
   - `{CHANGELOG}` - Add entries for new features/fixes
   - `{CONTROLS_REFERENCE}` - Update when adding new controls/themes

2. **Before committing**: Ensure documentation reflects current state

3. **Configuration**: See `.claude/docs-config.json` for:
   - Which files to update
   - What information to track
   - Update templates

## Automation Support

- Git pre-push hook will remind you if docs are stale
- Configuration file defines tracking rules
- Templates guide content structure

**Read `.claude/docs-config.json` for project-specific details**
```

### 2. Documentation Configuration
**File**: `.claude/docs-config.json`

**Purpose**: Defines what to track and how to update

**Schema**:
```json
{
  "project": {
    "name": "Soundscape Audio-Reactive Visualizer",
    "type": "web-app",
    "language": "JavaScript"
  },
  "documentation": {
    "roadmap": {
      "file": "VJ_FEATURES_ROADMAP.md",
      "trackSections": ["IN PROGRESS", "COMPLETED"],
      "updateOn": ["feature-complete", "milestone"],
      "template": ".claude/templates/roadmap-entry.md"
    },
    "changelog": {
      "file": "CHANGELOG.md",
      "format": "keep-a-changelog",
      "updateOn": ["push"],
      "autoGenerate": false
    },
    "controls": {
      "file": "THEME_CONTROLS_REFERENCE.md",
      "trackSections": ["Themes", "Controls", "Audio Reactivity"],
      "updateOn": ["theme-added", "control-added"],
      "autoCalculate": ["total-controls", "theme-count"]
    }
  },
  "tracking": {
    "themes": {
      "source": "soundscape/index.html",
      "pattern": "config.themes.{name}",
      "extractControls": true
    },
    "features": {
      "source": "VJ_FEATURES_ROADMAP.md",
      "completionMarker": "✅",
      "inProgressMarker": "⏳"
    }
  },
  "automation": {
    "preCommitCheck": true,
    "prePushUpdate": true,
    "sessionReminder": true
  }
}
```

### 3. Git Pre-Push Hook
**File**: `.git/hooks/pre-push`

**Purpose**: Updates documentation before pushing to remote

**Triggers**: Before `git push`

**Behavior**:
1. Check if tracked files changed since last doc update
2. If changes detected, create reminder message
3. Exit with status 1 (block push) if docs are stale
4. User must update docs and try push again

**Implementation**:
```bash
#!/bin/bash
# Git pre-push hook - Documentation sync

CONFIG_FILE=".claude/docs-config.json"
ROADMAP_FILE="VJ_FEATURES_ROADMAP.md"
CHANGELOG_FILE="CHANGELOG.md"
CONTROLS_FILE="THEME_CONTROLS_REFERENCE.md"
SOURCE_FILE="soundscape/index.html"

# Check if documentation config exists
if [ ! -f "$CONFIG_FILE" ]; then
    echo "⚠️  No documentation config found at $CONFIG_FILE"
    exit 0
fi

# Get last commit hash of each file
SOURCE_COMMIT=$(git log -1 --format="%H" -- "$SOURCE_FILE" 2>/dev/null)
ROADMAP_COMMIT=$(git log -1 --format="%H" -- "$ROADMAP_FILE" 2>/dev/null)
CONTROLS_COMMIT=$(git log -1 --format="%H" -- "$CONTROLS_FILE" 2>/dev/null)

# Check if source changed more recently than docs
if [ -n "$SOURCE_COMMIT" ]; then
    SOURCE_TIME=$(git log -1 --format="%ct" -- "$SOURCE_FILE")
    ROADMAP_TIME=$(git log -1 --format="%ct" -- "$ROADMAP_FILE" 2>/dev/null || echo "0")
    CONTROLS_TIME=$(git log -1 --format="%ct" -- "$CONTROLS_FILE" 2>/dev/null || echo "0")

    if [ "$SOURCE_TIME" -gt "$ROADMAP_TIME" ] || [ "$SOURCE_TIME" -gt "$CONTROLS_TIME" ]; then
        echo ""
        echo "⚠️  DOCUMENTATION MAY BE STALE"
        echo ""
        echo "Source code changed more recently than documentation:"
        echo "  - $SOURCE_FILE: $(git log -1 --format='%cr' -- "$SOURCE_FILE")"
        echo "  - $ROADMAP_FILE: $(git log -1 --format='%cr' -- "$ROADMAP_FILE")"
        echo "  - $CONTROLS_FILE: $(git log -1 --format='%cr' -- "$CONTROLS_FILE")"
        echo ""
        echo "Please verify documentation is up to date before pushing."
        echo ""
        echo "To bypass this check: git push --no-verify"
        echo ""
        exit 1
    fi
fi

# All checks passed
exit 0
```

### 4. Documentation Templates
**Directory**: `.claude/templates/`

**Purpose**: Guide Claude on how to format documentation updates

**Templates**:

#### `roadmap-entry.md`
```markdown
## [Feature Name]

**Status**: ⏳ IN PROGRESS / ✅ COMPLETED
**Priority**: 🔥 High / 🟡 Medium / 🟢 Low
**Complexity**: 🔴 High / 🟡 Medium / 🟢 Low
**VJ Value**: 🔥 High / 🟡 Medium / 🟢 Low

### Description
[What does this feature do?]

### Implementation Details
- [ ] Component/file 1
- [ ] Component/file 2
- [ ] Integration point

### Testing
- [ ] Test case 1
- [ ] Test case 2

### Completion Criteria
- [ ] Criterion 1
- [ ] Criterion 2
```

#### `theme-controls-entry.md`
```markdown
## [THEME NAME] Theme (NEW/UPDATED)
**Visual Style**: [Brief description of visual appearance]

| Control | Type | Range | Default | Description |
|---------|------|-------|---------|-------------|
| controlName | slider/select | min-max/options | default | What it does |

**Audio Reactivity**:
- Bass: [How bass affects the theme]
- Mid: [How mids affect the theme]
- High: [How highs affect the theme]

**Total Controls**: [Number]
```

#### `changelog-entry.md`
```markdown
## [Version] - YYYY-MM-DD

### Added
- New feature description

### Changed
- Changed feature description

### Fixed
- Bug fix description

### Removed
- Removed feature description
```

---

## Workflow Examples

### Example 1: Adding a New Theme

1. **Claude implements theme** in `soundscape/index.html`
2. **Session hook reminds** Claude to update docs
3. **Claude updates**:
   - `THEME_CONTROLS_REFERENCE.md` (uses template)
   - `VJ_FEATURES_ROADMAP.md` (marks task complete)
4. **Claude commits** code + docs together
5. **Pre-push hook validates** docs are current
6. **Push succeeds** ✅

### Example 2: Forgetting to Update Docs

1. **Claude implements feature**
2. **Claude commits code** but forgets docs
3. **User runs** `git push`
4. **Pre-push hook detects** stale docs
5. **Push blocked** with reminder message
6. **Claude updates docs**
7. **User pushes again** ✅

### Example 3: New Repository Setup

1. **Copy template files**:
   ```bash
   cp -r /path/to/templates/.claude /new/repo/.claude
   ```
2. **Edit** `.claude/docs-config.json` with project details
3. **Install** git hook:
   ```bash
   cp .claude/hooks/pre-push .git/hooks/pre-push
   chmod +x .git/hooks/pre-push
   ```
4. **Session hook activates** automatically
5. **System ready** ✅

---

## Configuration Options

### Update Triggers

```json
"updateOn": [
  "feature-complete",  // When a feature is marked done
  "milestone",         // At major milestones
  "push",              // Before every push
  "theme-added",       // When new theme added
  "control-added",     // When new control added
  "daily"              // Once per day
]
```

### Automation Levels

```json
"automation": {
  "preCommitCheck": true,    // Warn if docs stale before commit
  "prePushUpdate": true,     // Block push if docs stale
  "sessionReminder": true,   // Remind Claude at session start
  "autoGenerate": false      // Generate docs from code (advanced)
}
```

---

## Evolution Path

### Phase 1: Manual + Reminders (Current Design)
- Session hooks remind Claude
- Git hooks validate
- Templates guide formatting

### Phase 2: Semi-Automatic
- Extract controls from code automatically
- Auto-calculate statistics
- Generate drafts for Claude to review

### Phase 3: Fully Automatic
- Parse code to extract all metadata
- Generate complete documentation
- Claude only reviews for accuracy

---

## Cross-Repository Portability

### Setup Script
**File**: `.claude/setup-docs-automation.sh`

```bash
#!/bin/bash
# Setup documentation automation for any repository

REPO_ROOT=$(git rev-parse --show-toplevel)
CLAUDE_DIR="$REPO_ROOT/.claude"

# Create directory structure
mkdir -p "$CLAUDE_DIR/hooks"
mkdir -p "$CLAUDE_DIR/templates"

# Copy template files (from this repo or global location)
TEMPLATE_SOURCE="${1:-$HOME/.claude-templates}"

if [ -d "$TEMPLATE_SOURCE" ]; then
    cp "$TEMPLATE_SOURCE/hooks/session-start.md" "$CLAUDE_DIR/hooks/"
    cp "$TEMPLATE_SOURCE/templates/"*.md "$CLAUDE_DIR/templates/"
    cp "$TEMPLATE_SOURCE/docs-config.json" "$CLAUDE_DIR/docs-config.json"

    # Install git hook
    cp "$TEMPLATE_SOURCE/hooks/pre-push" "$REPO_ROOT/.git/hooks/pre-push"
    chmod +x "$REPO_ROOT/.git/hooks/pre-push"

    echo "✅ Documentation automation installed"
    echo "📝 Edit .claude/docs-config.json with your project details"
else
    echo "❌ Template source not found: $TEMPLATE_SOURCE"
    exit 1
fi
```

### Global Template Storage
Store templates in `~/.claude-templates/` for reuse:

```
~/.claude-templates/
├── hooks/
│   ├── session-start.md
│   └── pre-push
├── templates/
│   ├── roadmap-entry.md
│   ├── theme-controls-entry.md
│   └── changelog-entry.md
└── docs-config.json (template)
```

---

## Implementation Checklist

- [ ] Create `.claude/docs-config.json`
- [ ] Create `.claude/hooks/session-start.md`
- [ ] Create `.claude/templates/` directory
- [ ] Write template files (roadmap, controls, changelog)
- [ ] Create `.git/hooks/pre-push` script
- [ ] Test pre-push hook with stale docs
- [ ] Test session hook activation
- [ ] Create setup script for portability
- [ ] Store global templates in `~/.claude-templates/`
- [ ] Document usage in repository README

---

## Benefits

1. **Consistency**: All repos use same documentation patterns
2. **Automation**: Reduces manual documentation burden
3. **Accuracy**: Hooks catch documentation drift
4. **Portability**: One-command setup for new repos
5. **Evolvability**: Configuration-driven, easy to extend
6. **Intelligence**: Claude understands context and updates appropriately

---

Last Updated: 2025-12-26
