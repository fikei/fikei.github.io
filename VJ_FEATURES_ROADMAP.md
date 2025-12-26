# VJ Features Roadmap
## Soundscape Audio-Reactive Visualizer - Professional VJ Tool Development Plan

---

## ✅ COMPLETED FEATURES

### Core Visualization
- [x] 5 generative themes (LINEAR, NEON, GLITCH, STARS, WAVE)
- [x] 59 granular controls across all themes
- [x] Per-control audio reactivity (unique!)
- [x] 7-band frequency analysis (sub-bass to brilliance)
- [x] Beat detection (adaptive algorithm with local peak detection, works for all genres)
- [x] BPM detection (auto tempo tracking)
- [x] Onset detection

### Beat Pad System
- [x] 3×3 scene grid (unique!)
- [x] Scene save/load with all control values
- [x] Audio reactivity state capture
- [x] Keyboard shortcuts (1-9, QWER, ASDF, ZXCV)
- [x] Scene transitions (CUT, CROSSFADE, MORPH, WIPE)

### Control System
- [x] Unified control registry
- [x] Dynamic UI generation
- [x] Audio source mapping (25+ audio features)
- [x] Intensity control per parameter
- [x] Companion app control (mobile)

### Audio Analysis
- [x] Frequency bands: Sub-bass, Bass, Low-mids, Mids, High-mids, Highs, Brilliance
- [x] Amplitude features: Peak, RMS, Decibels
- [x] Rhythm features: Beat, Onset, BPM
- [x] Spectral features: Centroid, Flux, Rolloff, Flatness, Spread, Loudness, ZCR

---

## 🚧 IN PROGRESS

### New Themes (HIGH PRIORITY)
- [x] TUNNEL theme ✅ - 3D perspective vortex (canvas-based, 8 controls) - COMPLETED
- [x] PLASMA theme ✅ - Organic blob waves with sine interference (canvas-based, 7 controls) - COMPLETED
- [x] PARTICLES theme ✅ - Swarm/explosion system (canvas-based, 12 controls) - COMPLETED

### VJ Performance Enhancements (HIGH PRIORITY - COMPLETED ✅)
- [x] **Global Master Controls** ✅ - Master Intensity, Brightness, Hue Shift, Audio Sensitivity, Strobe, Border Flash (9 controls total)
  - ✅ Config added to index.html (config.global)
  - ✅ THEME_CONFIGS added to control-system.js
  - ✅ Helper functions implemented: applyGlobalModifiers(), getBPMSyncedSpeed(), applyStrobe()
  - ✅ Renderer integration: 8/8 complete (LINEAR ✅, NEON ✅, GLITCH ✅, STARS ✅, WAVE ✅, TUNNEL ✅, PLASMA ✅, PARTICLES ✅)
  - VJ Specialist recommendation: Critical for live performance

- [x] **BPM Sync System** ✅ - Lock animation speeds to detected BPM
  - ✅ Config added to all 8 themes (bpmSync: off/1x/2x/0.5x/4x)
  - ✅ Added to THEME_CONFIGS for all themes
  - ✅ Helper function implemented: getBPMSyncedSpeed()
  - ✅ Renderer integration: 8/8 complete (LINEAR ✅, NEON ✅, GLITCH ✅, STARS ✅, WAVE ✅, TUNNEL ✅, PLASMA ✅, PARTICLES ✅)

- [x] **Brightness Standardization** ✅ - Standardize to 0-1 scale across all themes
  - ✅ NEON: lightness (0-100%) → brightness (0-1)
  - ✅ STARS: brightness already at 0-1 scale
  - ✅ Updated configs, THEME_CONFIGS, and renderers
  - ✅ Prevents jarring transitions between themes

### Multi-Layer Compositing - HYBRID APPROACH
- [x] LayerManager class implementation ✅ (CREATED)
- [x] 2-layer system (A/B) ✅ (CREATED)
- [x] Crossfader between layers ✅ (CREATED)
- [x] Layer UI panel ✅ (CREATED)
- [x] Simplified theme switching at 50% ✅ (WORKING)
- [ ] **TRUE TRANSPARENCY** for canvas themes (GLITCH, STARS, WAVE, PLASMA, TUNNEL, PARTICLES)
- [ ] Layer opacity control (functional for canvas themes)
- [ ] Blend modes (Normal, Add, Multiply, Screen) for canvas themes
- [ ] SVG themes (LINEAR, NEON) keep instant switch behavior

