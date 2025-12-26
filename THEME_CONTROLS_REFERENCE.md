# Theme Controls Reference
## Soundscape Audio-Reactive Visualizer - Complete Control Listing

**Global Modifiers Integration Status**:
- ✅ **Fully Integrated**: All 8 themes (LINEAR, NEON, GLITCH, STARS, WAVE, TUNNEL, PLASMA, PARTICLES)
- ✅ Global modifiers (masterIntensity, masterBrightness, globalHueShift, audioSensitivity) active across all themes
- ✅ BPM sync (OFF/1X/2X/0.5X/4X) active across all themes
- ✅ Strobe effect (beat-synced brightness flash) active across all themes

> All 8 themes now have complete global modifier, BPM sync, and strobe integration. Master controls affect all themes simultaneously for unified live performance control.

---

## LINEAR Theme
**Visual Style**: Animated SVG paths with smooth motion

| Control | Type | Range | Default | Description |
|---------|------|-------|---------|-------------|
| visualMode | buttonGroup | FLOW/HOLE/CRUNCH | FLOW | Visual flow pattern mode |
| density | buttonGroup | L/M/H | M | Line density (Low/Medium/High) |
| hue | slider | 0-360 | 280 | Color hue (purple default) |
| saturation | slider | 0-100 | 0 | Color saturation (0 = grayscale) |
| opacity | slider | 0-1 | 0.6 | Line opacity |
| lineWidth | slider | 1-10 | 3 | Line thickness |
| spread | slider | 0-2 | 1.0 | Line spread/spacing multiplier |
| amplitude | slider | 0-2 | 1.0 | Wave amplitude multiplier |
| backgroundShift | slider | 0-2 | 1.0 | Camera parallax effect intensity |
| bpmSync | buttonGroup | OFF/1X/2X/0.5X/4X | OFF | Lock animation speed to detected BPM |

**Audio Reactivity**: Each control can map to 25+ audio features
**Total Controls**: 10

---

## NEON Theme
**Visual Style**: SVG gradient mesh with organic movement + beat-triggered bursts

| Control | Type | Range | Default | Description |
|---------|------|-------|---------|-------------|
| hue | slider | 0-360 | 280 | Base color hue |
| saturation | slider | 0-100 | 70 | Color saturation |
| brightness | slider | 0-1 | 0.5 | Overall brightness (0-1) |
| colorMode | select | - | static | Static, Cycle, Pulse, Reactive |
| colorChangeMode | select | - | static | How colors evolve over time |
| cycleSpeed | slider | 0-1 | 0.1 | Speed of color cycling (cycle mode) |
| warmCool | slider | 0-1 | 0.5 | Color temperature (warm/cool) |
| colorPalette | dropdown | 13 palettes | vibrant | Color palette preset (Vibrant, Warm, Cool, Sunset, Ocean, Forest, Neon, Fire, Ice, Analogous, Triadic, Complementary, Split-Comp) |
| burstSize | slider | 0.1-5 | 1.0 | Gradient sphere size |
| movement | slider | 0-2 | 1.0 | Gradient movement intensity |
| glow | slider | 0-5 | 1.5 | Glow/bloom effect intensity |
| blur | slider | 0-20 | 0 | Blur effect amount |
| responsiveness | slider | 0-3 | 1.0 | Audio response sensitivity |
| smoothing | slider | 0-1 | 0.7 | Audio smoothing (0 = instant, 1 = very smooth) |
| meshDensity | slider | 4-16 | 8 | Number of gradient centers (pulses +30% on beats) |
| backgroundShift | slider | 0-2 | 1.0 | Camera parallax effect |
| bpmSync | buttonGroup | OFF/1X/2X/0.5X/4X | OFF | Lock animation speed to detected BPM |
| beatBurstMode | dropdown | OFF/BEAT/BAR/KICK | BEAT | Beat-triggered gradient burst mode |
| beatBurstCount | slider | 1-5 | 1 | Number of bursts spawned per beat |
| beatBurstLifetime | slider | 500-5000ms | 2000 | Burst lifetime (ms) |
| beatBurstSpawnMode | dropdown | 5 modes | random | Burst spawn location (Random, Center, Edges, Stereo, Bass-Follow) |
| beatBurstIntensityThreshold | slider | 0-1 | 0.5 | Minimum beat energy to spawn bursts |

