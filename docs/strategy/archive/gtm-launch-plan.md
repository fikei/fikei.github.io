> **Archived from an orphaned branch.** Recovered from `claude/gtm-rodeo-echo-launch-TAWEy` (last touched 2026-03-05),
> which shares no history with master after the repository history was rewritten.
> Kept for the thinking in it; nothing here is current.

# GTM Launch Plan: Rodeo + Echo

> **Target Launch:** Friday, March 13, 2026
> **Scale Target:** 2,000 users within 60 days
> **Status:** DRAFT
> **Created:** 2026-03-05

---

## Executive Summary

Dual-product launch of **Rodeo** (web — personal curation platform, formerly Boards) and **Echo** (iOS — audio/voice capture app). Both products share the ctrl.rodeo brand and the same core insight: **what you experience informs what you create.** The launch targets creatives and high-volume collectors who need better tools for capturing and organizing their inputs.

---

## Part 1: Rodeo (Web) — Launch-Ready MVP

### What's Already Shipped
Rodeo is substantially built. The core loop works:

| Capability | Status | Notes |
|-----------|--------|-------|
| User auth (signup/login) | SHIPPED | Supabase auth |
| Link capture (URL input) | SHIPPED | Freeform text, mobile-optimized |
| AI auto-categorization | SHIPPED | Claude Haiku, 9 categories |
| Visual grid with hero images | SHIPPED | Swiss design, drag-and-drop |
| PWA + share target | SHIPPED | Mobile share sheet integration |
| Quick capture tools | SHIPPED | Bookmarklet, deep links, image scan |
| AI widgets (21 configs) | SHIPPED | Recommendations, comparisons, etc. |
| Board sharing (link-only) | SHIPPED | Read-only shared view |
| Events aggregator | SHIPPED | Multi-source, calendar views |
| Design system | SHIPPED | Tokens, components, constraints |
| Analytics (Segment + GTM) | SHIPPED | Already integrated |

### What's Needed for Launch (Must-Have by March 13)

These are the **minimum gaps** to close for a credible public launch:

#### 1. Landing Page (ctrl.rodeo homepage)
The current homepage is a developer portfolio. It needs to become a product landing page.

- **Hero**: Tagline + 1-sentence value prop + CTA ("Start Curating" → /boards/)
- **How it works**: 3-step visual (Save → Organize → Discover)
- **Social proof placeholder**: "Join X creatives organizing their creative life"
- **Footer**: Links to privacy policy, terms (can be minimal/placeholder)
- **No signup wall**: Direct link to the app — reduce friction to zero

#### 2. Onboarding Flow (First 60 Seconds)
Currently users land on an empty board. Fix the cold start:

- **Welcome state**: When board is empty, show 3-step prompt:
  1. "Paste a URL to get started"
  2. "Or install the bookmarklet for one-click saving"
  3. "Share from any app on mobile"
- **Sample content**: Optional "Try it" button that adds 3 demo links to show categorization
- **Capture tools surfaced early**: Show bookmarklet/PWA install prompts in onboarding, not buried in a modal

#### 3. Run Blocked Migrations
6 SQL migrations are pending (019, 020, 016, 017, 018, 007). At minimum, run:
- `019_board_metadata.sql` — needed for Create a Board
- `020_link_tags.sql` — needed for tag-based features

#### 4. Deploy Pending Edge Functions
- Deploy updated `enrich-link` with Tier 2 validation
- Deploy `validate-image` for image quality

#### 5. Basic Error Handling & Polish
- Ensure auth flow handles edge cases (password reset, email confirmation)
- Loading states for AI categorization (users need feedback that something is happening)
- Mobile viewport fixes if any exist

### What's NOT Needed for Launch (Cut Scope)

| Feature | Why It Can Wait |
|---------|----------------|
| Collaborative boards | Solo use is the core loop; collab is Phase 4 |
| Username system | Not needed until sharing is a growth driver |
| Bulk import | Nice-to-have; manual adding works for launch |
| Instagram import | Future growth feature |
| Lookback/digest emails | Retention feature — add in week 2-3 |
| Push notifications | Requires FCM/APNs setup — post-launch |

---

## Part 2: Echo (iOS) — Launch-Ready MVP

> **Note:** Echo lives in a separate repo (`echo-ios`). This section defines the GTM requirements; implementation details should be tracked in that repo.

### MVP Definition (Must-Have for Launch)

Echo should launch with the **minimum feature set that delivers a complete, differentiated experience**:

| Feature | Priority | Notes |
|---------|----------|-------|
| Voice/audio capture | P0 | Core differentiator — capture thoughts, sounds, ideas by voice |
| Auto-transcription | P0 | Whisper or similar — text from voice |
| AI tagging/categorization | P0 | Match Rodeo's category system — shared taxonomy |
| Simple feed/timeline | P0 | Chronological view of captures |
| Share to Rodeo | P1 | Deep link captured items into Rodeo web app |
| Basic search | P1 | Search transcriptions |
| iOS share extension | P1 | Capture from any app |

### What Echo Should NOT Do at Launch

