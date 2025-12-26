#!/bin/bash
# Setup documentation automation for any repository
# Usage: ./setup-docs-automation.sh [template-source-dir]

set -e

REPO_ROOT=$(git rev-parse --show-toplevel 2>/dev/null || echo ".")
CLAUDE_DIR="$REPO_ROOT/.claude"
GIT_HOOKS_DIR="$REPO_ROOT/.git/hooks"

# Colors
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
NC='\033[0m'

echo ""
echo -e "${BLUE}📚 Documentation Automation Setup${NC}"
echo ""

# Check if we're in a git repository
if [ ! -d "$REPO_ROOT/.git" ]; then
    echo "❌ Not a git repository"
    exit 1
fi

# Determine template source
TEMPLATE_SOURCE="${1:-$HOME/.claude-templates}"

# If template source doesn't exist, use current repo as source
if [ ! -d "$TEMPLATE_SOURCE" ]; then
    CURRENT_SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
    TEMPLATE_SOURCE="$(dirname "$CURRENT_SCRIPT_DIR")"
    echo -e "${YELLOW}Using current repository as template source${NC}"
fi

# Create directory structure
echo "Creating directory structure..."
mkdir -p "$CLAUDE_DIR/hooks"
mkdir -p "$CLAUDE_DIR/templates"

# Copy configuration file
if [ -f "$TEMPLATE_SOURCE/docs-config.json" ]; then
    if [ -f "$CLAUDE_DIR/docs-config.json" ]; then
        echo -e "${YELLOW}⚠️  docs-config.json already exists, skipping${NC}"
    else
        cp "$TEMPLATE_SOURCE/docs-config.json" "$CLAUDE_DIR/docs-config.json"
        echo -e "${GREEN}✅${NC} Created docs-config.json"
    fi
fi

# Copy session start hook
if [ -f "$TEMPLATE_SOURCE/hooks/session-start.md" ]; then
    cp "$TEMPLATE_SOURCE/hooks/session-start.md" "$CLAUDE_DIR/hooks/"
    echo -e "${GREEN}✅${NC} Created session-start.md hook"
fi

# Copy templates
if [ -d "$TEMPLATE_SOURCE/templates" ]; then
    cp "$TEMPLATE_SOURCE/templates/"*.md "$CLAUDE_DIR/templates/" 2>/dev/null || true
    echo -e "${GREEN}✅${NC} Created documentation templates"
fi

# Install git pre-push hook
if [ -d "$GIT_HOOKS_DIR" ]; then
    if [ -f "$GIT_HOOKS_DIR/pre-push" ]; then
        echo -e "${YELLOW}⚠️  pre-push hook already exists${NC}"
        echo "   Backup created at: pre-push.backup"
        cp "$GIT_HOOKS_DIR/pre-push" "$GIT_HOOKS_DIR/pre-push.backup"
    fi

    # Copy pre-push hook from .claude directory
    if [ -f "$CLAUDE_DIR/../.git/hooks/pre-push" ]; then
        cp "$CLAUDE_DIR/../.git/hooks/pre-push" "$GIT_HOOKS_DIR/pre-push"
    elif [ -f "$TEMPLATE_SOURCE/../.git/hooks/pre-push" ]; then
        cp "$TEMPLATE_SOURCE/../.git/hooks/pre-push" "$GIT_HOOKS_DIR/pre-push"
    fi

    chmod +x "$GIT_HOOKS_DIR/pre-push"
    echo -e "${GREEN}✅${NC} Installed pre-push hook"
fi

echo ""
echo -e "${GREEN}✅ Documentation automation installed successfully!${NC}"
echo ""
echo "Next steps:"
echo "  1. Edit .claude/docs-config.json with your project details"
echo "  2. Customize templates in .claude/templates/"
echo "  3. Start a new Claude session to activate hooks"
echo ""
echo "Files created:"
echo "  - .claude/docs-config.json"
echo "  - .claude/hooks/session-start.md"
echo "  - .claude/templates/*.md"
echo "  - .git/hooks/pre-push"
echo ""
