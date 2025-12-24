# Unified Control System Architecture

## Overview

This document outlines a proposed architecture for a unified, extensible control system that:
- Provides consistency across all themes and media
- Makes adding new themes trivial
- Enables per-control audio reactivity configuration
- Reduces code duplication
- Centralizes control definitions

## Current Problems

1. **Inconsistency**: Each theme has custom control sections with different structures
2. **Duplication**: Similar controls repeated across themes (hue, saturation, speed, etc.)
3. **Hard to extend**: Adding a new theme requires touching many places in the code
4. **Audio reactivity baked in**: Can't easily toggle which controls respond to audio
5. **No central definition**: Controls defined in HTML, event listeners, state, and reset function

## Proposed Architecture

### 1. Control Definitions (Centralized Registry)

Define all possible controls in one place with metadata:

```javascript
const CONTROL_REGISTRY = {
  // Color controls
  hue: {
    type: 'slider',
    label: 'HUE',
    min: 0,
    max: 360,
    step: 1,
    default: 280,
    unit: '°',
    category: 'color',
    audioReactive: true,  // Can this control be audio-reactive?
    description: 'Color hue on the color wheel'
  },

  saturation: {
    type: 'slider',
    label: 'SATURATION',
    min: 0,
    max: 100,
    step: 1,
    default: 70,
    unit: '%',
    category: 'color',
    audioReactive: true,
    description: 'Color intensity/vibrancy'
  },

  brightness: {
    type: 'slider',
    label: 'BRIGHTNESS',
    min: 0,
    max: 1,
    step: 0.05,
    default: 0.8,
    unit: '',
    category: 'appearance',
    audioReactive: true,
    description: 'Overall brightness level'
  },

  // Motion controls
  speed: {
    type: 'slider',
    label: 'SPEED',
    min: 0,
    max: 5,
    step: 0.1,
    default: 1.0,
    unit: 'x',
    category: 'motion',
    audioReactive: true,
    description: 'Animation speed multiplier'
  },

  rotation: {
    type: 'slider',
    label: 'ROTATION',
    min: 0,
    max: 5,
    step: 0.1,
    default: 1.0,
    unit: 'x',
    category: 'motion',
    audioReactive: true,
    description: 'Rotation speed/intensity'
  },

  // Mode controls
  visualMode: {
    type: 'select',
    label: 'MODE',
    options: [
      { value: 'planes', label: 'PLANES' },
      { value: 'grids', label: 'GRIDS' },
      { value: 'dots', label: 'DOTS' }
    ],
    default: 'planes',
    category: 'style',
    audioReactive: false,  // Mode switches typically aren't audio-reactive
    description: 'Visual rendering style'
  },

  layers: {
    type: 'slider',
    label: 'LAYERS',
    min: 1,
    max: 10,
    step: 1,
    default: 3,
    unit: '',
    category: 'style',
    audioReactive: true,
    description: 'Number of visual layers'
  },

  // Density/Count controls
  count: {
    type: 'slider',
    label: 'COUNT',
    min: 100,
    max: 2000,
    step: 100,
    default: 1200,
    unit: '',
    category: 'density',
    audioReactive: true,
    description: 'Number of elements',
    requiresReinit: true  // Changing this requires reinitialization
  },

  density: {
    type: 'buttonGroup',
    label: 'DENSITY',
    options: [
      { value: 'low', label: 'L' },
      { value: 'medium', label: 'M' },
      { value: 'high', label: 'H' }
    ],
    default: 'medium',
    category: 'density',
    audioReactive: false,
    description: 'Grid density preset',
    requiresReinit: true
  },

  // Effect controls
  glitchIntensity: {
    type: 'slider',
    label: 'GLITCH',
    min: 0,
    max: 5,
    step: 0.1,
    default: 1.0,
    unit: 'x',
    category: 'effects',
    audioReactive: true,
    description: 'Glitch effect intensity'
  },

  contrast: {
    type: 'slider',
    label: 'CONTRAST',
    min: 0,
    max: 3,
    step: 0.1,
    default: 1.0,
    unit: 'x',
    category: 'effects',
    audioReactive: true,
    description: 'Visual contrast level'
  }
};
```

### 2. Theme Configurations

Each theme declares which controls it uses and their audio reactivity:

