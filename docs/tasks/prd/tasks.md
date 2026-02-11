# Tasks — AI-Powered Email Triage for Google Tasks

> PRD v1.0 | February 2026 | Status: Draft

**Target Launch:** Q3 2026
**Platforms:** Web (ctrl.rodeo/tasks), Gmail Plugin, iOS
**Sub-product:** Tasks

---

## 1. Executive Summary

### The Problem

Professionals receive 100+ emails daily. Buried in newsletters, notifications, and CC chains are the emails that actually require action: bills to pay, availability to share, questions to answer, confirmations to send. No existing product automatically identifies these actionable emails and routes them to Google Tasks — the task manager already embedded in Gmail and Google Calendar.

**Tasks** is an AI-powered email triage tool that continuously scans your Gmail inbox, identifies emails requiring action or response, classifies them by type and urgency, and automatically creates structured tasks in Google Tasks. It works natively with the Google ecosystem — no new task app to adopt, no workflow to change.

**Core value proposition:** Your inbox becomes read-only for awareness. Google Tasks becomes your single action queue. You never miss a bill, forget to respond to a colleague, or lose track of a confirmation.

---

## 2. Problem Statement

### 2.1 The Core Problem

Email was designed for communication, not task management. Yet most professionals use their inbox as a de facto to-do list, scanning and re-scanning messages to remember what needs doing. This creates three compounding problems:

1. **Action items get buried.** A bill payment due date sits between a newsletter and a meeting recap. A client question gets lost below a thread of FYI emails.
2. **Mental overhead is constant.** Every inbox scan requires re-reading and re-evaluating the same messages, burning cognitive energy without making progress.
3. **Existing tools require behavior change.** Superhuman, Shortwave, and SaneBox all require switching email clients or manually labeling/starring emails. The action item detection is passive, not automatic.

### 2.2 Why Google Tasks?

Google Tasks is the most underutilized productivity surface in the Google ecosystem. It is already embedded in Gmail (sidebar), Google Calendar (date-linked tasks), and has native iOS and Android apps. Critically, it has a well-documented REST API with generous rate limits (6M requests/min per project), full CRUD support, and OAuth 2.0 authentication.

Yet no product connects AI-powered email analysis to Google Tasks as a first-class integration.

### 2.3 Target User

Professionals who use Gmail as their primary email and live in the Google ecosystem (Calendar, Tasks, Drive). They receive 50-200+ emails per day and regularly miss action items buried in their inbox. They are not looking for a new productivity system — they want their existing one to work better.

---

## 3. Product Overview

### 3.1 What Tasks Does

Tasks monitors your Gmail inbox in near-real-time. For each incoming email, it uses an LLM to determine whether the email requires you to take action or respond. If it does, Tasks creates a task in Google Tasks with a structured title, due date (if detectable), category label, and a deep link back to the original email.

### 3.2 Action Types (MVP Taxonomy)

| Category | Description | Examples | Default Priority |
|----------|-------------|----------|-----------------|
| **Pay / Purchase** | Financial action required | Bills, invoices, subscription renewals | High |
| **Schedule / RSVP** | Calendar or availability action | Meeting requests, event invites, doodle polls | High |
| **Confirm / Approve** | Explicit confirmation needed | Order confirmations, document approvals | Medium |
| **Reply Required** | Human is asking a question | Client questions, colleague asks, intros | Medium |
| **Review / Read** | Content requires your attention | Shared docs for review, reports, feedback | Low |
| **Action Required** | Catch-all for other actions | Password resets, account verifications | Low |

### 3.3 What Tasks Does NOT Do (MVP)

- Replace your email client — you keep using Gmail
- Auto-reply or send emails on your behalf
- Manage tasks unrelated to email
- Work with Outlook or non-Gmail providers (post-MVP)
- Provide its own task UI — Google Tasks IS the UI

---

## 4. User Experience & Surfaces

Tasks is not a monolithic app — it is a lightweight intelligence layer that surfaces through three touchpoints:

