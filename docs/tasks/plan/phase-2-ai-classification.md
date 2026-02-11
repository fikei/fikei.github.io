# Phase 2: AI Classification (Pending)

> Back to [Project Plan](./index.md)

---

## Epic 2.1: Pre-Filter System

| Story | Tasks | Status |
|-------|-------|--------|
| **Sender Blocklist** | | Pending |
| | Implement sender domain blocklist (no-reply@, noreply@, notifications@, etc.) | Pending |
| | Add user-configurable sender rules to tasks_rules table | Pending |
| | Test blocklist against common automated senders | Pending |
| **Gmail Category Filtering** | | Pending |
| | Check Gmail labels (CATEGORY_PROMOTIONS, CATEGORY_SOCIAL, CATEGORY_UPDATES) | Pending |
| | Skip emails in promotional/social/updates categories by default | Pending |
| | Allow users to opt-in to processing specific categories | Pending |
| **Automated Sender Detection** | | Pending |
| | Detect List-Unsubscribe header (indicates marketing email) | Pending |
| | Detect Precedence: bulk header | Pending |
| | Flag emails with these headers and skip by default | Pending |
| **Thread Deduplication** | | Pending |
| | Check if thread_id already exists in tasks_processed table | Pending |
| | Skip duplicate emails in same thread (only process first email) | Pending |
| | Handle thread updates (new replies) separately | Pending |

---

## Epic 2.2: LLM Classification Pipeline

| Story | Tasks | Status |
|-------|-------|--------|
| **Claude API Integration** | | Pending |
| | Set up Anthropic API client in Edge Function | Pending |
| | Configure Claude 3 Haiku model (cost-effective for classification) | Pending |
| | Implement error handling and retry logic | Pending |
| **Structured Output Prompt** | | Pending |
| | Design prompt template with email context (sender, subject, body) | Pending |
| | Request JSON output with category, urgency, confidence, suggested_title, due_date fields | Pending |
| | Test prompt against 20+ sample emails and refine | Pending |
| **6 Action Categories** | | Pending |
| | Define categories: TO_DO, TO_READ, TO_RESPOND, TO_REVIEW, TO_FOLLOW_UP, REFERENCE | Pending |
| | Train Claude to distinguish between categories with examples | Pending |
| | Handle edge cases (unclear emails, multiple actions) | Pending |
| **Urgency Scoring** | | Pending |
| | Implement urgency scale: LOW (1), MEDIUM (2), HIGH (3), URGENT (4) | Pending |
| | Extract urgency signals from email (deadlines, keywords like "urgent", "ASAP") | Pending |
| | Set default urgency to MEDIUM if unclear | Pending |
| **Confidence Scoring** | | Pending |
| | Request confidence score from Claude (0.0 - 1.0) | Pending |
| | Set minimum confidence threshold (0.7) to create task | Pending |
| | Log low-confidence classifications for manual review | Pending |

---

## Epic 2.3: Google Tasks Creation

| Story | Tasks | Status |
|-------|-------|--------|
| **Tasks API Integration** | | Pending |
| | Set up Google Tasks API client with user OAuth tokens | Pending |
| | Implement token refresh if access token expired | Pending |
| | Handle API errors (rate limits, network failures) | Pending |
| **Task List Management** | | Pending |
| | Fetch user's default task list on first run | Pending |
| | Create dedicated "Email Actions" task list if it doesn't exist | Pending |
| | Store task list ID in tasks_users table | Pending |
| **Title Formatting** | | Pending |
| | Format task title with [CATEGORY] prefix: "[TO_DO] Fix bug in payment flow" | Pending |
| | Use suggested_title from Claude if provided, otherwise use email subject | Pending |
| | Truncate title to 1024 characters (Google Tasks limit) | Pending |
| **Notes & Deep Link** | | Pending |
| | Populate task notes with email sender and snippet | Pending |
| | Add deep link to Gmail: https://mail.google.com/mail/u/0/#inbox/[message_id] | Pending |
| | Include AI-generated summary if available | Pending |
| **Due Date Extraction** | | Pending |
| | Parse due_date from Claude output (ISO 8601 format) | Pending |
| | Set task due date if date was extracted from email | Pending |
| | Leave due date empty if no clear deadline in email | Pending |

---

## Epic 2.4: Core Loop End-to-End

| Story | Tasks | Status |
|-------|-------|--------|
| **Wire Up Pipeline** | | Pending |
| | Implement full flow: gmail-webhook → pre-filter → classify-email → create-task | Pending |
| | Pass email metadata through each stage | Pending |
| | Store result in tasks_processed table with all classification fields | Pending |
| **Latency Optimization** | | Pending |
| | Measure p50, p95, p99 latency from email arrival to task creation | Pending |
| | Target: <90s p95 latency | Pending |
| | Optimize Claude API call (use cached embeddings if possible) | Pending |
| | Parallelize Google Tasks API call and database write | Pending |
| **Error Handling** | | Pending |
| | Implement retry queue for failed classifications | Pending |
| | Log errors with email context for debugging | Pending |
| | Send user notification if critical error (e.g., OAuth token revoked) | Pending |
| **End-to-End Testing** | | Pending |
| | Send test email to connected account | Pending |
| | Verify task appears in Google Tasks within 90 seconds | Pending |
| | Verify task has correct title, notes, and due date | Pending |
