#!/bin/bash
# Notion Workspace Setup Script for ctrl.rodeo
# This script creates the page structure for the AI agent system

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

# Colors for output
GREEN='\033[0;32m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

echo -e "${BLUE}🚀 Setting up Notion workspace for ctrl.rodeo${NC}"
echo ""

# Function to create a page
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

# Function to add content blocks to a page
add_content() {
  local page_id="$1"
  local content="$2"

  curl -s -X PATCH "$BASE_URL/blocks/$page_id/children" \
    -H "Authorization: Bearer $API_KEY" \
    -H "Notion-Version: $API_VERSION" \
    -H "Content-Type: application/json" \
    -d "$content" > /dev/null
}

# Step 1: Find or prompt for parent page
echo "First, I need a parent page to create the structure under."
echo ""
echo "Searching for existing pages you've shared with the integration..."
echo ""

SEARCH_RESULT=$(curl -s -X POST "$BASE_URL/search" \
  -H "Authorization: Bearer $API_KEY" \
  -H "Notion-Version: $API_VERSION" \
  -H "Content-Type: application/json" \
  -d '{"query": "", "page_size": 10, "filter": {"property": "object", "value": "page"}}')

# Check if we got results
if echo "$SEARCH_RESULT" | grep -q '"results":\[\]'; then
  echo "❌ No pages found. Please:"
  echo "   1. Create a page in Notion called 'ctrl.rodeo'"
  echo "   2. Click '...' menu → 'Add connections' → Select your integration"
  echo "   3. Run this script again"
  exit 1
fi

echo "Found pages shared with the integration:"
echo "$SEARCH_RESULT" | grep -o '"title":\[{"type":"text","text":{"content":"[^"]*"' | sed 's/.*content":"/  - /g' | sed 's/"$//g' | head -5
echo ""

# Extract first page as potential root
ROOT_PAGE_ID=$(echo "$SEARCH_RESULT" | grep -o '"id":"[^"]*"' | head -1 | cut -d'"' -f4)
ROOT_TITLE=$(echo "$SEARCH_RESULT" | grep -o '"title":\[{"type":"text","text":{"content":"[^"]*"' | head -1 | sed 's/.*content":"//g' | sed 's/"$//g')

echo "Using '$ROOT_TITLE' as root page (ID: $ROOT_PAGE_ID)"
echo ""
read -p "Continue with this page? (y/n) " -n 1 -r
echo ""

if [[ ! $REPLY =~ ^[Yy]$ ]]; then
  echo "Please share the correct page with your integration and try again."
  exit 1
fi

echo ""
echo -e "${BLUE}Creating page structure...${NC}"
echo ""

# Create main sections
echo "📋 Creating Strategic Planning..."
STRATEGIC_ID=$(create_page "$ROOT_PAGE_ID" "Strategic Planning" "📋")
echo "   Created: $STRATEGIC_ID"

echo "🛠 Creating Product & Development..."
DEVELOPMENT_ID=$(create_page "$ROOT_PAGE_ID" "Product & Development" "🛠")
echo "   Created: $DEVELOPMENT_ID"

echo "📅 Creating Operations..."
OPERATIONS_ID=$(create_page "$ROOT_PAGE_ID" "Operations" "📅")
echo "   Created: $OPERATIONS_ID"

echo "🤝 Creating Cross-Functional..."
CROSS_FUNCTIONAL_ID=$(create_page "$ROOT_PAGE_ID" "Cross-Functional" "🤝")
echo "   Created: $CROSS_FUNCTIONAL_ID"

echo ""
echo -e "${BLUE}Creating sub-pages...${NC}"
echo ""

# Create sub-pages under Strategic Planning
echo "   Creating PRDs..."
create_page "$STRATEGIC_ID" "PRDs" "📄" > /dev/null
echo "   Creating Vision Docs..."
create_page "$STRATEGIC_ID" "Vision Docs" "🎯" > /dev/null
echo "   Creating Roadmaps..."
create_page "$STRATEGIC_ID" "Roadmaps" "🗺" > /dev/null

# Create sub-pages under Product & Development
echo "   Creating Technical Plans..."
create_page "$DEVELOPMENT_ID" "Technical Plans" "📐" > /dev/null
echo "   Creating Sprint Backlog..."
create_page "$DEVELOPMENT_ID" "Sprint Backlog" "📝" > /dev/null
echo "   Creating Vibe Coding Notes..."
create_page "$DEVELOPMENT_ID" "Vibe Coding Notes" "✨" > /dev/null

# Create sub-pages under Operations
echo "   Creating Calendar..."
create_page "$OPERATIONS_ID" "Calendar" "📆" > /dev/null
echo "   Creating Admin Docs..."
create_page "$OPERATIONS_ID" "Admin Docs" "📁" > /dev/null

# Create sub-pages under Cross-Functional
echo "   Creating Status Updates..."
create_page "$CROSS_FUNCTIONAL_ID" "Status Updates" "📊" > /dev/null
echo "   Creating Meeting Notes..."
create_page "$CROSS_FUNCTIONAL_ID" "Meeting Notes" "📝" > /dev/null

echo ""
echo -e "${GREEN}✅ Notion workspace setup complete!${NC}"
echo ""
echo "Page IDs (add these to .env.local):"
echo ""
echo "NOTION_PAGE_STRATEGIC=$STRATEGIC_ID"
echo "NOTION_PAGE_DEVELOPMENT=$DEVELOPMENT_ID"
echo "NOTION_PAGE_OPERATIONS=$OPERATIONS_ID"
echo "NOTION_PAGE_CROSS_FUNCTIONAL=$CROSS_FUNCTIONAL_ID"
echo ""

# Offer to update .env.local
read -p "Update .env.local with these IDs? (y/n) " -n 1 -r
echo ""

if [[ $REPLY =~ ^[Yy]$ ]]; then
  sed -i "s/NOTION_PAGE_STRATEGIC=.*/NOTION_PAGE_STRATEGIC=$STRATEGIC_ID/" .env.local
  sed -i "s/NOTION_PAGE_DEVELOPMENT=.*/NOTION_PAGE_DEVELOPMENT=$DEVELOPMENT_ID/" .env.local
  sed -i "s/NOTION_PAGE_OPERATIONS=.*/NOTION_PAGE_OPERATIONS=$OPERATIONS_ID/" .env.local
  sed -i "s/NOTION_PAGE_CROSS_FUNCTIONAL=.*/NOTION_PAGE_CROSS_FUNCTIONAL=$CROSS_FUNCTIONAL_ID/" .env.local
  echo -e "${GREEN}✅ .env.local updated!${NC}"
fi

echo ""
echo "Next steps:"
echo "  1. Check your Notion workspace - you should see the new pages"
echo "  2. Deploy Supabase functions: supabase functions deploy agent-handler"
echo "  3. Set Supabase secrets: supabase secrets set NOTION_API_KEY=\$NOTION_API_KEY"
echo ""
