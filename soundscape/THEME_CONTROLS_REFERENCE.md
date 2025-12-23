# Soundscape Visualization - Theme Controls Reference

## Table of Contents
- [Overview](#overview)
- [Control Types](#control-types)
- [Audio Reactivity](#audio-reactivity)
- [LINEAR Theme](#linear-theme)
- [NEON Theme](#neon-theme)
- [GLITCH Theme](#glitch-theme)
- [STARS Theme](#stars-theme)
- [WAVE Theme](#wave-theme)

---

## Overview

This document provides a complete reference for all theme controls in the Soundscape Visualization project. Each theme has unique visual characteristics and control sets optimized for that aesthetic.

### Theme Types

| Theme | Type | Media Support | Best For |
|-------|------|---------------|----------|
| LINEAR | Generative | SVG Paths | Wave grids, geometric patterns |
| NEON | Generative | SVG Gradients | Vibrant color meshes, fluid motion |
| GLITCH | Media Manipulation | Canvas (Images) | Distortion, RGB separation, retro effects |
| STARS | Generative | Canvas | Particle systems, space aesthetics |
| WAVE | Generative | Canvas | 3D waves, flowing patterns |

---

## Control Types

### Button Group
Multiple choice selection (e.g., modes, styles)
- **Example**: RGB / B&R / GRAY

### Slider
Continuous numeric value within a range
- **Example**: 0-360 for hue, 0-1 for opacity

### Audio Source Dropdown
Selects which audio frequency/feature drives the control
- **Options**: None (Static), Bass, Mids, Highs, All Levels, and 20+ specialized sources

### Intensity Slider
Controls how much audio modulates the control value
- **Range**: 0-200% (0 = static, 100% = normal, 200% = exaggerated)

---

## Audio Reactivity

### Default Audio Mappings

Each control can respond to audio in different ways:

- **Mode**: `modulate` (continuous) or `trigger` (threshold-based)
- **Frequency**: Which audio band affects the control
- **Intensity**: How much the audio affects the value (0-2x)

### Audio Sources Available

| Category | Sources |
|----------|---------|
| **Frequency Bands** | Sub-Bass, Bass, Low-Mids, Mids, High-Mids, Highs, Brilliance |
| **Amplitude** | All Levels, Peak, RMS, Decibels |
| **Rhythm** | Beat Detection, Onset Detection, BPM |
| **Dynamics** | Attack, Transients, Envelope |
| **Spectral** | Centroid, Flux, Rolloff, Zero Crossing Rate |
| **Musical** | Pitch, Harmonic Energy |

---

## LINEAR Theme

**Description**: Classic wave grid with flowing geometric patterns and multiple motion modes

### Visual Characteristics
- SVG-based line rendering
- Smooth flowing wave motion
- Cursor-reactive distortion
- Three distinct motion modes

### Controls

#### STYLE Category

**visualMode** (Button Group)
- **Options**: FLOW / HOLE / CRUNCH
- **Default**: HOLE
- **Description**: Changes how waves interact with cursor/audio
  - **FLOW**: Smooth flowing motion
  - **HOLE**: Creates vortex effect around cursor
  - **CRUNCH**: Compresses and expands waves
- **Audio Reactive**: No

**density** (Button Group)
- **Options**: L / M / H
- **Default**: M (Medium)
- **Description**: Number of grid points (Low=fewer, High=more)
- **Audio Reactive**: No
- **Requires Reinit**: Yes (regenerates grid)
- **Status**: ✅ Hooked up

#### GEOMETRY Category

**points** (Slider)
- **Range**: 4-16
- **Default**: 8
- **Description**: Number of wave lines in the grid
- **Audio Reactive**: Yes (optional)
- **Status**: ⚠️ Defined but not yet implemented

**spread** (Slider)
- **Range**: 50-200
- **Default**: 100
- **Description**: Spacing between grid points
- **Audio Reactive**: Yes (optional)
- **Status**: ⚠️ Defined but not yet implemented

**amplitude** (Slider)
- **Range**: 0-2
- **Default**: 1.0
- **Description**: Physics-based wave amplitude
- **Audio Reactive**: Yes (All Levels, 70% intensity)
- **Default Mapping**: All Levels → Modulate
- **Status**: ✅ Hooked up

**lineWidth** (Slider)
- **Range**: 1-10
- **Default**: 3
- **Description**: Thickness of wave lines
- **Audio Reactive**: Yes (optional)
- **Status**: ✅ Hooked up

#### COLOR Category

**hue** (Slider)
- **Range**: 0-360°
- **Default**: 280° (purple)
- **Description**: Base color hue on color wheel
- **Audio Reactive**: Yes (optional)
- **Status**: ✅ Hooked up

**saturation** (Slider)
- **Range**: 0-100%
- **Default**: 70%
- **Description**: Color intensity/vibrancy
- **Audio Reactive**: Yes (optional)
- **Status**: ✅ Hooked up

**opacity** (Slider)
- **Range**: 0-1
- **Default**: 0.6
- **Description**: Line transparency
- **Audio Reactive**: Yes (optional)
- **Status**: ✅ Hooked up

### Implementation Status
- **Total Controls**: 8
- **Fully Implemented**: 6 (75%)
- **Pending**: 2 (points, spread)

---

## NEON Theme

**Description**: Vibrant gradient mesh with glow effects and fluid color transitions

### Visual Characteristics
- SVG gradient mesh background
- Multiple gradient centers with radial blending
- Strong glow/bloom effects
- Smooth color transitions

### Controls

#### STYLE Category

**colorMode** (Button Group)
- **Options**: BRIGHT / GRAY / PASTEL
- **Default**: BRIGHT
- **Description**: Overall color palette style
  - **BRIGHT**: Vivid, saturated colors
  - **GRAY**: Desaturated, monochrome
  - **PASTEL**: Soft, light colors
- **Audio Reactive**: No
- **Status**: ✅ Hooked up

**density** (Button Group)
- **Options**: L / M / H
- **Default**: M
- **Description**: Mesh complexity (affects performance)
- **Audio Reactive**: No
- **Requires Reinit**: Yes
- **Status**: ✅ Hooked up

#### COLOR Category

**warmCool** (Slider)
- **Range**: 0-2
- **Default**: 1.0
- **Description**: Color temperature (0=cool blues, 2=warm oranges)
- **Audio Reactive**: Yes (optional)
- **Status**: ✅ Hooked up

**hue** (Slider)
- **Range**: 0-360°
- **Default**: 280°
- **Description**: Base hue for gradient colors
- **Audio Reactive**: Yes (optional)
- **Status**: ✅ Hooked up

**saturation** (Slider)
- **Range**: 0-100%
- **Default**: 70%
- **Description**: Color saturation with audio modulation
- **Audio Reactive**: Yes (optional)
- **Status**: ✅ Hooked up

**lightness** (Slider)
- **Range**: 0-100%
- **Default**: 50%
- **Description**: Color lightness with audio modulation
- **Audio Reactive**: Yes (optional)
- **Status**: ✅ Hooked up

#### GEOMETRY Category

**burstSize** (Slider)
- **Range**: 0-3
- **Default**: 1.0
- **Description**: Size of gradient bursts
- **Audio Reactive**: Yes (Bass, 70% intensity)
- **Default Mapping**: Bass → Modulate
- **Status**: ✅ Hooked up

**meshDensity** (Slider)
- **Range**: 4-20
- **Default**: 8
- **Description**: Number of gradient centers
- **Audio Reactive**: Yes (optional)
- **Status**: ⚠️ Defined but not yet implemented

#### MOTION Category

**movement** (Slider)
- **Range**: 0-3
- **Default**: 1.0
- **Description**: Movement amplitude multiplier
- **Audio Reactive**: Yes (Bass, 80% intensity)
- **Default Mapping**: Bass → Modulate
- **Status**: ✅ Hooked up

#### EFFECTS Category

**glow** (Slider)
- **Range**: 0-5
- **Default**: 1.5
- **Description**: Blur/bloom effect intensity
- **Audio Reactive**: Yes (All Levels, 60% intensity)
- **Default Mapping**: All Levels → Modulate
- **Status**: ✅ Hooked up

**blur** (Slider)
- **Range**: 0-20px
- **Default**: 0
- **Description**: Additional blur effect
- **Audio Reactive**: Yes (optional)
- **Status**: ✅ Hooked up

### Implementation Status
- **Total Controls**: 11
- **Fully Implemented**: 10 (91%)
- **Pending**: 1 (meshDensity)

### Planned Enhancements
- **Color Change Modes**: Static, Cycle, Pulse, Reactive
- **Responsiveness**: Audio response speed control
- **Smoothing**: Movement smoothing control

---

## GLITCH Theme

**Description**: Media manipulation theme for distorting images with RGB separation and glitch effects

### Visual Characteristics
- Canvas-based image rendering
- RGB channel separation (chromatic aberration)
- 3D rotation transforms
- Multiple glitch effects (scanlines, blocks, tears)
- Retro CRT aesthetics

### Media Support
- **Supported**: Static images (JPG, PNG, GIF)
- **Future**: Video support, webcam input

### Controls

#### STYLE Category

**visualMode** (Button Group)
- **Options**: RGB / B&R / GRAY
- **Default**: RGB
- **Description**: Color separation mode
  - **RGB**: Full RGB channel separation (colorful)
  - **B&R**: Red and Cyan only (3D glasses effect)
  - **GRAY**: Grayscale with glitch effects
- **Audio Reactive**: No
- **Status**: ✅ Hooked up

#### MOTION Category

**rotation** (Slider)
- **Range**: 0-5x
- **Default**: 1.0
- **Description**: 3D rotation intensity for image canvas
- **Audio Reactive**: Yes (Mids, 60% intensity)
- **Default Mapping**: Mids → Modulate
- **Status**: ✅ Hooked up

#### EFFECTS Category (Media Manipulation)

**glitchIntensity** (Slider)
- **Range**: 0-5x
- **Default**: 1.0
- **Description**: Overall glitch effect strength
- **Affects**: Scanline displacement, block corruption, vertical tears
- **Audio Reactive**: Yes (Highs, 60% intensity)
- **Default Mapping**: Highs → Modulate
- **Status**: ✅ Hooked up

**channelOffset** (Slider)
- **Range**: 0-30px
- **Default**: 5
- **Description**: RGB channel separation distance
- **Effect**: Creates chromatic aberration/misalignment
- **Audio Reactive**: Yes (Highs, 70% intensity)
- **Default Mapping**: Highs → Modulate
- **Status**: ✅ Hooked up

**displacement** (Slider)
- **Range**: 0-50px
- **Default**: 10
- **Description**: Glitch displacement amount
- **Effect**: How far pixels shift during glitch
- **Audio Reactive**: Yes (All Levels, 50% intensity)
- **Default Mapping**: All Levels → Modulate
- **Status**: ✅ Hooked up

**contrast** (Slider)
- **Range**: 0-3x
- **Default**: 1.0
- **Description**: Visual contrast multiplier
- **Implementation**: CSS filter: contrast()
- **Audio Reactive**: Yes (optional, default: Static)
- **Status**: ✅ Hooked up

**scanlines** (Slider)
- **Range**: 0-1
- **Default**: 0
- **Description**: CRT-style horizontal scanlines
- **Effect**: Creates retro monitor aesthetic
- **Implementation**: Black horizontal lines every 4px
- **Audio Reactive**: Yes (optional, default: Static)
- **Status**: ✅ Hooked up

**noise** (Slider)
- **Range**: 0-1
- **Default**: 0
- **Description**: Static grain/noise overlay
- **Effect**: Adds film grain texture to image
- **Implementation**: Random pixel value adjustments
- **Audio Reactive**: Yes (optional, default: Static)
- **Status**: ✅ Hooked up

**pixelation** (Slider)
- **Range**: 1-50px
- **Default**: 1
- **Description**: Pixel size for pixelation effect
- **Effect**: Creates mosaic/low-resolution look
- **Implementation**: Down-scale then up-scale rendering
- **Audio Reactive**: Yes (optional, default: Static)
- **Status**: ✅ Hooked up

### Implementation Status
- **Total Controls**: 9
- **Fully Implemented**: 9 (100%) ✅
- **Pending**: 0

### Media Manipulation Effects Summary

| Effect | Type | Performance | Best Use Case |
|--------|------|-------------|---------------|
| RGB Offset | Light | Fast | Chromatic aberration, 3D glasses look |
| Rotation | Light | Fast | Dynamic camera movement |
| Glitch | Medium | Medium | Audio-reactive distortion |
| Scanlines | Light | Fast | Retro CRT monitor aesthetic |
| Noise | Medium | Medium | Film grain, analog feel |
| Pixelation | Heavy | Slow | Low-res, mosaic effects |
| Contrast | Light | Fast | Brightness/darkness adjustments |

---

## STARS Theme

**Description**: Orbital star field with perspective depth and particle effects

### Visual Characteristics
- Canvas-based particle system
- 3D perspective projection
- Orbital motion around shifting center
- Variable star sizes and opacity
- Smooth color transitions

### Controls

#### COLOR Category

**hue** (Slider)
- **Range**: 0-360°
- **Default**: 44° (orange)
- **Description**: Base star color
- **Audio Reactive**: Yes (optional)
- **Status**: ✅ Hooked up

**saturation** (Slider)
- **Range**: 0-100%
- **Default**: 12%
- **Description**: Star color saturation
- **Audio Reactive**: Yes (optional)
- **Status**: ✅ Hooked up

**brightness** (Slider)
- **Range**: 0-1
- **Default**: 0.8
- **Description**: Overall brightness level
- **Audio Reactive**: Yes (Mids, 30% intensity)
- **Default Mapping**: Mids → Modulate
- **Status**: ✅ Hooked up

**minOpacity** (Slider)
- **Range**: 0-1
- **Default**: 0.2
- **Description**: Minimum star opacity
- **Audio Reactive**: Yes (optional)
- **Status**: ✅ Hooked up

**maxOpacity** (Slider)
- **Range**: 0-1
- **Default**: 1.0
- **Description**: Maximum star opacity
- **Audio Reactive**: Yes (optional)
- **Status**: ✅ Hooked up

#### MOTION Category

**speed** (Slider)
- **Range**: 0-5
- **Default**: 1.0
- **Description**: Orbital rotation speed
- **Audio Reactive**: Yes (Bass, 70% intensity)
- **Default Mapping**: Bass → Modulate
- **Status**: ✅ Hooked up

**zSpeed** (Slider)
- **Range**: -2 to 2
- **Default**: 0
- **Description**: Z-axis movement speed (depth)
- **Audio Reactive**: Yes (optional)
- **Status**: ✅ Hooked up

**centerShiftRate** (Slider)
- **Range**: 0-3
- **Default**: 1.0
- **Description**: Rate of orbital center movement
- **Audio Reactive**: Yes (optional)
- **Status**: ✅ Hooked up

**smoothing** (Slider)
- **Range**: 0-1
- **Default**: 0.5
- **Description**: Movement smoothing amount
- **Audio Reactive**: No
- **Status**: ⚠️ Defined but not yet implemented

#### GEOMETRY Category

**diameter** (Slider)
- **Range**: 0.5-3
- **Default**: 1.0
- **Description**: Star size multiplier
- **Audio Reactive**: Yes (optional)
- **Status**: ✅ Hooked up

**count** (Slider)
- **Range**: 100-3000
- **Default**: 1200
- **Description**: Number of stars
- **Audio Reactive**: Yes (optional)
- **Status**: ✅ Hooked up

**perspective** (Slider)
- **Range**: 0-3
- **Default**: 1.0
- **Description**: 3D perspective strength
- **Audio Reactive**: Yes (optional)
- **Status**: ⚠️ Defined but not yet implemented

#### EFFECTS Category

**twinkleRate** (Slider)
- **Range**: 0-100
- **Default**: 20
- **Description**: Star twinkling frequency
- **Audio Reactive**: Yes (optional)
- **Status**: ✅ Hooked up

**trailLength** (Slider)
- **Range**: 0-50
- **Default**: 0
- **Description**: Motion trail length
- **Audio Reactive**: Yes (optional)
- **Status**: ⚠️ Defined but not yet implemented

**bloom** (Slider)
- **Range**: 0-5
- **Default**: 0
- **Description**: Glow/bloom effect for bright stars
- **Audio Reactive**: Yes (optional)
- **Status**: ⚠️ Defined but not yet implemented

#### AUDIO Category

**audioBoost** (Slider)
- **Range**: 0-5
- **Default**: 3.0
- **Description**: Audio reactivity strength multiplier
- **Audio Reactive**: No (meta-control)
- **Status**: ✅ Hooked up

### Implementation Status
- **Total Controls**: 16
- **Fully Implemented**: 12 (75%)
- **Pending**: 4 (smoothing, perspective, trailLength, bloom)

---

## WAVE Theme

**Description**: Flowing 3D wave patterns with multiple rendering modes

### Visual Characteristics
- Canvas-based 3D wave rendering
- Three distinct visual modes
- Perspective projection
- Layer-based depth
- Smooth color gradients

### Controls

#### STYLE Category

**visualMode** (Button Group)
- **Options**: PLANES / GRIDS / DOTS
- **Default**: PLANES
- **Description**: Wave rendering style
  - **PLANES**: Solid colored wave planes
  - **GRIDS**: Wireframe grid waves
  - **DOTS**: Particle-based waves
- **Audio Reactive**: No
- **Status**: ✅ Hooked up

#### GEOMETRY Category

**layers** (Slider)
- **Range**: 1-10
- **Default**: 3
- **Description**: Number of wave layers (visible in GRIDS/DOTS modes)
- **Audio Reactive**: Yes (optional)
- **Visible When**: Mode is GRIDS or DOTS
- **Status**: ✅ Hooked up

**amplitude** (Slider)
- **Range**: 0-3
- **Default**: 1.2
- **Description**: Wave height/amplitude
- **Audio Reactive**: Yes (Bass, 70% intensity)
- **Default Mapping**: Bass → Modulate
- **Status**: ✅ Hooked up

**wavelength** (Slider)
- **Range**: 10-200
- **Default**: 50
- **Description**: Distance between wave peaks
- **Audio Reactive**: Yes (optional)
- **Status**: ✅ Hooked up

**lineWidth** (Slider)
- **Range**: 1-10
- **Default**: 3
- **Description**: Line thickness (GRIDS mode)
- **Audio Reactive**: Yes (optional)
- **Status**: ✅ Hooked up

#### COLOR Category

**hue** (Slider)
- **Range**: 0-360°
- **Default**: 280°
- **Description**: Wave color hue
- **Audio Reactive**: Yes (optional)
- **Status**: ✅ Hooked up

**saturation** (Slider)
- **Range**: 0-100%
- **Default**: 70%
- **Description**: Color saturation
- **Audio Reactive**: Yes (optional)
- **Status**: ✅ Hooked up

#### MOTION Category

**rotationX** (Slider)
- **Range**: 0-2
- **Default**: 0.3
- **Description**: X-axis rotation speed
- **Audio Reactive**: Yes (Bass, 60% intensity)
- **Default Mapping**: Bass → Modulate
- **Status**: ✅ Hooked up

**rotationY** (Slider)
- **Range**: 0-2
- **Default**: 0.3
- **Description**: Y-axis rotation speed
- **Audio Reactive**: Yes (Mids, 60% intensity)
- **Default Mapping**: Mids → Modulate
- **Status**: ✅ Hooked up

**speed** (Slider)
- **Range**: 0-5
- **Default**: 1.0
- **Description**: Wave animation speed
- **Audio Reactive**: Yes (optional)
- **Status**: ✅ Hooked up

#### EFFECTS Category

**glow** (Slider)
- **Range**: 0-20
- **Default**: 0
- **Description**: Glow/bloom effect strength
- **Audio Reactive**: Yes (optional)
- **Status**: ✅ Hooked up

**perspective** (Slider)
- **Range**: 0-3
- **Default**: 1.0
- **Description**: 3D perspective depth
- **Audio Reactive**: Yes (optional)
- **Status**: ⚠️ Defined but not yet implemented

**depth** (Slider)
- **Range**: 0-5
- **Default**: 1.0
- **Description**: Z-axis depth range
- **Audio Reactive**: Yes (optional)
- **Status**: ⚠️ Defined but not yet implemented

**turbulence** (Slider)
- **Range**: 0-2
- **Default**: 0
- **Description**: Wave turbulence/noise amount
- **Audio Reactive**: Yes (optional)
- **Status**: ⚠️ Defined but not yet implemented

**phaseShift** (Slider)
- **Range**: 0-360°
- **Default**: 0
- **Description**: Phase offset between layers
- **Audio Reactive**: Yes (optional)
- **Status**: ⚠️ Defined but not yet implemented

### Implementation Status
- **Total Controls**: 15
- **Fully Implemented**: 11 (73%)
- **Pending**: 4 (perspective, depth, turbulence, phaseShift)

---

## Overall Statistics

| Theme | Total Controls | Implemented | Pending | Completion % |
|-------|----------------|-------------|---------|--------------|
| LINEAR | 8 | 6 | 2 | 75% |
| NEON | 11 | 10 | 1 | 91% |
| GLITCH | 9 | 9 | 0 | 100% ✅ |
| STARS | 16 | 12 | 4 | 75% |
| WAVE | 15 | 11 | 4 | 73% |
| **TOTAL** | **59** | **48** | **11** | **81%** |

---

## Quick Reference: Default Audio Mappings

### Controls with Audio Reactivity Enabled by Default

| Theme | Control | Audio Source | Intensity | Mode |
|-------|---------|--------------|-----------|------|
| LINEAR | amplitude | All Levels | 70% | Modulate |
| NEON | burstSize | Bass | 70% | Modulate |
| NEON | movement | Bass | 80% | Modulate |
| NEON | glow | All Levels | 60% | Modulate |
| GLITCH | rotation | Mids | 60% | Modulate |
| GLITCH | glitchIntensity | Highs | 60% | Modulate |
| GLITCH | channelOffset | Highs | 70% | Modulate |
| GLITCH | displacement | All Levels | 50% | Modulate |
| STARS | speed | Bass | 70% | Modulate |
| STARS | brightness | Mids | 30% | Modulate |
| WAVE | amplitude | Bass | 70% | Modulate |
| WAVE | rotationX | Bass | 60% | Modulate |
| WAVE | rotationY | Mids | 60% | Modulate |

All other controls default to **Static (None)** and can be configured by users.

---

## Performance Considerations

### Low Impact Controls
- Color (hue, saturation, lightness)
- Opacity
- Simple sliders (speed, intensity)

### Medium Impact Controls
- Density changes
- Blur/glow effects
- RGB channel separation

### High Impact Controls
- Particle count (stars, meshDensity)
- Pixelation (large values)
- Noise overlay
- Trails (long lengths)
- Turbulence

**Recommendation**: Start with default values and gradually increase high-impact controls while monitoring performance.

---

## Usage Tips

1. **Audio Reactivity**: Use intensity sliders to fine-tune how much music affects each control
2. **Combinations**: Try combining static and reactive controls for best results
3. **Performance**: Lower density/count values if experiencing lag
4. **Experimentation**: All themes respond differently to different music genres
5. **Presets**: Consider saving favorite configurations for quick recall

---

*Last Updated: 2025-12-23*
*Version: 1.0*
