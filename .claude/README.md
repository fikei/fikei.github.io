# Claude Documentation Automation

This directory contains configuration and automation for maintaining project documentation.

## System Overview

The documentation automation system ensures that documentation stays synchronized with code changes through three mechanisms:

1. **Session Hooks** - Remind Claude to update documentation
2. **Git Hooks** - Validate documentation before push
3. **Templates** - Standardize documentation format

## Directory Structure

```
.claude/
├── README.md                        # This file
├── docs-config.json                 # Configuration for documentation tracking
├── DOCUMENTATION_AUTOMATION_DESIGN.md  # Full system design
├── hooks/
│   └── session-start.md            # Instructions loaded at session start
├── templates/
│   ├── roadmap-entry.md            # Template for roadmap entries
│   ├── theme-controls-entry.md     # Template for theme documentation
│   └── changelog-entry.md          # Template for changelog entries
└── setup-docs-automation.sh        # Installation script for other repos
```

## How It Works

### Session Start Hook

When Claude starts a new session, `hooks/session-start.md` is automatically loaded, providing instructions on:
- Which documentation files to maintain
- When to update documentation
- Templates to use for consistency

### Git Pre-Push Hook

Before each `git push`, the `.git/hooks/pre-push` script validates:
- Documentation files exist
- Documentation is as recent as source code
- No uncommitted source changes without doc changes

If validation fails, the push is blocked with a clear error message.

### Configuration

`docs-config.json` defines:
- **Project metadata**: Name, type, language
- **Tracked files**: Which documentation files to monitor
- **Update triggers**: When to update (theme-added, feature-complete, etc.)
- **Automation settings**: Hook behavior and validation rules

## Files Tracked

For this project:
- **`VJ_FEATURES_ROADMAP.md`** - Feature planning and progress
- **`THEME_CONTROLS_REFERENCE.md`** - Theme controls documentation
- **`soundscape/index.html`** - Source code (triggers doc updates)

## Update Rules

Documentation should be updated when:
- ✅ Completing a theme implementation
- ✅ Adding new controls to themes
- ✅ Modifying control ranges or defaults
- ✅ Completing roadmap features
- ✅ Making breaking changes

## Templates

Templates in `.claude/templates/` provide standardized formats:

### `roadmap-entry.md`
Use when adding features to the roadmap:
- Status markers (⏳/✅)
- Priority and complexity ratings
- Implementation checklist

### `theme-controls-entry.md`
Use when documenting new themes:
- Control table format
- Audio reactivity sections
- Consistent structure

### `changelog-entry.md`
Use for version changelog entries:
- Added/Changed/Fixed/Removed sections
- Semantic versioning format

## Testing the System

### Test 1: Stale Documentation Detection

```bash
# Make a change to source code
echo "// test" >> soundscape/index.html
git add soundscape/index.html
git commit -m "Test change"

# Try to push without updating docs
git push
# Should fail with warning about stale docs

# Update documentation
echo "Test update" >> THEME_CONTROLS_REFERENCE.md
git add THEME_CONTROLS_REFERENCE.md
git commit -m "Update docs"

# Push should now succeed
git push
```

### Test 2: Bypass Hook (When Needed)

```bash
# If you need to push without validation (use sparingly)
git push --no-verify
```

## Installing in Other Repositories

### Option 1: Manual Setup

1. Copy `.claude/` directory to new repository:
   ```bash
   cp -r /path/to/soundscape/.claude /new/repo/.claude
   ```

2. Edit `docs-config.json` with new project details

3. Install git hook:
   ```bash
   cp .claude/../.git/hooks/pre-push .git/hooks/pre-push
   chmod +x .git/hooks/pre-push
   ```

### Option 2: Automated Setup

```bash
cd /new/repo
/path/to/soundscape/.claude/setup-docs-automation.sh
```

Then edit `.claude/docs-config.json` with project-specific settings.

### Option 3: Global Templates

Store templates globally for reuse:

```bash
# Create global template directory
mkdir -p ~/.claude-templates

# Copy templates
cp -r .claude/* ~/.claude-templates/

# Use in any new repo
cd /new/repo
~/.claude-templates/setup-docs-automation.sh
```

## Configuration Examples

### Minimal Configuration

```json
{
  "project": {
    "name": "My Project",
    "type": "web-app"
  },
  "documentation": {
    "readme": {
      "file": "README.md",
      "updateOn": ["feature-complete"]
    }
  },
  "automation": {
    "prePushUpdate": true
  }
}
```

### Full Configuration

See `docs-config.json` for complete example with all options.

## Customization

### Disable Hook Temporarily

```bash
# Disable pre-push validation
# Edit .claude/docs-config.json:
"automation": {
  "prePushUpdate": false
}
```

### Add New Tracked Files

```json
"documentation": {
  "api": {
    "file": "API.md",
    "updateOn": ["endpoint-added", "schema-changed"],
    "template": ".claude/templates/api-entry.md"
  }
}
```

### Custom Update Triggers

```json
"updateOn": [
  "feature-complete",
  "breaking-change",
  "api-version-bump",
  "theme-added"
]
```

## Troubleshooting

### Hook Not Running

```bash
# Verify hook is executable
ls -la .git/hooks/pre-push
# Should show: -rwxr-xr-x

# If not, make executable
chmod +x .git/hooks/pre-push
```

### Hook Blocking Valid Push

```bash
# Check if automation is enabled
grep "prePushUpdate" .claude/docs-config.json

# Temporarily bypass
git push --no-verify
```

### Session Hook Not Loading

Session hooks are loaded automatically by Claude Code. If you don't see documentation reminders:
1. Verify `hooks/session-start.md` exists
2. Check Claude Code hook configuration
3. Start a fresh session

## Evolution

This system is designed to evolve:

**Phase 1 (Current)**: Manual updates with validation
- Claude updates docs based on instructions
- Git hooks validate before push

**Phase 2 (Future)**: Semi-automatic
- Extract controls from code automatically
- Auto-calculate statistics
- Generate draft updates for review

**Phase 3 (Future)**: Fully automatic
- Parse code to extract metadata
- Generate complete documentation
- Claude reviews for accuracy

## Support

For questions or issues with the documentation system:
1. Read `DOCUMENTATION_AUTOMATION_DESIGN.md` for detailed architecture
2. Check `docs-config.json` for current configuration
3. Review templates in `.claude/templates/`

---

Last Updated: 2025-12-26
Version: 1.0.0