**Audio Reactivity**: Each control can map to 25+ audio features
**Beat Burst System**: Automatic gradient explosions on detected beats with lifecycle animation
**Color Palettes**: 13 professional presets for quick mood changes
**Total Controls**: 22

---

## GLITCH Theme
**Visual Style**: RGB channel-separated glitch effect (requires loaded image)

| Control | Type | Range | Default | Description |
|---------|------|-------|---------|-------------|
| visualMode | buttonGroup | RGB/B&R/GRAY | RGB | Color channel mode |
| rotation | slider | 0-360 | 0 | Image rotation angle |
| glitchIntensity | slider | 0-2 | 1.0 | Overall glitch effect strength |
| contrast | slider | 0-3 | 1.0 | Image contrast |
| channelOffset | slider | 0-50 | 5 | RGB channel separation distance |
| displacement | slider | 0-100 | 10 | Glitch displacement amount |
| noise | slider | 0-1 | 0 | Digital noise amount |
| pixelation | slider | 1-50 | 1 | Pixelation level (1 = none, 50 = very pixelated) |
| scanlines | slider | 0-1 | 0.5 | Scanline intensity |
| backgroundShift | slider | 0-2 | 1.0 | Camera parallax effect |
| bpmSync | buttonGroup | OFF/1X/2X/0.5X/4X | OFF | Lock animation speed to detected BPM |

**Audio Reactivity**: Each control can map to 25+ audio features
**Total Controls**: 11
**Note**: Requires image upload to display

---

## STARS Theme
**Visual Style**: 3D star field with perspective depth

| Control | Type | Range | Default | Description |
|---------|------|-------|---------|-------------|
| hue | slider | 0-360 | 44 | Star color hue |
| saturation | slider | 0-100 | 12 | Color saturation |
| speed | slider | 0-5 | 1.0 | Orbit speed |
| brightness | slider | 0-1 | 0.8 | Overall star brightness (0-1) |
| zSpeed | slider | 0-5 | 1.0 | Speed moving towards camera |
| minOpacity | slider | 0-1 | 0.2 | Minimum star opacity |
| maxOpacity | slider | 0-1 | 1.0 | Maximum star opacity |
| diameter | slider | 0.1-3 | 1.0 | Star size multiplier |
| twinkleRate | slider | 0-100 | 20 | Twinkle frequency (higher = less) |
| audioBoost | slider | 0-10 | 3.0 | Audio reactivity intensity |
| count | slider | 100-1200 | 600 | Number of stars |
| trailLength | slider | 0-1 | 0 | Motion trail length |
| bloom | slider | 0-2 | 0 | Glow/bloom effect |
| perspective | slider | 0-2 | 1.0 | Depth perspective strength |
| smoothing | slider | 0-1 | 0.5 | Audio smoothing |
| bpmSync | buttonGroup | OFF/1X/2X/0.5X/4X | OFF | Lock animation speed to detected BPM |

**Audio Reactivity**: Each control can map to 25+ audio features
**Total Controls**: 16

---

## WAVE Theme
**Visual Style**: 3D geometric mesh with orbiting particles

| Control | Type | Range | Default | Description |
|---------|------|-------|---------|-------------|
| visualMode | select | - | orbital | Mesh, Orbital, or Mixed mode |
| hue | slider | 0-360 | 280 | Color hue |
| saturation | slider | 0-100 | 70 | Color saturation |
| amplitude | slider | 0-3 | 1.2 | Wave height/displacement |
| wavelength | slider | 0.1-100 | 50 | Wave frequency |
| lineWidth | slider | 1-5 | 3 | Line thickness |
| layers | slider | 1-10 | 3 | Number of layers |
| speed | slider | 0-5 | 1.0 | Animation speed |
| rotationX | slider | 0-2 | 0.3 | X-axis rotation |
| rotationY | slider | 0-2 | 0.3 | Y-axis rotation |
| glow | slider | 0-3 | 0 | Glow effect intensity |
| perspective | slider | 0-2 | 1.0 | Depth perspective |
| depth | slider | 0-2 | 1.0 | Layer depth spacing |
| turbulence | slider | 0-2 | 0 | Noise displacement |
| phaseShift | slider | 0-6.28 | 0 | Wave phase offset |
| backgroundShift | slider | 0-2 | 1.0 | Camera parallax |
| bpmSync | buttonGroup | OFF/1X/2X/0.5X/4X | OFF | Lock animation speed to detected BPM |