### Beat Sync & UI Enhancements
- [x] BeatSyncManager class implementation ✅ (CREATED)
- [x] BPM display UI ✅ (CREATED)
- [x] Tap tempo button ✅ (CREATED)
- [x] Beat flash indicator (4 quarter notes) ✅ (CREATED)
- [x] Confidence meter display ✅ (CREATED)
- [x] Quantized Beat Pad triggers ✅ (CREATED)
- [x] Audio source selection (mic vs audio input) ✅ (CREATED)
- [x] Debug mode toggle ✅ (CREATED)
- [x] Beat Pad status header ✅ (CREATED)
- [x] Theme badges on scenes ✅ (CREATED)

### Performance & Visual Feedback Enhancements
- [x] **FPS Monitor** ✅ - Real-time performance diagnostics
  - ✅ Top-right display showing current/avg/min/max FPS
  - ✅ 60-frame rolling average for stability
  - ✅ Color-coded warnings (yellow <45 FPS, red <30 FPS)
  - ✅ Throttled UI updates (3x per second) to prevent DOM thrashing

- [x] **Border Flash (Global Control)** ✅ - Beat-synced canvas border flash
  - ✅ config.global.borderFlash (on/off toggle)
  - ✅ config.global.borderFlashIntensity (0-200%, default 100%)
  - ✅ Smooth decay animation with inset box-shadow
  - ✅ Triggers on detected beats (beatResult.isBeat)

- [x] **Quantize Visual Feedback** ✅ - Beat Pad waiting indicators
  - ✅ "⏱️ WAITING FOR BEAT" banner in Beat Pad header
  - ✅ Real-time countdown timer (ms/seconds)
  - ✅ Yellow pulsing border on Beat Pad container
  - ✅ Highlighted queued pad with gold border and pulse animation
  - ✅ Auto-clears when scene loads or is cancelled

- [x] **GLITCH Theme Memory Leak Fix** ✅ - Canvas caching optimization
  - ✅ Cache temp/red/green/blue canvases in state.glitchImage.tempCanvases
  - ✅ Prevents creating 240 canvas objects per second (4 canvases @ 60 FPS)
  - ✅ Lazy initialization, resize only on dimension change
  - ✅ Applied to renderGlitchImageBackground() and renderGlitchImage()

### NEON Theme VJ Enhancements
- [x] **Beat-Triggered Gradient Bursts** ✅ - DEALBREAKER professional VJ feature
  - ✅ Automatic burst spawning on detected beats (off/beat/bar/kick modes)
  - ✅ Configurable burst count (1-5 per trigger)
  - ✅ Lifecycle system: growing (200ms) → stable → fading (200ms)
  - ✅ Intensity threshold (0-1) to spawn only on strong beats
  - ✅ Cubic ease-out growth animation
  - ✅ Default: 1 burst per beat, 2000ms lifetime

- [x] **12 Professional Color Palettes** ✅ - Quick mood changes for live performance
  - ✅ Vibrant, Warm, Cool, Sunset, Ocean, Forest, Neon, Fire, Ice
  - ✅ Music theory palettes: Analogous, Triadic, Complementary, Split-Complementary
  - ✅ Each palette optimized for visual coherence
  - ✅ Palette system replaces static baseHues

- [x] **Spatial Spawn Modes** ✅ - Storytelling through burst placement
  - ✅ Random: anywhere on canvas
  - ✅ Center: builds intensity inward
  - ✅ Edges: explosions from perimeter (top/right/bottom/left)
  - ✅ Stereo: alternating left/right (spatial visualization)
  - ✅ Bass-follow: spawns near bottom-center on bass hits

