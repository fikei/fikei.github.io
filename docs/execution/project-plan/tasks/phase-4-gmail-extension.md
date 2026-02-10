# Phase 4: Gmail Extension (Pending)

> Back to [Project Plan](./index.md)

---

## Epic 4.1: Extension Scaffold

| Story | Tasks | Status |
|-------|-------|--------|
| **Manifest V3 Setup** | | Pending |
| | Create manifest.json with required permissions (gmail.readonly, identity, storage) | Pending |
| | Configure OAuth2 client ID for Chrome extension | Pending |
| | Set up content security policy | Pending |
| **Content Script Injection** | | Pending |
| | Inject content script into Gmail domain (mail.google.com) | Pending |
| | Detect Gmail UI load and inject custom elements | Pending |
| | Handle Gmail's dynamic DOM updates | Pending |
| **Background Service Worker** | | Pending |
| | Set up background service worker for API calls | Pending |
| | Implement message passing between content script and service worker | Pending |
| | Cache user authentication state | Pending |
| **Popup HTML** | | Pending |
| | Create extension popup with quick stats (items processed today) | Pending |
| | Add link to open full web dashboard | Pending |
| | Add sign-in/sign-out button | Pending |

---

## Epic 4.2: Gmail Sidebar

| Story | Tasks | Status |
|-------|-------|--------|
| **Sidebar Panel Injection** | | Pending |
| | Inject sidebar panel into Gmail's right sidebar area | Pending |
| | Match Gmail's visual style (background, borders, spacing) | Pending |
| | Make sidebar collapsible | Pending |
| **Action Card List** | | Pending |
| | Query tasks_processed API for recent items | Pending |
| | Display action cards in sidebar (sender, subject, category) | Pending |
| | Limit to 10 most recent items | Pending |
| | Add "View All" button linking to web dashboard | Pending |
| **Category Badges** | | Pending |
| | Use same category badge design as web dashboard | Pending |
| | Color-code categories consistently | Pending |
| **Confirm/Dismiss Controls** | | Pending |
| | Add inline confirm button to each card | Pending |
| | Add inline dismiss button to each card | Pending |
| | Update task status via API call | Pending |
| | Remove card from sidebar on dismiss | Pending |

---

## Epic 4.3: Inbox Indicators

| Story | Tasks | Status |
|-------|-------|--------|
| **Email Row Overlay** | | Pending |
| | Detect email rows in Gmail inbox | Pending |
| | Add colored dot overlay to emails that were classified | Pending |
| | Position dot in left margin (before sender name) | Pending |
| **Priority-Based Coloring** | | Pending |
| | URGENT: red dot | Pending |
| | HIGH: orange dot | Pending |
| | MEDIUM: yellow dot | Pending |
| | LOW: gray dot | Pending |
| **Hover Tooltip** | | Pending |
| | Show tooltip on dot hover with category and urgency details | Pending |
| | Add "Open in Tasks dashboard" link in tooltip | Pending |

---

## Epic 4.4: Chrome Web Store Submission

| Story | Tasks | Status |
|-------|-------|--------|
| **Listing & Assets** | | Pending |
| | Create extension icon (16x16, 48x48, 128x128) | Pending |
| | Write extension description and feature list | Pending |
| | Create 5 promo screenshots (1280x800) | Pending |
| | Create promotional tile image (440x280) | Pending |
| **Privacy Policy** | | Pending |
| | Write privacy policy explaining data usage | Pending |
| | Host privacy policy at ctrl.rodeo/tasks/privacy | Pending |
| | Link privacy policy in manifest.json | Pending |
| **Review & Launch** | | Pending |
| | Submit extension for review | Pending |
| | Address reviewer feedback | Pending |
| | Publish to Chrome Web Store | Pending |