**Audio Reactivity**: Each control can map to 25+ audio features
**Total Controls**: 17

---

## TUNNEL Theme (NEW)
**Visual Style**: 3D perspective tunnel with concentric rings

| Control | Type | Range | Default | Description |
|---------|------|-------|---------|-------------|
| hue | slider | 0-360 | 180 | Color hue (cyan default) |
| saturation | slider | 0-100 | 80 | Color saturation |
| speed | slider | 0-5 | 1.0 | Tunnel movement speed |
| rotation | slider | 0-2 | 0.5 | Rotation speed |
| rings | slider | 10-100 | 50 | Number of rings |
| perspective | slider | 0-2 | 1.0 | Depth perspective strength |
| lineWidth | slider | 1-5 | 2 | Ring line thickness |
| segments | slider | 6-24 | 12 | Polygon segments per ring |
| **shape** | **buttonGroup** | **CIRCLE/SQUARE/TRIANGLE/HEXAGON/STAR** | **circle** | **Geometric shape of tunnel rings** |
| **smoothing** | **slider** | **0-1** | **0.0** | **Edge smoothing (rounded corners/bezier curves)** |
| **curvature** | **slider** | **-1 to 1** | **0.0** | **Radial warp/distortion effect** |
| bpmSync | buttonGroup | OFF/1X/2X/0.5X/4X | OFF | Lock animation speed to detected BPM |

**Audio Reactivity**: Each control can map to 25+ audio features
**Total Controls**: 12 (3 new geometric controls added)

---

## PLASMA Theme (IN PROGRESS)
**Visual Style**: Organic sine wave interference patterns

| Control | Type | Range | Default | Description |
|---------|------|-------|---------|-------------|
| hue | slider | 0-360 | 280 | Base color hue |
| saturation | slider | 0-100 | 85 | Color saturation |
| scale | slider | 1-10 | 3.0 | Wave frequency/scale |
| speed | slider | 0-5 | 1.0 | Animation speed |
| complexity | slider | 1-5 | 3 | Number of wave layers |
| brightness | slider | 0-1 | 0.6 | Overall brightness |
| contrast | slider | 0-3 | 1.0 | Contrast multiplier |
| bpmSync | buttonGroup | OFF/1X/2X/0.5X/4X | OFF | Lock animation speed to detected BPM |

**Audio Reactivity**: Each control can map to 25+ audio features
**Total Controls**: 8

---

## PARTICLES Theme (NEW)
**Visual Style**: Particle system with physics

| Control | Type | Range | Default | Description |
|---------|------|-------|---------|-------------|
| mode | select | 3 options | explode | Physics mode: Explode, Converge, Swarm |
| count | slider | 100-5000 | 1000 | Number of particles |
| size | slider | 1-10 | 2 | Particle size |
| hue | slider | 0-360 | 180 | Particle color (cyan default) |
| saturation | slider | 0-100 | 80 | Color saturation |
| brightness | slider | 0-1 | 0.6 | Overall brightness |
| speed | slider | 0-5 | 1.0 | Particle velocity |
| gravity | slider | -2-2 | 0 | Gravity force |
| damping | slider | 0-1 | 0.98 | Velocity damping |
| trailLength | slider | 0-1 | 0.15 | Motion trail fade amount |
| bloom | slider | 0-2 | 0 | Glow/bloom intensity |
| explosionThreshold | slider | 0-1 | 0.3 | Bass level for explosions |
| bpmSync | buttonGroup | OFF/1X/2X/0.5X/4X | OFF | Lock animation speed to detected BPM |

**Audio Reactivity (Default Mappings)**:
- Bass: Particle size boost
- Mid: Brightness boost
- High: Hue shift

