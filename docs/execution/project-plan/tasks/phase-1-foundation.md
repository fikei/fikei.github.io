# Phase 1: Foundation (Pending)

> Back to [Project Plan](./index.md)

---

## Epic 1.1: Google OAuth & Account System

| Story | Tasks | Status |
|-------|-------|--------|
| **Google Sign-In Flow** | | Pending |
| | Implement Google OAuth 2.0 sign-in button | Pending |
| | Handle OAuth callback and exchange code for tokens | Pending |
| | Store access token and refresh token securely | Pending |
| | Implement token refresh logic (tokens expire in 1 hour) | Pending |
| **User Account Management** | | Pending |
| | Create tasks_users table in Supabase (user_id, google_id, email, tokens, created_at) | Pending |
| | Link Supabase Auth user to Google account | Pending |
| | Handle sign-out and token revocation | Pending |
| | Display user email and profile picture in dashboard | Pending |

---

## Epic 1.2: Gmail Integration

| Story | Tasks | Status |
|-------|-------|--------|
| **Gmail API Setup** | | Pending |
| | Enable Gmail API in Google Cloud Console | Pending |
| | Configure OAuth consent screen with required scopes (gmail.readonly, tasks) | Pending |
| | Test Gmail API access with user credentials | Pending |
| **Cloud Pub/Sub Webhook** | | Pending |
| | Create Google Cloud Pub/Sub topic for Gmail notifications | Pending |
| | Implement Gmail watch() to subscribe to inbox changes | Pending |
| | Create Supabase Edge Function webhook endpoint to receive Pub/Sub messages | Pending |
| | Verify webhook receives notifications on new emails | Pending |
| **Watch Renewal Cron** | | Pending |
| | Gmail watch expires after 7 days - implement renewal cron | Pending |
| | Store watch expiration timestamp in tasks_watches table | Pending |
| | Create daily Supabase Edge Function cron to renew expiring watches | Pending |
| **Email Metadata Extraction** | | Pending |
| | Fetch email details via Gmail API (subject, sender, body snippet, labels) | Pending |
| | Extract plain text body from multipart MIME messages | Pending |
| | Handle HTML-only emails (strip tags for AI input) | Pending |

---

## Epic 1.3: Database Setup

| Story | Tasks | Status |
|-------|-------|--------|
| **PostgreSQL Schema** | | Pending |
| | Create tasks_users table (user_id, google_id, email, access_token, refresh_token, created_at) | Pending |
| | Create tasks_processed table (id, user_id, gmail_id, message_id, thread_id, category, urgency, confidence, task_id, processed_at) | Pending |
| | Create tasks_rules table (id, user_id, rule_type, pattern, action, created_at) | Pending |
| | Create tasks_watches table (id, user_id, watch_id, expiration, history_id, created_at) | Pending |
| **Indexes & Constraints** | | Pending |
| | Add unique index on tasks_users.google_id | Pending |
| | Add unique index on tasks_processed.gmail_id per user | Pending |
| | Add index on tasks_processed.user_id + processed_at for feed queries | Pending |
| | Add foreign key constraints (user_id references tasks_users) | Pending |

---

## Epic 1.4: Development Environment

| Story | Tasks | Status |
|-------|-------|--------|
| **Supabase Project Setup** | | Pending |
| | Create new Supabase project for Tasks sub-product | Pending |
| | Configure environment variables (Google OAuth credentials, Claude API key) | Pending |
| | Set up Supabase CLI and link local environment | Pending |
| **Edge Function Scaffolding** | | Pending |
| | Create edge function: gmail-webhook (receives Pub/Sub notifications) | Pending |
| | Create edge function: classify-email (sends email to Claude for classification) | Pending |
| | Create edge function: create-task (creates Google Task from classification result) | Pending |
| | Create edge function: renew-watch (cron job to renew Gmail watches) | Pending |
| **Local Dev Workflow** | | Pending |
| | Set up local testing with ngrok for webhook development | Pending |
| | Create test data fixtures (sample emails, classification results) | Pending |
| | Document local development setup in README | Pending |
