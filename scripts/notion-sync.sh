#!/bin/bash
# Notion Sync - Unified sync script for ctrl.rodeo
# Creates structure on first run, updates content on subsequent runs
# Run from repository root: ./scripts/notion-sync.sh

set -e

# Load environment variables
if [ -f ".env.local" ]; then
  export $(grep -v '^#' .env.local | xargs)
fi

# Check for API key
if [ -z "$NOTION_API_KEY" ]; then
  echo "Error: NOTION_API_KEY not found"
  echo "Please set it in .env.local or export it:"
  echo "  export NOTION_API_KEY=YOUR_NOTION_API_KEY"
  exit 1
fi

API_KEY="$NOTION_API_KEY"
API_VERSION="2022-06-28"
BASE_URL="https://api.notion.com/v1"

# Colors
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
RED='\033[0;31m'
NC='\033[0m'

# ═══════════════════════════════════════════════════════════════
# HELPER FUNCTIONS
# ═══════════════════════════════════════════════════════════════

find_page_by_title() {
  local title="$1"
  local response=$(curl -s -X POST "$BASE_URL/search" \
    -H "Authorization: Bearer $API_KEY" \
    -H "Notion-Version: $API_VERSION" \
    -H "Content-Type: application/json" \
    -d "{\"query\": \"$title\", \"filter\": {\"property\": \"object\", \"value\": \"page\"}}")

  echo "$response" | grep -o '"id":"[^"]*"' | head -1 | cut -d'"' -f4
}

create_page() {
  local parent_id="$1"
  local title="$2"
  local icon="$3"

  local response=$(curl -s -X POST "$BASE_URL/pages" \
    -H "Authorization: Bearer $API_KEY" \
    -H "Notion-Version: $API_VERSION" \
    -H "Content-Type: application/json" \
    -d "{
      \"parent\": { \"page_id\": \"$parent_id\" },
      \"icon\": { \"type\": \"emoji\", \"emoji\": \"$icon\" },
      \"properties\": {
        \"title\": {
          \"title\": [{ \"text\": { \"content\": \"$title\" } }]
        }
      }
    }")

  echo "$response" | grep -o '"id":"[^"]*"' | head -1 | cut -d'"' -f4
}

clear_page_content() {
  local page_id="$1"

  # Get existing blocks
  local blocks=$(curl -s -X GET "$BASE_URL/blocks/$page_id/children" \
    -H "Authorization: Bearer $API_KEY" \
    -H "Notion-Version: $API_VERSION")

  # Extract block IDs and delete them
  echo "$blocks" | grep -o '"id":"[^"]*"' | cut -d'"' -f4 | while read block_id; do
    if [ -n "$block_id" ] && [ "$block_id" != "$page_id" ]; then
      curl -s -X DELETE "$BASE_URL/blocks/$block_id" \
        -H "Authorization: Bearer $API_KEY" \
        -H "Notion-Version: $API_VERSION" > /dev/null 2>&1
    fi
  done
}

