# Phase 6: Launch & Growth (Pending)

> Back to [Project Plan](./index.md)

---

## Epic 6.1: Google API Verification

| Story | Tasks | Status |
|-------|-------|--------|
| **Security Assessment** | | Pending |
| | Complete Google's security assessment questionnaire | Pending |
| | Document OAuth scopes and data usage | Pending |
| | Explain why each scope is necessary | Pending |
| **Privacy Policy** | | Pending |
| | Write comprehensive privacy policy covering email access | Pending |
| | Explain data retention and deletion policies | Pending |
| | Host privacy policy at ctrl.rodeo/tasks/privacy | Pending |
| | Link privacy policy in OAuth consent screen | Pending |
| **Terms of Service** | | Pending |
| | Write terms of service | Pending |
| | Define user responsibilities | Pending |
| | Define service limitations and SLA | Pending |
| | Host terms at ctrl.rodeo/tasks/terms | Pending |
| **Verification Submission** | | Pending |
| | Submit app for Google OAuth verification | Pending |
| | Provide video demo of app functionality | Pending |
| | Address Google's verification feedback | Pending |
| | Receive verified status | Pending |

---

## Epic 6.2: Pricing & Billing

| Story | Tasks | Status |
|-------|-------|--------|
| **Stripe Integration** | | Pending |
| | Set up Stripe account | Pending |
| | Create Stripe products for Free, Pro, Team tiers | Pending |
| | Implement Stripe checkout flow | Pending |
| | Store subscription status in tasks_users table | Pending |
| **Free/Pro/Team Tiers** | | Pending |
| | Define tier limits: Free (100 emails/month, 5 rules), Pro (unlimited emails, 50 rules), Team (multi-user, unlimited rules) | Pending |
| | Set pricing: Free ($0), Pro ($9/month), Team ($49/month for 5 users) | Pending |
| | Create pricing page at /tasks/pricing | Pending |
| **Usage Tracking** | | Pending |
| | Track emails processed per user per month | Pending |
| | Enforce Free tier limit (100 emails/month) | Pending |
| | Show usage dashboard in settings view | Pending |
| | Send email when user approaches limit | Pending |
| **Upgrade/Downgrade Flow** | | Pending |
| | Implement upgrade button in dashboard | Pending |
| | Handle pro-rated billing on tier change | Pending |
| | Allow downgrade at end of billing period | Pending |

---

## Epic 6.3: Monitoring & Observability

| Story | Tasks | Status |
|-------|-------|--------|
| **Latency Metrics** | | Pending |
| | Track end-to-end latency (email arrival → task creation) | Pending |
| | Track Claude API latency separately | Pending |
| | Track Google Tasks API latency separately | Pending |
| | Set up Grafana dashboard for latency metrics | Pending |
| **Classification Accuracy Tracking** | | Pending |
| | Track user feedback on classifications (confirm/dismiss rate) | Pending |
| | Calculate accuracy per category | Pending |
| | Flag low-confidence classifications for review | Pending |
| | Retrain or adjust prompts based on accuracy data | Pending |
| **Error Alerting** | | Pending |
| | Set up error tracking with Sentry or similar | Pending |
| | Alert on high error rate (>5% of classifications failing) | Pending |
| | Alert on Claude API errors | Pending |
| | Alert on Gmail watch expiration failures | Pending |

---

## Epic 6.4: Beta Program

| Story | Tasks | Status |
|-------|-------|--------|
| **Invite-Only Beta** | | Pending |
| | Create waitlist signup form | Pending |
| | Implement invite code system | Pending |
| | Send onboarding emails to beta users | Pending |
| | Limit beta to 100 users initially | Pending |
| **Feedback Collection** | | Pending |
| | Add in-app feedback form | Pending |
| | Send weekly feedback survey to beta users | Pending |
| | Track feature requests and bugs | Pending |
| | Schedule 1-on-1 user interviews with 10 beta users | Pending |
| **Iterate on Classification Quality** | | Pending |
| | Analyze classification accuracy from beta data | Pending |
| | Identify common misclassifications | Pending |
| | Refine Claude prompt based on feedback | Pending |
| | A/B test prompt variations | Pending |
| **Public Launch Prep** | | Pending |
| | Fix critical bugs identified in beta | Pending |
| | Improve onboarding flow based on user feedback | Pending |
| | Prepare launch announcement and marketing materials | Pending |
| | Set public launch date | Pending |
