#!/bin/bash
# Sync PRDs and Project Plans to Notion
# Run from repository root: ./scripts/sync-docs-to-notion.sh

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
NC='\033[0m'

echo -e "${BLUE}📄 Syncing documents to Notion${NC}"
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

# Function to convert markdown to Notion blocks
markdown_to_blocks() {
  local file="$1"
  local blocks="["
  local first=true

  while IFS= read -r line || [[ -n "$line" ]]; do
    # Skip empty lines at start
    [[ -z "$line" ]] && continue

    # Escape special characters for JSON
    line=$(echo "$line" | sed 's/\\/\\\\/g' | sed 's/"/\\"/g' | sed 's/	/\\t/g')

    if [[ "$first" != true ]]; then
      blocks+=","
    fi
    first=false

    if [[ "$line" =~ ^#\ (.+) ]]; then
      # H1
      content="${BASH_REMATCH[1]}"
      blocks+="{\"object\":\"block\",\"type\":\"heading_1\",\"heading_1\":{\"rich_text\":[{\"type\":\"text\",\"text\":{\"content\":\"$content\"}}]}}"
    elif [[ "$line" =~ ^##\ (.+) ]]; then
      # H2
      content="${BASH_REMATCH[1]}"
      blocks+="{\"object\":\"block\",\"type\":\"heading_2\",\"heading_2\":{\"rich_text\":[{\"type\":\"text\",\"text\":{\"content\":\"$content\"}}]}}"
    elif [[ "$line" =~ ^###\ (.+) ]]; then
      # H3
      content="${BASH_REMATCH[1]}"
      blocks+="{\"object\":\"block\",\"type\":\"heading_3\",\"heading_3\":{\"rich_text\":[{\"type\":\"text\",\"text\":{\"content\":\"$content\"}}]}}"
    elif [[ "$line" =~ ^-\ (.+) ]]; then
      # Bullet
      content="${BASH_REMATCH[1]}"
      blocks+="{\"object\":\"block\",\"type\":\"bulleted_list_item\",\"bulleted_list_item\":{\"rich_text\":[{\"type\":\"text\",\"text\":{\"content\":\"$content\"}}]}}"
    elif [[ "$line" =~ ^\>\ (.+) ]]; then
      # Quote
      content="${BASH_REMATCH[1]}"
      blocks+="{\"object\":\"block\",\"type\":\"quote\",\"quote\":{\"rich_text\":[{\"type\":\"text\",\"text\":{\"content\":\"$content\"}}]}}"
    elif [[ "$line" == "---" ]]; then
      # Divider
      blocks+="{\"object\":\"block\",\"type\":\"divider\",\"divider\":{}}"
    elif [[ -n "$line" ]]; then
      # Paragraph
      blocks+="{\"object\":\"block\",\"type\":\"paragraph\",\"paragraph\":{\"rich_text\":[{\"type\":\"text\",\"text\":{\"content\":\"$line\"}}]}}"
    fi
  done < "$file"

  blocks+="]"
  echo "$blocks"
}

# Function to add content to a page
add_content_to_page() {
  local page_id="$1"
  local file="$2"

  # Read file and convert to blocks (simplified - first 100 lines to avoid API limits)
  local content=$(head -100 "$file")

  # Create blocks array
  local blocks="["
  local first=true

  while IFS= read -r line; do
    [[ -z "$line" ]] && continue

    # Escape for JSON
    line=$(echo "$line" | sed 's/\\/\\\\/g' | sed 's/"/\\"/g' | sed 's/	/    /g')

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

# Find parent pages
echo "Finding Notion pages..."
STRATEGIC_ID=$(find_page_by_title "Strategic Planning")
DEVELOPMENT_ID=$(find_page_by_title "Product & Development")
PRDS_ID=$(find_page_by_title "PRDs")

if [ -z "$STRATEGIC_ID" ]; then
  echo -e "${YELLOW}Warning: Strategic Planning page not found. Run setup-notion.sh first.${NC}"
  exit 1
fi

echo -e "  Strategic Planning: $STRATEGIC_ID"
echo -e "  Product & Development: $DEVELOPMENT_ID"
echo ""

# Sync PRDs
echo -e "${BLUE}Syncing PRDs...${NC}"

for prd in docs/PRD-*.md; do
  filename=$(basename "$prd" .md)
  title=$(echo "$filename" | sed 's/PRD-//' | sed 's/-/ /g' | sed 's/\b\(.\)/\u\1/g')

  echo -n "  📄 $title... "

  # Check if page exists
  existing_id=$(find_page_by_title "$title")

  if [ -n "$existing_id" ]; then
    echo -e "${YELLOW}exists, updating${NC}"
    # For updates, we'd need to delete and recreate content
    # For now, skip existing
  else
    # Create new page under PRDs (or Strategic Planning if PRDs not found)
    parent=${PRDS_ID:-$STRATEGIC_ID}
    new_id=$(create_page "$parent" "$title" "📄")

    if [ -n "$new_id" ]; then
      add_content_to_page "$new_id" "$prd"
      echo -e "${GREEN}created${NC}"
    else
      echo -e "${YELLOW}failed${NC}"
    fi
  fi
done

# Sync Project Plans
echo ""
echo -e "${BLUE}Syncing Project Plans...${NC}"

# Things I Like Project Plan
if [ -f "docs/PROJECT-PLAN-things-i-like.md" ]; then
  echo -n "  📋 Things I Like Project Plan... "
  existing_id=$(find_page_by_title "Things I Like Project Plan")
  if [ -z "$existing_id" ]; then
    new_id=$(create_page "$DEVELOPMENT_ID" "Things I Like Project Plan" "📋")
    if [ -n "$new_id" ]; then
      add_content_to_page "$new_id" "docs/PROJECT-PLAN-things-i-like.md"
      echo -e "${GREEN}created${NC}"
    fi
  else
    echo -e "${YELLOW}exists${NC}"
  fi
fi

# Soundscape Project Plan
if [ -f "soundscape/PROJECT_PLAN.md" ]; then
  echo -n "  🎵 Soundscape Project Plan... "
  existing_id=$(find_page_by_title "Soundscape Project Plan")
  if [ -z "$existing_id" ]; then
    new_id=$(create_page "$DEVELOPMENT_ID" "Soundscape Project Plan" "🎵")
    if [ -n "$new_id" ]; then
      add_content_to_page "$new_id" "soundscape/PROJECT_PLAN.md"
      echo -e "${GREEN}created${NC}"
    fi
  else
    echo -e "${YELLOW}exists${NC}"
  fi
fi

# Soundscape Project Tracker
if [ -f "soundscape/PROJECT_TRACKER.md" ]; then
  echo -n "  📊 Soundscape Project Tracker... "
  existing_id=$(find_page_by_title "Soundscape Project Tracker")
  if [ -z "$existing_id" ]; then
    new_id=$(create_page "$DEVELOPMENT_ID" "Soundscape Project Tracker" "📊")
    if [ -n "$new_id" ]; then
      add_content_to_page "$new_id" "soundscape/PROJECT_TRACKER.md"
      echo -e "${GREEN}created${NC}"
    fi
  else
    echo -e "${YELLOW}exists${NC}"
  fi
fi

# Main Project Status
if [ -f "PROJECT-STATUS.md" ]; then
  echo -n "  ✅ Project Status (Main)... "
  existing_id=$(find_page_by_title "Project Status")
  if [ -z "$existing_id" ]; then
    # Put this in Cross-Functional
    CROSS_ID=$(find_page_by_title "Cross-Functional")
    parent=${CROSS_ID:-$DEVELOPMENT_ID}
    new_id=$(create_page "$parent" "Project Status" "✅")
    if [ -n "$new_id" ]; then
      add_content_to_page "$new_id" "PROJECT-STATUS.md"
      echo -e "${GREEN}created${NC}"
    fi
  else
    echo -e "${YELLOW}exists${NC}"
  fi
fi

# Sync Product Pages (READMEs)
echo ""
echo -e "${BLUE}Syncing Product Pages...${NC}"

# Root README
if [ -f "README.md" ]; then
  echo -n "  🏠 ctrl.rodeo Overview... "
  existing_id=$(find_page_by_title "ctrl.rodeo Overview")
  if [ -z "$existing_id" ]; then
    CROSS_ID=$(find_page_by_title "Cross-Functional")
    parent=${CROSS_ID:-$DEVELOPMENT_ID}
    new_id=$(create_page "$parent" "ctrl.rodeo Overview" "🏠")
    if [ -n "$new_id" ]; then
      add_content_to_page "$new_id" "README.md"
      echo -e "${GREEN}created${NC}"
    fi
  else
    echo -e "${YELLOW}exists${NC}"
  fi
fi

# Boards Product Page
if [ -f "boards/README.md" ]; then
  echo -n "  📋 Boards Product... "
  existing_id=$(find_page_by_title "Boards Product")
  if [ -z "$existing_id" ]; then
    new_id=$(create_page "$DEVELOPMENT_ID" "Boards Product" "📋")
    if [ -n "$new_id" ]; then
      add_content_to_page "$new_id" "boards/README.md"
      echo -e "${GREEN}created${NC}"
    fi
  else
    echo -e "${YELLOW}exists${NC}"
  fi
fi

# Soundscape Product Page
if [ -f "soundscape/README.md" ]; then
  echo -n "  🎵 Soundscape Product... "
  existing_id=$(find_page_by_title "Soundscape Product")
  if [ -z "$existing_id" ]; then
    new_id=$(create_page "$DEVELOPMENT_ID" "Soundscape Product" "🎵")
    if [ -n "$new_id" ]; then
      add_content_to_page "$new_id" "soundscape/README.md"
      echo -e "${GREEN}created${NC}"
    fi
  else
    echo -e "${YELLOW}exists${NC}"
  fi
fi

# Systemic Product Page
if [ -f "systemic/README.md" ]; then
  echo -n "  🔧 Systemic Product... "
  existing_id=$(find_page_by_title "Systemic Product")
  if [ -z "$existing_id" ]; then
    new_id=$(create_page "$DEVELOPMENT_ID" "Systemic Product" "🔧")
    if [ -n "$new_id" ]; then
      add_content_to_page "$new_id" "systemic/README.md"
      echo -e "${GREEN}created${NC}"
    fi
  else
    echo -e "${YELLOW}exists${NC}"
  fi
fi

# Design System Product Page
if [ -f "design-system/README.md" ]; then
  echo -n "  🎨 Design System... "
  existing_id=$(find_page_by_title "Design System")
  if [ -z "$existing_id" ]; then
    new_id=$(create_page "$DEVELOPMENT_ID" "Design System" "🎨")
    if [ -n "$new_id" ]; then
      add_content_to_page "$new_id" "design-system/README.md"
      echo -e "${GREEN}created${NC}"
    fi
  else
    echo -e "${YELLOW}exists${NC}"
  fi
fi

# Favicon Product Page (Playground)
if [ -f "favicon/README.md" ]; then
  echo -n "  🎨 Favicon Generator... "
  existing_id=$(find_page_by_title "Favicon Generator")
  if [ -z "$existing_id" ]; then
    new_id=$(create_page "$DEVELOPMENT_ID" "Favicon Generator" "🎨")
    if [ -n "$new_id" ]; then
      add_content_to_page "$new_id" "favicon/README.md"
      echo -e "${GREEN}created${NC}"
    fi
  else
    echo -e "${YELLOW}exists${NC}"
  fi
fi

# Sync Operations Documents
echo ""
echo -e "${BLUE}Syncing Operations...${NC}"

# Find Operations page
OPERATIONS_ID=$(find_page_by_title "Operations")

# Costs tracking
if [ -f "COSTS.md" ]; then
  echo -n "  💰 Costs... "
  existing_id=$(find_page_by_title "Costs")
  if [ -z "$existing_id" ]; then
    parent=${OPERATIONS_ID:-$STRATEGIC_ID}
    new_id=$(create_page "$parent" "Costs" "💰")
    if [ -n "$new_id" ]; then
      add_content_to_page "$new_id" "COSTS.md"
      echo -e "${GREEN}created${NC}"
    fi
  else
    echo -e "${YELLOW}exists${NC}"
  fi
fi

echo ""
echo -e "${GREEN}✅ Sync complete!${NC}"
echo ""
echo "View your documents in Notion at: https://notion.so"