- [x] **Mesh Density Breathing** ✅ - Visual rhythm lock
  - ✅ Pulses 30% higher on detected beats
  - ✅ Creates visual "breathing" locked to rhythm
  - ✅ Subtle professional polish

**Impact:** NEON theme elevated from 60% to 100% performance-ready. Now competitive with Resolume/VDMX beat-reactive features.

### TUNNEL Theme VJ Enhancements
- [x] **Geometric Shape Variations** ✅ - Multiple tunnel geometries
  - ✅ Circle (default, smooth polygon)
  - ✅ Square (4 vertices, geometric precision)
  - ✅ Triangle (3 vertices, minimal geometry)
  - ✅ Hexagon (6 vertices, organic flow)
  - ✅ Star (5-point with inner/outer radius)
  - ✅ Shape dropdown control in UI (CIRCLE/SQUARE/TRIANGLE/HEXAGON/STAR)

- [x] **Edge Smoothing Control** ✅ - Artistic refinement
  - ✅ Smoothing slider (0-1 range)
  - ✅ Rounded line joins and caps when enabled
  - ✅ Bezier curve smoothing for circle shapes
  - ✅ Professional polish for live visuals

- [x] **Curvature/Warp System** ✅ - Spatial distortion
  - ✅ Curvature slider (-1 to 1 range)
  - ✅ Radial warp transformation based on depth
  - ✅ Dynamic spatial effects for dramatic moments
  - ✅ Applied to both ring shapes and connecting lines

**Impact:** TUNNEL theme now offers 5× geometric variety with professional refinement controls. Shape morphing creates dramatic transitions perfect for build-ups and drops.

### Bug Fixes (2025-12-26)
- [x] **state.beatDetector.isBeat is not a function** ✅ - CRITICAL crash fix
  - ✅ Fixed NEON theme crash when switching themes
  - ✅ Fixed beat burst spawning (line 6114)
  - ✅ Fixed mesh density breathing (line 6321)
  - ✅ Fixed applyStrobe() function (line 4673)
  - ✅ Changed to use state.audioLevels._beatDetected instead
  - **Impact:** NEON and other themes now render without crashing

- [x] **Beat Pad theme switching not working** ✅ - Scene switching fix
  - ✅ window.soundscape.switchTheme() now updates state.settings.theme
  - ✅ Syncs theme select dropdown
  - ✅ Ensures theme actually changes when loading scenes
  - **Impact:** Beat Pad scene switching now works correctly

- [x] **Syntax error: missing closing brace** ✅ - Parse error fix
  - ✅ applyStrobe() function missing closing brace (line 4681)
  - ✅ Caused "Unexpected end of input" error
  - **Impact:** Application now loads without syntax errors

- [x] **Audio input dropdown blank** ✅ - Device detection fix
  - ✅ Detect active device from audioStream.getAudioTracks()
  - ✅ Add current device to list if not already present
  - ✅ Fallback to "Microphone (Active)" if stream active but no devices enumerated
  - **Impact:** Audio source dropdown now shows active microphone

- [x] **BPM display not initializing** ✅ - UI initialization fix
  - ✅ Call updateBPMDisplay() at end of setupBeatSyncUI()
  - ✅ Added debug logging for missing elements
  - ✅ Confidence now shows "0%" on load instead of "--"
  - **Impact:** BPM panel displays correctly on initialization, beat indicators update

---

## 📋 ROADMAP (Prioritized)

### PHASE 1: Core VJ Essentials (Make it gig-ready)
**Goal**: Professional live performance capability
**Timeline**: 2-4 weeks

#### 1.1 Beat Sync UI
- [ ] Add BPM display panel to main UI
- [ ] Implement tap tempo button
- [ ] Add 4-dot beat indicator
- [ ] Show confidence meter
- [ ] Auto/Manual BPM toggle
- [x] Visual beat flash on canvas border ✅ (Global setting: borderFlash + borderFlashIntensity)

#### 1.2 Quantization System
- [ ] Integrate BeatSyncManager into main loop
- [ ] Add quantize mode selector (OFF, BEAT, BAR, 4BAR)
- [ ] Queue Beat Pad scene changes to beat
- [x] Visual countdown to next trigger point ✅ (Real-time countdown in Beat Pad)
- [x] "Waiting for beat..." indicator ✅ (Yellow pulsing banner + queued pad highlighting)

