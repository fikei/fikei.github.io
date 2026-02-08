# User Personas

> Reference personas for feature design, prioritization, and UX decisions across ctrl.rodeo.
>
> See also: [Brand Positioning](../strategy/brand-positioning.md)

---

## How to Use These Personas

When designing features, widgets, or architecture:

1. **Check which personas benefit** — if a feature doesn't serve at least one persona's core need, question it
2. **Prioritize by tier** — Primary personas get first-class support; Secondary personas should not be blocked; Future personas inform long-term architecture but don't drive current sprints
3. **Reference the JTBD** — each persona has Jobs To Be Done that map directly to feature requirements
4. **Test against anti-patterns** — each persona has things that would drive them away

---

## Primary Personas (Launch Audience)

### 1. The Visual Collector — "Mara"

**Who:** Graphic designer, 28. Freelance. Pulls references from Instagram, Are.na, Behance, random blogs, physical bookstores, gallery shows. Has 40+ browser tabs open at any time.

**Creative practice:** Brand identity work, editorial design, occasional illustration. Her output quality depends directly on the breadth of her reference library.

**Core need:** A single place to throw everything — URLs, screenshots, products, inspiration — and have it organized without effort so she can find it when she needs it for a project.

**Jobs To Be Done:**
| When I... | I want to... | So I can... |
|-----------|-------------|-------------|
| Find something inspiring online | Save it in one action | Not lose it in browser tab chaos |
| Start a new client project | Browse my saved references by mood/style/color | Build a direction quickly from things I already love |
| See my collection growing | Understand what patterns emerge | Know my own taste better and articulate it to clients |
| Need a specific reference I saved months ago | Search and find it fast | Pull it into a mood board or presentation |

**Anti-patterns (what would drive her away):**
- Forcing her to pick a category before saving
- Ugly or cluttered interface that competes with her content
- Slow capture — anything more than paste-and-done
- No visual browsing — text-only lists are useless for visual work

---

### 2. The Sound & Scene Curator — "Jordan"

**Who:** Musician and DJ, 32. Produces electronic music, plays shows, runs a small label. Constantly scanning for new music, gear, venues, visual artists for collaborations, and events to attend or play.

**Creative practice:** Music production, DJ sets, event curation. What they listen to, see, and experience directly feeds the music they make. The line between "consuming" and "creating" is blurred.

**Core need:** Track everything across music, visual art, events, gear, and collaborators — and see the connections between them. A link to a synth review, a Bandcamp album, and an event listing might all relate to the same project.

**Jobs To Be Done:**
| When I... | I want to... | So I can... |
|-----------|-------------|-------------|
| Discover a new artist or track | Save it alongside context (who shared it, what event) | Remember why it mattered and follow up |
| Plan a DJ set or event | Browse my music + visual + venue saves together | Curate a cohesive experience, not just a playlist |
| Research new gear or software | Collect reviews, demos, and comparisons in one place | Make an informed decision without re-searching |
| Look back at a month of saves | See what themes and sounds I was drawn to | Identify creative directions for my own work |

**Anti-patterns:**
- Only supporting "link" content — needs to handle audio, events, products
- No way to see things across categories — everything siloed
- Rigid organization that doesn't match how music people think (vibes > folders)

---

### 3. The Multidisciplinary Maker — "Alex"

**Who:** Industrial designer turned creative technologist, 35. Works at the intersection of physical and digital. Saves material samples, fabrication techniques, code repos, design tools, exhibition photos, supplier links.

**Creative practice:** Prototyping, installations, product design. Inputs come from wildly different domains — a ceramics blog, a GitHub repo, a hardware store product page, a museum exhibition — and they all connect in the work.

**Core need:** A personal knowledge base that doesn't force artificial boundaries between "work research" and "personal interest" — because for makers, those are the same thing.

**Jobs To Be Done:**
| When I... | I want to... | So I can... |
|-----------|-------------|-------------|
| Research a new material or technique | Save links from diverse sources (suppliers, tutorials, forums) | Build a complete picture without switching between apps |
| Start a new project | See related saves across categories (materials + tools + references + inspiration) | Connect dots I wouldn't have seen otherwise |
| Share research with a collaborator | Export or share a curated collection | Bring someone up to speed without re-explaining everything |
| Move between online research and physical making | Capture both digital links and real-world finds (photos, locations) | Keep my full creative context in one place |

**Anti-patterns:**
- Desktop-only — needs to capture in the studio, at a shop, at an exhibition
- No way to relate items across categories
- Treating "links" as the only input type

---

## Secondary Personas (Growth Audience)

### 4. The Deep-Dive Enthusiast — "Priya"

**Who:** Product manager by day, 30. Obsessive hobbyist — currently deep into specialty coffee, Japanese stationery, and rock climbing. Curates recommendations for friends. Maintains mental lists of "best of" across every interest.

