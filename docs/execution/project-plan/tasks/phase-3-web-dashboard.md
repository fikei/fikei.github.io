# Phase 3: Web Dashboard (Pending)

> Back to [Project Plan](./index.md)

---

## Epic 3.1: Dashboard Shell

| Story | Tasks | Status |
|-------|-------|--------|
| **HTML Structure** | | Pending |
| | Create /tasks/index.html with semantic HTML structure | Pending |
| | Add page header with product name and user menu | Pending |
| | Implement responsive layout with sidebar navigation | Pending |
| **CTRL Design System Integration** | | Pending |
| | Link to design-system/tokens.css for color, spacing, typography variables | Pending |
| | Link to design-system/components.css for reusable components | Pending |
| | Use --color-bg-primary, --color-text-primary, --spacing-4, etc. | Pending |
| | Ensure dark mode works correctly (default) | Pending |
| **Page Header & Breadcrumb** | | Pending |
| | Add breadcrumb navigation (Home > Tasks > Feed) | Pending |
| | Display user email and profile picture in top-right corner | Pending |
| | Add settings icon linking to settings view | Pending |
| **Google Sign-In Flow** | | Pending |
| | Show Google Sign-In button if user not authenticated | Pending |
| | Redirect to OAuth consent screen | Pending |
| | Handle OAuth callback and store tokens | Pending |
| | Redirect authenticated users to feed view | Pending |

---

## Epic 3.2: Action Feed View

| Story | Tasks | Status |
|-------|-------|--------|
| **Real-Time Feed** | | Pending |
| | Query tasks_processed table for current user, ordered by processed_at DESC | Pending |
| | Display feed items in card layout (sender, subject, category, urgency, timestamp) | Pending |
| | Auto-refresh feed every 30 seconds | Pending |
| **Category Badges** | | Pending |
| | Use token component from design-system for category badges | Pending |
| | Color-code categories: TO_DO (blue), TO_READ (green), TO_RESPOND (orange), etc. | Pending |
| | Display badge with [CATEGORY] text | Pending |
| **Urgency Indicators** | | Pending |
| | Show urgency level with visual indicator (icon or color border) | Pending |
| | HIGH/URGENT: red accent, MEDIUM: yellow, LOW: gray | Pending |
| | Sort feed by urgency DESC, then processed_at DESC | Pending |
| **Confirm/Dismiss Buttons** | | Pending |
| | Add "Confirm" button to each feed item (marks task as reviewed) | Pending |
| | Add "Dismiss" button (removes from feed, does not delete Google Task) | Pending |
| | Update tasks_processed.status field on action | Pending |
| | Animate item removal from feed on dismiss | Pending |
| **Supabase Realtime Subscription** | | Pending |
| | Subscribe to tasks_processed table changes for current user | Pending |
| | Insert new feed items at top of list when new email processed | Pending |
| | Show notification badge when new items arrive | Pending |

---

## Epic 3.3: Analytics View

| Story | Tasks | Status |
|-------|-------|--------|
| **Stat Cards** | | Pending |
| | Display total items processed (count from tasks_processed) | Pending |
| | Display response rate (tasks marked confirmed / total tasks) | Pending |
| | Display average time-to-action (time from processed_at to confirmed_at) | Pending |
| | Use stat card component from design-system | Pending |
| **Processing Charts** | | Pending |
| | Create bar chart showing items processed per day (last 30 days) | Pending |
| | Create pie chart showing category distribution (TO_DO, TO_READ, etc.) | Pending |
| | Use lightweight chart library (Chart.js or native SVG) | Pending |
| **Trend Analysis** | | Pending |
| | Show week-over-week change in processing volume | Pending |
| | Highlight most common category | Pending |
| | Display busiest day of week for actionable emails | Pending |

---

## Epic 3.4: Settings & Rules View

| Story | Tasks | Status |
|-------|-------|--------|
| **Account Settings** | | Pending |
| | Display connected Google account email | Pending |
| | Show Gmail watch status (active/expired) | Pending |
| | Add "Re-authorize" button if OAuth token invalid | Pending |
| | Add "Disconnect Account" button with confirmation dialog | Pending |
| **Notification Preferences** | | Pending |
| | Toggle: Enable/disable email notifications for new tasks | Pending |
| | Toggle: Enable/disable digest emails (daily summary) | Pending |
| | Set quiet hours (don't send notifications during these hours) | Pending |
| **Sender Rules CRUD** | | Pending |
| | Display table of user-defined sender rules | Pending |
| | Add rule: block specific sender or domain | Pending |
| | Add rule: always process specific sender (override default filters) | Pending |
| | Add rule: auto-categorize emails from specific sender | Pending |
| | Edit and delete rules with confirmation | Pending |
| | Store rules in tasks_rules table | Pending |
| **Rule Limit Enforcement** | | Pending |
| | Free tier: max 5 custom rules | Pending |
| | Pro tier: max 50 custom rules | Pending |
| | Team tier: unlimited rules | Pending |
| | Show upgrade prompt when limit reached | Pending |

---

## Epic 3.5: History View

| Story | Tasks | Status |
|-------|-------|--------|
| **Data Table** | | Pending |
| | Create table with columns: Date, Sender, Subject, Category, Urgency, Status | Pending |
| | Query tasks_processed table with pagination (50 items per page) | Pending |
| | Use data-table component from design-system if available | Pending |
| **Sortable Columns** | | Pending |
| | Implement sort by Date (DESC default) | Pending |
| | Implement sort by Urgency | Pending |
| | Implement sort by Category | Pending |
| | Add sort indicator icons to column headers | Pending |
| **Search & Filter** | | Pending |
| | Add search input to filter by sender or subject (client-side) | Pending |
| | Add category filter dropdown (show only TO_DO, etc.) | Pending |
| | Add date range picker to filter by date | Pending |
| **Status Indicators** | | Pending |
| | Show status badge: Pending, Confirmed, Dismissed | Pending |
| | Link to Gmail message (open in new tab) | Pending |
| | Link to Google Task (if task_id exists) | Pending |