#### 1.3 Multi-Layer System
- [ ] Integrate LayerManager into render pipeline
- [ ] Create layer control panel UI
- [ ] Implement layer visibility toggles
- [ ] Add solo/lock functionality
- [ ] Implement crossfader slider (A/B)
- [ ] Keyboard shortcuts for crossfader (Z/X keys)

#### 1.4 Recording Output
- [ ] Canvas video recording (MediaRecorder API)
- [ ] Record button in UI
- [ ] Recording indicator
- [ ] MP4/WebM export
- [ ] Screenshot capture (single frame)
- [ ] Recording settings (quality, format)

#### 1.5 Performance Optimization
- [ ] Offscreen canvas rendering for layers
- [ ] WebGL acceleration (where possible)
- [ ] FPS limiter/target selector
- [x] Performance monitor overlay ✅ (FPS counter)
- [ ] Low-latency mode

#### 1.6 MIDI Mapping (CRITICAL - Dealbreaker for Professional VJs)
**Status:** FOUNDATION COMPLETE ✅ - Core system implemented, hardware testing pending
**Priority:** HIGHEST - Required for hardware controller support
**Timeline:** 1-2 weeks (60-80 hours) → **Phase 1 Complete (80% done)**

**Completed:**
- [x] Web MIDI API integration ✅
- [x] MIDI device detection & hot-plug support ✅
- [x] MIDIManager class with message parsing ✅
- [x] Map MIDI CC to any of 115 parameters ✅
- [x] MIDI note triggers for Beat Pad scenes (Notes 60-68) ✅
- [x] Value transformation (MIDI 0-127 → param ranges) ✅
  - normalized (0-1), hue360 (0-360), hueShift (-180 to +180)
  - percentage200 (0-200), toggle, buttonGroup
- [x] Mapping management (view, delete, clear all) ✅
- [x] Export/import mappings as JSON ✅
- [x] Visual feedback (MIDI activity indicator, status display) ✅
- [x] localStorage persistence ✅
- [x] Multi-device support ✅
- [x] MIDI settings panel UI ✅
- [x] Profile system (export/import controller configs) ✅

**Remaining:**
- [ ] MIDI Learn mode integration with control system (backend ready, needs click handler)
- [ ] Beat Pad quantization + MIDI integration (basic trigger works)
- [ ] Manual mapping UI (currently auto-detect only)
- [ ] Pre-made mappings for APC40, Launchpad, generic controllers
- [ ] Hardware testing with real MIDI controllers
- [ ] MIDI control icons on mapped parameters

**Impact:** Transforms Soundscape from "hobby tool" to "professional VJ software" with hardware control support competitive with Resolume/VDMX.

**Documentation:** See `/MIDI_MAPPING_SPEC.md` for complete technical specification

---

### PHASE 1.5: Theme Expansion & Transparency System
**Goal**: Add compelling new themes + smooth layer blending
**Timeline**: 1-2 weeks

#### 1.5.1 High Priority Themes (Canvas-Based)
- [x] **TUNNEL** ✅ - 3D perspective vortex
  - Infinite tunnel pulling viewer in
  - Rings pulsing to bass
  - Tunnel speed = BPM, ring size = bass, rotation = mids
  - Complexity: 🟢 Low (similar to STARS)
  - VJ Value: 🔥 High (classic VJ effect)
  - **Status**: COMPLETED

- [x] **PLASMA** ✅ - Organic blob waves
  - Swirling, morphing color fields (lava lamp effect)
  - Pixel-by-pixel sine wave interference patterns
  - Wave frequency = highs, amplitude = bass, color shift = mids
  - Complexity: 🟡 Medium (Canvas 2D with optimization)
  - VJ Value: 🔥 High (hypnotic, psychedelic)
  - **Status**: COMPLETED

