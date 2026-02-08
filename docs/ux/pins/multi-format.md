# Multi-Format Content

> **Status:** ⚠️ Partial
> **Brand Principle:** One place, whole life
> **Key Personas:** Sound & Scene Curator, DJ, Multidisciplinary Maker, Design Technologist

Don't silo by format. A person's links, images, videos, and notes are all facets of who they are. The platform should hold all of it.

---

## What's Shipped

### Links (core pin type)
- URL-based pins with title, description, domain, hero image
- Content type classification across 9 types
- Full enrichment pipeline

### Photos
- Upload via file input
- Stored as `content_type: 'image'`
- Added through standard pin creation flow

### Videos
- Upload via file input
- YouTube/Vimeo detection and ID extraction from URLs
- Stored as `content_type: 'video'`

---

## What's Planned

### Note Pins
Text-first pins without a URL. For capturing thoughts, snippets, quotes.
- Text input in Add modal (detect no URL → note mode)
- Markdown support
- NLP: topic extraction, auto-categorize

### Image Pins
Direct image uploads with richer handling.
- Drag-and-drop or file picker
- Supabase Storage integration
- Vision AI: describe content, suggest category, detect objects
- EXIF data extraction

### File Pins
Document and file uploads — PDFs, CSVs, other file types.
- File type detection and size limits
- Content extraction (PDF text, CSV preview)
- AI summarization

### Event Pins
See [Events Integration](../boards/events.md).

---

## Architecture Note

Multi-format requires the **Pin Type Abstraction** epic (see [Backlog](../../execution/project-plan/backlog.md#epic-0-pin-type-abstraction-pre-requisite)):
- Abstract `Link` into `Pin` with `pin_type` discriminator
- Enrichment strategy registry per pin type
- Database migration: `links` → `pins`

This is the prerequisite for all new pin types beyond links.

---

## Persona Fit

| Persona | What They Need |
|---------|---------------|
| Sound & Scene Curator | Audio embeds, music links with album art, event info |
| DJ | BPM/key metadata on music pins, audio snippet capture |
| Multidisciplinary Maker | Material photos, code repos, supplier links, physical-world captures |
| Design Technologist | Code snippets alongside visual references, hardware specs |

---

*See also: [Link Capture & Enrichment](./link-capture.md) · [Mobile Capture](./mobile-capture.md)*
