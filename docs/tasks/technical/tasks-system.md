# Tasks System — Technical Design

> Version 1.0 | February 2026 | Status: Draft

---

## 1. Overview

Tasks is an AI-powered email triage system that monitors Gmail inboxes, classifies actionable emails using Claude, and creates structured tasks in Google Tasks. The web dashboard lives at `ctrl.rodeo/tasks` and uses the CTRL design system.

### Architecture Flow

```
Gmail Inbox
  ↓ (Cloud Pub/Sub push notification)
Email Processor (Supabase Edge Function)
  ↓ (extract metadata: sender, subject, body preview)
Pre-Filter
  ↓ (skip newsletters, marketing, notifications)
LLM Classification (Claude API)
  ↓ (structured JSON: action_type, urgency, confidence)
Confidence Gate
  ├─ confidence >= 0.7 → Auto-create Google Task
  └─ confidence < 0.7  → Queue for user review
  ↓
Google Tasks API (create task in user's task list)
  ↓
Sync to Web Dashboard + iOS App
```

---

## 2. Core Components

### 2.1 Email Ingestion

**Technology:** Gmail API + Google Cloud Pub/Sub

```
Gmail → Pub/Sub Topic → Pub/Sub Subscription → Edge Function webhook
```

- Uses Gmail `watch()` to register push notifications
- Watch expires every 7 days; cron job renews
- Pub/Sub delivers `historyId` — edge function calls `history.list()` to get new messages
- Only processes `messagesAdded` events (not modifications/deletions)
- Rate limit: 250 quota units per user per second (Gmail API)

**Key fields extracted:**
- `from` (sender email + display name)
- `subject`
- `body_preview` (first 2000 characters, plain text preferred)
- `date` (RFC 2822 timestamp)
- `threadId` (for dedup)
- `labelIds` (for pre-filtering: CATEGORY_PROMOTIONS, CATEGORY_SOCIAL, etc.)

### 2.2 Pre-Filter

Runs before LLM classification to reduce inference costs:

```javascript
function shouldProcess(email) {
  // Skip Gmail category-filtered emails
  const skipCategories = ['CATEGORY_PROMOTIONS', 'CATEGORY_SOCIAL', 'CATEGORY_UPDATES'];
  if (email.labelIds.some(l => skipCategories.includes(l))) return false;

  // Skip blocklisted sender domains
  if (SENDER_BLOCKLIST.includes(extractDomain(email.from))) return false;

  // Skip if already processed (thread dedup)
  if (await isThreadProcessed(email.threadId)) return false;

  // Skip automated/no-reply senders
  if (isAutomatedSender(email.from)) return false;

  return true;
}
```

Expected pre-filter rate: 60-70% of emails skipped without LLM call.

### 2.3 LLM Classification

**Model:** Claude claude-sonnet-4-5 (structured output mode)

**Request format:**
```json
{
  "model": "claude-sonnet-4-5",
  "max_tokens": 256,
  "messages": [{
    "role": "user",
    "content": "Classify this email for actionability..."
  }],
  "tool_choice": { "type": "tool", "name": "classify_email" },
  "tools": [{
    "name": "classify_email",
    "description": "Classify an email for actionability",
    "input_schema": {
      "type": "object",
      "properties": {
        "is_actionable": { "type": "boolean" },
        "action_type": {
          "type": "string",
          "enum": ["pay_purchase", "schedule_rsvp", "confirm_approve", "reply_required", "review_read", "action_required"]
        },
        "urgency": { "type": "string", "enum": ["high", "medium", "low"] },
        "suggested_title": { "type": "string", "maxLength": 120 },
        "due_date": { "type": "string", "format": "date", "nullable": true },
        "confidence": { "type": "number", "minimum": 0, "maximum": 1 },
        "reasoning": { "type": "string", "maxLength": 200 }
      },
      "required": ["is_actionable", "action_type", "urgency", "suggested_title", "confidence", "reasoning"]
    }
  }]
}
```

**Token budget per email:** ~500 input, ~100 output
**Cost per classification:** ~$0.003
**Latency target:** < 3 seconds per classification

### 2.4 Google Tasks Integration

**Scopes required:**
- `https://www.googleapis.com/auth/tasks` (read/write tasks)
- `https://www.googleapis.com/auth/gmail.readonly` (read email)

**Task creation format:**
```json
{
  "title": "[PAY] Electric bill due Feb 15 — ConEdison",
  "notes": "From: billing@coned.com\nSubject: Your February bill is ready\n\nOpen email: https://mail.google.com/mail/u/0/#inbox/18d7a2b3c4e5f6",
  "due": "2026-02-15T00:00:00.000Z",
  "status": "needsAction"
}
```

**Title format:** `[CATEGORY] AI-generated summary — sender name`

**Task list management:**
- On first connection, create "Tasks" list (or use existing if user selects)
- Store `taskListId` in user profile
- All auto-created tasks go to this list

### 2.5 Backend API

**Runtime:** Supabase Edge Functions (Deno/TypeScript)

**Edge Functions:**

| Function | Purpose | Trigger |
|----------|---------|---------|
| `tasks-webhook` | Receive Pub/Sub push, process email | HTTP POST from Pub/Sub |
| `tasks-classify` | Run LLM classification on email | Called by tasks-webhook |
| `tasks-create` | Create Google Task from classification | Called by tasks-classify |
| `tasks-auth` | Handle Google OAuth flow | HTTP GET/POST from web |
| `tasks-settings` | CRUD user settings and rules | HTTP from web dashboard |
| `tasks-history` | Query processing history | HTTP from web dashboard |
| `tasks-digest` | Generate and send daily digest | Cron (daily) |