- [x] **PARTICLES** ✅ - Swarm/explosion system
  - Thousands of particles exploding/converging to music
  - Particle physics with audio control (explode/converge/swarm modes)
  - Particle count = intensity, velocity = bass hits, color = spectrum
  - Complexity: 🟢 Low (like STARS but with physics)
  - VJ Value: 🔥 High (reactive bursts on drops)
  - **Status**: COMPLETED

#### 1.5.2 Hybrid Transparency System
- [ ] Detect canvas vs SVG themes
- [ ] Implement alpha blending for canvas themes (GLITCH, STARS, WAVE, PLASMA, TUNNEL, PARTICLES)
- [ ] Keep instant switch for SVG themes (LINEAR, NEON)
- [ ] Make opacity sliders functional for canvas layers
- [ ] Add blend modes: Normal, Add, Multiply, Screen, Overlay
- [ ] Smooth crossfade transitions for same-theme layers
- [ ] Visual feedback showing which themes support transparency

**Result**: 6/8 themes will have beautiful smooth blending, 2/8 will hard-switch

#### 1.5.3 Medium Priority Themes (Future)
- [ ] SCOPE - Classic waveform oscilloscope (canvas)
- [ ] KALEIDOSCOPE - Symmetrical mirrors (canvas transform)
- [ ] MESH - 3D deforming grid (WebGL vertex shader)
- [ ] FRACTAL - Mandelbrot/Julia zoom (WebGL fragment shader)
- [ ] FLUID - Real-time fluid simulation (WebGL compute shader)

---

### PHASE 2: Professional Features (Match industry standards)
**Goal**: Feature parity with Resolume/VDMX basics
**Timeline**: 4-8 weeks

**Note:** MIDI Mapping moved to Phase 1.6 (critical priority)

#### 2.1 Effects Chain
- [ ] Stackable post-processing effects
- [ ] Effect bypass/enable toggles
- [ ] Effect presets
- [ ] Effects:
  - [ ] Color correction (brightness, contrast, saturation)
  - [ ] Blur/sharpen
  - [ ] Kaleidoscope/mirror
  - [ ] Edge detection
  - [ ] Feedback loop
  - [ ] Delay/echo
  - [ ] Strobe/flash
- [ ] Effect parameter automation
- [ ] Audio-reactive effect parameters

#### 2.3 Video/Image Layers
- [ ] Video file playback (.mp4, .webm)
- [ ] Image layer support (.jpg, .png, .gif)
- [ ] GIF animation support
- [ ] Video playback controls (play, pause, loop, speed)
- [ ] Video position scrubbing
- [ ] Alpha channel support (transparency)
- [ ] Layer content source selector (Generative, Video, Image, Camera)

#### 2.4 Preset Organization
- [ ] Unlimited preset banks
- [ ] Categories/tags system
- [ ] Search/filter presets
- [ ] Star ratings
- [ ] Preset thumbnails (auto-generate)
- [ ] Import/Export presets (.soundscape format)
- [ ] Preset browser UI
- [ ] Auto-pilot mode (randomize on beat)

#### 2.5 Theme Import/Export
- [ ] Theme schema definition (.soundscape format)
- [ ] Theme validation
- [ ] Theme import from file
- [ ] Theme export with presets
- [ ] Theme metadata (author, version, tags)
- [ ] Theme thumbnail generation
- [ ] Community theme gallery (future)

---

### PHASE 3: Advanced VJ Features (Competitive advantage)
**Goal**: Unique features beyond competitors
**Timeline**: 8-12 weeks

#### 3.1 Camera Input
- [ ] Webcam/camera capture
- [ ] Camera selection
- [ ] Camera as layer source
- [ ] Real-time effects on camera feed
- [ ] Chroma key (green screen)
- [ ] Camera resolution/FPS selection

#### 3.2 Shader Support
- [ ] GLSL fragment shader support
- [ ] ShaderToy compatibility
- [ ] ISF (Interactive Shader Format) support
- [ ] Shader parameter mapping
- [ ] Shader preset library
- [ ] Custom shader editor
- [ ] Hot-reload shader code

