#!/bin/bash
# Full Structure Sync to Notion
# Creates the complete Ctrl Rodeo workspace hierarchy
# Run from repository root: ./scripts/sync-full-structure-to-notion.sh

set -e

# Load environment variables
if [ -f ".env.local" ]; then
  export $(grep -v '^#' .env.local | xargs)
fi

# Check for API key
if [ -z "$NOTION_API_KEY" ]; then
  echo "Error: NOTION_API_KEY not found"
  echo "Please set it in .env.local or export it"
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
NC='\033[0m'

echo -e "${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${CYAN}  📁 Ctrl Rodeo - Full Structure Sync${NC}"
echo -e "${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo ""

# Function to find page ID by title
find_page_by_title() {
  local title="$1"
  local response=$(curl -s -X POST "$BASE_URL/search" \
    -H "Authorization: Bearer $API_KEY" \
    -H "Notion-Version: $API_VERSION" \
    -H "Content-Type: application/json" \
    -d "{\"query\": \"$title\", \"filter\": {\"property\": \"object\", \"value\": \"page\"}}")

  echo "$response" | grep -o '"id":"[^"]*"' | head -1 | cut -d'"' -f4
}

# Function to create a page under a parent
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

# Function to add content to a page from a file
add_content_to_page() {
  local page_id="$1"
  local file="$2"

  # Read file and convert to blocks (first 100 lines to avoid API limits)
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

# Helper to create page or skip if exists
create_or_skip() {
  local parent_id="$1"
  local title="$2"
  local icon="$3"
  local file="$4"  # Optional file to add content from

  echo -n "    $icon $title... "
  existing_id=$(find_page_by_title "$title")

  if [ -n "$existing_id" ]; then
    echo -e "${YELLOW}exists${NC}"
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
      echo -e "${YELLOW}failed${NC}"
      echo ""
    fi
  fi
}

# Find root page
echo "Finding Ctrl Rodeo root page..."
ROOT_ID=$(find_page_by_title "Ctrl Rodeo")

if [ -z "$ROOT_ID" ]; then
  echo -e "${YELLOW}Root page 'Ctrl Rodeo' not found.${NC}"
  echo "Please create a page called 'Ctrl Rodeo' and share it with the integration."
  exit 1
fi

echo -e "  Root: $ROOT_ID"
echo ""

# ═══════════════════════════════════════════════════════════════
# 🎯 STRATEGY SECTION
# ═══════════════════════════════════════════════════════════════
echo -e "${BLUE}🎯 Creating Strategy Section...${NC}"

STRATEGY_ID=$(create_or_skip "$ROOT_ID" "Strategy" "🎯" "")

if [ -n "$STRATEGY_ID" ]; then
  # Vision & Roadmap
  create_or_skip "$STRATEGY_ID" "Vision & Roadmap" "📄" "docs/VISION-AND-ROADMAP.md" > /dev/null

  # PRDs container
  PRDS_ID=$(create_or_skip "$STRATEGY_ID" "PRDs" "📄" "")

  if [ -n "$PRDS_ID" ]; then
    # Individual PRDs
    for prd in docs/PRD-*.md; do
      if [ -f "$prd" ]; then
        filename=$(basename "$prd" .md)
        title=$(echo "$filename" | sed 's/PRD-//' | sed 's/-/ /g')
        create_or_skip "$PRDS_ID" "$title" "📋" "$prd" > /dev/null
      fi
    done
  fi

  # Decision Log
  create_or_skip "$STRATEGY_ID" "Decision Log (ADRs)" "📄" "docs/DECISION-LOG.md" > /dev/null
fi

echo ""

# ═══════════════════════════════════════════════════════════════
# 📦 PRODUCTS SECTION
# ═══════════════════════════════════════════════════════════════
echo -e "${BLUE}📦 Creating Products Section...${NC}"

PRODUCTS_ID=$(create_or_skip "$ROOT_ID" "Products" "📦" "")

if [ -n "$PRODUCTS_ID" ]; then
  # Boards
  BOARDS_ID=$(create_or_skip "$PRODUCTS_ID" "Boards" "📋" "")
  if [ -n "$BOARDS_ID" ]; then
    create_or_skip "$BOARDS_ID" "Overview" "📄" "boards/README.md" > /dev/null
    create_or_skip "$BOARDS_ID" "Features" "⭐" "" > /dev/null
    create_or_skip "$BOARDS_ID" "Changelog" "📝" "CHANGELOG.md" > /dev/null
    create_or_skip "$BOARDS_ID" "Human TODOs" "👤" "" > /dev/null
  fi

  # Soundscape (Playground)
  SOUNDSCAPE_ID=$(create_or_skip "$PRODUCTS_ID" "Soundscape" "🎵" "")
  if [ -n "$SOUNDSCAPE_ID" ]; then
    create_or_skip "$SOUNDSCAPE_ID" "Overview" "📄" "soundscape/README.md" > /dev/null
    create_or_skip "$SOUNDSCAPE_ID" "Features" "⭐" "" > /dev/null
    create_or_skip "$SOUNDSCAPE_ID" "Changelog" "📝" "" > /dev/null
    create_or_skip "$SOUNDSCAPE_ID" "Human TODOs" "👤" "" > /dev/null
  fi

  # Systemic (Playground)
  SYSTEMIC_ID=$(create_or_skip "$PRODUCTS_ID" "Systemic" "🔧" "")
  if [ -n "$SYSTEMIC_ID" ]; then
    create_or_skip "$SYSTEMIC_ID" "Overview" "📄" "systemic/README.md" > /dev/null
    create_or_skip "$SYSTEMIC_ID" "Features" "⭐" "" > /dev/null
    create_or_skip "$SYSTEMIC_ID" "Changelog" "📝" "" > /dev/null
    create_or_skip "$SYSTEMIC_ID" "Human TODOs" "👤" "" > /dev/null
  fi

  # Favicon (Playground)
  FAVICON_ID=$(create_or_skip "$PRODUCTS_ID" "Favicon Generator" "🎨" "")
  if [ -n "$FAVICON_ID" ]; then
    create_or_skip "$FAVICON_ID" "Overview" "📄" "favicon/README.md" > /dev/null
    create_or_skip "$FAVICON_ID" "Features" "⭐" "" > /dev/null
    create_or_skip "$FAVICON_ID" "Human TODOs" "👤" "" > /dev/null
  fi

  # Design System
  DESIGN_ID=$(create_or_skip "$PRODUCTS_ID" "Design System" "🎨" "")
  if [ -n "$DESIGN_ID" ]; then
    create_or_skip "$DESIGN_ID" "Overview" "📄" "design-system/README.md" > /dev/null
    create_or_skip "$DESIGN_ID" "Components" "🧩" "" > /dev/null
    create_or_skip "$DESIGN_ID" "Tokens" "🎨" "" > /dev/null
    create_or_skip "$DESIGN_ID" "Human TODOs" "👤" "" > /dev/null
  fi
fi

echo ""

# ═══════════════════════════════════════════════════════════════
# 🔨 EXECUTION SECTION
# ═══════════════════════════════════════════════════════════════
echo -e "${BLUE}🔨 Creating Execution Section...${NC}"

EXECUTION_ID=$(create_or_skip "$ROOT_ID" "Execution" "🔨" "")

if [ -n "$EXECUTION_ID" ]; then
  create_or_skip "$EXECUTION_ID" "Global Backlog" "📊" "BACKLOG.md" > /dev/null
  create_or_skip "$EXECUTION_ID" "Current Sprint" "🏃" "docs/EXECUTION-SPRINT.md" > /dev/null
  create_or_skip "$EXECUTION_ID" "Recently Shipped" "✅" "docs/EXECUTION-SHIPPED.md" > /dev/null
  create_or_skip "$EXECUTION_ID" "Blocked/Waiting" "🚧" "docs/EXECUTION-BLOCKED.md" > /dev/null
fi

echo ""

# ═══════════════════════════════════════════════════════════════
# 🏗 INFRASTRUCTURE SECTION
# ═══════════════════════════════════════════════════════════════
echo -e "${BLUE}🏗 Creating Infrastructure Section...${NC}"

INFRA_ID=$(create_or_skip "$ROOT_ID" "Infrastructure" "🏗" "")

if [ -n "$INFRA_ID" ]; then
  # Architecture
  ARCH_ID=$(create_or_skip "$INFRA_ID" "Architecture" "📐" "")
  if [ -n "$ARCH_ID" ]; then
    create_or_skip "$ARCH_ID" "System Overview" "🗺️" "docs/INFRA-ARCHITECTURE.md" > /dev/null
    create_or_skip "$ARCH_ID" "Data Model" "💾" "" > /dev/null
    create_or_skip "$ARCH_ID" "API Reference" "🔌" "" > /dev/null
  fi

  # Deployment
  DEPLOY_ID=$(create_or_skip "$INFRA_ID" "Deployment" "🚀" "")
  if [ -n "$DEPLOY_ID" ]; then
    create_or_skip "$DEPLOY_ID" "Overview" "📄" "docs/INFRA-DEPLOYMENT.md" > /dev/null
    create_or_skip "$DEPLOY_ID" "Supabase Functions" "⚡" "" > /dev/null
    create_or_skip "$DEPLOY_ID" "GitHub Actions" "🔄" "" > /dev/null
    create_or_skip "$DEPLOY_ID" "Environments" "🌍" "" > /dev/null
  fi

  # Security
  create_or_skip "$INFRA_ID" "Security" "🔒" "docs/INFRA-SECURITY.md" > /dev/null

  # Monitoring
  create_or_skip "$INFRA_ID" "Monitoring" "📈" "" > /dev/null
fi

echo ""

# ═══════════════════════════════════════════════════════════════
# 🤖 AI AGENTS SECTION
# ═══════════════════════════════════════════════════════════════
echo -e "${BLUE}🤖 Creating AI Agents Section...${NC}"

AGENTS_ID=$(create_or_skip "$ROOT_ID" "AI Agents" "🤖" "")

if [ -n "$AGENTS_ID" ]; then
  # Agent Definitions
  DEFS_ID=$(create_or_skip "$AGENTS_ID" "Agent Definitions" "📋" "")
  if [ -n "$DEFS_ID" ]; then
    for agent in .claude/agents/*.md; do
      if [ -f "$agent" ]; then
        filename=$(basename "$agent" .md)
        title=$(echo "$filename" | sed 's/-/ /g' | sed 's/\b\(.\)/\u\1/g')
        create_or_skip "$DEFS_ID" "$title" "🤖" "$agent" > /dev/null
      fi
    done
  fi

  create_or_skip "$AGENTS_ID" "Workflows" "🔄" "" > /dev/null
  create_or_skip "$AGENTS_ID" "Logs/Reports" "📊" "" > /dev/null
fi

echo ""

# ═══════════════════════════════════════════════════════════════
# 📅 OPERATIONS SECTION
# ═══════════════════════════════════════════════════════════════
echo -e "${BLUE}📅 Creating Operations Section...${NC}"

OPS_ID=$(create_or_skip "$ROOT_ID" "Operations" "📅" "")

if [ -n "$OPS_ID" ]; then
  create_or_skip "$OPS_ID" "Costs" "💰" "COSTS.md" > /dev/null
  create_or_skip "$OPS_ID" "Calendar" "📆" "" > /dev/null
  create_or_skip "$OPS_ID" "Meeting Notes" "📝" "" > /dev/null
  create_or_skip "$OPS_ID" "Admin" "⚙️" "" > /dev/null
fi

echo ""
echo -e "${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${GREEN}✅ Full structure sync complete!${NC}"
echo -e "${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo ""
echo "View your workspace at: https://notion.so"
echo ""
echo "Structure created:"
echo "  📁 Ctrl Rodeo"
echo "  ├── 🎯 Strategy"
echo "  │   ├── 📄 Vision & Roadmap"
echo "  │   ├── 📄 PRDs"
echo "  │   └── 📄 Decision Log (ADRs)"
echo "  ├── 📦 Products"
echo "  │   ├── 📋 Boards"
echo "  │   ├── 🎵 Soundscape"
echo "  │   ├── 🔧 Systemic"
echo "  │   ├── 🎨 Favicon Generator"
echo "  │   └── 🎨 Design System"
echo "  ├── 🔨 Execution"
echo "  │   ├── 📊 Global Backlog"
echo "  │   ├── 🏃 Current Sprint"
echo "  │   ├── ✅ Recently Shipped"
echo "  │   └── 🚧 Blocked/Waiting"
echo "  ├── 🏗 Infrastructure"
echo "  │   ├── 📐 Architecture"
echo "  │   ├── 🚀 Deployment"
echo "  │   ├── 🔒 Security"
echo "  │   └── 📈 Monitoring"
echo "  ├── 🤖 AI Agents"
echo "  │   ├── 📋 Agent Definitions"
echo "  │   ├── 🔄 Workflows"
echo "  │   └── 📊 Logs/Reports"
echo "  └── 📅 Operations"
echo "      ├── 💰 Costs"
echo "      ├── 📆 Calendar"
echo "      ├── 📝 Meeting Notes"
echo "      └── ⚙️ Admin"