- No social features, no public profiles
- No Android version
- No complex editing or organization tools
- No subscription/paywall — free at launch

### Cross-Product Integration
The key differentiator is that Rodeo + Echo together = **capture everything, everywhere**:
- **Echo** captures ephemeral moments (audio, voice notes, quick thoughts) on mobile
- **Rodeo** captures intentional saves (links, articles, products) on web
- Both feed into the same organized life map
- Shared user accounts via Supabase auth

---

## Part 3: GTM Strategy

### Positioning

**Rodeo:** "Your likes. Your saves. Your life — organized."
**Echo:** "Capture what you hear. Remember what matters."
**Together:** "Everything you find interesting — captured, organized, connected."

### Launch Channels (Ranked by Expected Impact)

#### Tier 1: High-Impact, Low-Cost (Week 1)

| Channel | Action | Expected Impact |
|---------|--------|-----------------|
| **Product Hunt** | Launch Rodeo on PH. Echo as "companion app" in description. Schedule for Tuesday or Wednesday (highest traffic). | 300-800 signups day 1 |
| **Hacker News** | "Show HN: I built an AI-powered curation tool for creatives" — genuine builder story, mention vibe coding approach | 200-500 signups if front page |
| **Twitter/X** | Thread: "I spent 3 months building the tool I wished existed for organizing my creative life" — demo GIF, link to PH | Amplifier for PH + HN |
| **Designer communities** | Post in Sidebar.io, Designer News, Dribbble, Behance forums | 50-200 targeted signups |

#### Tier 2: Community Seeding (Week 1-2)

| Channel | Action | Expected Impact |
|---------|--------|-----------------|
| **Reddit** | r/InternetIsBeautiful, r/SideProject, r/webdev, r/design — tailored posts per subreddit | 100-300 signups |
| **Discord communities** | Design, creative, and indie hacker Discords — share as a tool, not spam | 50-100 signups |
| **IndieHackers** | Product launch post + milestone post | 50-150 signups |
| **Creative newsletters** | Pitch to Dense Discovery, TLDR Design, Sidebar | 100-500 if featured |

#### Tier 3: Sustained Growth (Week 2-4)

| Channel | Action | Expected Impact |
|---------|--------|-----------------|
| **Content marketing** | Blog posts on ctrl.rodeo: "How I organize 500+ links", "The case for intentional curation" | SEO long-tail |
| **Share-driven virality** | Every shared board is a marketing surface — add "Curated with Rodeo" footer | Organic compound growth |
| **Bookmarklet/PWA virality** | Users install tools → more captures → more sharing | Retention + word of mouth |
| **Creator partnerships** | Give 5-10 design influencers early access, ask them to share their public board | 200-1000 per influencer |

### Growth Mechanisms (Built Into the Product)

These are the features that make growth self-sustaining:

#### 1. Shared Boards as Marketing Surfaces
Every public board at `ctrl.rodeo/boards/share.html?id=X` should include:
- "Curated with Rodeo" subtle branding
- "Create your own board →" CTA for non-users
- Open Graph metadata so shared links look good on social

#### 2. Bookmarklet as Distribution
The bookmarklet is installed in a user's browser toolbar. Every time they use it:
- Reinforces the habit
- Visible to anyone watching them browse (screen shares, pair programming)
- Can optionally prompt "Share this save?" after capture

#### 3. PWA Share Target as Lock-In
Once installed as a PWA, Rodeo appears in the mobile share sheet alongside native apps. This makes it:
- Top-of-mind every time the user shares anything
- A default habit over time
- Hard to abandon (behavioral lock-in, not technical)

#### 4. AI Widgets as Content Worth Sharing
Widget outputs ("Your top picks this week", "Complete the Look") are inherently shareable:
- Add "Share this widget" button that generates an image/link
- Each shared widget drives back to the board and to signup

#### 5. Echo → Rodeo Bridge
Echo captures feed into Rodeo's web view, creating:
- A reason to use both products
- Cross-platform stickiness
- "Capture on phone, organize on desktop" workflow

### Referral Mechanism
Simple invite system (post-launch week 2):
- "Invite a friend" — both get early access to upcoming features
- No complex referral codes — just a share link
- Track with Segment events

---

## Part 4: Scale Readiness (2,000 Users)

### Infrastructure Assessment

| Component | Current State | Ready for 2K? | Action Needed |
|-----------|--------------|----------------|---------------|
| GitHub Pages hosting | Static site | YES | No action — CDN-backed, scales infinitely |
| Supabase auth | Free tier | MAYBE | Free tier = 50K MAU — fine for 2K |
| Supabase database | Free tier | WATCH | Free tier = 500MB, 2 CPU. Monitor, upgrade to Pro ($25/mo) if needed |
| Edge functions | Free tier | WATCH | Free tier = 500K invocations/mo. At ~50 enrichments/user/mo = 100K. Fine. |
| Claude API (categorization) | Pay-per-use | YES | Haiku is cheap. 2K users × 50 links/mo × $0.001 = ~$100/mo |
| SERP API (enrichment) | Pay-per-use | WATCH | Check rate limits and budget |
| Segment analytics | Free tier | YES | Free tier = 1K MTU — will need to upgrade at ~1K users |