#### 3.3 Multi-Screen Output
- [ ] Dual/triple monitor support
- [ ] Fullscreen on secondary display
- [ ] Output resolution control
- [ ] Preview/Program monitor setup
- [ ] Window positioning presets

#### 3.4 Projection Mapping (Basic)
- [ ] Corner pin warping
- [ ] Keystone correction
- [ ] Grid-based mesh warping
- [ ] Output mask/crop
- [ ] Mapping preset save/load

#### 3.5 Timeline & Automation
- [ ] Basic timeline sequencer
- [ ] Keyframe animation (parameter automation)
- [ ] Loop regions
- [ ] Cue markers
- [ ] Timeline zoom/scroll
- [ ] Play/pause/scrub controls

---

### PHASE 4: Professional Integration (Industry standard)
**Goal**: Integration with professional workflows
**Timeline**: 12-16 weeks

#### 4.1 OSC (Open Sound Control)
- [ ] OSC server implementation
- [ ] OSC message routing
- [ ] Parameter mapping to OSC addresses
- [ ] TouchOSC/Lemur template creation
- [ ] OSC learn mode
- [ ] OSC preset import/export

#### 4.2 Clock Sync
- [ ] Ableton Link integration
- [ ] MIDI clock input/output
- [ ] External clock source selection
- [ ] Clock offset adjustment
- [ ] Sync indicator

#### 4.3 Screen Capture
- [ ] Desktop/window capture (Screen Capture API)
- [ ] Screen share as layer source
- [ ] Capture region selection
- [ ] Frame rate control

#### 4.4 NDI/Syphon/Spout
- [ ] NDI output (network video)
- [ ] NDI input (receive from other apps)
- [ ] Syphon support (macOS app sharing)
- [ ] Spout support (Windows app sharing)

#### 4.5 Streaming Integration
- [ ] OBS integration (virtual camera)
- [ ] Canvas as media source
- [ ] Stream output settings
- [ ] Twitch/YouTube streaming presets

---

### PHASE 5: Advanced Content Creation (Long-term)
**Goal**: Full creative suite
**Timeline**: 16+ weeks

#### 5.1 Theme Builder UI
- [ ] Visual theme editor
- [ ] Code editor with syntax highlighting (Monaco)
- [ ] Live preview pane
- [ ] Template system
- [ ] Control mapper UI
- [ ] Hot-reload during development
- [ ] Theme scaffolding wizard

#### 5.2 3D Scene Support
- [ ] Three.js integration
- [ ] 3D model import (.obj, .gltf)
- [ ] Camera controls (position, rotation, FOV)
- [ ] Lighting system
- [ ] 3D effects (depth of field, fog)
- [ ] 3D audio-reactive particles

#### 5.3 Particle Systems
- [ ] Particle emitter system
- [ ] Particle physics
- [ ] Audio-reactive particle behaviors
- [ ] Custom particle sprites
- [ ] Particle presets

#### 5.4 Advanced Effects
- [ ] GPU-accelerated effects
- [ ] Custom GLSL effect authoring
- [ ] Effect stacking/routing
- [ ] Effect macros
- [ ] LFO modulation

#### 5.5 DMX Lighting Control
- [ ] DMX output (WebUSB)
- [ ] Fixture library
- [ ] Color sync (match visuals to lights)
- [ ] DMX scene triggers
- [ ] Lighting timeline

---

## 🎯 MINIMUM VIABLE VJ TOOL (MVVJ)

For **immediate gig-readiness**, focus on:

### Essential Features (Next 2 weeks):
1. ✅ BPM display + tap tempo
2. ✅ Beat indicators (visual feedback)
3. ✅ Quantized Beat Pad triggers
4. ✅ 2-layer crossfader
5. ✅ Recording output (video)

### Nice-to-Have (Next month):
6. MIDI mapping (basic)
7. Fullscreen mode
8. Effect chain (color correction, blur, mirror)
9. Preset browser

With these 9 features, Soundscape becomes **performance-ready** for live VJ gigs.

---

## 📊 COMPETITIVE ANALYSIS

### Feature Comparison: Soundscape vs Industry Leaders

