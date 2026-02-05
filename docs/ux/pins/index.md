# Pins

Pins are the core content unit in Boards - links saved from the web that are automatically enriched with metadata, classified by content type, and organized for easy retrieval.

---

## User Goals

- **Save anything from the web** quickly with minimal friction
- **Understand what I saved** through rich previews and metadata
- **Find content later** through search, categories, and content types
- **Keep my collection organized** without manual effort
- **Get AI recommendations** based on my saved content

---

## Jobs to be Done (JTBD)

| When I... | I want to... | So I can... |
|-----------|-------------|-------------|
| Find something interesting online | Save it with one click | Come back to it later |
| Look at my saved pins | See rich previews | Remember what each link is about |
| Have too many pins | Search and filter | Find what I need quickly |
| Save from mobile | Add links easily | Build my collection anywhere |
| See related content | Get smart suggestions | Discover new things I'll like |

---

## Key Concepts

### What is a Pin?

A pin is a saved URL with:
- **Core data**: URL, title, description
- **Hero image**: Visual thumbnail for recognition
- **Content type**: Classification (product, article, video, etc.)
- **Metadata**: Domain, date saved, custom notes
- **Categories**: User-assigned or AI-suggested tags

### Pin Lifecycle

```
┌─────────────┐    ┌─────────────┐    ┌─────────────┐    ┌─────────────┐
│   Capture   │ → │   Enrich    │ → │   Classify  │ → │   Display   │
│  (Add URL)  │    │ (Metadata)  │    │ (AI Type)   │    │  (Card)     │
└─────────────┘    └─────────────┘    └─────────────┘    └─────────────┘
```

---

## Wireframes

### Pin Card (Standard)

```
┌─────────────────────────────────┐
│  ┌─────────────────────────┐    │
│  │                         │    │
│  │      [Hero Image]       │    │
│  │                         │    │
│  └─────────────────────────┘    │
│                                 │
│  Pin Title Here                 │
│  Short description text...      │
│                                 │
│  🌐 domain.com   🛍 Product     │
└─────────────────────────────────┘
```

### Pin Card States

```
Normal          Hover           Selected        Loading
┌───────┐      ┌───────┐       ┌═══════┐       ┌───────┐
│       │      │  [⋮]  │       ║       ║       │  ···  │
│  📌   │      │  📌   │       ║  📌   ║       │       │
│       │      │       │       ║       ║       │       │
└───────┘      └───────┘       └═══════┘       └───────┘
               Actions         Highlight       Fetching
               visible         border          metadata
```

### Pin Detail View

```
┌─────────────────────────────────────────────────────┐
│  [← Back]                              [⋮] Menu     │
├─────────────────────────────────────────────────────┤
│                                                     │
│  ┌──────────────────────────────────────────────┐   │
│  │                                              │   │
│  │              [Large Hero Image]              │   │
│  │                                              │   │
│  └──────────────────────────────────────────────┘   │
│                                                     │
│  # Pin Title                                        │
│                                                     │
│  Full description text here with more details       │
│  about what this content is...                      │
│                                                     │
│  ┌──────────────────────────────────────────────┐   │
│  │ 🌐 domain.com    📅 Saved Dec 15, 2024       │   │
│  │ 🛍 Product       🏷️ Shopping, Fashion        │   │
│  └──────────────────────────────────────────────┘   │
│                                                     │
│  [Open Link]           [Edit]           [Delete]    │
│                                                     │
└─────────────────────────────────────────────────────┘
```

---

## Pin Components

| Component | Description | See Details |
|-----------|-------------|-------------|
| **Content Types** | AI classification of what a pin represents | [Content Types](./content-types.md) |
| **Link Enrichment** | Automatic metadata extraction from URLs | [Link Enrichment](./link-enrichment.md) |
| **Add Links** | Interface for saving new pins | [Add Links](./add-links.md) |
| **Link Management** | Editing, deleting, organizing pins | [Link Management](./link-management.md) |

---

## Known Extensions / Future States

### Short-term
- **Bulk import** - Import bookmarks from browser or other services
- **Pin templates** - Pre-defined metadata for common sites
- **Quick notes** - Add personal notes to any pin

### Medium-term
- **Pin collections** - Group pins into themed collections
- **Pin history** - Track when content was updated
- **Duplicate detection** - Warn when saving something already pinned

### Long-term
- **Offline access** - Cache pin content for offline viewing
- **Content archiving** - Save snapshots of pages
- **Cross-device sync** - Access pins from any device

---

## Technical Notes

- Pins are stored in Supabase with user association
- Enrichment happens via `enrich-link` edge function
- Classification uses rule-based + AI hybrid approach
- Images are proxied through Supabase storage for reliability
