# Backlog: Future Considerations

> Back to [Project Plan](./index.md)

---

## Pin Type Abstraction (Pre-requisite for new pin types)

| Story | Status |
|-------|--------|
| **Introduce `Pin` base type** — Abstract `Link` into a `Pin` with `pin_type` discriminator field | Pending |
| **Refactor `addLink()` → `addPin()`** — Generalize creation flow to dispatch by pin type | Pending |
| **Refactor `syncLinkToSupabase()` → `syncPinToSupabase()`** — Type-agnostic persistence | Pending |
| **Enrichment strategy registry** — Map `pin_type` → `{ clientEnrich(), serverEnrich() }` | Pending |
| **Rename `enrich-link` edge function → `enrich-pin`** — Accept any pin type, route to type-specific handler | Pending |
| **Database migration: `links` → `pins`** — Add `pin_type` column, backfill existing rows as `link` | Pending |
| **Update widget eligibility** — Widgets declare which pin types they operate on | Pending |

> Trigger: Start this epic when implementing the first non-link pin type (notes, photos, or files).
> See: [Core Systems Architecture](../../infrastructure/technical-design/core-systems-architecture.md) for the extensibility model.

---

## Rich Media Support

| Story | Status |
|-------|--------|
| Video links (YouTube, Vimeo) - thumbnails, duration, inline preview | Pending |
| Music links (Spotify, SoundCloud) - album art, artist info, audio preview | Pending |
| Direct image upload to Supabase Storage | Pending |
| Direct video upload with compression | Pending |
| **Notes Support** - Add text notes as pins without URLs | Pending |
| **Photo Upload** - Add photos directly (not just links) | Pending |
| **Video Upload** - Upload video files with player | Pending |
| Note/media pin visual differentiation | Pending |

---

## Content Reader

| Story | Status |
|-------|--------|
| **PDF Reader** | Pending |
| Detect PDF links and content type | Pending |
| Inline PDF preview in expanded view | Pending |
| Full-screen PDF reader mode | Pending |
| Extract text/images for thumbnails | Pending |
| **Newsletter Reader** | Pending |
| Detect newsletter/email content | Pending |
| Clean reader view (strip tracking/formatting) | Pending |
| Save newsletter as readable text | Pending |
| **Article Reader** | Pending |
| News article detection | Pending |
| Reader mode (clean article extraction) | Pending |
| Save article text locally | Pending |
| Offline reading support | Pending |
| **Text View Mode** | Pending |
| Toggle between visual and text-focused views | Pending |
| Text-heavy content card design | Pending |
| Reading time estimates | Pending |

---

## Advanced AI Features

| Story | Status |
|-------|--------|
| Multi-type domain learning | Pending |
| Path pattern learning for complex domains | Pending |
| Type discovery pipeline (clustering + AI analysis) | Pending |
| AI image generation for missing thumbnails | Pending |
| User-customizable AI prompts | Pending |

---

## Admin Enhancements

| Story | Status |
|-------|--------|
| Content type management (add/edit types) | Pending |
| Visual guidelines management | Pending |
| System metrics dashboard | Pending |
| Scraping health monitor | Pending |
| Widget A/B testing framework | Pending |

---

## Sharing Enhancements

| Story | Status |
|-------|--------|
| Board fork/copy | Pending |
| Persistent saved link state | Pending |
| Advanced analytics (clicks, saves, trends) | Pending |
| Custom share URLs (ctrl.rodeo/b/my-board) | Pending |
| QR code sharing | Pending |
| Embed widget for websites | Pending |
| Comment system on shared boards | Pending |
| Pin suggestions from viewers | Pending |
| Follow boards (notifications) | Pending |
| Board marketplace/discovery | Pending |

---

## Internationalization

| Story | Status |
|-------|--------|
| Language selection in settings | Pending |
| RTL support | Pending |
| Date/time localization | Pending |

---

## Accessibility

| Story | Status |
|-------|--------|
| High contrast mode | Pending |
| Reduced motion option | Pending |
| Screen reader optimization | Pending |
| Focus indicators | Pending |