```javascript
const THEME_CONFIGS = {
  wave: {
    name: 'WAVE',
    description: 'Flowing orbital patterns with multiple rendering modes',
    controls: {
      visualMode: {},  // Use defaults from registry
      layers: {
        visibleWhen: (state) => ['grids', 'dots'].includes(state.settings.wave.visualMode)
      },
      hue: {},
      saturation: {},
      speed: {},
      count: {}
    },
    audioReactivity: {
      hue: {
        enabled: false,  // Off by default, user can toggle
        frequency: 'mid',  // Which frequency band affects this
        intensity: 1.0,     // Modulation strength (0-2)
        mode: 'modulate'    // 'modulate' or 'trigger'
      },
      saturation: {
        enabled: false,
        frequency: 'high',
        intensity: 0.5,
        mode: 'modulate'
      },
      speed: {
        enabled: true,  // On by default
        frequency: 'low',
        intensity: 2.0,
        mode: 'modulate'
      },
      count: {
        enabled: false,
        frequency: 'mid',
        intensity: 1.0,
        mode: 'trigger'  // Triggers at threshold rather than continuous
      }
    }
  },

  stars: {
    name: 'STARS',
    description: 'Orbital stars with perspective and depth',
    controls: {
      hue: {},
      saturation: {},
      speed: {},
      count: {},
      brightness: {},
      twinkleRate: {
        type: 'slider',
        label: 'TWINKLE RATE',
        min: 1,
        max: 50,
        step: 1,
        default: 20,
        unit: '',
        audioReactive: true
      },
      zSpeed: {
        type: 'slider',
        label: 'Z-AXIS SPEED',
        min: 0,
        max: 5,
        step: 0.1,
        default: 0,
        unit: '',
        audioReactive: true
      }
    },
    audioReactivity: {
      speed: { enabled: true, frequency: 'low', intensity: 3.0, mode: 'modulate' },
      brightness: { enabled: true, frequency: 'mid', intensity: 0.3, mode: 'modulate' },
      zSpeed: { enabled: false, frequency: 'high', intensity: 1.0, mode: 'modulate' }
    }
  },

  neon: {
    name: 'NEON',
    description: 'Vibrant gradient mesh with glow effects',
    controls: {
      colorMode: {
        type: 'buttonGroup',
        label: 'COLOR MODE',
        options: [
          { value: 'bright', label: 'BRIGHT' },
          { value: 'gray', label: 'GRAY' },
          { value: 'pastel', label: 'PASTEL' }
        ],
        default: 'bright',
        audioReactive: false
      },
      warmCool: {
        type: 'slider',
        label: 'WARM/COOL',
        min: 0,
        max: 2,
        step: 0.1,
        default: 1.0,
        unit: '',
        audioReactive: true
      }
    },
    audioReactivity: {
      warmCool: { enabled: false, frequency: 'mid', intensity: 0.5, mode: 'modulate' }
    }
  },

  linear: {
    name: 'LINEAR',
    description: 'Classic wave grid with multiple motion modes',
    controls: {
      mode: {
        type: 'buttonGroup',
        label: 'MODE',
        options: [
          { value: 'default', label: 'FLOW' },
          { value: 'hole', label: 'HOLE' },
          { value: 'crunch', label: 'CRUNCH' }
        ],
        default: 'default',
        audioReactive: false
      },
      density: {}
    },
    audioReactivity: {}  // Uses global frequency emphasis
  },

  glitch: {
    name: 'GLITCH',
    description: 'Distorted image effects with RGB separation',
    controls: {
      mode: {
        type: 'buttonGroup',
        label: 'MODE',
        options: [
          { value: 'rgb', label: 'RGB' },
          { value: 'br', label: 'B&R' },
          { value: 'gray', label: 'GRAY' }
        ],
        default: 'rgb',
        audioReactive: false
      },
      rotation: {},
      glitchIntensity: {},
      contrast: {}
    },
    audioReactivity: {
      rotation: { enabled: true, frequency: 'mid', intensity: 1.0, mode: 'modulate' },
      glitchIntensity: { enabled: true, frequency: 'high', intensity: 1.0, mode: 'modulate' },
      contrast: { enabled: false, frequency: 'low', intensity: 0.5, mode: 'modulate' }
    }
  }
};
```

### 3. Media Configurations

Same structure for media controls:

```javascript
const MEDIA_CONFIGS = {
  image: {
    name: 'IMAGE',
    controls: {
      transparency: {
        type: 'slider',
        label: 'TRANSPARENCY',
        min: 0,
        max: 1,
        step: 0.05,
        default: 1.0,
        audioReactive: true
      },
      rotation: {},
      blur: {
        type: 'slider',
        label: 'BLUR',
        min: 0,
        max: 20,
        step: 0.5,
        default: 0,
        audioReactive: true
      },
      motion3D: {
        type: 'slider',
        label: '3D MOTION',
        min: 0,
        max: 2,
        step: 0.1,
        default: 0,
        audioReactive: true
      },
      flashFrequency: {
        type: 'toggle',
        label: 'FREQUENCY FLASH',
        default: false,
        audioReactive: true
      },
      flashVolume: {
        type: 'toggle',
        label: 'VOLUME FLASH',
        default: false,
        audioReactive: true
      }
    },
    audioReactivity: {
      transparency: { enabled: false, frequency: 'low', intensity: 0.3, mode: 'modulate' },
      rotation: { enabled: false, frequency: 'mid', intensity: 1.0, mode: 'modulate' },
      blur: { enabled: false, frequency: 'high', intensity: 1.0, mode: 'modulate' },
      motion3D: { enabled: false, frequency: 'low', intensity: 1.0, mode: 'modulate' }
    }
  },

  video: {
    name: 'VIDEO',
    extends: 'image',  // Inherit image controls
    controls: {
      loop: {
        type: 'toggle',
        label: 'LOOP',
        default: false,
        audioReactive: false
      },
      trimStart: {
        type: 'slider',
        label: 'TRIM START',
        min: 0,
        max: 100,
        step: 0.1,
        default: 0,
        unit: 's',
        audioReactive: false
      },
      trimEnd: {
        type: 'slider',
        label: 'TRIM END',
        min: 0,
        max: 100,
        step: 0.1,
        default: 100,
        unit: 's',
        audioReactive: false
      }
    }
  }
};
```

### 4. Dynamic UI Generation

Generate control UI from configurations:

```javascript
class ControlSystemUI {
  constructor(containerElement) {
    this.container = containerElement;
    this.controlElements = new Map();
    this.audioToggles = new Map();
  }

  renderThemeControls(themeName) {
    const themeConfig = THEME_CONFIGS[themeName];
    const section = document.createElement('section');
    section.className = 'control-section';
    section.id = `${themeName}ControlsSection`;

    // Theme title
    const title = document.createElement('h3');
    title.textContent = themeConfig.name;
    section.appendChild(title);

    // Render each control
    for (const [controlId, controlConfig] of Object.entries(themeConfig.controls)) {
      const controlDef = { ...CONTROL_REGISTRY[controlId], ...controlConfig };
      const controlGroup = this.createControlGroup(controlId, controlDef, themeName);
      section.appendChild(controlGroup);
    }

    return section;
  }

  createControlGroup(controlId, controlDef, context) {
    const group = document.createElement('div');
    group.className = 'control-group';

    // Control label and value display
    const label = this.createControlLabel(controlDef);
    group.appendChild(label);

    // Control input (slider, select, etc.)
    const input = this.createControlInput(controlId, controlDef, context);
    group.appendChild(input);

    // Audio reactivity toggle (if applicable)
    if (controlDef.audioReactive) {
      const audioToggle = this.createAudioToggle(controlId, context);
      group.appendChild(audioToggle);
    }

    return group;
  }

  createControlLabel(controlDef) {
    const label = document.createElement('div');
    label.className = 'control-label';

    const span = document.createElement('span');
    span.textContent = controlDef.label;
    label.appendChild(span);

    // Value display for sliders
    if (controlDef.type === 'slider') {
      const valueSpan = document.createElement('span');
      valueSpan.className = 'control-value';
      valueSpan.textContent = `${controlDef.default}${controlDef.unit}`;
      label.appendChild(valueSpan);
    }

    return label;
  }

  createControlInput(controlId, controlDef, context) {
    switch (controlDef.type) {
      case 'slider':
        return this.createSlider(controlId, controlDef, context);
      case 'select':
        return this.createSelect(controlId, controlDef, context);
      case 'buttonGroup':
        return this.createButtonGroup(controlId, controlDef, context);
      case 'toggle':
        return this.createToggle(controlId, controlDef, context);
      default:
        console.error(`Unknown control type: ${controlDef.type}`);
        return document.createElement('div');
    }
  }

  createSlider(controlId, controlDef, context) {
    const slider = document.createElement('input');
    slider.type = 'range';
    slider.id = `${context}_${controlId}`;
    slider.min = controlDef.min;
    slider.max = controlDef.max;
    slider.step = controlDef.step;
    slider.value = controlDef.default;

    // Event listener
    slider.addEventListener('input', (e) => {
      const value = parseFloat(e.target.value);
      this.handleControlChange(controlId, value, context);
    });

    this.controlElements.set(`${context}_${controlId}`, slider);
    return slider;
  }

  createAudioToggle(controlId, context) {
    const toggleContainer = document.createElement('div');
    toggleContainer.className = 'audio-toggle-container';

    // Audio icon/indicator
    const icon = document.createElement('span');
    icon.className = 'audio-icon';
    icon.textContent = '🎵';
    icon.title = 'Audio Reactive';

    // Toggle checkbox
    const toggle = document.createElement('input');
    toggle.type = 'checkbox';
    toggle.className = 'audio-toggle';
    toggle.id = `${context}_${controlId}_audio`;

    const themeConfig = THEME_CONFIGS[context];
    const audioConfig = themeConfig?.audioReactivity?.[controlId];
    if (audioConfig) {
      toggle.checked = audioConfig.enabled;
    }

    // Frequency selector (dropdown)
    const freqSelect = document.createElement('select');
    freqSelect.className = 'audio-frequency-select';
    freqSelect.innerHTML = `
      <option value="low">LOW</option>
      <option value="mid">MID</option>
      <option value="high">HIGH</option>
    `;
    if (audioConfig) {
      freqSelect.value = audioConfig.frequency;
    }
    freqSelect.style.display = toggle.checked ? 'inline-block' : 'none';

    // Intensity slider (0-2)
    const intensitySlider = document.createElement('input');
    intensitySlider.type = 'range';
    intensitySlider.className = 'audio-intensity-slider';
    intensitySlider.min = 0;
    intensitySlider.max = 2;
    intensitySlider.step = 0.1;
    intensitySlider.value = audioConfig?.intensity || 1.0;
    intensitySlider.style.display = toggle.checked ? 'inline-block' : 'none';

    // Event listeners
    toggle.addEventListener('change', (e) => {
      const enabled = e.target.checked;
      freqSelect.style.display = enabled ? 'inline-block' : 'none';
      intensitySlider.style.display = enabled ? 'inline-block' : 'none';
      this.handleAudioToggle(controlId, context, enabled);
    });

    freqSelect.addEventListener('change', (e) => {
      this.handleFrequencyChange(controlId, context, e.target.value);
    });

    intensitySlider.addEventListener('input', (e) => {
      this.handleIntensityChange(controlId, context, parseFloat(e.target.value));
    });

    toggleContainer.appendChild(icon);
    toggleContainer.appendChild(toggle);
    toggleContainer.appendChild(freqSelect);
    toggleContainer.appendChild(intensitySlider);

    this.audioToggles.set(`${context}_${controlId}`, { toggle, freqSelect, intensitySlider });
    return toggleContainer;
  }

  handleControlChange(controlId, value, context) {
    // Update state
    if (!state.settings[context]) {
      state.settings[context] = {};
    }
    state.settings[context][controlId] = value;

    // Update value display
    const controlDef = CONTROL_REGISTRY[controlId];
    const valueDisplay = document.querySelector(`#${context}_${controlId}`).parentElement.querySelector('.control-value');
    if (valueDisplay && controlDef) {
      valueDisplay.textContent = `${value.toFixed(controlDef.step < 1 ? 1 : 0)}${controlDef.unit}`;
    }

    // Trigger reinitialization if required
    if (controlDef.requiresReinit && state[context]) {
      state[context].initialized = false;
    }

    // Send to companion if connected
    sendStateToMobile();
  }

  handleAudioToggle(controlId, context, enabled) {
    if (!state.audioReactivity) state.audioReactivity = {};
    if (!state.audioReactivity[context]) state.audioReactivity[context] = {};

    if (!state.audioReactivity[context][controlId]) {
      const themeConfig = THEME_CONFIGS[context];
      const defaultConfig = themeConfig?.audioReactivity?.[controlId] || {
        frequency: 'mid',
        intensity: 1.0,
        mode: 'modulate'
      };
      state.audioReactivity[context][controlId] = { ...defaultConfig };
    }

    state.audioReactivity[context][controlId].enabled = enabled;
  }

  handleFrequencyChange(controlId, context, frequency) {
    if (!state.audioReactivity?.[context]?.[controlId]) return;
    state.audioReactivity[context][controlId].frequency = frequency;
  }

  handleIntensityChange(controlId, context, intensity) {
    if (!state.audioReactivity?.[context]?.[controlId]) return;
    state.audioReactivity[context][controlId].intensity = intensity;
  }
}
```

### 5. Audio Modulation Engine

Process audio reactivity in a centralized way:

```javascript
class AudioModulationEngine {
  constructor() {
    this.baseValues = new Map();  // Store original values
  }

