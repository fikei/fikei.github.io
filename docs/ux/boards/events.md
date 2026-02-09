# Events Integration

> **Status:** ❌ Planned
> **Brand Principle:** One place, whole life
> **Key Personas:** Sound & Scene Curator, DJ, Cultural Omnivore

Connect digital curation to real-world experiences. Events attended, venues visited, and shows planned are all part of a curated life.

---

## What's Shipped

Nothing yet. The `/events/` page aggregates external event listings but is not integrated with the Boards pin system.

---

## What's Planned

### Event Pin Type
- Save events with date, venue, lineup metadata
- Auto-enrich from event pages (Eventbrite, Dice, Resident Advisor, venue sites)
- Calendar-aware: knows when events are upcoming vs past

### Venue Pin Type
- Save venues/locations with map preview, hours, links
- Associate events with venues
- Location context for recommendations

### Calendar View
- Upcoming saved events in timeline/calendar format
- Past events auto-archived but preserved in collection history
- Filter by category, venue, date range

### Location-Based Features
- "Events near you" widget from saved venues and event sources
- Map view of saved venues and events
- Location as a dimension for cross-category connections

### Event-Pin Linking
- Associate regular pins with events ("I found this at that show")
- Build narrative connections between experiences and discoveries
- Timeline view showing what was saved when and where

---

## Persona Fit

| Persona | Scenario |
|---------|----------|
| Sound & Scene Curator | Save a festival lineup, link it to the artists discovered there |
| DJ | Track gig opportunities, venue contacts, and promoter relationships |
| Cultural Omnivore | Log gallery openings, concerts, and pop-ups as part of their cultural life |

---

## Dependencies

- Requires [Pin Type Abstraction](../../execution/project-plan/backlog.md#epic-0-pin-type-abstraction-pre-requisite) for event and venue pin types
- Calendar view is a new UI surface (not just grid/list)
- Location features require user permission and geolocation API

---

*See also: [Multi-Format Content](../pins/multi-format.md) · [Cross-Category Connections](./cross-category.md)*
