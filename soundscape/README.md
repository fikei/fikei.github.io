# Soundscape

> 🧪 **Playground Project** - Audio-reactive visualization controls

**Status**: 🟡 Experimental (81% complete)

---

## What Is This?

An experiment in real-time audio analysis and visualization control. Transforms music into visual parameters that can drive any compatible visualization.

**Key Features:**
- Real-time frequency band analysis (7 bands)
- Beat detection and BPM estimation
- WebSocket server for streaming control data
- 48/59 visual controls implemented

---

## Quick Status

| Component | Progress |
|-----------|----------|
| Visual Controls | 48/59 (81%) |
| Audio Sources | 5/25 (20%) |
| Beat Detection | ✅ Complete |
| WebSocket Server | ✅ Complete |

---

## Try It

```bash
cd /Users/ian/Documents/GitHub/fikei.github.io/soundscape
npm install
node server.js
# Open http://localhost:3000
```

---

## Detailed Documentation

This is a playground project, but it has extensive docs from active development:

- [PROJECT_PLAN.md](./PROJECT_PLAN.md) - Full specification
- [PROJECT_TRACKER.md](./PROJECT_TRACKER.md) - Implementation status
- [CONTROL_SYSTEM_DESIGN.md](./CONTROL_SYSTEM_DESIGN.md) - Architecture
- [THEME_CONTROLS_REFERENCE.md](./THEME_CONTROLS_REFERENCE.md) - Control parameters
- [AUDIO_SOURCES_STATUS.md](./AUDIO_SOURCES_STATUS.md) - Input sources

---

## Ideas / TODO

- [ ] More audio source integrations
- [ ] Better beat detection algorithms
- [ ] WebGL visualizations
- [ ] Mobile companion app
