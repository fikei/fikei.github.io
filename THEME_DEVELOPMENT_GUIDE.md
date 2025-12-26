# Theme Development Guide
**Soundscape Audio-Reactive Visualizer**

Complete guide for creating fully compatible, production-ready themes

---

## Table of Contents

1. [Overview](#overview)
2. [Architecture](#architecture)
3. [Step-by-Step Implementation](#step-by-step-implementation)
4. [Control System Integration](#control-system-integration)
5. [Audio Reactivity](#audio-reactivity)
6. [Canvas vs SVG](#canvas-vs-svg)
7. [Performance Optimization](#performance-optimization)
8. [Testing](#testing)
9. [Documentation](#documentation)
10. [Checklist](#checklist)

---

## Overview

A **complete theme** in Soundscape requires:
1. ✅ Configuration in `index.html`
2. ✅ Rendering function in `index.html`
3. ✅ **Control system integration** in `control-system.js`
4. ✅ Audio reactivity mappings
5. ✅ Documentation in `THEME_CONTROLS_REFERENCE.md`
6. ✅ Roadmap entry in `VJ_FEATURES_ROADMAP.md`

**Critical:** All existing themes (LINEAR, NEON, GLITCH, STARS, WAVE) have control system integration. New themes (TUNNEL, PLASMA, PARTICLES) **must follow this pattern** for consistency.

---

## Architecture

### Theme Lifecycle

```
User selects theme
       ↓
Control UI loads (control-system.js)
       ↓
User adjusts controls
       ↓
AudioEngine processes audio
       ↓
Audio reactivity modulates control values
       ↓
drawLines{ThemeName}() renders frame
       ↓
Repeat at 60 FPS
```

### File Structure

```
soundscape/
├── index.html                 # Theme config + rendering functions
├── control-system.js          # Control UI + audio reactivity system
├── THEME_CONTROLS_REFERENCE.md  # User documentation
└── VJ_FEATURES_ROADMAP.md     # Development tracking
```

---

## Step-by-Step Implementation

### Step 1: Define Theme Configuration (index.html)

**Location:** `config.themes` object in `index.html`

```javascript
config.themes.yourTheme = {
    bg: '#000000',        // Background color (required)
    opacity: 1.0,         // Theme opacity (required, 0-1)

    // Color controls
    hue: 180,            // Base hue (0-360)
    saturation: 80,      // Saturation (0-100)
    brightness: 0.6,     // Brightness (0-1)

    // Geometry controls
    count: 1000,         // Number of elements
    size: 2,             // Element size

    // Motion controls
    speed: 1.0,          // Animation speed multiplier
    rotation: 0.5,       // Rotation speed

    // Effects controls
    bloom: 0,            // Glow intensity (0-2)
    trailLength: 0.15,   // Motion trail fade (0-1)

    // Mode selectors (button groups)
    mode: 'default'      // Visual mode: default, alternate, etc.
};
```

**Guidelines:**
- Use descriptive property names
- Include comments with ranges
- Set sensible defaults
- Group by category (color, geometry, motion, effects)

---

### Step 2: Create Rendering Function (index.html)

**Location:** After state initialization in `index.html`

```javascript
function drawLinesYourTheme() {
    const theme = config.themes.yourTheme;
    const { low, mid, high } = state.audioLevels;

    // Helper function to get control values from control system
    const getControl = (key) => window.audioEngine?.getValue('yourTheme', key) || theme[key];

    // Get all control values
    const hue = getControl('hue');
    const saturation = getControl('saturation');
    const brightness = getControl('brightness');
    const count = getControl('count');
    const size = getControl('size');
    const speed = getControl('speed');
    const bloom = getControl('bloom');
    const mode = getControl('mode');

    // CANVAS THEMES: Hide SVG paths
    state.paths.forEach(path => path.setAttribute('d', ''));

    // SVG THEMES: Use state.paths to draw
    // (See LINEAR or NEON themes for SVG examples)

    // Get or create canvas (CANVAS THEMES ONLY)
    let canvas = document.getElementById('yourtheme-canvas');
    if (!canvas) {
        canvas = document.createElement('canvas');
        canvas.id = 'yourtheme-canvas';
        canvas.style.position = 'fixed';
        canvas.style.top = '0';
        canvas.style.left = '0';
        canvas.style.width = '100%';
        canvas.style.height = '100%';
        canvas.style.pointerEvents = 'none';
        canvas.style.zIndex = '0';
        document.body.insertBefore(canvas, document.body.firstChild);
    }

    const ctx = canvas.getContext('2d');
    const w = canvas.width = state.boundingRect.width;
    const h = canvas.height = state.boundingRect.height;

    // Clear canvas
    ctx.fillStyle = theme.bg;
    ctx.fillRect(0, 0, w, h);

    // YOUR RENDERING CODE HERE
    // - Use control values (not hardcoded values)
    // - Apply audio reactivity (low/mid/high)
    // - Draw your visual effect

    // Example: Draw audio-reactive particles
    for (let i = 0; i < count; i++) {
        const x = (i / count) * w;
        const y = h / 2 + Math.sin(x * 0.01 + state.currentTime * speed * 0.001) * 100 * (1 + low);

        ctx.fillStyle = `hsl(${hue}, ${saturation}%, ${brightness * 100}%)`;
        ctx.beginPath();
        ctx.arc(x, y, size * (1 + bloom), 0, Math.PI * 2);
        ctx.fill();
    }
}
```

**Key Patterns:**
1. **Always use `getControl()` helper** - Never hardcode values from `theme` object directly
2. **Access audio levels** from `state.audioLevels`
3. **Use `state.currentTime`** for animations
4. **Canvas cleanup**: Set composite operations back to default
5. **Performance**: Minimize object creation in render loop

---

### Step 3: Register Theme in themeRenderers (index.html)

**Location:** `themeRenderers` object in `index.html`

```javascript
const themeRenderers = {
    linear: drawLinesLinear,
    neon: drawLinesNeon,
    glitch: drawLinesGlitch,
    stars: drawLinesStars,
    wave: drawLinesWave,
    tunnel: drawLinesTunnel,
    plasma: drawLinesPlasma,
    particles: drawLinesParticles,
    yourTheme: drawLinesYourTheme  // ADD YOUR THEME HERE
};
```

---

### Step 4: Add Theme to Selectors (index.html)

**Location:** All `<select>` elements in HTML

```html
<!-- Main theme select -->
<select class="theme-select" id="themeSelect">
    <option value="linear">LINEAR</option>
    <option value="neon">NEON</option>
    <option value="glitch">GLITCH</option>
    <option value="stars">STARS</option>
    <option value="wave">WAVE</option>
    <option value="tunnel">TUNNEL</option>
    <option value="plasma">PLASMA</option>
    <option value="particles">PARTICLES</option>
    <option value="yourTheme">YOUR THEME</option>  <!-- ADD HERE -->
</select>

<!-- Layer A theme select -->
<select class="layer-theme-select" id="layer0Theme">
    <!-- Same options as above -->
</select>

<!-- Layer B theme select -->
<select class="layer-theme-select" id="layer1Theme">
    <!-- Same options as above -->
</select>
```

**Important:** Add to **all three** select elements!

---

### Step 5: **CRITICAL** - Control System Integration (control-system.js)

**Location:** `THEME_CONFIGS` object in `control-system.js`

This is the **most important step** for full theme compatibility.

```javascript
const THEME_CONFIGS = {
    // ... existing themes ...

    // ─────────────────────────────────────────────────────────
    // YOUR THEME
    // ─────────────────────────────────────────────────────────
    yourTheme: {
        name: 'YOUR THEME',
        description: 'Brief description of visual style',
        controls: {
            // ===== STYLE CONTROLS (Button Groups) =====
            mode: {
                type: 'buttonGroup',
                label: 'MODE',
                options: [
                    { value: 'default', label: 'DEFAULT' },
                    { value: 'alternate', label: 'ALT' },
                    { value: 'special', label: 'SPECIAL' }
                ],
                default: 'default',
                category: 'style',
                audioReactive: false,
                description: 'Visual mode selector'
            },

            // ===== COLOR CONTROLS =====
            hue: {
                default: 180,
                category: 'color'
            },
            saturation: {
                default: 80,
                category: 'color'
            },
            brightness: {
                default: 0.6,
                category: 'color',
                description: 'Overall brightness (0-1)'
            },

            // ===== GEOMETRY CONTROLS =====
            count: {
                default: 1000,
                category: 'geometry',
                description: 'Number of elements (100-5000)'
            },
            size: {
                default: 2,
                category: 'geometry',
                description: 'Element size (1-10)'
            },

            // ===== MOTION CONTROLS =====
            speed: {
                default: 1.0,
                category: 'motion',
                description: 'Animation speed multiplier'
            },
            rotation: {
                default: 0.5,
                category: 'motion',
                description: 'Rotation speed'
            },

            // ===== EFFECTS CONTROLS =====
            bloom: {
                default: 0,
                category: 'effects',
                description: 'Glow/bloom intensity (0-2)'
            },
            trailLength: {
                default: 0.15,
                category: 'effects',
                description: 'Motion trail fade (0-1)'
            }
        },

        audioReactivity: {
            // ===== ENABLED BY DEFAULT (Main Audio-Reactive Controls) =====
            size: { enabled: true, frequency: 'bass', intensity: 0.5, mode: 'modulate' },
            hue: { enabled: true, frequency: 'highs', intensity: 0.6, mode: 'modulate' },
            brightness: { enabled: true, frequency: 'mids', intensity: 0.3, mode: 'modulate' },

            // ===== DISABLED BY DEFAULT (Static Controls) =====
            // User can enable these via UI
            count: { enabled: false, frequency: 'none', intensity: 0.4, mode: 'modulate' },
            saturation: { enabled: false, frequency: 'none', intensity: 0.3, mode: 'modulate' },
            speed: { enabled: false, frequency: 'none', intensity: 0.5, mode: 'modulate' },
            rotation: { enabled: false, frequency: 'none', intensity: 0.4, mode: 'modulate' },
            bloom: { enabled: false, frequency: 'none', intensity: 0.6, mode: 'modulate' },
            trailLength: { enabled: false, frequency: 'none', intensity: 0.4, mode: 'modulate' }
        }
    }
};
```

**Control Object Structure:**

```javascript
// Minimal control (auto-generates slider UI)
controlName: {
    default: 1.0,        // Default value
    category: 'motion'   // Category: color, geometry, motion, effects, style, audio
}

// Full control specification
controlName: {
    type: 'slider',              // or 'buttonGroup'
    label: 'CONTROL NAME',       // UI label
    min: 0,                      // Minimum value (sliders only)
    max: 10,                     // Maximum value (sliders only)
    step: 0.1,                   // Step size (sliders only)
    default: 1.0,                // Default value
    unit: 'x',                   // Display unit (optional)
    category: 'motion',          // Category grouping
    audioReactive: false,        // Can this be audio-reactive? (true by default)
    requiresReinit: true,        // Does changing this require reinitialization? (optional)
    description: 'Tooltip text'  // Help text (optional)
}

// Button group control
modeName: {
    type: 'buttonGroup',
    label: 'MODE',
    options: [
        { value: 'option1', label: 'OPTION 1' },
        { value: 'option2', label: 'OPTION 2' }
    ],
    default: 'option1',
    category: 'style',
    audioReactive: false
}
```

**Audio Reactivity Object Structure:**

```javascript
controlName: {
    enabled: true,           // Is this control audio-reactive by default?
    frequency: 'bass',       // Which frequency band? (bass, mids, highs, allLevels, etc.)
    intensity: 0.5,          // How strong is the modulation? (0-1)
    mode: 'modulate'         // Modulation mode (always 'modulate' for now)
}
```

**Available Frequency Sources:**
- `none` - Static (no audio)
- `bass` - 60-250 Hz (kick drums)
- `mids` - 500-2000 Hz (vocals, leads)
- `highs` - 4000-8000 Hz (cymbals)
- `allLevels` - Combined average
- `subBass`, `lowMids`, `highMids`, `brilliance`
- `peak`, `rms`, `beat`, `onset`, `bpm`

See `/home/user/fikei.github.io/soundscape/control-system.js` lines 11-117 for full list.

---

## Control System Integration

### Why Control System Integration is Critical

**Without integration:**
- ❌ No UI controls appear when theme is selected
- ❌ No audio source customization
- ❌ No per-control audio reactivity
- ❌ Inconsistent with other themes
- ❌ Incomplete user experience

**With integration:**
- ✅ Dynamic UI generation
- ✅ Per-control audio reactivity
- ✅ User customization (remap any control to any frequency)
- ✅ Consistent behavior across all themes
- ✅ Professional-grade experience

### Integration Checklist

1. **Add to THEME_CONFIGS** in `control-system.js`
2. **Define all controls** with defaults and categories
3. **Configure audioReactivity** for each control
4. **Use `getControl()` helper** in rendering function
5. **Test UI generation** - controls should appear when theme is selected

---

## Audio Reactivity

### Fixed vs Per-Control Reactivity

**❌ WRONG (Fixed Mappings):**
```javascript
// Hardcoded in rendering function
const bassPulse = low * 5;
const midGlow = mid * 3;
particle.size = baseSize * (1 + bassPulse);
```

**✅ CORRECT (Control System):**
```javascript
// In THEME_CONFIGS audioReactivity
size: { enabled: true, frequency: 'bass', intensity: 0.5, mode: 'modulate' }

// In rendering function
const size = getControl('size'); // AudioEngine handles reactivity
particle.size = size * particle.baseSize;
```

### Audio Reactivity Best Practices

1. **Enable 2-4 controls by default** - Enough to be reactive, not overwhelming
2. **Map logically:**
   - Bass → Movement, size, explosions
   - Mids → Brightness, color shifts
   - Highs → Details, sparkle, hue shifts
3. **Allow customization** - All controls should be mappable
4. **Set appropriate intensity** - 0.3-0.7 for subtle, 0.8-1.0 for aggressive

---

## Canvas vs SVG

### Canvas Themes (Recommended for New Themes)

**Pros:**
- ✅ Better performance for particle systems
- ✅ Pixel-level control
- ✅ Supports transparency/blending (future)
- ✅ More visual effects (gradients, glows)

**Pattern:**
```javascript
function drawLinesCanvasTheme() {
    // Hide SVG paths
    state.paths.forEach(path => path.setAttribute('d', ''));

    // Get or create canvas
    let canvas = document.getElementById('themename-canvas');
    if (!canvas) {
        canvas = document.createElement('canvas');
        canvas.id = 'themename-canvas';
        canvas.style.position = 'fixed';
        canvas.style.top = '0';
        canvas.style.left = '0';
        canvas.style.width = '100%';
        canvas.style.height = '100%';
        canvas.style.pointerEvents = 'none';
        canvas.style.zIndex = '0';
        document.body.insertBefore(canvas, document.body.firstChild);
    }

    const ctx = canvas.getContext('2d');
    const w = canvas.width = state.boundingRect.width;
    const h = canvas.height = state.boundingRect.height;

    // Render to canvas
    ctx.fillStyle = theme.bg;
    ctx.fillRect(0, 0, w, h);

    // ... your drawing code ...
}
```

### SVG Themes (Legacy)

**Pros:**
- ✅ Vector graphics
- ✅ DOM manipulation
- ✅ CSS styling

**Cons:**
- ❌ No transparency/blending support
- ❌ Performance limitations
- ❌ Hard theme switching

**Use Case:** Only use SVG if you specifically need vector paths (like LINEAR wave grids)

---

## Performance Optimization

### Canvas Performance Tips

1. **Minimize object creation in render loop**
   ```javascript
   // ❌ BAD - Creates new array every frame
   for (let particle of [...particles]) { }

   // ✅ GOOD - Reuse array
   for (let particle of particles) { }
   ```

2. **Use squared distances when possible**
   ```javascript
   // ❌ SLOW - sqrt() is expensive
   const dist = Math.sqrt(dx * dx + dy * dy);
   if (dist < 30) { }

   // ✅ FAST - Compare squared distances
   const distSq = dx * dx + dy * dy;
   if (distSq < 900) { } // 30² = 900
   ```

3. **Spatial partitioning for particle systems**
   ```javascript
   // ❌ O(n²) - Checks all pairs
   particles.forEach(p1 => {
       particles.forEach(p2 => {
           checkCollision(p1, p2);
       });
   });

   // ✅ O(n) - Grid-based spatial hash
   const GRID_SIZE = 50;
   const grid = {};
   particles.forEach(p => {
       const key = `${Math.floor(p.x / GRID_SIZE)},${Math.floor(p.y / GRID_SIZE)}`;
       if (!grid[key]) grid[key] = [];
       grid[key].push(p);
   });
   // Only check neighbors in adjacent cells
   ```

4. **Limit particle counts**
   ```javascript
   // Add reasonable max limits
   count: {
       type: 'slider',
       min: 100,
       max: 5000,  // Prevents performance issues
       default: 1000
   }
   ```

5. **Use `globalCompositeOperation` wisely**
   ```javascript
   ctx.globalCompositeOperation = 'lighter'; // Additive blending
   // ... draw particles ...
   ctx.globalCompositeOperation = 'source-over'; // Reset to default
   ```

### Target Performance

- **60 FPS** at 1080p with default settings
- **30 FPS minimum** at 4K with max particles
- **Frame time** < 16ms (60 FPS) or < 33ms (30 FPS)

---

## Testing

### Testing Checklist

**Functionality:**
- [ ] Theme appears in all 3 dropdowns (main, Layer A, Layer B)
- [ ] Rendering function executes without errors
- [ ] All controls appear in UI when theme is selected
- [ ] Control values update rendering in real-time
- [ ] Audio reactivity works for enabled controls
- [ ] Button groups (modes) switch correctly
- [ ] Theme works in both standalone and layer modes

**Performance:**
- [ ] 60 FPS at 1080p with default settings
- [ ] No memory leaks (check DevTools memory profiler)
- [ ] CPU usage reasonable (<50% on mid-range hardware)
- [ ] Works on mobile (30 FPS minimum)

**Visual Quality:**
- [ ] Colors are vibrant and distinct from other themes
- [ ] Audio reactivity is visually impactful
- [ ] No visual artifacts or glitches
- [ ] Looks good on both dark and light backgrounds
- [ ] Works well with layer crossfading

**Integration:**
- [ ] Beat Pad scenes save/load correctly
- [ ] Video recording captures theme correctly
- [ ] Companion app can control theme
- [ ] Audio source selection works (mic/input)
- [ ] Works with all BeatSync features

### Test Script

```javascript
// In browser console:
// 1. Select your theme
document.getElementById('themeSelect').value = 'yourTheme';
document.getElementById('themeSelect').dispatchEvent(new Event('change'));

// 2. Check controls loaded
console.log(window.audioEngine?.currentTheme); // Should be 'yourTheme'

// 3. Get a control value
console.log(window.audioEngine?.getValue('yourTheme', 'size')); // Should return number

// 4. Set a control value
window.audioEngine?.setValue('yourTheme', 'size', 5);

// 5. Monitor frame rate
let lastTime = performance.now();
function checkFPS() {
    const now = performance.now();
    const fps = 1000 / (now - lastTime);
    console.log('FPS:', fps.toFixed(1));
    lastTime = now;
    requestAnimationFrame(checkFPS);
}
checkFPS();
```

---

## Documentation

### 1. Update THEME_CONTROLS_REFERENCE.md

Add complete entry for your theme:

```markdown
## YOUR THEME Theme
**Visual Style**: Brief description of visual appearance

| Control | Type | Range | Default | Description |
|---------|------|-------|---------|-------------|
| mode | select | 3 options | default | Visual mode selector |
| hue | slider | 0-360 | 180 | Base color hue |
| saturation | slider | 0-100 | 80 | Color saturation |
| brightness | slider | 0-1 | 0.6 | Overall brightness |
| count | slider | 100-5000 | 1000 | Number of elements |
| size | slider | 1-10 | 2 | Element size |
| speed | slider | 0-5 | 1.0 | Animation speed |
| bloom | slider | 0-2 | 0 | Glow intensity |

**Audio Reactivity (Default Mappings):**
- Bass: Size boost + explosions
- Mid: Brightness boost
- High: Hue shift

**Total Controls**: 8

**Notes:**
- Canvas-based theme
- Supports layer transparency
- Optimized for 1000+ elements
```

### 2. Update VJ_FEATURES_ROADMAP.md

Mark your theme as completed:

```markdown
### New Themes
- [x] YOUR THEME ✅ - Brief description
  - Features implemented
  - Control count: 8
  - Status: COMPLETED
```

### 3. Add to README (if exists)

Update theme count and feature list.

---

## Checklist

Use this checklist for every new theme:

### Implementation
- [ ] 1. Config added to `config.themes` in `index.html`
- [ ] 2. Rendering function created (`drawLinesYourTheme()`)
- [ ] 3. Registered in `themeRenderers` object
- [ ] 4. Added to all 3 theme `<select>` dropdowns
- [ ] 5. **THEME_CONFIGS entry added** to `control-system.js`
- [ ] 6. All controls defined with defaults
- [ ] 7. Audio reactivity configured for each control
- [ ] 8. `getControl()` helper used in rendering function

### Quality
- [ ] 9. No hardcoded values in rendering (all via `getControl()`)
- [ ] 10. Performance optimized (60 FPS at default settings)
- [ ] 11. Spatial optimization if using >500 elements
- [ ] 12. Canvas cleanup (reset composite operations)
- [ ] 13. No memory leaks
- [ ] 14. Works on mobile

### Documentation
- [ ] 15. Entry added to `THEME_CONTROLS_REFERENCE.md`
- [ ] 16. Roadmap updated in `VJ_FEATURES_ROADMAP.md`
- [ ] 17. Control count is accurate
- [ ] 18. Audio reactivity documented

### Testing
- [ ] 19. Tested in main theme selector
- [ ] 20. Tested in Layer A and Layer B
- [ ] 21. All controls appear in UI
- [ ] 22. Audio reactivity works
- [ ] 23. Beat Pad scenes work
- [ ] 24. Video recording works
- [ ] 25. No console errors

---

## Common Mistakes

### ❌ MISTAKE 1: Skipping Control System Integration

```javascript
// ❌ WRONG - No THEME_CONFIGS entry
// Result: No UI controls, no audio reactivity

config.themes.myTheme = { hue: 180, size: 2 };
function drawLinesMyTheme() {
    const size = config.themes.myTheme.size;
    // ... rendering ...
}
```

**Fix:** Always add THEME_CONFIGS entry in `control-system.js`

### ❌ MISTAKE 2: Hardcoded Values

```javascript
// ❌ WRONG - Hardcoded size
function drawLines() {
    const size = 2; // Hardcoded!
    particle.size = size * (1 + low * 0.5);
}
```

```javascript
// ✅ CORRECT - Use getControl()
function drawLines() {
    const getControl = (key) => window.audioEngine?.getValue('theme', key) || theme[key];
    const size = getControl('size');
    particle.size = size * (1 + low * 0.5);
}
```

### ❌ MISTAKE 3: Missing Audio Reactivity Config

```javascript
// ❌ WRONG - No audioReactivity object
yourTheme: {
    controls: { size: { default: 2 } }
    // Missing audioReactivity!
}
```

```javascript
// ✅ CORRECT - Complete config
yourTheme: {
    controls: { size: { default: 2, category: 'geometry' } },
    audioReactivity: {
        size: { enabled: true, frequency: 'bass', intensity: 0.5, mode: 'modulate' }
    }
}
```

### ❌ MISTAKE 4: O(n²) Complexity

```javascript
// ❌ WRONG - Checks all pairs (1M ops at 1000 particles)
particles.forEach(p1 => {
    particles.forEach(p2 => {
        checkDistance(p1, p2);
    });
});
```

**Fix:** Use spatial partitioning (grid-based hash)

### ❌ MISTAKE 5: Creating Objects in Render Loop

```javascript
// ❌ WRONG - Creates garbage
function drawLines() {
    for (let i = 0; i < 1000; i++) {
        const particle = { x: i, y: i }; // New object every frame!
        draw(particle);
    }
}
```

```javascript
// ✅ CORRECT - Reuse objects
const particles = []; // Created once
function init() {
    for (let i = 0; i < 1000; i++) {
        particles.push({ x: i, y: i });
    }
}
function drawLines() {
    for (let particle of particles) {
        particle.x += 1; // Modify existing
        draw(particle);
    }
}
```

---

## Example: Complete Theme Implementation

See **PARTICLES theme** for reference implementation:
- **Config:** `/home/user/fikei.github.io/soundscape/index.html` lines 2842-2857
- **Renderer:** `/home/user/fikei.github.io/soundscape/index.html` lines 6540-6742
- **Control System:** `/home/user/fikei.github.io/soundscape/control-system.js` lines 1509-1583
- **Documentation:** `/home/user/fikei.github.io/THEME_CONTROLS_REFERENCE.md`

**Demonstrates:**
- ✅ Full control system integration
- ✅ Button group mode selector
- ✅ 12 controls across all categories
- ✅ Audio reactivity (size, hue, brightness)
- ✅ Spatial grid optimization (O(n) swarm mode)
- ✅ New controls (bloom, trailLength, explosionThreshold)
- ✅ getControl() helper pattern

---

## Summary

**Minimum Requirements for Production-Ready Theme:**

1. Configuration in `index.html` (`config.themes.yourTheme`)
2. Rendering function (`drawLinesYourTheme()`)
3. **THEME_CONFIGS entry in `control-system.js`** ← CRITICAL
4. Audio reactivity mappings
5. Documentation in `THEME_CONTROLS_REFERENCE.md`

**Why This Matters:**
Without control system integration, your theme is **incomplete** and **inconsistent** with the rest of the application. Users expect all themes to have the same level of control and customization.

**Follow this guide** and your theme will be:
- ✅ Fully compatible with the control system
- ✅ Consistent with existing themes
- ✅ Production-ready
- ✅ Professional quality

---

**Version:** 1.0
**Last Updated:** 2025-12-26
**Applies To:** Soundscape v1.0+

For questions or issues, see the `/home/user/fikei.github.io/.claude/README.md` documentation automation guide.