**Core need:** Organize and surface knowledge across multiple passionate interests without mixing up contexts. She's essentially building personal databases for each hobby.

**Jobs To Be Done:**
| When I... | I want to... | So I can... |
|-----------|-------------|-------------|
| Find the perfect coffee roaster | Save and compare options with notes | Make confident purchase decisions |
| A friend asks for recommendations | Pull up my curated list for that topic | Share expertise without recreating it each time |
| Pick up a hobby I paused | See where I left off — what I'd saved, what I'd tried | Resume without starting from scratch |
| Go deep on a new interest | Have a dedicated space that grows with my research | Feel the satisfaction of building expertise |

---

### 5. The Researcher — "David"

**Who:** Freelance strategist, 41. Reads 50+ articles a week across technology, culture, business, and design. Builds arguments and decks from curated evidence. His value is in synthesis — connecting dots others miss.

**Core need:** Save, tag, and retrieve references fast — and see relationships between articles, reports, and ideas over time. His collection is a competitive advantage.

**Jobs To Be Done:**
| When I... | I want to... | So I can... |
|-----------|-------------|-------------|
| Read something relevant | Capture it with minimal friction and context | Build a searchable archive of evidence |
| Build a strategy deck | Search my saves by theme or timeframe | Ground arguments in real examples and trends |
| Spot a trend forming | See what I've been saving recently in aggregate | Identify emerging patterns before others do |
| Need to cite a source from months ago | Find it by content, not by when I saved it | Maintain credibility with specific references |

---

### 6. The Cultural Omnivore — "Kai"

**Who:** Creative director, 37. Attends gallery openings, film festivals, concerts, pop-ups. Reads across art, food, travel, fashion, architecture. Their identity is their taste — and they want it visible and organized.

**Core need:** A living, visual map of everything they care about — not just links, but events attended, places visited, things owned, experiences had. A curated life, not just a curated feed.

**Jobs To Be Done:**
| When I... | I want to... | So I can... |
|-----------|-------------|-------------|
| Attend an event or visit a place | Log it as part of my collection | Build a record of experiences, not just bookmarks |
| Plan a weekend | See what's happening filtered by my interests | Spend time on things that actually matter to me |
| Look back at a year | See a visual timeline of what I consumed and experienced | Appreciate and share my cultural life |
| Discover something through my collection | Follow connections I didn't plan | Stay surprised by my own taste |

---

## Future Personas (Architecture Considerations)

These personas don't drive current features but should not be blocked by architectural decisions:

### 7. The Student — "Sam"
Organizing learning materials, career inspiration, course notes, and application resources. Needs simple capture, topic-based organization, and export capabilities.

### 8. The Small Business Owner — "Lin"
Tracking competitors, suppliers, industry trends, design inspiration for their brand, and product ideas. Needs collections that can be shared with a small team.

### 9. The Planner — "Noor"
Trip planning, event coordination, gift lists, home renovation research. Practical curation with a timeline component — things that have deadlines or locations attached.

---

## Persona-to-Feature Matrix

| Feature Area | Mara | Jordan | Alex | Priya | David | Kai |
|-------------|------|--------|------|-------|-------|-----|
| Link capture & enrichment | **critical** | **critical** | **critical** | **critical** | **critical** | high |
| AI categorization | **critical** | **critical** | **critical** | high | **critical** | high |
| Visual grid browsing | **critical** | high | high | medium | low | **critical** |
| Cross-category connections | high | **critical** | **critical** | medium | **critical** | **critical** |
| Events integration | medium | **critical** | medium | medium | low | **critical** |
| Mobile capture | **critical** | high | **critical** | high | medium | high |
| Search & retrieval | high | medium | high | high | **critical** | medium |
| Collection sharing | medium | high | **critical** | **critical** | high | high |
| Taste/pattern surfacing | high | **critical** | high | medium | **critical** | **critical** |
| Multi-format content | medium | **critical** | **critical** | medium | medium | high |

---

## Design Implications

**From Primary personas:**
- Capture must be instant — paste a URL, done. Zero decisions required at save time.
- Visual browsing is non-negotiable. The grid layout is correct; never regress to text-only lists.
- AI categorization must feel like magic, not like a menu to fill out.
- Cross-category discovery is a differentiator. Build for it early.
- Mobile is not optional. Creatives find things everywhere — commuting, at shows, in studios.

**From Secondary personas:**
- Sharing and export features are retention drivers — people who share their collections stay.
- Search quality matters more as collections grow. Invest in retrieval.
- Support for "returning to a topic" — don't just show recent saves, show collection depth.

**From Future personas:**
- Don't couple architecture to "links only" — design data models that can hold events, locations, notes, images.
- Team/sharing features should be planned in the data model even if not built yet.
- Timeline and calendar views are future surface areas — don't block them.

---

*Last updated: 2026-02-08*
