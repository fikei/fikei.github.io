# Mobile Capture

> **Status:** ⚠️ Partial
> **Brand Principle:** Organize as you go
> **Key Personas:** Visual Collector, DJ, Multidisciplinary Maker

Creatives find things everywhere — commuting, at shows, in studios, at shops. Capture must work from a phone as easily as from a desktop.

---

## What's Shipped

### Responsive Mobile UI
- Full responsive layout: 2-column grid on mobile
- Touch-friendly card interactions
- Mobile-optimized input modals

### Clipboard Detection
- Detects URLs in clipboard on page load and window focus
- Prompts to save detected URL

### File Upload
- Photo upload via camera/file picker
- Video upload from device

---

## What's Planned

### Share Sheet Integration
- Save to ctrl.rodeo from any app's share menu (iOS Share Extension, Android Share Intent)
- Auto-extract page metadata from shared URL
- Requires mobile app or PWA with share target

### Photo-to-Pin
- Capture photo, AI extracts context (product label, artwork, event poster, business card)
- Vision AI identifies what's in the image and creates appropriate pin

### Audio Snippet Capture
- Record a few seconds at a club or show
- Audio fingerprinting to identify track (Shazam-like)
- Creates music pin with artist/track metadata

### Quick Capture Widget
- Home screen widget for instant URL/note/photo capture
- One-tap save without opening the full app

### Offline Capture Queue
- Save pins offline when no connection
- Sync and enrich when back online
- Visual indicator for queued items

---

## Persona Fit

| Persona | Scenario |
|---------|----------|
| Visual Collector | Sees a design in a bookstore — photos it, AI categorizes as design reference |
| DJ | Hears a track at a club — records snippet, identifies it, saves to crate |
| Multidisciplinary Maker | At a hardware store — saves supplier link from phone between errands |

---

*See also: [Link Capture & Enrichment](./link-capture.md) · [Multi-Format Content](./multi-format.md)*