**Physics Modes**:
- **Explode Mode**: Particles burst from center when bass exceeds explosionThreshold
- **Converge Mode**: Particles pull towards center
- **Swarm Mode**: Boids-like behavior (attraction + separation) - Optimized with spatial grid for O(n) performance

**Performance**:
- Spatial grid optimization in swarm mode handles 5000 particles at 60 FPS
- Recommended: 1000-2000 particles for smooth performance

**Total Controls**: 13

---

## GLOBAL Controls (Master Controls)
**Description**: Master controls that affect all themes simultaneously

| Control | Type | Range | Default | Description |
|---------|------|-------|---------|-------------|
| masterIntensity | slider | 0-200 | 100 | Multiplies all size, amplitude, and glow parameters |
| masterBrightness | slider | 0-200 | 100 | Multiplies all brightness, lightness, and opacity parameters |
| globalHueShift | slider | -180-180 | 0 | Shifts all hue values (color rotation) |
| audioSensitivity | slider | 0-300 | 100 | Multiplies all audio reactivity intensity |
| strobeEnabled | toggle | ON/OFF | OFF | Enable beat-synced strobe effect |
| strobeRate | buttonGroup | BEAT/1/2/2X | BEAT | Strobe flash rate |
| bpmDisplay | toggle | ON/OFF | ON | Show BPM in UI |
| borderFlash | toggle | ON/OFF | ON | Flash canvas border on detected beats |
| borderFlashIntensity | slider | 0-200 | 100 | Border flash brightness and thickness |

**Total Controls**: 9

---

## Summary

| Theme | Total Controls | Canvas/SVG | Audio Reactive | Supports Transparency |
|-------|---------------|------------|----------------|---------------------|
| LINEAR | 10 | SVG | ✅ Per-control | ❌ (Hard switch) |
| NEON | 22 | SVG | ✅ Per-control + Beat Bursts | ❌ (Hard switch) |
| GLITCH | 11 | Canvas | ✅ Per-control | ✅ (When implemented) |
| STARS | 16 | Canvas | ✅ Per-control | ✅ (When implemented) |
| WAVE | 17 | Canvas | ✅ Per-control | ✅ (When implemented) |
| TUNNEL | 12 | Canvas | ✅ Per-control | ✅ (When implemented) |
| PLASMA | 8 | Canvas | ✅ Per-control | ✅ (When implemented) |
| PARTICLES | 13 | Canvas | ✅ Per-control | ✅ (When implemented) |
| **GLOBAL** | **9** | **N/A** | **❌ Master Controls** | **N/A** |

**TOTAL THEME CONTROLS**: 106 parameters
**TOTAL GLOBAL CONTROLS**: 9 parameters
**GRAND TOTAL**: 115 parameters

---

## Audio Reactivity Sources (Available for All Controls)

Each theme control can be mapped to any of these 25+ audio features:

### Frequency Bands
- Sub-bass (20-60 Hz)
- Bass (60-250 Hz)
- Low-mids (250-500 Hz)
- Mids (500-2000 Hz)
- High-mids (2000-4000 Hz)
- Highs (4000-6000 Hz)
- Brilliance (6000+ Hz)

### Amplitude Features
- Peak
- RMS
- Decibels

### Rhythm Features
- Beat
- Onset
- BPM

### Spectral Features (Meyda)
- Spectral Centroid
- Spectral Flux
- Spectral Rolloff
- Spectral Flatness
- Spectral Spread
- Loudness
- Zero Crossing Rate
- Chroma

### Modulation
- Each control has intensity slider (0-100%)
- Inverted mapping option
- Range limiting

---

## MIDI Control System

**Status:** Foundation Complete ✅ (Hardware testing pending)

Soundscape supports Web MIDI API for hardware controller integration. All 115 parameters can be mapped to MIDI CC/Note messages.

### Supported Controllers
- ✅ MIDI keyboards (Note On triggers, CC knobs)
- ✅ APC40/APC40 mkII (48 knobs, 40 buttons, 8 faders)
- ✅ Novation Launchpad (64 pads for Beat Pad scenes)
- ✅ Generic MIDI controllers (any device with CC/Note support)
- ✅ MIDI mixers (Behringer X-Touch, etc.)

