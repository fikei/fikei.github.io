# Theme Controls Reference
## Soundscape Audio-Reactive Visualizer - Complete Control Listing

---

## LINEAR Theme
**Visual Style**: Animated SVG paths with smooth motion

| Control | Type | Range | Default | Description |
|---------|------|-------|---------|-------------|
| hue | slider | 0-360 | 280 | Color hue (purple default) |
| saturation | slider | 0-100 | 0 | Color saturation (0 = grayscale) |
| opacity | slider | 0-1 | 0.6 | Line opacity |
| lineWidth | slider | 1-10 | 3 | Line thickness |
| backgroundShift | slider | 0-2 | 1.0 | Camera parallax effect intensity |
| bpmSync | buttonGroup | OFF/1X/2X/0.5X/4X | OFF | Lock animation speed to detected BPM |

**Audio Reactivity**: Each control can map to 25+ audio features
**Total Controls**: 6

---

## NEON Theme
**Visual Style**: SVG gradient mesh with organic movement

| Control | Type | Range | Default | Description |
|---------|------|-------|---------|-------------|
| hue | slider | 0-360 | 280 | Base color hue |
| saturation | slider | 0-100 | 70 | Color saturation |
| brightness | slider | 0-1 | 0.5 | Overall brightness (0-1) |
| colorMode | select | - | static | Static, Cycle, Pulse, Reactive |
| colorChangeMode | select | - | static | How colors evolve over time |
| cycleSpeed | slider | 0-1 | 0.1 | Speed of color cycling (cycle mode) |
| warmCool | slider | 0-1 | 0.5 | Color temperature (warm/cool) |
| burstSize | slider | 0.1-5 | 1.0 | Gradient sphere size |
| movement | slider | 0-2 | 1.0 | Gradient movement intensity |
| glow | slider | 0-5 | 1.5 | Glow/bloom effect intensity |
| blur | slider | 0-20 | 0 | Blur effect amount |
| responsiveness | slider | 0-3 | 1.0 | Audio response sensitivity |
| smoothing | slider | 0-1 | 0.7 | Audio smoothing (0 = instant, 1 = very smooth) |
| meshDensity | slider | 4-16 | 8 | Number of gradient centers |
| backgroundShift | slider | 0-2 | 1.0 | Camera parallax effect |
| bpmSync | buttonGroup | OFF/1X/2X/0.5X/4X | OFF | Lock animation speed to detected BPM |

**Audio Reactivity**: Each control can map to 25+ audio features
**Total Controls**: 16

---

## GLITCH Theme
**Visual Style**: RGB channel-separated glitch effect (requires loaded image)

| Control | Type | Range | Default | Description |
|---------|------|-------|---------|-------------|
| rotation | slider | 0-360 | 0 | Image rotation angle |
| glitchIntensity | slider | 0-2 | 1.0 | Overall glitch effect strength |
| contrast | slider | 0-3 | 1.0 | Image contrast |
| channelOffset | slider | 0-50 | 5 | RGB channel separation distance |
| displacement | slider | 0-100 | 10 | Glitch displacement amount |
| blockSize | slider | 1-50 | 10 | Glitch block size |
| scanlines | slider | 0-1 | 0.5 | Scanline intensity |
| colorShift | slider | 0-360 | 0 | Hue shift amount |
| bpmSync | buttonGroup | OFF/1X/2X/0.5X/4X | OFF | Lock animation speed to detected BPM |

**Audio Reactivity**: Each control can map to 25+ audio features
**Total Controls**: 9
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
| bpmSync | buttonGroup | OFF/1X/2X/0.5X/4X | OFF | Lock animation speed to detected BPM |

**Audio Reactivity**: Each control can map to 25+ audio features
**Total Controls**: 9

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

**Total Controls**: 7

---

## Summary

| Theme | Total Controls | Canvas/SVG | Audio Reactive | Supports Transparency |
|-------|---------------|------------|----------------|---------------------|
| LINEAR | 6 | SVG | ✅ Per-control | ❌ (Hard switch) |
| NEON | 16 | SVG | ✅ Per-control | ❌ (Hard switch) |
| GLITCH | 9 | Canvas | ✅ Per-control | ✅ (When implemented) |
| STARS | 16 | Canvas | ✅ Per-control | ✅ (When implemented) |
| WAVE | 17 | Canvas | ✅ Per-control | ✅ (When implemented) |
| TUNNEL | 9 | Canvas | ✅ Per-control | ✅ (When implemented) |
| PLASMA | 8 | Canvas | ✅ Per-control | ✅ (When implemented) |
| PARTICLES | 13 | Canvas | ✅ Per-control | ✅ (When implemented) |
| **GLOBAL** | **7** | **N/A** | **❌ Master Controls** | **N/A** |

**TOTAL THEME CONTROLS**: 94 parameters
**TOTAL GLOBAL CONTROLS**: 7 parameters
**GRAND TOTAL**: 101 parameters

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

## Usage Notes

1. **Per-Control Audio Reactivity**: Every slider can react to music independently
2. **Theme Switching**: Use Beat Pad for instant scene changes
3. **Layer Blending**: Canvas themes (GLITCH, STARS, WAVE, TUNNEL, PLASMA, PARTICLES) will support smooth opacity blending
4. **SVG Themes**: LINEAR and NEON use vector graphics (better quality) but hard-switch when crossfading
5. **Performance**: More complex themes (NEON, WAVE) may impact frame rate on older hardware

---

Last Updated: 2025-12-26