### 2.6 Database Schema

**Supabase PostgreSQL:**

```sql
-- User profiles and Google OAuth tokens
CREATE TABLE tasks_users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT UNIQUE NOT NULL,
  google_access_token TEXT,
  google_refresh_token TEXT,
  google_token_expires_at TIMESTAMPTZ,
  task_list_id TEXT,
  settings JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Processed email log (for dedup and history)
CREATE TABLE tasks_processed (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES tasks_users(id),
  gmail_message_id TEXT NOT NULL,
  gmail_thread_id TEXT NOT NULL,
  sender TEXT,
  subject TEXT,
  action_type TEXT,
  urgency TEXT,
  confidence FLOAT,
  suggested_title TEXT,
  due_date DATE,
  google_task_id TEXT,
  status TEXT DEFAULT 'auto_created', -- auto_created, confirmed, dismissed, review
  reasoning TEXT,
  processed_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(user_id, gmail_message_id)
);

-- User-defined rules
CREATE TABLE tasks_rules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES tasks_users(id),
  rule_type TEXT NOT NULL, -- sender_priority, sender_block, domain_block, category_override
  match_value TEXT NOT NULL, -- email address, domain, or pattern
  action JSONB NOT NULL, -- { "priority": "high" } or { "skip": true }
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Gmail watch state
CREATE TABLE tasks_watches (
  user_id UUID PRIMARY KEY REFERENCES tasks_users(id),
  history_id TEXT NOT NULL,
  watch_expiration TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Indexes
CREATE INDEX idx_processed_user_date ON tasks_processed(user_id, processed_at DESC);
CREATE INDEX idx_processed_thread ON tasks_processed(user_id, gmail_thread_id);
CREATE INDEX idx_rules_user ON tasks_rules(user_id);
```

---

## 3. Web Dashboard Architecture

### 3.1 Frontend

**Stack:** Vanilla HTML + CSS + JavaScript (same as Boards)
**Design system:** CTRL tokens + components (`/design-system/tokens.css`, `/design-system/components.css`)
**Location:** `/tasks/index.html`

**Views:**
1. **Feed view** (default) — chronological list of detected action items
2. **Analytics view** — stats cards + processing charts
3. **Settings view** — account, rules, notification preferences
4. **History view** — searchable table of all processed emails

**State management:** In-memory JS object, synced to Supabase on change.

### 3.2 Authentication

Google Sign-In via OAuth 2.0 redirect flow:
1. User clicks "Connect Gmail" → redirect to Google consent screen
2. Google redirects back with auth code → exchange for access + refresh tokens
3. Store tokens in `tasks_users` table
4. Frontend stores session JWT from Supabase

### 3.3 Real-time Updates

Supabase Realtime subscriptions on `tasks_processed` table:
- New classifications appear in feed without page refresh
- Status changes (confirmed/dismissed) sync across devices

---

## 4. Gmail Extension Architecture

### 4.1 Manifest V3

```json
{
  "manifest_version": 3,
  "name": "Tasks by ctrl.rodeo",
  "permissions": ["identity", "storage"],
  "host_permissions": ["https://mail.google.com/*"],
  "content_scripts": [{
    "matches": ["https://mail.google.com/*"],
    "js": ["content.js"],
    "css": ["sidebar.css"]
  }],
  "background": {
    "service_worker": "background.js"
  },
  "action": {
    "default_popup": "popup.html"
  }
}
```

### 4.2 Content Script

- Injects sidebar panel into Gmail DOM
- Polls backend API for recent action items (every 30s)
- Renders action cards with category badges
- Adds colored dot indicators to email rows in inbox view
- Communicates with background service worker for auth

---

## 5. iOS App Architecture

### 5.1 Stack

- Swift / SwiftUI
- Google Sign-In SDK for iOS
- Native push notifications via APNs
- Deep linking to Gmail app

### 5.2 Key Screens

1. **Onboarding:** Google Sign-In → permission grants → initial scan
2. **Action feed:** Swipeable card stack, grouped by category
3. **Settings:** Notification preferences, connected account
4. **History:** Scrollable list of past actions

---

## 6. Security & Privacy

### 6.1 Data Handling

- **Email body content:** Processed in-memory only, NEVER stored at rest
- **Email metadata:** Sender, subject, timestamp stored for history (retention window applies)
- **OAuth tokens:** Encrypted at rest in Supabase (pgcrypto)
- **Classification prompts:** Contain only metadata + body preview, sent over TLS to Claude API

### 6.2 Scopes

Minimal OAuth scopes:
- `gmail.readonly` — read emails (no send, no modify)
- `tasks` — create/update/delete tasks

### 6.3 Compliance Targets

- Google API verification (required for Gmail access)
- SOC 2 Type II (post-launch)
- GDPR-compliant data retention and deletion

---

## 7. Observability

### 7.1 Metrics

| Metric | Source | Alert Threshold |
|--------|--------|----------------|
| Email processing latency (p95) | Edge function logs | > 90s |
| Classification accuracy | Dismiss rate | > 20% dismiss |
| Gmail watch renewal failures | Cron logs | Any failure |
| Google Tasks API errors | Edge function logs | > 5% error rate |
| Active users (DAU) | Supabase analytics | — |

### 7.2 Logging

- Edge function logs via Supabase dashboard
- Classification results logged (anonymized) for model improvement
- User actions (confirm/dismiss) logged for feedback loop

---

## Related Documents

- [PRD: Tasks](../../strategy/prds/tasks.md)
- [CTRL Design System](../../../design-system/README.md)
