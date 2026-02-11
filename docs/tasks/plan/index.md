# Project Plan - Tasks

> Single source of truth for all features, stories, and tasks for the Tasks sub-product.
> **Last Updated**: 2026-02-10 (Initial project plan creation)

---

## How to Use This Document

- **Epics**: Major feature areas (collapsible sections)
- **Stories**: User-facing functionality with clear value
- **Tasks**: Specific implementation steps with checkboxes
- **Status**: Complete | In Progress | Pending | Blocked

---

## Phase Overview

| Phase | Status | Progress |
|-------|--------|----------|
| [Phase 1: Foundation](./phase-1-foundation.md) | Pending | 0/32 |
| [Phase 2: AI Classification](./phase-2-ai-classification.md) | Pending | 0/28 |
| [Phase 3: Web Dashboard](./phase-3-web-dashboard.md) | Pending | 0/42 |
| [Phase 4: Gmail Extension](./phase-4-gmail-extension.md) | Pending | 0/24 |
| [Phase 5: iOS App](./phase-5-ios-app.md) | Pending | 0/22 |
| [Phase 6: Launch & Growth](./phase-6-launch.md) | Pending | 0/28 |

---

## Recent Milestones

### Project Initiation ⚡
**Created: 2026-02-10**

- **Project plan scaffolding** complete
- **6 phases** defined: Foundation, AI Classification, Web Dashboard, Gmail Extension, iOS App, Launch & Growth
- **Sub-product structure** established at `/tasks/`
- **Design system integration** planned using CTRL tokens and components
- **Next**: Phase 1.1 - Google OAuth & Account System

---

## Summary Statistics

| Category | Complete | In Progress | Pending | Blocked |
|----------|----------|-------------|---------|---------|
| Phase 1: Foundation | 0 | 0 | 32 | 0 |
| Phase 2: AI Classification | 0 | 0 | 28 | 0 |
| Phase 3: Web Dashboard | 0 | 0 | 42 | 0 |
| Phase 4: Gmail Extension | 0 | 0 | 24 | 0 |
| Phase 5: iOS App | 0 | 0 | 22 | 0 |
| Phase 6: Launch & Growth | 0 | 0 | 28 | 0 |
| **TOTAL** | **0** | **0** | **176** | **0** |

---

## Product Overview

**Tasks** is an AI-powered email triage tool that automatically creates Google Tasks from actionable emails.

### Key Features
- **AI Classification**: Claude-powered analysis identifies actionable emails across 6 categories
- **Auto Task Creation**: Generates Google Tasks with formatted titles, notes, and due dates
- **Multi-Platform**: Web dashboard, Gmail extension, and iOS app
- **Smart Filtering**: Pre-filter system blocks automated senders and duplicates
- **Real-Time**: <90s latency from email arrival to task creation

### Tech Stack
- **Frontend**: HTML/CSS/JavaScript using CTRL design system
- **Backend**: Supabase Edge Functions (TypeScript/Deno)
- **AI**: Claude API for email classification
- **Database**: Supabase PostgreSQL
- **Integrations**: Gmail API, Google Tasks API, Google OAuth, Cloud Pub/Sub

---

## Blocked Items

| Item | Blocker | Owner |
|------|---------|-------|
| - | - | - |

---

## Needs Decision

| Item | Options | Impact |
|------|---------|--------|
| AI provider selection | Claude vs GPT-4o mini vs hybrid | Cost, quality, latency |
| Pricing tiers | Free/Pro/Team structure | Revenue model, feature gating |
| Email storage | Store full email vs metadata only | Storage cost, privacy compliance |
| Task list strategy | Single list vs category-based lists | User experience, organization |

---

*This document follows the same structure as the Boards project plan and integrates with the unified documentation system.*