  /**
   * Apply audio modulation to all enabled controls
   */
  applyModulation(audioLevels, context) {
    if (!state.audioReactivity?.[context]) return;

    for (const [controlId, audioConfig] of Object.entries(state.audioReactivity[context])) {
      if (!audioConfig.enabled) continue;

      const baseValue = state.settings[context][controlId];
      const audioLevel = audioLevels[audioConfig.frequency];  // 0-1
      const controlDef = CONTROL_REGISTRY[controlId];

      if (!controlDef) continue;

      let modulatedValue;

      if (audioConfig.mode === 'modulate') {
        // Continuous modulation based on audio level
        const range = controlDef.max - controlDef.min;
        const modulation = (audioLevel - 0.5) * range * audioConfig.intensity;
        modulatedValue = baseValue + modulation;
        modulatedValue = Math.max(controlDef.min, Math.min(controlDef.max, modulatedValue));
      } else if (audioConfig.mode === 'trigger') {
        // Trigger at threshold
        const threshold = audioConfig.threshold || 0.5;
        if (audioLevel > threshold) {
          modulatedValue = controlDef.max;
        } else {
          modulatedValue = baseValue;
        }
      }

      // Store modulated value in separate object so we don't overwrite base
      if (!state.modulatedValues) state.modulatedValues = {};
      if (!state.modulatedValues[context]) state.modulatedValues[context] = {};
      state.modulatedValues[context][controlId] = modulatedValue;
    }
  }

  /**
   * Get the current value for a control (modulated or base)
   */
  getValue(context, controlId) {
    // Check if there's a modulated value
    if (state.modulatedValues?.[context]?.[controlId] !== undefined) {
      return state.modulatedValues[context][controlId];
    }
    // Fall back to base value
    return state.settings[context]?.[controlId];
  }
}
```

### 6. Renderer Integration

Update renderers to use the modulation engine:

```javascript
function drawLinesWave() {
  const theme = config.themes.wave;
  const { low, mid, high } = state.audioLevels;

  // Apply audio modulation
  audioEngine.applyModulation({ low, mid, high }, 'wave');

  // Get values (will be modulated if audio reactivity is enabled)
  const hue = audioEngine.getValue('wave', 'hue');
  const saturation = audioEngine.getValue('wave', 'saturation');
  const speed = audioEngine.getValue('wave', 'speed');
  const mode = audioEngine.getValue('wave', 'visualMode');

  // Use these values in rendering...
  // ...
}
```

## Benefits

1. **Consistency**: All themes use the same control structure
2. **Extensibility**: Adding a new theme is just adding a config object
3. **Granular audio control**: Per-control audio toggles with frequency and intensity
4. **Less code**: UI generation and event handling is centralized
5. **Type safety**: Could add TypeScript for compile-time validation
6. **Easy presets**: Save/load entire configurations as JSON
7. **A/B testing**: Easy to experiment with different control combinations
8. **Documentation**: Control definitions serve as documentation

## Migration Path

1. **Phase 1**: Create control registry and theme configs alongside existing code
2. **Phase 2**: Implement UI generation system
3. **Phase 3**: Add audio modulation engine
4. **Phase 4**: Migrate one theme at a time to new system
5. **Phase 5**: Remove old control code once all themes migrated

## Future Enhancements

- **Presets**: Save/load control configurations
- **MIDI mapping**: Map MIDI controllers to controls
- **Automation**: Record and playback control changes
- **Control linking**: Link controls together (e.g., hue follows saturation)
- **Custom controls**: Plugin system for theme-specific controls
- **Visual feedback**: Show audio reactivity in real-time on controls
- **Per-frequency intensity**: Different intensities for low/mid/high on same control
