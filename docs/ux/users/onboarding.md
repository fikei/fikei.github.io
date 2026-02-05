# Onboarding

The first-time user experience that introduces Boards features and helps users get started quickly.

---

## User Goals

- **Understand what Boards does** immediately
- **Add my first pin** within 30 seconds
- **Learn key features** without reading docs
- **Feel successful** after first session
- **Skip if I know what I'm doing** without friction

---

## Jobs to be Done (JTBD)

| When I... | I want to... | So I can... |
|-----------|-------------|-------------|
| First open Boards | Understand the value prop | Know if it's for me |
| Start using the app | Be guided through basics | Not feel lost |
| Add my first pin | Feel accomplished | Want to continue |
| See empty state | Know what to do next | Take action |
| Return as a new user | Skip already-seen tips | Get to work faster |

---

## Wireframes

### Landing State (No Pins)

```
┌─────────────────────────────────────────────────────────────┐
│  BOARDS                                       [+ Add]       │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│                                                             │
│                         📌                                  │
│                                                             │
│              Welcome to Boards                              │
│                                                             │
│       Save links, organize with AI, discover                │
│              what goes with what.                           │
│                                                             │
│              ┌─────────────────────┐                        │
│              │   + Add Your First  │                        │
│              │        Link         │                        │
│              └─────────────────────┘                        │
│                                                             │
│                 or paste a URL anywhere                     │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

### First Pin Added Celebration

```
┌─────────────────────────────────────────┐
│                                         │
│              🎉                         │
│                                         │
│        Your first pin!                  │
│                                         │
│   ┌─────────────────────────────┐      │
│   │  [image]  Product Title     │      │
│   │           domain.com        │      │
│   └─────────────────────────────┘      │
│                                         │
│   Tips:                                 │
│   • Click to expand and see details    │
│   • Add more pins to unlock AI widgets │
│   • Organize into categories           │
│                                         │
│          [ Got it! ]                    │
│                                         │
└─────────────────────────────────────────┘
```

### Feature Discovery Tooltips

```
First category filter used:
┌──────────────────────────────────────────────────────┐
│  [ All (5) ] [ Clothing (3) ] [ Tech (2) ]          │
│        ↑                                             │
│  ┌─────────────────────────────────────┐             │
│  │ 💡 Filter by category to focus on  │             │
│  │    specific types of content        │             │
│  │                         [ Got it ] │             │
│  └─────────────────────────────────────┘             │
└──────────────────────────────────────────────────────┘

Widget appears (after 5+ pins):
┌─────────────────────────────────────────────────────────┐
│  ✨ Complete the Look                                   │
│  ┌─────────────────────────────────────────────────┐   │
│  │ 💡 New! AI found items that match your style.  │   │
│  │    Favorite widgets you like, dismiss ones     │   │
│  │    you don't.                    [ Got it ]    │   │
│  └─────────────────────────────────────────────────┘   │
│  ...                                                    │
└─────────────────────────────────────────────────────────┘
```

### Progress Indicators

```
Onboarding checklist (dismissible):
┌─────────────────────────────────────────┐
│  Getting Started                   [×]  │
├─────────────────────────────────────────┤
│  ✓ Add your first pin                   │
│  ✓ Expand a pin to see details          │
│  ○ Create a category                    │
│  ○ Add 5 pins to unlock AI widgets      │
│  ○ Sign in to sync across devices       │
│                                         │
│  Progress: ████████░░░░░░░░░░ 40%       │
└─────────────────────────────────────────┘
```

---

## Onboarding Stages

| Stage | Trigger | What Happens |
|-------|---------|--------------|
| **Welcome** | First visit | Show empty state with CTA |
| **First Pin** | Pin added | Celebration + tips |
| **Categories** | First filter click | Tooltip explanation |
| **Widgets** | 5+ pins | Introduce AI widgets |
| **Sync** | Using locally | Prompt to sign in |
| **Complete** | Checklist done | Hide onboarding |

---

## Progressive Disclosure

```
Pin Count:  Features Unlocked:
──────────  ───────────────────
0           Empty state, Add CTA
1           Basic grid, expand cards
3           Category creation prompt
5           AI widgets appear
10          Sharing suggestion
20          Advanced tips
```

---

## Known Extensions / Future States

### Short-term
- **Interactive tutorial** - Guided walkthrough with hotspots
- **Sample board** - Pre-populated demo board
- **Video intro** - 30-second feature overview

### Medium-term
- **Personalized onboarding** - Ask what they'll use it for
- **Import from other services** - "Bring your Pocket/Pinterest pins"
- **Template boards** - Start with curated collections

### Long-term
- **Onboarding A/B testing** - Optimize conversion
- **Re-engagement flows** - Help dormant users return
- **Advanced feature tutorials** - Deep-dive on complex features

---

## Success Metrics

| Metric | Target |
|--------|--------|
| Time to first pin | < 60 seconds |
| Day 1 retention | > 30% |
| Pins per session (new user) | > 3 |
| Onboarding completion | > 50% |
| Sign-up conversion | > 20% |

---

## Technical Notes

- Onboarding state stored in localStorage
- `onboarding_completed` flag prevents re-showing
- Individual tooltips tracked by ID
- Checklist items have `seen_at` timestamps
- Analytics events fired at each stage