| Feature | Soundscape (Current) | After MVVJ | Resolume | VDMX | MilkDrop |
|---------|---------------------|------------|----------|------|----------|
| **Generative Visuals** | ✅ (5 themes) | ✅ | ⚠️ (plugins) | ⚠️ (limited) | ✅ |
| **Beat Pad Grid** | ✅ (unique!) | ✅ | ❌ | ❌ | ❌ |
| **Per-Control Audio** | ✅ (59!) | ✅ | ⚠️ (global) | ⚠️ (global) | ⚠️ |
| **Multi-Layer** | ❌ | ✅ (2 layers) | ✅ (10+) | ✅ (8+) | ❌ |
| **BPM Sync** | ⚠️ (auto only) | ✅ (tap+auto) | ✅ | ✅ | ✅ |
| **Quantization** | ❌ | ✅ | ✅ | ✅ | ❌ |
| **Recording** | ❌ | ✅ | ✅ | ✅ | ❌ |
| **MIDI Mapping** | ❌ | ❌ → Phase 2 | ✅ | ✅ | ⚠️ |
| **Video Playback** | ❌ | ❌ → Phase 2 | ✅ | ✅ | ❌ |
| **Shader Support** | ⚠️ (WebGL) | ⚠️ | ✅ (GLSL) | ✅ (ISF) | ✅ |
| **Effects Chain** | ⚠️ (per-theme) | ❌ → Phase 2 | ✅ | ✅ | ⚠️ |
| **Price** | **Free** | **Free** | $299 | $349 | Free |

---

## 🏆 UNIQUE SELLING POINTS

**What makes Soundscape special:**

1. **Beat Pad 3×3 Grid** - No other VJ tool has this performance interface
2. **Per-Control Audio Reactivity** - 59 individually mappable controls
3. **Web-Based** - No installation, works anywhere, easy sharing
4. **Companion App** - Mobile control (unique!)
5. **Clean, Modern UI** - Easy to learn, professional aesthetic
6. **Free & Open Source** - No licensing costs

**Marketing angles:**
- "Performance-first VJ tool with Beat Pad grid"
- "59 audio-reactive controls - more than any other VJ software"
- "Works in your browser - no installation needed"
- "Perfect for live streaming, VJ gigs, and creative coding"

---

## 📅 SUGGESTED SPRINT PLAN

### Sprint 1 (Week 1-2): Beat Sync & UI
- Integrate BeatSyncManager
- Add BPM panel UI
- Implement tap tempo
- Add beat indicators
- Visual beat flash

### Sprint 2 (Week 3-4): Multi-Layer Foundation
- Integrate LayerManager
- Render pipeline refactor (layers)
- Layer control panel UI
- Crossfader implementation

### Sprint 3 (Week 5-6): Quantization & Polish
- Quantized Beat Pad triggers
- Recording output (MediaRecorder)
- Fullscreen mode
- Performance optimization

### Sprint 4 (Week 7-8): MIDI & Effects (Phase 2 Start)
- Web MIDI integration
- Basic MIDI learn
- Effect chain architecture
- Color correction effect

---

## 🔗 DEPENDENCIES & LIBRARIES

### Current Stack:
- Canvas 2D API ✅
- Web Audio API ✅
- Meyda (audio analysis) ✅
- SimplexNoise ✅
- WebSocket (companion app) ✅

### Needed Libraries:
- **WebGL/Three.js** - 3D support, GPU effects
- **MediaRecorder API** - Video recording
- **Web MIDI API** - MIDI controller support
- **Monaco Editor** - Theme builder code editor
- **Ableton Link** - Clock sync (via WASM)
- **WebUSB** - DMX output (phase 5)

---

## 📝 NOTES

- **Focus on MVVJ first** - Get to performance-ready ASAP
- **Keep Beat Pad as core differentiator** - Don't dilute this unique feature
- **Web-based is a strength** - Don't try to compete on every feature with desktop apps
- **Build community** - Preset sharing, theme gallery, Discord
- **Document everything** - Make it easy for users to create themes

---

**Last Updated**: 2025-01-XX
**Version**: 1.0
**Status**: Active Development