### A) Web Dashboard (ctrl.rodeo/tasks)

The primary configuration and analytics surface, built with the CTRL design system:

- **Action feed:** Real-time feed of detected action items from recent emails
- **Classification badges:** Category and priority indicators for each item
- **Confirm/dismiss controls:** One-click to keep or remove auto-created tasks
- **Settings panel:** Sensitivity tuning (ignore marketing, include CC'd emails)
- **Analytics:** Action items processed, response rate, average time-to-action
- **Rules engine:** Custom rules for classification (sender-based priority overrides)
- **History:** Searchable log of all detected actions with status

### B) Gmail Chrome Extension / Add-on

Appears as a sidebar panel in Gmail:

- Real-time feed of detected action items from recent emails
- Classification badge and priority for each item
- One-click "Add to Tasks" (auto-adds) or "Dismiss" (not actionable)
- Settings panel for sensitivity tuning
- Subtle visual indicator on email rows — colored dot for detected actions

### C) iOS App

A focused mobile experience for reviewing action items on the go:

- Swipeable card stack of pending action items, grouped by category
- Each card: sender, subject snippet, action summary, category, due date
- Swipe right to confirm, swipe left to dismiss
- Tap to open original email in Gmail app via deep link
- Push notifications for high-priority items
- Daily digest notification: "You have 4 action items today — 2 high priority"

---

## 5. Technical Architecture

### 5.1 System Overview

```
Gmail API (Push via Pub/Sub)
  → Email Processor Service
    → LLM Classification (Claude)
      → Google Tasks API
        → Sync to Web Dashboard + iOS App
```

### 5.2 Core Components

| Component | Technology | Purpose |
|-----------|-----------|---------|
| Email Ingestion | Gmail API + Cloud Pub/Sub | Near-real-time email monitoring |
| AI Classification | Claude API (claude-sonnet-4-5) | Classify intent, extract action type, due dates |
| Task Creation | Google Tasks API v1 (REST, OAuth 2.0) | Create tasks with title, notes, due date, link |
| Backend API | Supabase Edge Functions (Deno/TypeScript) | Orchestration, user management, rule engine |
| Database | Supabase PostgreSQL + Redis cache | Preferences, processing history, dedup |
| Web Dashboard | Vanilla HTML/CSS/JS (CTRL design system) | Analytics, configuration, history |
| Chrome Extension | Manifest V3, Gmail Add-on API | In-Gmail sidebar experience |
| iOS App | Swift / SwiftUI | Mobile action item review |

### 5.3 AI Classification Pipeline

1. **Pre-filter:** Skip known non-actionable senders (newsletters, notifications, marketing) using sender domain allowlist/blocklist and Gmail category headers
2. **LLM Classification:** Send email metadata (sender, subject, first 2000 chars) to Claude API with structured prompt returning JSON: `is_actionable`, `action_type`, `urgency`, `suggested_task_title`, `due_date`, `confidence`, `reasoning`
3. **Confidence Gating:** Actions with confidence < 0.7 flagged for user review instead of auto-created
4. **Deduplication:** Hash-based dedup prevents same thread from creating multiple tasks. Thread ID tracked in PostgreSQL

### 5.4 Google Tasks Integration

- **Authentication:** OAuth 2.0 with `tasks` scope and Gmail read-only scope
- **Task List:** Creates dedicated "Tasks by ctrl.rodeo" list by default, or user selects existing list
- **Task Structure:** Title = AI summary (max 1024 chars), Notes = sender + subject + deep link, Due = extracted or default
- **Rate limits:** 6M req/min per project — no concern at consumer scale
- **Limitation:** No webhook support on Tasks API; web/iOS must poll for completion sync

### 5.5 Google Calendar Integration

Tasks created with due dates automatically appear in Google Calendar's task view (native behavior). Post-MVP Calendar Add-on shows daily summary card in sidebar.

---

## 6. MVP Scope & Phasing

### 6.1 MVP (v1.0) — Q3 2026

| Feature | Scope | Surface |
|---------|-------|---------|
| Email monitoring | Real-time Gmail push via Pub/Sub, process within 60s | Backend |
| AI classification | 6 action categories, urgency scoring, confidence gating | Backend |
| Google Tasks creation | Auto-create tasks with title, notes, due date, email link | Backend |
| Web dashboard | Action feed, confirm/dismiss, basic settings, analytics | Web |
| Gmail sidebar | View detected actions, confirm/dismiss, settings | Extension |
| iOS app | Card-based review, swipe confirm/dismiss, push notifications | iOS |
| Daily digest | Push notification with action count and top priorities | iOS |
| Onboarding | Google Sign-In, permissions, initial inbox scan (last 7 days) | All |

### 6.2 v1.1 — Q4 2026

- Custom rules engine (sender-based priority overrides)
- Google Calendar Add-on sidebar
- Snooze / defer actions to a future date
- Smart grouping: combine related action items from same thread

### 6.3 v2.0 — Q1 2027

- AI-drafted reply suggestions for "Reply Required" tasks
- Outlook / Microsoft 365 support
- Team features: shared action items, delegation
- Integrations: Todoist, Asana, Notion as alternative task backends
- Learning system: personalized classification from user behavior

---

## 7. Key User Stories

| # | Story | Acceptance Criteria |
|---|-------|-------------------|
| 1 | As a user, I want actionable emails to automatically appear as tasks in Google Tasks so I never miss an action item | Task created within 60s of email arrival. Human-readable title. Notes contain sender, subject, deep link. |
| 2 | As a user, I want to see which emails need action directly in Gmail so I can prioritize my inbox scan | Gmail sidebar shows chronological list of detected actions with category badge, urgency indicator, action summary. |
| 3 | As a user, I want to review and dismiss false positives so the system learns my preferences | Dismiss removes task from Google Tasks. Patterns tracked. Confidence threshold adapts per user. |
| 4 | As a user, I want push notifications for high-priority actions so urgent items don't wait | iOS push within 2 minutes for High priority. Daily digest at configured time for Medium/Low. |
| 5 | As a user, I want to quickly handle action items on mobile | iOS card stack loads in <2s. Swipe right confirms, swipe left dismisses. Tap opens email in Gmail. |
| 6 | As a user, I want a web dashboard to see analytics and configure rules | Dashboard shows items processed this week, response rate, time-to-action. Rules engine for priority overrides. |

---

## 8. Business Model

### 8.1 Pricing

| | Free | Pro ($8/mo) | Team ($14/user/mo) |
|-|------|-------------|-------------------|
| Emails processed/day | 25 | Unlimited | Unlimited |
| Action categories | 3 (Pay, Reply, Confirm) | All 6 | All 6 + Custom |
| Gmail sidebar | Yes | Yes | Yes |
| iOS app | Yes | Yes | Yes |
| Push notifications | Daily digest only | Real-time + digest | Real-time + digest |
| Web dashboard | — | Yes | Yes |
| Custom rules | — | 10 rules | Unlimited |
| Processing history | 7 days | 90 days | 1 year |
| Calendar Add-on | — | Yes | Yes |
| Team delegation | — | — | Yes |

### 8.2 Unit Economics

Primary cost: LLM inference. At Claude Sonnet pricing (~$3/M input tokens, $15/M output tokens), a typical email (500 tokens in, 100 tokens out) costs ~$0.003. A Pro user at 150 emails/day costs ~$13.50/mo in inference — viable at $8/mo with pre-filtering (skip ~60%), caching, and batching bringing effective cost to ~$4-5/user/mo.

### 8.3 Key Metrics

- **Activation:** % of signups who connect Gmail and have first task created within 24h
- **Core engagement:** Tasks created per user per week, dismiss rate (target <15%)
- **Retention:** WAU/MAU ratio, 30-day retention rate
- **Conversion:** Free → Pro upgrade rate (target 8-12%)
- **NPS:** Measured monthly, target 50+

---

## 9. Competitive Landscape

| Product | Auto-detect Actions | Google Tasks | Price | Mobile | Requires App Switch |
|---------|-------------------|-------------|-------|--------|-------------------|
| **Tasks** | Automatic | Native | $0-$14/mo | iOS | No |
| Superhuman | Partial (triage) | No (own system) | $25-30/mo | Yes | Yes |
| Shortwave | Partial (bundles) | No (own system) | $0-14/mo | Yes | Yes |
| SaneBox | No (sorting only) | No tasks | $7-36/mo | No | No |
| Lindy | Automatic | No (Notion/own) | $50+/mo | No | Yes |
| Zapier DIY | Manual label | Via Zap | $20+/mo | No | N/A |

**Key Differentiator:** Tasks is the only product combining fully automatic action detection with native Google Tasks integration. No email client switch, no new task system, no manual labeling.

---

## 10. Risks & Mitigations

| Risk | Severity | Mitigation |
|------|----------|-----------|
| Google restricts Gmail API access | High | Apply for Verification early. Read-only scopes. Strong privacy posture. |
| False positive rate too high | Medium | Confidence gating (>0.7 auto-create). User feedback loop. Aggressive pre-filtering. |
| Google launches native feature | Medium | Move faster. Go deeper on classification. Build mobile experience. Expand backends. |
| LLM costs exceed revenue | Medium | Pre-filter 60%+ without LLM. Cache repeat senders. Batch process. Fine-tuned models for v2. |
| Privacy concerns limit adoption | Medium | Zero data retention on email content. Process metadata + first 2000 chars only. SOC 2 cert. |

---

## 11. Success Criteria

### 11.1 Launch Criteria (MVP)

- Gmail push integration processing emails within 60 seconds
- AI classification accuracy >85% (dismiss rate <15%)
- Google Tasks creation with proper title, notes, due date, deep link
- Chrome Extension approved on Chrome Web Store
- iOS app approved on App Store
- End-to-end latency < 90 seconds at p95

### 11.2 Growth Targets (6 months post-launch)

| Metric | Target | Stretch |
|--------|--------|---------|
| Monthly Active Users | 10,000 | 25,000 |
| Free → Pro Conversion | 8% | 12% |
| Weekly Active Rate | 65% | 75% |
| 30-Day Retention | 40% | 55% |
| Tasks Created / User / Week | 15 | 25 |
| NPS | 45 | 55 |
| Monthly Recurring Revenue | $25K | $60K |

---

## 12. Appendix

### 12.1 API Dependencies

- **Gmail API:** Read-only access, push notifications via Cloud Pub/Sub
- **Google Tasks API v1:** Full CRUD, 6M req/min, OAuth 2.0
- **Google Calendar API:** Read access for Calendar Add-on
- **Claude API (Anthropic):** Classification inference, structured JSON output
- **Apple Push Notification Service:** iOS push notifications

### 12.2 Classification Prompt Structure

**Input:** sender, subject, body_preview (first 2000 chars), recipient, timestamp
**Output:** `{ is_actionable, action_type, urgency, suggested_title, due_date, confidence, reasoning }`

The prompt includes few-shot examples for each action category and explicit instructions to return `is_actionable: false` for newsletters, marketing, social notifications, automated alerts, and FYI-only messages.

### 12.3 Data Retention Policy

- **Email body content:** Processed in-memory only, never stored at rest
- **Email metadata:** Stored for processing history, deleted after retention window
- **Task data:** Stored in Google Tasks (user's own Google account)
- **User preferences/rules:** Stored in PostgreSQL, encrypted at rest
- **Classification logs (anonymized):** Retained for model improvement, opt-out available

---

## Related Documents

- [Technical Design: Tasks System](../../infrastructure/technical-design/tasks-system.md)
- [Project Plan: Tasks](../../execution/project-plan/tasks/)