### Cost Projection (2,000 Users)

| Item | Monthly Cost |
|------|-------------|
| Supabase Pro (if needed) | $25 |
| Claude API (Haiku) | ~$100 |
| SERP API | ~$50 |
| Segment (if over 1K MTU) | $120 |
| Domain (ctrl.rodeo) | ~$2 |
| Apple Developer (Echo) | ~$8 |
| **Total** | **~$305/mo** |

### Performance Checklist Before Launch

- [ ] Load test: Simulate 100 concurrent users hitting /boards/
- [ ] Edge function cold start: Ensure < 3s for `enrich-link`
- [ ] Database indexing: Verify GIN indexes on tags, category columns
- [ ] Image CDN: Ensure hero images aren't served raw from origin
- [ ] Rate limiting: Add basic rate limits to edge functions to prevent abuse
- [ ] Error monitoring: Set up basic alerting (Supabase dashboard or Sentry free tier)

---

## Part 5: Launch Timeline

### Week of March 5-9 (This Week — Prep)

| Day | Rodeo | Echo | Marketing |
|-----|-------|------|-----------|
| Thu 3/5 | Scope MVP gaps, create landing page plan | Audit current state, define MVP gaps | Draft PH listing, prepare assets |
| Fri 3/6 | Build landing page, onboarding flow | Close critical MVP gaps | Create demo GIF/video, OG images |
| Sat 3/7 | Run migrations, deploy functions | TestFlight beta | Write HN post, Twitter thread |
| Sun 3/8 | Bug bash, mobile testing | Bug bash | Prep PH hunter outreach |

### Week of March 10-13 (Launch Week)

| Day | Rodeo | Echo | Marketing |
|-----|-------|------|-----------|
| Mon 3/10 | Final polish, shared board OG tags | Final TestFlight | Schedule PH for Wednesday |
| Tue 3/11 | Soft launch — share with 10-20 friends/creatives | Submit to App Store | Seed early reviews, prep launch day |
| Wed 3/12 | **PRODUCT HUNT LAUNCH** | **APP STORE LIVE** | PH, HN, Twitter, Reddit — all channels |
| Thu 3/13 | Monitor, hotfix, respond to feedback | Monitor crashes, reviews | Follow-up posts, respond to comments |

### Post-Launch (Week 2-4)

| Week | Focus |
|------|-------|
| Week 2 | Hotfixes, onboarding iteration based on drop-off data, add referral mechanism |
| Week 3 | First retention feature (Lookback digest email), creator partnerships |
| Week 4 | Collaborative boards (if demand signals are strong), content marketing |

---

## Part 6: Success Metrics

### Launch Day (March 12-13)
- [ ] 200+ signups on day 1
- [ ] Product Hunt top 10 finish
- [ ] < 1% error rate on core flows
- [ ] Average 5+ links saved per new user in first session

### Week 1
- [ ] 500+ total signups
- [ ] 30% D1 retention (return next day)
- [ ] 10+ shared boards created
- [ ] App Store rating > 4.0 (Echo)

### Month 1
- [ ] 2,000 total signups
- [ ] 20% WAU/MAU ratio
- [ ] 50+ shared boards with external views
- [ ] 5+ organic mentions (tweets, posts, newsletters)

### Key Tracking Events (Segment)
```
user_signed_up        — account creation
first_link_saved      — activation
fifth_link_saved      — engagement threshold
board_shared          — virality trigger
bookmarklet_installed — power user signal
pwa_installed         — retention signal
echo_capture_sent     — cross-product activation
widget_shared         — content virality
```

---

## Part 7: Risk Register

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| Echo not App Store approved by 3/12 | Medium | High | Submit by 3/8 at latest; have web fallback |
| Supabase free tier rate limited | Low | High | Monitor during soft launch; upgrade to Pro preemptively |
| PH launch underperforms | Medium | Medium | HN + Reddit as backup channels; don't put all eggs in one basket |
| AI categorization quality issues | Low | Medium | Already battle-tested; monitor edge cases |
| Cold start problem (empty board) | High | High | Onboarding flow + sample content are P0 |
| Users confused by two products | Medium | Medium | Clear positioning on landing page: "Rodeo = web saves, Echo = audio capture" |

---

## Immediate Next Steps

### For This Session (Rodeo — ctrl.rodeo repo)
1. **Build the landing page** — transform ctrl.rodeo homepage into a product landing page
2. **Add onboarding empty state** — welcome flow for new users in /boards/
3. **Add OG metadata to shared boards** — make shared links look good on social
4. **Add "Curated with Rodeo" branding** to share.html

### Requiring Human Action
1. **Run blocked SQL migrations** (019, 020, 016) via Supabase Dashboard
2. **Deploy edge functions** (`enrich-link`, `validate-image`)
3. **Echo iOS:** Audit current state, close MVP gaps, submit TestFlight by 3/7
4. **Product Hunt:** Create listing draft, find a hunter
5. **Prepare launch day content:** HN post, Twitter thread, Reddit posts

---

*This is a living document. Update as launch prep progresses.*