add_content_to_page() {
  local page_id="$1"
  local file="$2"

  # Read file (first 100 lines to avoid API limits)
  local content=$(head -100 "$file")

  # Create blocks array
  local blocks="["
  local first=true

  while IFS= read -r line; do
    [[ -z "$line" ]] && continue

    # Escape for JSON
    line=$(echo "$line" | sed 's/\\/\\\\/g' | sed 's/"/\\"/g' | sed 's/\t/    /g')

    [[ "$first" != true ]] && blocks+=","
    first=false

    if [[ "$line" =~ ^#\ (.+) ]]; then
      content="${BASH_REMATCH[1]}"
      blocks+="{\"object\":\"block\",\"type\":\"heading_1\",\"heading_1\":{\"rich_text\":[{\"type\":\"text\",\"text\":{\"content\":\"$content\"}}]}}"
    elif [[ "$line" =~ ^##\ (.+) ]]; then
      content="${BASH_REMATCH[1]}"
      blocks+="{\"object\":\"block\",\"type\":\"heading_2\",\"heading_2\":{\"rich_text\":[{\"type\":\"text\",\"text\":{\"content\":\"$content\"}}]}}"
    elif [[ "$line" =~ ^###\ (.+) ]]; then
      content="${BASH_REMATCH[1]}"
      blocks+="{\"object\":\"block\",\"type\":\"heading_3\",\"heading_3\":{\"rich_text\":[{\"type\":\"text\",\"text\":{\"content\":\"$content\"}}]}}"
    elif [[ "$line" =~ ^-\ (.+) ]]; then
      content="${BASH_REMATCH[1]}"
      blocks+="{\"object\":\"block\",\"type\":\"bulleted_list_item\",\"bulleted_list_item\":{\"rich_text\":[{\"type\":\"text\",\"text\":{\"content\":\"$content\"}}]}}"
    elif [[ "$line" == "---" ]]; then
      blocks+="{\"object\":\"block\",\"type\":\"divider\",\"divider\":{}}"
    else
      blocks+="{\"object\":\"block\",\"type\":\"paragraph\",\"paragraph\":{\"rich_text\":[{\"type\":\"text\",\"text\":{\"content\":\"$line\"}}]}}"
    fi
  done <<< "$content"

  blocks+="]"

  # Append blocks to page
  curl -s -X PATCH "$BASE_URL/blocks/$page_id/children" \
    -H "Authorization: Bearer $API_KEY" \
    -H "Notion-Version: $API_VERSION" \
    -H "Content-Type: application/json" \
    -d "{\"children\": $blocks}" > /dev/null
}

# Sync a page: create if missing, update content if file provided
sync_page() {
  local parent_id="$1"
  local title="$2"
  local icon="$3"
  local file="$4"
  local update_content="$5"  # "true" to update existing content

  echo -n "    $icon $title... "

  existing_id=$(find_page_by_title "$title")

  if [ -n "$existing_id" ]; then
    if [ "$update_content" = "true" ] && [ -n "$file" ] && [ -f "$file" ]; then
      clear_page_content "$existing_id"
      add_content_to_page "$existing_id" "$file"
      echo -e "${BLUE}updated${NC}"
    else
      echo -e "${YELLOW}exists${NC}"
    fi
    echo "$existing_id"
  else
    new_id=$(create_page "$parent_id" "$title" "$icon")
    if [ -n "$new_id" ]; then
      if [ -n "$file" ] && [ -f "$file" ]; then
        add_content_to_page "$new_id" "$file"
      fi
      echo -e "${GREEN}created${NC}"
      echo "$new_id"
    else
      echo -e "${RED}failed${NC}"
      echo ""
    fi
  fi
}

# ═══════════════════════════════════════════════════════════════
# MAIN SYNC
# ═══════════════════════════════════════════════════════════════

echo -e "${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${CYAN}  📁 Ctrl Rodeo - Notion Sync${NC}"
echo -e "${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo ""

# Parse arguments
UPDATE_CONTENT="false"
while [[ "$#" -gt 0 ]]; do
  case $1 in
    --update|-u) UPDATE_CONTENT="true" ;;
    --help|-h)
      echo "Usage: ./scripts/notion-sync.sh [options]"
      echo ""
      echo "Options:"
      echo "  --update, -u    Update content of existing pages"
      echo "  --help, -h      Show this help message"
      echo ""
      echo "First run creates the structure, subsequent runs skip existing pages."
      echo "Use --update to refresh content from markdown files."
      exit 0
      ;;
    *) echo "Unknown option: $1"; exit 1 ;;
  esac
  shift
done

if [ "$UPDATE_CONTENT" = "true" ]; then
  echo -e "${YELLOW}Mode: Update existing content${NC}"
else
  echo -e "${YELLOW}Mode: Create structure only${NC}"
fi
echo ""

# Find root page
echo "Finding Ctrl Rodeo root page..."
ROOT_ID=$(find_page_by_title "Ctrl Rodeo")

if [ -z "$ROOT_ID" ]; then
  echo -e "${RED}Root page 'Ctrl Rodeo' not found.${NC}"
  echo "Please create a page called 'Ctrl Rodeo' in Notion and share it with your integration."
  exit 1
fi

echo -e "  Root: $ROOT_ID"
echo ""

# ═══════════════════════════════════════════════════════════════
# 🎯 STRATEGY
# ═══════════════════════════════════════════════════════════════
echo -e "${BLUE}🎯 Strategy${NC}"

STRATEGY_ID=$(sync_page "$ROOT_ID" "Strategy" "🎯" "" "false")

if [ -n "$STRATEGY_ID" ]; then
  sync_page "$STRATEGY_ID" "Vision & Roadmap" "📄" "docs/VISION-AND-ROADMAP.md" "$UPDATE_CONTENT" > /dev/null

  PRDS_ID=$(sync_page "$STRATEGY_ID" "PRDs" "📄" "" "false")
  if [ -n "$PRDS_ID" ]; then
    for prd in docs/PRD-*.md; do
      [ -f "$prd" ] || continue
      filename=$(basename "$prd" .md)
      title=$(echo "$filename" | sed 's/PRD-//' | sed 's/-/ /g')
      sync_page "$PRDS_ID" "$title" "📋" "$prd" "$UPDATE_CONTENT" > /dev/null
    done
  fi

  sync_page "$STRATEGY_ID" "Decision Log (ADRs)" "📄" "docs/DECISION-LOG.md" "$UPDATE_CONTENT" > /dev/null
fi
echo ""

# ═══════════════════════════════════════════════════════════════
# 📦 PRODUCTS
# ═══════════════════════════════════════════════════════════════
echo -e "${BLUE}📦 Products${NC}"

PRODUCTS_ID=$(sync_page "$ROOT_ID" "Products" "📦" "" "false")

if [ -n "$PRODUCTS_ID" ]; then
  # Boards
  BOARDS_ID=$(sync_page "$PRODUCTS_ID" "Boards" "📋" "" "false")
  [ -n "$BOARDS_ID" ] && {
    sync_page "$BOARDS_ID" "Overview" "📄" "boards/README.md" "$UPDATE_CONTENT" > /dev/null
    sync_page "$BOARDS_ID" "Human TODOs" "👤" "" "false" > /dev/null
  }

  # Soundscape
  SOUNDSCAPE_ID=$(sync_page "$PRODUCTS_ID" "Soundscape" "🎵" "" "false")
  [ -n "$SOUNDSCAPE_ID" ] && {
    sync_page "$SOUNDSCAPE_ID" "Overview" "📄" "soundscape/README.md" "$UPDATE_CONTENT" > /dev/null
    sync_page "$SOUNDSCAPE_ID" "Human TODOs" "👤" "" "false" > /dev/null
  }

  # Systemic
  SYSTEMIC_ID=$(sync_page "$PRODUCTS_ID" "Systemic" "🔧" "" "false")
  [ -n "$SYSTEMIC_ID" ] && {
    sync_page "$SYSTEMIC_ID" "Overview" "📄" "systemic/README.md" "$UPDATE_CONTENT" > /dev/null
    sync_page "$SYSTEMIC_ID" "Human TODOs" "👤" "" "false" > /dev/null
  }

  # Favicon
  FAVICON_ID=$(sync_page "$PRODUCTS_ID" "Favicon Generator" "🎨" "" "false")
  [ -n "$FAVICON_ID" ] && {
    sync_page "$FAVICON_ID" "Overview" "📄" "favicon/README.md" "$UPDATE_CONTENT" > /dev/null
    sync_page "$FAVICON_ID" "Human TODOs" "👤" "" "false" > /dev/null
  }

  # Design System
  DESIGN_ID=$(sync_page "$PRODUCTS_ID" "Design System" "🎨" "" "false")
  [ -n "$DESIGN_ID" ] && {
    sync_page "$DESIGN_ID" "Overview" "📄" "design-system/README.md" "$UPDATE_CONTENT" > /dev/null
    sync_page "$DESIGN_ID" "Human TODOs" "👤" "" "false" > /dev/null
  }
fi
echo ""

# ═══════════════════════════════════════════════════════════════
# 🔨 EXECUTION
# ═══════════════════════════════════════════════════════════════
echo -e "${BLUE}🔨 Execution${NC}"

EXECUTION_ID=$(sync_page "$ROOT_ID" "Execution" "🔨" "" "false")

if [ -n "$EXECUTION_ID" ]; then
  sync_page "$EXECUTION_ID" "Global Backlog" "📊" "BACKLOG.md" "$UPDATE_CONTENT" > /dev/null
  sync_page "$EXECUTION_ID" "Current Sprint" "🏃" "docs/EXECUTION-SPRINT.md" "$UPDATE_CONTENT" > /dev/null
  sync_page "$EXECUTION_ID" "Recently Shipped" "✅" "docs/EXECUTION-SHIPPED.md" "$UPDATE_CONTENT" > /dev/null
  sync_page "$EXECUTION_ID" "Blocked/Waiting" "🚧" "docs/EXECUTION-BLOCKED.md" "$UPDATE_CONTENT" > /dev/null
fi
echo ""

# ═══════════════════════════════════════════════════════════════
# 🏗 INFRASTRUCTURE
# ═══════════════════════════════════════════════════════════════
echo -e "${BLUE}🏗 Infrastructure${NC}"

INFRA_ID=$(sync_page "$ROOT_ID" "Infrastructure" "🏗" "" "false")

if [ -n "$INFRA_ID" ]; then
  ARCH_ID=$(sync_page "$INFRA_ID" "Architecture" "📐" "" "false")
  [ -n "$ARCH_ID" ] && {
    sync_page "$ARCH_ID" "System Overview" "🗺️" "docs/INFRA-ARCHITECTURE.md" "$UPDATE_CONTENT" > /dev/null
  }

  DEPLOY_ID=$(sync_page "$INFRA_ID" "Deployment" "🚀" "" "false")
  [ -n "$DEPLOY_ID" ] && {
    sync_page "$DEPLOY_ID" "Overview" "📄" "docs/INFRA-DEPLOYMENT.md" "$UPDATE_CONTENT" > /dev/null
  }

  sync_page "$INFRA_ID" "Security" "🔒" "docs/INFRA-SECURITY.md" "$UPDATE_CONTENT" > /dev/null
  sync_page "$INFRA_ID" "Monitoring" "📈" "" "false" > /dev/null
fi
echo ""

# ═══════════════════════════════════════════════════════════════
# 🤖 AI AGENTS
# ═══════════════════════════════════════════════════════════════
echo -e "${BLUE}🤖 AI Agents${NC}"

AGENTS_ID=$(sync_page "$ROOT_ID" "AI Agents" "🤖" "" "false")

if [ -n "$AGENTS_ID" ]; then
  DEFS_ID=$(sync_page "$AGENTS_ID" "Agent Definitions" "📋" "" "false")
  if [ -n "$DEFS_ID" ]; then
    for agent in .claude/agents/*.md; do
      [ -f "$agent" ] || continue
      filename=$(basename "$agent" .md)
      title=$(echo "$filename" | sed 's/-/ /g' | sed 's/\b\(.\)/\u\1/g')
      sync_page "$DEFS_ID" "$title" "🤖" "$agent" "$UPDATE_CONTENT" > /dev/null
    done
  fi

  sync_page "$AGENTS_ID" "Workflows" "🔄" "" "false" > /dev/null
  sync_page "$AGENTS_ID" "Logs/Reports" "📊" "" "false" > /dev/null
fi
echo ""

# ═══════════════════════════════════════════════════════════════
# 📅 OPERATIONS
# ═══════════════════════════════════════════════════════════════
echo -e "${BLUE}📅 Operations${NC}"

OPS_ID=$(sync_page "$ROOT_ID" "Operations" "📅" "" "false")

if [ -n "$OPS_ID" ]; then
  sync_page "$OPS_ID" "Costs" "💰" "COSTS.md" "$UPDATE_CONTENT" > /dev/null
  sync_page "$OPS_ID" "Calendar" "📆" "" "false" > /dev/null
  sync_page "$OPS_ID" "Meeting Notes" "📝" "" "false" > /dev/null
  sync_page "$OPS_ID" "Admin" "⚙️" "" "false" > /dev/null
fi
echo ""

# ═══════════════════════════════════════════════════════════════
# DONE
# ═══════════════════════════════════════════════════════════════
echo -e "${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${GREEN}✅ Sync complete!${NC}"
echo -e "${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo ""
echo "View workspace: https://notion.so"
echo ""
echo "Usage:"
echo "  ./scripts/notion-sync.sh           # Create structure"
echo "  ./scripts/notion-sync.sh --update  # Update all content"
