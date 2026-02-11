# Soundscape

> Audio-reactive visualization controls with WebSocket streaming

**Status**: Experimental (81% complete)
**Code**: [`/soundscape/`](../../soundscape/)
**Live**: [ctrl.rodeo/soundscape](https://ctrl.rodeo/soundscape/)

---

## What it does

Real-time audio analysis with frequency band decomposition, beat detection, and BPM estimation. Streams control data over WebSocket to drive external visualizations.

## Key capabilities

- **Frequency analysis** — 7-band decomposition
- **Beat detection** — Real-time BPM estimation
- **WebSocket server** — Streams control parameters to visualization clients
- **Visual controls** — 48/59 implemented
- **Audio sources** — 5/25 implemented

## Documentation

| Category | Path | Contents |
|----------|------|----------|
| **Technical** | [`technical/`](technical/) | Control system design |
| **Plan** | [`plan/`](plan/) | Project plan and implementation roadmap |
| **In-repo** | [`/soundscape/`](../../soundscape/) | 9 detailed docs co-located with code |

### In-repo docs (source of truth)

| File | Purpose |
|------|---------|
| `PROJECT_PLAN.md` | Full specification |
| `PROJECT_TRACKER.md` | Implementation status |
| `CONTROL_SYSTEM_DESIGN.md` | Architecture |
| `THEME_CONTROLS_REFERENCE.md` | Control parameters |
| `AUDIO_SOURCES_STATUS.md` | Input source status |
| `MEYDA_INTEGRATION_PLAN.md` | Audio analysis library |
| `WEBSOCKET_SETUP.md` | Server setup guide |
| `IMPLEMENTATION_PLAN.md` | Development roadmap |
| `MEDIA_ANALYSIS.md` | Media processing details |