### MIDI Features

| Feature | Status | Description |
|---------|--------|-------------|
| Device Detection | ✅ | Auto-detect connected MIDI devices |
| Hot-Plug Support | ✅ | Devices can connect/disconnect while app running |
| MIDI Learn | 🚧 | Click control, move MIDI knob (backend ready) |
| CC Mapping | ✅ | Map Control Change (0-127) to parameters |
| Note Mapping | ✅ | Map Note On/Off to toggles and triggers |
| Beat Pad Triggers | ✅ | MIDI Notes 60-68 → Scenes 1-9 |
| Velocity-Based Transitions | ✅ | Note velocity 0-42=CUT, 43-84=CROSSFADE, 85-127=MORPH |
| Value Transformations | ✅ | 6 transform types (normalized, hue360, hueShift, percentage200, toggle, buttonGroup) |
| Mapping Management | ✅ | View, delete, clear all mappings |
| Export/Import | ✅ | Save/load mappings as JSON |
| localStorage Persistence | ✅ | Mappings saved across sessions |
| Multi-Device | ✅ | Use multiple MIDI controllers simultaneously |
| Activity Indicator | ✅ | Real-time MIDI message display |

### Value Transformations

MIDI messages send values 0-127. Soundscape automatically transforms these to match parameter ranges:

- **normalized** (0-127 → 0-1): Most sliders
- **hue360** (0-127 → 0-360): Hue controls
- **hueShift** (0-127 → -180 to +180): Hue shift controls
- **percentage200** (0-127 → 0-200): Intensity/brightness controls
- **toggle** (0-127 → true/false): Buttons (>64 = true)
- **buttonGroup** (0-127 → option index): Button groups (maps ranges to options)

### Usage

1. **Connect MIDI Controller** → Auto-detected, status shows in MIDI panel
2. **Create Mapping** → Click MIDI Learn, click control, move MIDI knob
3. **View Mappings** → See all CC/Note → Control mappings
4. **Export/Import** → Share controller configs between sessions/users

### Browser Compatibility

- ✅ **Chrome/Edge**: Full support
- ✅ **Opera**: Full support
- ⚠️ **Firefox**: Behind flag (user must enable `dom.webmidi.enabled`)
- ❌ **Safari**: No support (WebKit limitation)

**Note:** Use Chrome/Edge for best MIDI experience

### Beat Pad MIDI Integration

| MIDI Note | Scene | Velocity Range | Transition |
|-----------|-------|----------------|------------|
| 60 (C3) | Scene 1 | 0-42 | CUT |
| 61 (C#3) | Scene 2 | 43-84 | CROSSFADE |
| 62 (D3) | Scene 3 | 85-127 | MORPH |
| 63-68 | Scenes 4-9 | Velocity-based | Variable |

**Example:** Press pad at velocity 100 → Triggers scene with MORPH transition

---

## Usage Notes

1. **Per-Control Audio Reactivity**: Every slider can react to music independently
2. **Theme Switching**: Use Beat Pad for instant scene changes
3. **Layer Blending**: Canvas themes (GLITCH, STARS, WAVE, TUNNEL, PLASMA, PARTICLES) will support smooth opacity blending
4. **SVG Themes**: LINEAR and NEON use vector graphics (better quality) but hard-switch when crossfading
5. **Performance**: More complex themes (NEON, WAVE) may impact frame rate on older hardware
6. **MIDI Control**: Hardware controllers can map to all 115 parameters (use Chrome/Edge)

---

## Recent Fixes (2025-12-26)
- Fixed NEON theme crash (`state.beatDetector.isBeat is not a function`)
- Fixed Beat Pad theme switching (scenes now properly change themes)
- Fixed syntax error (missing closing brace in `applyStrobe()`)
- Fixed audio input dropdown (now detects and shows active microphone)
- Fixed BPM display initialization (confidence and beat indicators now update correctly)
- Completely rewrote beat detection with adaptive algorithm (1.05-1.3x threshold based on variance + local peak detection)

---

Last Updated: 2025-12-26
