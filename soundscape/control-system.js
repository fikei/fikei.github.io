// =====================================================
// UNIFIED CONTROL SYSTEM
// =====================================================
// Provides consistent, extensible control system across all themes
// with granular per-control audio reactivity

// =====================================================
// 1. AUDIO SOURCES - All Possible Audio Modulation Types
// =====================================================

const AUDIO_SOURCES = {
  // Basic
  none: {
    label: 'Static',
    category: 'basic',
    description: 'No audio modulation'
  },

  // Frequency Bands
  allLevels: {
    label: 'All Levels (Combined)',
    category: 'frequency',
    description: 'Average of all frequencies'
  },
  subBass: {
    label: 'Sub-Bass (20-60 Hz)',
    category: 'frequency',
    description: 'Deepest bass frequencies'
  },
  bass: {
    label: 'Bass (60-250 Hz)',
    category: 'frequency',
    description: 'Kick drums, bass guitar'
  },
  lowMids: {
    label: 'Low-Mids (250-500 Hz)',
    category: 'frequency',
    description: 'Body of instruments, warmth'
  },
  mids: {
    label: 'Mids (500-2000 Hz)',
    category: 'frequency',
    description: 'Vocals, lead instruments'
  },
  highMids: {
    label: 'High-Mids (2000-4000 Hz)',
    category: 'frequency',
    description: 'Clarity, presence'
  },
  highs: {
    label: 'Highs (4000-8000 Hz)',
    category: 'frequency',
    description: 'Cymbals, sibilance'
  },
  brilliance: {
    label: 'Brilliance (8000-20000 Hz)',
    category: 'frequency',
    description: 'Air, sparkle, shimmer'
  },

  // Amplitude
  peak: {
    label: 'Peak Level',
    category: 'amplitude',
    description: 'Maximum amplitude in current frame'
  },
  rms: {
    label: 'RMS (Loudness)',
    category: 'amplitude',
    description: 'Root Mean Square (perceived loudness)'
  },
  decibels: {
    label: 'Decibels (dB)',
    category: 'amplitude',
    description: 'Logarithmic volume measurement'
  },

  // Rhythm
  beat: {
    label: 'Beat Detection (Kick)',
    category: 'rhythm',
    description: 'Detects kick drum hits/beats'
  },
  onset: {
    label: 'Onset Detection',
    category: 'rhythm',
    description: 'Detects any note/sound starts'
  },
  bpm: {
    label: 'BPM (Tempo)',
    category: 'rhythm',
    description: 'Beats per minute (for speed scaling)'
  },

  // Dynamics
  attack: {
    label: 'Attack (Sudden Hits)',
    category: 'dynamics',
    description: 'Rate of sudden volume increases'
  },
  transients: {
    label: 'Transients (Percussive)',
    category: 'dynamics',
    description: 'Sharp percussive hits'
  },
  envelope: {
    label: 'Envelope Follower',
    category: 'dynamics',
    description: 'Overall volume contour over time'
  },

  // Spectral (Meyda)
  centroid: {
    label: 'Spectral Centroid (Brightness)',
    category: 'spectral',
    description: 'Where most frequency energy is located'
  },
  flux: {
    label: 'Spectral Flux (Change Rate)',
    category: 'spectral',
    description: 'Rate of spectral change'
  },
  rolloff: {
    label: 'Spectral Rolloff',
    category: 'spectral',
    description: 'Frequency below which 85% of energy is'
  },
  flatness: {
    label: 'Spectral Flatness',
    category: 'spectral',
    description: 'Tonality vs noisiness (0=tonal, 1=noise)'
  },
  spread: {
    label: 'Spectral Spread (Variance)',
    category: 'spectral',
    description: 'Frequency distribution variance'
  },
  loudness: {
    label: 'Loudness (Perceptual)',
    category: 'amplitude',
    description: 'Perceived loudness (psychoacoustic)'
  },
  zcr: {
    label: 'Zero Crossing Rate',
    category: 'spectral',
    description: 'Noisiness/percussiveness measure'
  },

  // Musical (Meyda)
  chroma: {
    label: 'Chroma (Pitch Classes)',
    category: 'musical',
    description: 'Average pitch class energy'
  },
  pitch: {
    label: 'Pitch Detection',
    category: 'musical',
    description: 'Fundamental frequency'
  },
  harmonic: {
    label: 'Harmonic Energy',
    category: 'musical',
    description: 'Strength of harmonic content'
  },

  // Custom
  customRange: {
    label: 'Custom Frequency Range...',
    category: 'custom',
    description: 'Specify exact Hz range'
  }
};

// =====================================================
// 2. CONTROL REGISTRY - Centralized Control Definitions
// =====================================================

const CONTROL_REGISTRY = {

  // ═══════════════════════════════════════════════════════
  // COLOR CONTROLS
  // ═══════════════════════════════════════════════════════

  hue: {
    type: 'slider',
    label: 'HUE',
    min: 0,
    max: 360,
    step: 1,
    default: 280,
    unit: '°',
    category: 'color',
    audioReactive: true,
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
    category: 'color',
    audioReactive: true,
    description: 'Overall brightness level'
  },

  lightness: {
    type: 'slider',
    label: 'LIGHTNESS',
    min: 0,
    max: 100,
    step: 1,
    default: 50,
    unit: '%',
    category: 'color',
    audioReactive: true,
    description: 'Lightness in HSL color space'
  },

  opacity: {
    type: 'slider',
    label: 'OPACITY',
    min: 0,
    max: 1,
    step: 0.05,
    default: 1.0,
    unit: '',
    category: 'color',
    audioReactive: true,
    description: 'Overall opacity/transparency'
  },

  minOpacity: {
    type: 'slider',
    label: 'MIN OPACITY',
    min: 0,
    max: 1,
    step: 0.05,
    default: 0.2,
    unit: '',
    category: 'color',
    audioReactive: true,
    description: 'Minimum opacity threshold'
  },

  maxOpacity: {
    type: 'slider',
    label: 'MAX OPACITY',
    min: 0,
    max: 1,
    step: 0.05,
    default: 1.0,
    unit: '',
    category: 'color',
    audioReactive: true,
    description: 'Maximum opacity threshold'
  },

  warmCool: {
    type: 'slider',
    label: 'WARM/COOL',
    min: 0,
    max: 2,
    step: 0.1,
    default: 1.0,
    unit: '',
    category: 'color',
    audioReactive: true,
    description: 'Color temperature adjustment'
  },

  // ═══════════════════════════════════════════════════════
  // MOTION CONTROLS
  // ═══════════════════════════════════════════════════════

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

  rotationX: {
    type: 'slider',
    label: 'ROTATION X',
    min: 0,
    max: 5,
    step: 0.1,
    default: 0.3,
    unit: '',
    category: 'motion',
    audioReactive: true,
    description: 'X-axis rotation'
  },

  rotationY: {
    type: 'slider',
    label: 'ROTATION Y',
    min: 0,
    max: 5,
    step: 0.1,
    default: 0.3,
    unit: '',
    category: 'motion',
    audioReactive: true,
    description: 'Y-axis rotation'
  },

  zSpeed: {
    type: 'slider',
    label: 'Z-AXIS SPEED',
    min: 0,
    max: 5,
    step: 0.1,
    default: 0,
    unit: '',
    category: 'motion',
    audioReactive: true,
    description: 'Depth movement speed'
  },

  backgroundShift: {
    type: 'slider',
    label: 'BACKGROUND SHIFT',
    min: 0,
    max: 5,
    step: 0.1,
    default: 1.0,
    unit: 'x',
    category: 'motion',
    audioReactive: true,
    description: 'Global camera shift intensity (bass-reactive)'
  },

  smoothing: {
    type: 'slider',
    label: 'SMOOTHING',
    min: 0,
    max: 1,
    step: 0.1,
    default: 0.5,
    unit: '',
    category: 'motion',
    audioReactive: false,
    description: 'Motion smoothing factor'
  },

  // ═══════════════════════════════════════════════════════
  // GEOMETRY CONTROLS
  // ═══════════════════════════════════════════════════════

  count: {
    type: 'slider',
    label: 'COUNT',
    min: 100,
    max: 2000,
    step: 100,
    default: 1200,
    unit: '',
    category: 'geometry',
    audioReactive: true,
    requiresReinit: true,
    description: 'Number of elements'
  },

  points: {
    type: 'slider',
    label: 'POINTS',
    min: 3,
    max: 20,
    step: 1,
    default: 8,
    unit: '',
    category: 'geometry',
    audioReactive: true,
    requiresReinit: true,
    description: 'Number of points in grid'
  },

  spread: {
    type: 'slider',
    label: 'SPREAD',
    min: 20,
    max: 300,
    step: 10,
    default: 100,
    unit: '',
    category: 'geometry',
    audioReactive: true,
    description: 'Spacing/spread of elements'
  },

  amplitude: {
    type: 'slider',
    label: 'AMPLITUDE',
    min: 0,
    max: 3,
    step: 0.1,
    default: 1.0,
    unit: 'x',
    category: 'geometry',
    audioReactive: true,
    description: 'Wave amplitude multiplier'
  },

  wavelength: {
    type: 'slider',
    label: 'WAVELENGTH',
    min: 10,
    max: 200,
    step: 5,
    default: 50,
    unit: '',
    category: 'geometry',
    audioReactive: true,
    description: 'Wave pattern wavelength'
  },

  lineWidth: {
    type: 'slider',
    label: 'LINE WIDTH',
    min: 0.5,
    max: 10,
    step: 0.5,
    default: 3,
    unit: 'px',
    category: 'geometry',
    audioReactive: true,
    description: 'Stroke width of lines'
  },

  diameter: {
    type: 'slider',
    label: 'DIAMETER',
    min: 0.5,
    max: 2,
    step: 0.1,
    default: 1.0,
    unit: 'x',
    category: 'geometry',
    audioReactive: true,
    requiresReinit: true,
    description: 'Element size multiplier'
  },

  layers: {
    type: 'slider',
    label: 'LAYERS',
    min: 1,
    max: 10,
    step: 1,
    default: 3,
    unit: '',
    category: 'geometry',
    audioReactive: true,
    description: 'Number of visual layers'
  },

  perspective: {
    type: 'slider',
    label: 'PERSPECTIVE',
    min: 0,
    max: 2,
    step: 0.1,
    default: 1.0,
    unit: '',
    category: 'geometry',
    audioReactive: true,
    description: 'Perspective depth effect'
  },

  depth: {
    type: 'slider',
    label: 'DEPTH',
    min: 0,
    max: 2,
    step: 0.1,
    default: 1.0,
    unit: '',
    category: 'geometry',
    audioReactive: true,
    description: 'Z-depth intensity'
  },

  burstSize: {
    type: 'slider',
    label: 'BURST SIZE',
    min: 0.5,
    max: 3,
    step: 0.1,
    default: 1.0,
    unit: 'x',
    category: 'geometry',
    audioReactive: true,
    description: 'Size of burst elements'
  },

  meshDensity: {
    type: 'slider',
    label: 'MESH DENSITY',
    min: 4,
    max: 16,
    step: 1,
    default: 8,
    unit: '',
    category: 'geometry',
    audioReactive: true,
    description: 'Density of mesh grid'
  },

  movement: {
    type: 'slider',
    label: 'MOVEMENT',
    min: 0,
    max: 3,
    step: 0.1,
    default: 1.0,
    unit: 'x',
    category: 'geometry',
    audioReactive: true,
    description: 'Movement amplitude'
  },

  // ═══════════════════════════════════════════════════════
  // EFFECTS CONTROLS
  // ═══════════════════════════════════════════════════════

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
  },

  twinkleRate: {
    type: 'slider',
    label: 'TWINKLE RATE',
    min: 1,
    max: 50,
    step: 1,
    default: 20,
    unit: '',
    category: 'effects',
    audioReactive: true,
    description: 'Star twinkle frequency'
  },

  glow: {
    type: 'slider',
    label: 'GLOW',
    min: 0,
    max: 3,
    step: 0.1,
    default: 1.0,
    unit: 'x',
    category: 'effects',
    audioReactive: true,
    description: 'Glow/bloom intensity'
  },

  blur: {
    type: 'slider',
    label: 'BLUR',
    min: 0,
    max: 20,
    step: 1,
    default: 0,
    unit: 'px',
    category: 'effects',
    audioReactive: true,
    description: 'Blur radius'
  },

  displacement: {
    type: 'slider',
    label: 'DISPLACEMENT',
    min: 0,
    max: 50,
    step: 1,
    default: 10,
    unit: 'px',
    category: 'effects',
    audioReactive: true,
    description: 'Displacement map intensity'
  },

  channelOffset: {
    type: 'slider',
    label: 'RGB OFFSET',
    min: 0,
    max: 30,
    step: 1,
    default: 5,
    unit: 'px',
    category: 'effects',
    audioReactive: true,
    description: 'RGB channel separation'
  },

  scanlines: {
    type: 'slider',
    label: 'SCANLINES',
    min: 0,
    max: 1,
    step: 0.05,
    default: 0,
    unit: '',
    category: 'effects',
    audioReactive: true,
    description: 'CRT scanline effect'
  },

  noise: {
    type: 'slider',
    label: 'NOISE',
    min: 0,
    max: 1,
    step: 0.05,
    default: 0,
    unit: '',
    category: 'effects',
    audioReactive: true,
    description: 'Static noise overlay'
  },

  pixelation: {
    type: 'slider',
    label: 'PIXELATION',
    min: 1,
    max: 50,
    step: 1,
    default: 1,
    unit: 'px',
    category: 'effects',
    audioReactive: true,
    description: 'Pixel size for pixelation'
  },

  chromaticAberration: {
    type: 'slider',
    label: 'CHROMATIC ABB',
    min: 0,
    max: 20,
    step: 1,
    default: 0,
    unit: 'px',
    category: 'effects',
    audioReactive: true,
    description: 'Chromatic aberration effect'
  },

  trailLength: {
    type: 'slider',
    label: 'TRAIL LENGTH',
    min: 0,
    max: 1,
    step: 0.05,
    default: 0,
    unit: '',
    category: 'effects',
    audioReactive: true,
    description: 'Motion trail/echo length'
  },

  bloom: {
    type: 'slider',
    label: 'BLOOM',
    min: 0,
    max: 2,
    step: 0.1,
    default: 0,
    unit: '',
    category: 'effects',
    audioReactive: true,
    description: 'Bloom/glow effect'
  },

  turbulence: {
    type: 'slider',
    label: 'TURBULENCE',
    min: 0,
    max: 2,
    step: 0.1,
    default: 0,
    unit: '',
    category: 'effects',
    audioReactive: true,
    description: 'Turbulence distortion'
  },

  phaseShift: {
    type: 'slider',
    label: 'PHASE SHIFT',
    min: 0,
    max: Math.PI * 2,
    step: 0.1,
    default: 0,
    unit: '',
    category: 'effects',
    audioReactive: true,
    description: 'Wave phase offset'
  },

  // ═══════════════════════════════════════════════════════
  // AUDIO CONTROLS
  // ═══════════════════════════════════════════════════════

  audioBoost: {
    type: 'slider',
    label: 'AUDIO BOOST',
    min: 0,
    max: 10,
    step: 0.5,
    default: 3.0,
    unit: 'x',
    category: 'audio',
    audioReactive: false,
    description: 'Audio reactivity strength multiplier'
  }
};

// =====================================================
// 2.5 VALUE FORMATTERS - Simple value display (no descriptions)
// =====================================================

const VALUE_FORMATTERS = {
  backgroundShift: (val) => `±${Math.round(val * 20)}px`,
  twinkleRate: (val) => `${((1 / val) * 100).toFixed(1)}% per frame`,
  opacity: (val) => `${Math.round(val * 100)}%`,
  minOpacity: (val) => `${Math.round(val * 100)}%`,
  maxOpacity: (val) => `${Math.round(val * 100)}%`,
  speed: (val) => val === 0 ? '0' : `${val}×`,
  zSpeed: (val) => val.toFixed(1),
  hue: (val) => `${Math.round(val)}°`,
  saturation: (val) => `${Math.round(val)}%`,
  brightness: (val) => `${Math.round(val * 100)}%`,
  lightness: (val) => `${Math.round(val)}%`,
  rotation: (val) => `${Math.round(val)}°`,
  rotationX: (val) => val.toFixed(1),
  rotationY: (val) => val.toFixed(1),
  amplitude: (val) => val.toFixed(1),
  wavelength: (val) => `${Math.round(val)}px`,
  spread: (val) => `${Math.round(val)}px`,
  lineWidth: (val) => `${Math.round(val)}px`,
  burstSize: (val) => val.toFixed(1),
  movement: (val) => val.toFixed(1),
  glow: (val) => val.toFixed(1),
  blur: (val) => `${Math.round(val)}px`,
  meshDensity: (val) => Math.round(val).toString(),
  responsiveness: (val) => `${val.toFixed(1)}×`,
  smoothing: (val) => `${Math.round(val * 100)}%`,
  warmCool: (val) => val.toFixed(1),
  cycleSpeed: (val) => `${val.toFixed(2)}×`,
  glitchIntensity: (val) => val.toFixed(1),
  channelOffset: (val) => `${Math.round(val)}px`,
  displacement: (val) => `${Math.round(val)}px`,
  contrast: (val) => val.toFixed(1),
  scanlines: (val) => val.toFixed(1),
  noise: (val) => val.toFixed(1),
  pixelation: (val) => `${Math.round(val)}px`,
  diameter: (val) => `${val.toFixed(1)}×`,
  count: (val) => Math.round(val).toString(),
  perspective: (val) => val.toFixed(1),
  trailLength: (val) => val.toFixed(1),
  bloom: (val) => val.toFixed(1),
  audioBoost: (val) => val.toFixed(1),
  layers: (val) => Math.round(val).toString(),
  depth: (val) => val.toFixed(1),
  turbulence: (val) => val.toFixed(1),
  phaseShift: (val) => val.toFixed(2),
  points: (val) => Math.round(val).toString(),

  // Default formatter for any control without a specific formatter
  default: (val) => {
    if (typeof val === 'number') {
      return val % 1 === 0 ? val.toString() : val.toFixed(2);
    }
    return val.toString();
  }
};

// Helper function to get formatted value
function getFormattedValue(controlId, value) {
  const formatter = VALUE_FORMATTERS[controlId] || VALUE_FORMATTERS.default;
  return formatter(value);
}

// =====================================================
// 3. THEME CONFIGURATIONS
// =====================================================

const THEME_CONFIGS = {

  // ─────────────────────────────────────────────────────────
  // LINEAR THEME
  // ─────────────────────────────────────────────────────────
  linear: {
    name: 'LINEAR',
    description: 'Classic wave grid with multiple motion modes',
    controls: {
      // Style
      visualMode: {
        type: 'buttonGroup',
        label: 'MODE',
        options: [
          { value: 'default', label: 'FLOW' },
          { value: 'hole', label: 'HOLE' },
          { value: 'crunch', label: 'CRUNCH' }
        ],
        default: 'hole',
        category: 'style',
        audioReactive: false
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
        category: 'style',
        audioReactive: false,
        requiresReinit: true
      },

      // Geometry
      spread: {
        default: 12,
        category: 'geometry'
      },
      amplitude: {
        default: 1.0,
        category: 'geometry'
      },
      lineWidth: {
        default: 3,
        category: 'geometry'
      },

      // Color
      hue: {
        default: 280,
        category: 'color'
      },
      saturation: {
        default: 0,
        category: 'color'
      },
      opacity: {
        default: 0.6,
        category: 'color'
      },

      // Motion
      backgroundShift: {
        default: 1.0,
        category: 'motion'
      },
      bpmSync: {
        type: 'buttonGroup',
        label: 'BPM SYNC',
        options: [
          { value: 'off', label: 'OFF' },
          { value: '1x', label: '1X' },
          { value: '2x', label: '2X' },
          { value: '0.5x', label: '0.5X' },
          { value: '4x', label: '4X' }
        ],
        default: 'off',
        category: 'motion',
        audioReactive: false,
        description: 'Lock animation speed to detected BPM'
      }
    },
    audioReactivity: {
      // Original: Amplitude responds to overall audio (physics-based)
      amplitude: { enabled: true, frequency: 'allLevels', intensity: 0.7, mode: 'modulate' },

      // All other controls default to Static (None)
      spread: { enabled: false, frequency: 'none', intensity: 0.5, mode: 'modulate' },
      lineWidth: { enabled: false, frequency: 'none', intensity: 0.3, mode: 'modulate' },
      hue: { enabled: false, frequency: 'none', intensity: 0.6, mode: 'modulate' },
      saturation: { enabled: false, frequency: 'none', intensity: 0.3, mode: 'modulate' },
      opacity: { enabled: false, frequency: 'none', intensity: 0.4, mode: 'modulate' },
      backgroundShift: { enabled: true, frequency: 'bass', intensity: 1.0, mode: 'modulate' },
      bpmSync: { enabled: false, frequency: 'none', intensity: 0, mode: 'modulate' }
    }
  },

  // ─────────────────────────────────────────────────────────
  // NEON THEME
  // ─────────────────────────────────────────────────────────
  neon: {
    name: 'NEON',
    description: 'Vibrant gradient mesh with glow effects',
    controls: {
      // Style
      colorMode: {
        type: 'buttonGroup',
        label: 'COLOR MODE',
        options: [
          { value: 'bright', label: 'BRIGHT' },
          { value: 'gray', label: 'GRAY' },
          { value: 'pastel', label: 'PASTEL' }
        ],
        default: 'bright',
        category: 'style',
        audioReactive: false
      },
      colorChangeMode: {
        type: 'buttonGroup',
        label: 'COLOR CHANGE',
        options: [
          { value: 'static', label: 'STATIC' },
          { value: 'cycle', label: 'CYCLE' },
          { value: 'pulse', label: 'PULSE' },
          { value: 'reactive', label: 'REACTIVE' }
        ],
        default: 'static',
        category: 'style',
        audioReactive: false,
        description: 'How colors change over time'
      },

      // Color
      cycleSpeed: {
        type: 'slider',
        label: 'CYCLE SPEED',
        min: 0.01,
        max: 0.5,
        step: 0.01,
        default: 0.1,
        unit: 'x',
        category: 'color',
        audioReactive: false,
        visibleWhen: (state) => {
          const mode = state.settings?.neon?.colorChangeMode || 'static';
          return mode === 'cycle' || mode === 'pulse';
        },
        description: 'Speed of color cycling/pulsing'
      },
      warmCool: {
        default: 1.0,
        category: 'color'
      },
      hue: {
        default: 280,
        category: 'color'
      },
      saturation: {
        default: 70,
        category: 'color'
      },
      brightness: {
        default: 0.5,
        category: 'color',
        description: 'Overall brightness (0-1)'
      },

      // Geometry
      burstSize: {
        default: 1.0,
        category: 'geometry'
      },
      meshDensity: {
        default: 8,
        category: 'geometry'
      },

      // Motion
      movement: {
        default: 1.0,
        category: 'motion'
      },
      backgroundShift: {
        default: 1.0,
        category: 'motion'
      },
      responsiveness: {
        type: 'slider',
        label: 'RESPONSIVENESS',
        min: 0.1,
        max: 2.0,
        step: 0.1,
        default: 1.0,
        unit: 'x',
        category: 'motion',
        audioReactive: false,
        description: 'Speed of audio response'
      },
      smoothing: {
        type: 'slider',
        label: 'SMOOTHING',
        min: 0,
        max: 0.95,
        step: 0.05,
        default: 0.7,
        unit: '',
        category: 'motion',
        audioReactive: false,
        description: 'Movement smoothing amount'
      },
      bpmSync: {
        type: 'buttonGroup',
        label: 'BPM SYNC',
        options: [
          { value: 'off', label: 'OFF' },
          { value: '1x', label: '1X' },
          { value: '2x', label: '2X' },
          { value: '0.5x', label: '0.5X' },
          { value: '4x', label: '4X' }
        ],
        default: 'off',
        category: 'motion',
        audioReactive: false,
        description: 'Lock animation speed to detected BPM'
      },

      // Effects
      glow: {
        default: 1.5,
        category: 'effects'
      },
      blur: {
        default: 0,
        category: 'effects'
      }
    },
    audioReactivity: {
      // Original: Burst size, movement, and glow respond to audio
      burstSize: { enabled: true, frequency: 'bass', intensity: 0.7, mode: 'modulate' },
      movement: { enabled: true, frequency: 'bass', intensity: 0.8, mode: 'modulate' },
      glow: { enabled: true, frequency: 'allLevels', intensity: 0.6, mode: 'modulate' },

      // All other controls default to Static (None)
      warmCool: { enabled: false, frequency: 'none', intensity: 0.4, mode: 'modulate' },
      hue: { enabled: false, frequency: 'none', intensity: 0.6, mode: 'modulate' },
      saturation: { enabled: false, frequency: 'none', intensity: 0.3, mode: 'modulate' },
      brightness: { enabled: false, frequency: 'none', intensity: 0.4, mode: 'modulate' },
      meshDensity: { enabled: false, frequency: 'none', intensity: 0.3, mode: 'modulate' },
      blur: { enabled: false, frequency: 'none', intensity: 0.3, mode: 'modulate' },
      backgroundShift: { enabled: true, frequency: 'bass', intensity: 1.0, mode: 'modulate' },
      bpmSync: { enabled: false, frequency: 'none', intensity: 0, mode: 'modulate' }
    }
  },

  // ─────────────────────────────────────────────────────────
  // GLITCH THEME
  // ─────────────────────────────────────────────────────────
  glitch: {
    name: 'GLITCH',
    description: 'Distorted image effects with RGB separation',
    controls: {
      // Style
      visualMode: {
        type: 'buttonGroup',
        label: 'MODE',
        options: [
          { value: 'rgb', label: 'RGB' },
          { value: 'br', label: 'B&R' },
          { value: 'gray', label: 'GRAY' }
        ],
        default: 'rgb',
        category: 'style',
        audioReactive: false
      },

      // Motion - 3D rotation effects
      rotation: {
        default: 1.0,
        category: 'motion'
      },
      backgroundShift: {
        default: 1.0,
        category: 'motion'
      },
      bpmSync: {
        type: 'buttonGroup',
        label: 'BPM SYNC',
        options: [
          { value: 'off', label: 'OFF' },
          { value: '1x', label: '1X' },
          { value: '2x', label: '2X' },
          { value: '0.5x', label: '0.5X' },
          { value: '4x', label: '4X' }
        ],
        default: 'off',
        category: 'motion',
        audioReactive: false,
        description: 'Lock animation speed to detected BPM'
      },

      // Effects - Media manipulation
      glitchIntensity: {
        default: 1.0,
        category: 'effects'
      },
      channelOffset: {
        default: 5,
        category: 'effects'
      },
      displacement: {
        default: 10,
        category: 'effects'
      },
      contrast: {
        default: 1.0,
        category: 'effects'
      },
      scanlines: {
        default: 0,
        category: 'effects'
      },
      noise: {
        default: 0,
        category: 'effects'
      },
      pixelation: {
        default: 1,
        category: 'effects'
      }
    },
    audioReactivity: {
      // Original: Rotation (mids), glitch intensity (highs), channel offset (highs), displacement (all)
      rotation: { enabled: true, frequency: 'mids', intensity: 0.6, mode: 'modulate' },
      glitchIntensity: { enabled: true, frequency: 'highs', intensity: 0.6, mode: 'modulate' },
      channelOffset: { enabled: true, frequency: 'highs', intensity: 0.7, mode: 'modulate' },
      displacement: { enabled: true, frequency: 'allLevels', intensity: 0.5, mode: 'modulate' },

      // All other controls default to Static (None)
      contrast: { enabled: false, frequency: 'none', intensity: 0.3, mode: 'modulate' },
      scanlines: { enabled: false, frequency: 'none', intensity: 0.3, mode: 'modulate' },
      noise: { enabled: false, frequency: 'none', intensity: 0.4, mode: 'modulate' },
      pixelation: { enabled: false, frequency: 'none', intensity: 0.7, mode: 'modulate' },
      backgroundShift: { enabled: true, frequency: 'bass', intensity: 1.0, mode: 'modulate' },
      bpmSync: { enabled: false, frequency: 'none', intensity: 0, mode: 'modulate' }
    }
  },

  // ─────────────────────────────────────────────────────────
  // STARS THEME
  // ─────────────────────────────────────────────────────────
  stars: {
    name: 'STARS',
    description: 'Orbital stars with perspective and depth',
    controls: {
      // Color
      hue: {
        default: 44,
        category: 'color'
      },
      saturation: {
        default: 12,
        category: 'color'
      },

      // Motion
      speed: {
        default: 1.0,
        category: 'motion'
      },
      zSpeed: {
        default: 0,
        category: 'motion'
      },
      backgroundShift: {
        default: 1.0,
        category: 'motion'
      },
      smoothing: {
        default: 0.5,
        category: 'motion'
      },
      bpmSync: {
        type: 'buttonGroup',
        label: 'BPM SYNC',
        options: [
          { value: 'off', label: 'OFF' },
          { value: '1x', label: '1X' },
          { value: '2x', label: '2X' },
          { value: '0.5x', label: '0.5X' },
          { value: '4x', label: '4X' }
        ],
        default: 'off',
        category: 'motion',
        audioReactive: false,
        description: 'Lock animation speed to detected BPM'
      },

      // Appearance
      brightness: {
        default: 0.8,
        category: 'color'
      },
      minOpacity: {
        default: 0.2,
        category: 'color'
      },
      maxOpacity: {
        default: 1.0,
        category: 'color'
      },
      diameter: {
        default: 1.0,
        category: 'geometry'
      },

      // Effects
      twinkleRate: {
        default: 200,
        category: 'effects'
      },
      trailLength: {
        default: 0,
        category: 'effects'
      },
      bloom: {
        default: 0,
        category: 'effects'
      },

      // Geometry
      count: {
        default: 1200,
        category: 'geometry'
      },
      perspective: {
        default: 1.0,
        category: 'geometry'
      },

      // Audio
      audioBoost: {
        default: 3.0,
        category: 'audio'
      }
    },
    audioReactivity: {
      // Original: Speed (bass) and brightness (mids)
      speed: { enabled: true, frequency: 'bass', intensity: 0.7, mode: 'modulate' },
      brightness: { enabled: true, frequency: 'mids', intensity: 0.3, mode: 'modulate' },

      // All other controls default to Static (None)
      hue: { enabled: false, frequency: 'none', intensity: 0.6, mode: 'modulate' },
      saturation: { enabled: false, frequency: 'none', intensity: 0.3, mode: 'modulate' },
      zSpeed: { enabled: false, frequency: 'none', intensity: 0.4, mode: 'modulate' },
      backgroundShift: { enabled: true, frequency: 'bass', intensity: 1.0, mode: 'modulate' },
      minOpacity: { enabled: false, frequency: 'none', intensity: 0.3, mode: 'modulate' },
      maxOpacity: { enabled: false, frequency: 'none', intensity: 0.3, mode: 'modulate' },
      diameter: { enabled: false, frequency: 'none', intensity: 0.4, mode: 'modulate' },
      twinkleRate: { enabled: false, frequency: 'none', intensity: 0.4, mode: 'modulate' },
      trailLength: { enabled: false, frequency: 'none', intensity: 0.5, mode: 'modulate' },
      bloom: { enabled: false, frequency: 'none', intensity: 0.6, mode: 'modulate' },
      count: { enabled: false, frequency: 'none', intensity: 0.4, mode: 'modulate' },
      perspective: { enabled: false, frequency: 'none', intensity: 0.3, mode: 'modulate' },
      bpmSync: { enabled: false, frequency: 'none', intensity: 0, mode: 'modulate' }
    }
  },

  // ─────────────────────────────────────────────────────────
  // WAVE THEME
  // ─────────────────────────────────────────────────────────
  wave: {
    name: 'WAVE',
    description: 'Flowing orbital patterns with multiple rendering modes',
    controls: {
      // Style
      visualMode: {
        type: 'buttonGroup',
        label: 'MODE',
        options: [
          { value: 'planes', label: 'PLANES' },
          { value: 'grids', label: 'GRIDS' },
          { value: 'dots', label: 'DOTS' }
        ],
        default: 'planes',
        category: 'style',
        audioReactive: false
      },
      layers: {
        default: 3,
        category: 'geometry',
        visibleWhen: (state) => {
          const mode = state.settings?.wave?.visualMode || 'planes';
          return ['grids', 'dots'].includes(mode);
        }
      },

      // Color
      hue: {
        default: 280,
        category: 'color'
      },
      saturation: {
        default: 70,
        category: 'color'
      },

      // Geometry
      amplitude: {
        default: 1.2,
        category: 'geometry'
      },
      wavelength: {
        default: 50,
        category: 'geometry'
      },
      lineWidth: {
        default: 3,
        category: 'geometry'
      },

      // Motion
      rotationX: {
        default: 0.3,
        category: 'motion'
      },
      rotationY: {
        default: 0.3,
        category: 'motion'
      },
      speed: {
        default: 1.0,
        category: 'motion'
      },
      backgroundShift: {
        default: 1.0,
        category: 'motion'
      },
      bpmSync: {
        type: 'buttonGroup',
        label: 'BPM SYNC',
        options: [
          { value: 'off', label: 'OFF' },
          { value: '1x', label: '1X' },
          { value: '2x', label: '2X' },
          { value: '0.5x', label: '0.5X' },
          { value: '4x', label: '4X' }
        ],
        default: 'off',
        category: 'motion',
        audioReactive: false,
        description: 'Lock animation speed to detected BPM'
      },

      // Effects
      glow: {
        default: 0,
        category: 'effects'
      },
      perspective: {
        default: 1.0,
        category: 'effects'
      },
      depth: {
        default: 1.0,
        category: 'effects'
      },
      turbulence: {
        default: 0,
        category: 'effects'
      },
      phaseShift: {
        default: 0,
        category: 'effects'
      }
    },
    audioReactivity: {
      // Original: Amplitude, rotationX, and rotationY respond to audio
      amplitude: { enabled: true, frequency: 'bass', intensity: 0.7, mode: 'modulate' },
      rotationX: { enabled: true, frequency: 'bass', intensity: 0.6, mode: 'modulate' },
      rotationY: { enabled: true, frequency: 'mids', intensity: 0.6, mode: 'modulate' },

      // All other controls default to Static (None)
      layers: { enabled: false, frequency: 'none', intensity: 0.3, mode: 'modulate' },
      hue: { enabled: false, frequency: 'none', intensity: 0.6, mode: 'modulate' },
      saturation: { enabled: false, frequency: 'none', intensity: 0.3, mode: 'modulate' },
      wavelength: { enabled: false, frequency: 'none', intensity: 0.5, mode: 'modulate' },
      lineWidth: { enabled: false, frequency: 'none', intensity: 0.3, mode: 'modulate' },
      speed: { enabled: false, frequency: 'none', intensity: 0.4, mode: 'modulate' },
      glow: { enabled: false, frequency: 'none', intensity: 0.5, mode: 'modulate' },
      perspective: { enabled: false, frequency: 'none', intensity: 0.3, mode: 'modulate' },
      depth: { enabled: false, frequency: 'none', intensity: 0.4, mode: 'modulate' },
      turbulence: { enabled: false, frequency: 'none', intensity: 0.5, mode: 'modulate' },
      phaseShift: { enabled: false, frequency: 'none', intensity: 0.3, mode: 'modulate' },
      backgroundShift: { enabled: true, frequency: 'bass', intensity: 1.0, mode: 'modulate' },
      bpmSync: { enabled: false, frequency: 'none', intensity: 0, mode: 'modulate' }
    }
  },

  // ─────────────────────────────────────────────────────────
  // TUNNEL THEME
  // ─────────────────────────────────────────────────────────
  tunnel: {
    name: 'TUNNEL',
    description: '3D perspective vortex with concentric rings',
    controls: {
      // Color
      hue: {
        default: 180,
        category: 'color'
      },
      saturation: {
        default: 80,
        category: 'color'
      },

      // Motion
      speed: {
        default: 1.0,
        category: 'motion',
        description: 'Tunnel movement speed'
      },
      rotation: {
        default: 0.5,
        category: 'motion',
        description: 'Ring rotation speed'
      },
      bpmSync: {
        type: 'buttonGroup',
        label: 'BPM SYNC',
        options: [
          { value: 'off', label: 'OFF' },
          { value: '1x', label: '1X' },
          { value: '2x', label: '2X' },
          { value: '0.5x', label: '0.5X' },
          { value: '4x', label: '4X' }
        ],
        default: 'off',
        category: 'motion',
        audioReactive: false,
        description: 'Lock animation speed to detected BPM'
      },

      // Geometry
      rings: {
        default: 50,
        category: 'geometry',
        description: 'Number of rings in tunnel'
      },
      perspective: {
        default: 1.0,
        category: 'geometry',
        description: 'Depth perspective multiplier'
      },
      lineWidth: {
        default: 2,
        category: 'geometry'
      },
      segments: {
        default: 12,
        category: 'geometry',
        description: 'Segments per ring (roundness)'
      }
    },
    audioReactivity: {
      // Original: Speed and rotation respond to audio
      speed: { enabled: true, frequency: 'bass', intensity: 0.7, mode: 'modulate' },
      rotation: { enabled: true, frequency: 'mids', intensity: 0.6, mode: 'modulate' },

      // All other controls default to Static (None)
      hue: { enabled: false, frequency: 'none', intensity: 0.6, mode: 'modulate' },
      saturation: { enabled: false, frequency: 'none', intensity: 0.3, mode: 'modulate' },
      rings: { enabled: false, frequency: 'none', intensity: 0.3, mode: 'modulate' },
      perspective: { enabled: false, frequency: 'none', intensity: 0.4, mode: 'modulate' },
      lineWidth: { enabled: false, frequency: 'none', intensity: 0.3, mode: 'modulate' },
      segments: { enabled: false, frequency: 'none', intensity: 0.2, mode: 'modulate' },
      bpmSync: { enabled: false, frequency: 'none', intensity: 0, mode: 'modulate' }
    }
  },

  // ─────────────────────────────────────────────────────────
  // PLASMA THEME
  // ─────────────────────────────────────────────────────────
  plasma: {
    name: 'PLASMA',
    description: 'Organic plasma with sine wave interference patterns',
    controls: {
      // Color
      hue: {
        default: 280,
        category: 'color'
      },
      saturation: {
        default: 85,
        category: 'color'
      },
      brightness: {
        default: 0.6,
        category: 'color',
        description: 'Overall brightness (0-1)'
      },
      contrast: {
        default: 1.0,
        category: 'color',
        description: 'Contrast multiplier'
      },

      // Geometry
      scale: {
        default: 3.0,
        category: 'geometry',
        description: 'Wave scale/frequency'
      },
      complexity: {
        default: 3,
        category: 'geometry',
        description: 'Number of sine wave layers (1-5)'
      },

      // Motion
      speed: {
        default: 1.0,
        category: 'motion',
        description: 'Animation speed'
      },
      bpmSync: {
        type: 'buttonGroup',
        label: 'BPM SYNC',
        options: [
          { value: 'off', label: 'OFF' },
          { value: '1x', label: '1X' },
          { value: '2x', label: '2X' },
          { value: '0.5x', label: '0.5X' },
          { value: '4x', label: '4X' }
        ],
        default: 'off',
        category: 'motion',
        audioReactive: false,
        description: 'Lock animation speed to detected BPM'
      }
    },
    audioReactivity: {
      // Original: Speed responds to audio
      speed: { enabled: true, frequency: 'bass', intensity: 0.6, mode: 'modulate' },
      brightness: { enabled: true, frequency: 'mids', intensity: 0.4, mode: 'modulate' },
      hue: { enabled: true, frequency: 'highs', intensity: 0.5, mode: 'modulate' },

      // All other controls default to Static (None)
      saturation: { enabled: false, frequency: 'none', intensity: 0.3, mode: 'modulate' },
      contrast: { enabled: false, frequency: 'none', intensity: 0.4, mode: 'modulate' },
      scale: { enabled: false, frequency: 'none', intensity: 0.5, mode: 'modulate' },
      complexity: { enabled: false, frequency: 'none', intensity: 0.3, mode: 'modulate' },
      bpmSync: { enabled: false, frequency: 'none', intensity: 0, mode: 'modulate' }
    }
  },

  // ─────────────────────────────────────────────────────────
  // PARTICLES THEME
  // ─────────────────────────────────────────────────────────
  particles: {
    name: 'PARTICLES',
    description: 'Physics-based particle system with swarm behaviors',
    controls: {
      // Style
      mode: {
        type: 'buttonGroup',
        label: 'PHYSICS MODE',
        options: [
          { value: 'explode', label: 'EXPLODE' },
          { value: 'converge', label: 'CONVERGE' },
          { value: 'swarm', label: 'SWARM' }
        ],
        default: 'explode',
        category: 'style',
        audioReactive: false,
        description: 'Particle behavior mode'
      },

      // Geometry
      count: {
        default: 1000,
        category: 'geometry',
        description: 'Number of particles (100-5000)'
      },
      size: {
        default: 2,
        category: 'geometry',
        description: 'Base particle size (1-10)'
      },

      // Color
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

      // Motion
      speed: {
        default: 1.0,
        category: 'motion',
        description: 'Base velocity multiplier (0-5)'
      },
      gravity: {
        default: 0,
        category: 'motion',
        description: 'Gravity force (-2 to 2)'
      },
      damping: {
        default: 0.98,
        category: 'motion',
        description: 'Velocity damping/friction (0-1)'
      },
      bpmSync: {
        type: 'buttonGroup',
        label: 'BPM SYNC',
        options: [
          { value: 'off', label: 'OFF' },
          { value: '1x', label: '1X' },
          { value: '2x', label: '2X' },
          { value: '0.5x', label: '0.5X' },
          { value: '4x', label: '4X' }
        ],
        default: 'off',
        category: 'motion',
        audioReactive: false,
        description: 'Lock animation speed to detected BPM'
      },

      // Effects
      trailLength: {
        default: 0.15,
        category: 'effects',
        description: 'Motion trail fade amount (0-1)'
      },
      bloom: {
        default: 0,
        category: 'effects',
        description: 'Glow/bloom intensity (0-2)'
      },
      explosionThreshold: {
        default: 0.3,
        category: 'effects',
        description: 'Bass level for explosions (0-1)'
      }
    },
    audioReactivity: {
      // Original: Size and hue respond to audio
      size: { enabled: true, frequency: 'bass', intensity: 0.5, mode: 'modulate' },
      hue: { enabled: true, frequency: 'highs', intensity: 0.6, mode: 'modulate' },
      brightness: { enabled: true, frequency: 'mids', intensity: 0.3, mode: 'modulate' },

      // All other controls default to Static (None)
      count: { enabled: false, frequency: 'none', intensity: 0.4, mode: 'modulate' },
      saturation: { enabled: false, frequency: 'none', intensity: 0.3, mode: 'modulate' },
      speed: { enabled: false, frequency: 'none', intensity: 0.5, mode: 'modulate' },
      gravity: { enabled: false, frequency: 'none', intensity: 0.3, mode: 'modulate' },
      damping: { enabled: false, frequency: 'none', intensity: 0.2, mode: 'modulate' },
      trailLength: { enabled: false, frequency: 'none', intensity: 0.4, mode: 'modulate' },
      bloom: { enabled: false, frequency: 'none', intensity: 0.6, mode: 'modulate' },
      explosionThreshold: { enabled: false, frequency: 'none', intensity: 0.3, mode: 'modulate' },
      bpmSync: { enabled: false, frequency: 'none', intensity: 0, mode: 'modulate' }
    }
  },

  // ─────────────────────────────────────────────────────────
  // GLOBAL CONTROLS (Affect All Themes)
  // ─────────────────────────────────────────────────────────
  global: {
    name: 'GLOBAL',
    description: 'Master controls that affect all themes simultaneously',
    controls: {
      // Master multipliers
      masterIntensity: {
        type: 'slider',
        label: 'MASTER INTENSITY',
        min: 0,
        max: 200,
        step: 1,
        default: 100,
        unit: '%',
        category: 'master',
        audioReactive: false,
        description: 'Multiplies all size, amplitude, and glow parameters'
      },
      masterBrightness: {
        type: 'slider',
        label: 'MASTER BRIGHTNESS',
        min: 0,
        max: 200,
        step: 1,
        default: 100,
        unit: '%',
        category: 'master',
        audioReactive: false,
        description: 'Multiplies all brightness, lightness, and opacity parameters'
      },
      globalHueShift: {
        type: 'slider',
        label: 'GLOBAL HUE SHIFT',
        min: -180,
        max: 180,
        step: 1,
        default: 0,
        unit: '°',
        category: 'master',
        audioReactive: false,
        description: 'Shifts all hue values (color rotation)'
      },
      audioSensitivity: {
        type: 'slider',
        label: 'AUDIO SENSITIVITY',
        min: 0,
        max: 300,
        step: 1,
        default: 100,
        unit: '%',
        category: 'master',
        audioReactive: false,
        description: 'Multiplies all audio reactivity intensity'
      },

      // Strobe effect
      strobeEnabled: {
        type: 'toggle',
        label: 'STROBE',
        default: false,
        category: 'effects',
        audioReactive: false,
        description: 'Enable beat-synced brightness strobe'
      },
      strobeRate: {
        type: 'buttonGroup',
        label: 'STROBE RATE',
        options: [
          { value: 'beat', label: 'BEAT' },
          { value: 'half', label: '1/2' },
          { value: 'double', label: '2X' }
        ],
        default: 'beat',
        category: 'effects',
        audioReactive: false,
        visibleWhen: (state) => state.settings?.global?.strobeEnabled || false,
        description: 'Strobe flash frequency'
      },

      // Display options
      bpmDisplay: {
        type: 'toggle',
        label: 'SHOW BPM',
        default: true,
        category: 'display',
        audioReactive: false,
        description: 'Display detected BPM in UI'
      }
    },
    audioReactivity: {
      // Global controls are not audio-reactive (they control audio reactivity)
    }
  }
};

// =====================================================
// 4. CONTROL SYSTEM UI - Dynamic UI Generation
// =====================================================

class ControlSystemUI {
  constructor(containerElement) {
    this.container = containerElement;
    this.controlElements = new Map();
    this.audioToggles = new Map();
    this.sections = new Map();
  }

  /**
   * Render theme controls and return the section element
   */
  renderThemeControls(themeName) {
    const themeConfig = THEME_CONFIGS[themeName];
    if (!themeConfig) {
      console.error(`Unknown theme: ${themeName}`);
      return null;
    }

    // Initialize audio reactivity state from theme config
    if (!window.state.audioReactivity) {
      window.state.audioReactivity = {};
    }
    if (!window.state.audioReactivity[themeName] && themeConfig.audioReactivity) {
      window.state.audioReactivity[themeName] = JSON.parse(JSON.stringify(themeConfig.audioReactivity));
    }

    // Initialize settings state from theme config defaults
    if (!window.state.settings[themeName]) {
      window.state.settings[themeName] = {};
      // Set default values for all controls
      for (const [controlId, controlConfig] of Object.entries(themeConfig.controls)) {
        const controlDef = { ...CONTROL_REGISTRY[controlId], ...controlConfig };
        if (controlDef.default !== undefined) {
          window.state.settings[themeName][controlId] = controlDef.default;
        }
      }
    }

    const section = document.createElement('section');
    section.className = 'control-section';
    section.id = `${themeName}ControlsSection`;
    section.style.display = 'none';

    // Theme title
    const title = document.createElement('h3');
    title.textContent = themeConfig.name;
    section.appendChild(title);

    // Group controls by category
    const categorized = this.categorizeControls(themeName, themeConfig.controls);

    // Render each category
    for (const [category, controls] of Object.entries(categorized)) {
      if (controls.length > 0) {
        const categorySection = this.createCategorySection(category, controls, themeName);
        section.appendChild(categorySection);
      }
    }

    this.sections.set(themeName, section);
    return section;
  }

  /**
   * Categorize controls by their category field
   */
  categorizeControls(themeName, controls) {
    const categories = {
      style: [],
      color: [],
      geometry: [],
      motion: [],
      effects: [],
      audio: []
    };

    for (const [controlId, controlConfig] of Object.entries(controls)) {
      const controlDef = { ...CONTROL_REGISTRY[controlId], ...controlConfig };
      const category = controlDef.category || 'style';

      if (!categories[category]) {
        categories[category] = [];
      }

      categories[category].push({ controlId, controlDef });
    }

    return categories;
  }

  /**
   * Create a collapsible category section
   */
  createCategorySection(category, controls, themeName) {
    const section = document.createElement('div');
    section.className = 'control-category';

    // Category header
    const header = document.createElement('div');
    header.className = 'category-header';
    header.textContent = category.toUpperCase();
    section.appendChild(header);

    // Category content
    const content = document.createElement('div');
    content.className = 'category-content';

    controls.forEach(({ controlId, controlDef }) => {
      const controlGroup = this.createControlGroup(controlId, controlDef, themeName);
      content.appendChild(controlGroup);
    });

    section.appendChild(content);
    return section;
  }

  /**
   * Create a control group (label + input + optional audio selector)
   */
  createControlGroup(controlId, controlDef, context) {
    const group = document.createElement('div');
    group.className = 'control-group';
    group.id = `${context}_${controlId}_group`;

    // Check if this control should be visible
    if (controlDef.visibleWhen) {
      group.style.display = 'none';
      group.dataset.visibilityCheck = 'true';
    }

    // Control header (label + audio selector button)
    const headerRow = document.createElement('div');
    headerRow.className = 'control-header';

    const labelSpan = document.createElement('span');
    labelSpan.className = 'control-label';
    labelSpan.textContent = controlDef.label;
    headerRow.appendChild(labelSpan);

    // Audio selector button (right-aligned) - only for audio reactive controls
    if (controlDef.audioReactive) {
      const audioSelector = this.createAudioSelector(controlId, context);
      headerRow.appendChild(audioSelector);
    }

    group.appendChild(headerRow);

    // Intensity slider (only visible when not STATIC)
    if (controlDef.audioReactive) {
      const intensityControl = this.createIntensityControl(controlId, context);
      group.appendChild(intensityControl);
    }

    // Main control input (slider, select, etc.)
    const inputContainer = document.createElement('div');
    inputContainer.className = 'slider-container';

    const input = this.createControlInput(controlId, controlDef, context);
    inputContainer.appendChild(input);

    group.appendChild(inputContainer);

    // Value display (explicit formatted value)
    if (controlDef.type === 'slider') {
      const valueDisplay = document.createElement('div');
      valueDisplay.className = 'control-value';
      valueDisplay.id = `${context}_${controlId}_value`;
      valueDisplay.textContent = getFormattedValue(controlId, controlDef.default);
      group.appendChild(valueDisplay);
    }

    return group;
  }

  /**
   * Create audio selector button (right-aligned)
   */
  createAudioSelector(controlId, context) {
    const button = document.createElement('button');
    button.className = 'audio-selector';
    button.id = `${context}_${controlId}_audioSelector`;

    // Get current audio source from theme config
    const themeConfig = THEME_CONFIGS[context];
    const audioConfig = themeConfig?.audioReactivity?.[controlId];
    const currentSource = audioConfig?.frequency || 'none';

    // Set button text and styling
    const sourceLabel = this.getAudioSourceLabel(currentSource);
    button.textContent = sourceLabel;
    button.dataset.audioSource = currentSource;

    // Apply styling based on source (STATIC = black, others = white)
    if (currentSource === 'none') {
      button.classList.add('static');
    }

    // Click handler to show dropdown
    button.addEventListener('click', (e) => {
      e.stopPropagation();
      this.toggleAudioDropdown(button, controlId, context);
    });

    return button;
  }

  /**
   * Create intensity control slider
   */
  createIntensityControl(controlId, context) {
    const container = document.createElement('div');
    container.className = 'intensity-control';
    container.id = `${context}_${controlId}_intensityContainer`;

    // Get current audio source
    const themeConfig = THEME_CONFIGS[context];
    const audioConfig = themeConfig?.audioReactivity?.[controlId];
    const currentSource = audioConfig?.frequency || 'none';

    // Hide if STATIC
    if (currentSource === 'none') {
      container.style.display = 'none';
    }

    // Label
    const label = document.createElement('label');
    label.textContent = 'Intensity:';
    label.className = 'intensity-label';

    // Slider
    const slider = document.createElement('input');
    slider.type = 'range';
    slider.className = 'intensity-slider';
    slider.id = `${context}_${controlId}_intensity`;
    slider.min = 0;
    slider.max = 1;
    slider.step = 0.01;
    slider.value = audioConfig?.intensity || 1.0;

    // Value display
    const valueSpan = document.createElement('span');
    valueSpan.className = 'intensity-value';
    valueSpan.textContent = `${Math.round(slider.value * 100)}%`;

    // Event listener
    slider.addEventListener('input', (e) => {
      const value = parseFloat(e.target.value);
      valueSpan.textContent = `${Math.round(value * 100)}%`;
      this.handleIntensityChange(controlId, context, value);
    });

    container.appendChild(label);
    container.appendChild(slider);
    container.appendChild(valueSpan);

    return container;
  }

  /**
   * Get display label for audio source (always uppercase for buttons)
   * Removes parentheses and content inside them for shorter button labels
   */
  getAudioSourceLabel(sourceId) {
    const source = AUDIO_SOURCES[sourceId];
    if (!source) return sourceId.toUpperCase();

    // Remove parentheses and content inside them for button display
    const shortLabel = source.label.replace(/\s*\([^)]*\)/g, '').trim();
    return shortLabel.toUpperCase();
  }

  /**
   * Toggle audio source dropdown
   */
  toggleAudioDropdown(button, controlId, context) {
    // Check if dropdown already exists
    let dropdown = document.querySelector('.audio-dropdown.active');

    // Close existing dropdown
    if (dropdown) {
      dropdown.remove();
      return;
    }

    // Create new dropdown
    dropdown = document.createElement('div');
    dropdown.className = 'audio-dropdown active';

    // Build options from AUDIO_SOURCES, grouped by category
    const categories = {};
    for (const [sourceId, source] of Object.entries(AUDIO_SOURCES)) {
      if (!categories[source.category]) {
        categories[source.category] = [];
      }
      categories[source.category].push({ sourceId, source });
    }

    // Category order
    const categoryOrder = ['basic', 'frequency', 'amplitude', 'rhythm', 'dynamics', 'spectral', 'musical'];

    categoryOrder.forEach(categoryId => {
      if (!categories[categoryId]) return;

      // Add category header
      const categoryHeader = document.createElement('div');
      categoryHeader.className = 'audio-dropdown-category';
      categoryHeader.textContent = categoryId.toUpperCase();
      dropdown.appendChild(categoryHeader);

      // Add items in category
      categories[categoryId].forEach(({ sourceId, source }) => {
        const item = document.createElement('div');
        item.className = 'audio-dropdown-item';
        item.textContent = source.label;
        item.dataset.value = sourceId;

        // Mark current selection
        if (sourceId === button.dataset.audioSource) {
          item.classList.add('selected');
        }

        item.addEventListener('click', (e) => {
          e.stopPropagation();
          this.handleAudioSourceChange(controlId, context, sourceId);

          // Update button with short label (remove parentheses, always uppercase)
          const shortLabel = source.label.replace(/\s*\([^)]*\)/g, '').trim();
          button.textContent = shortLabel.toUpperCase();
          button.dataset.audioSource = sourceId;

          // Update styling (static only for 'none')
          button.classList.toggle('static', sourceId === 'none');

          // Show/hide intensity control
          const intensityContainer = document.getElementById(`${context}_${controlId}_intensityContainer`);
          if (intensityContainer) {
            intensityContainer.style.display = sourceId === 'none' ? 'none' : 'flex';
          }

          dropdown.remove();
        });

        dropdown.appendChild(item);
      });
    });

    // Position dropdown relative to button
    button.style.position = 'relative';
    button.appendChild(dropdown);

    // Close dropdown when clicking outside
    const closeDropdown = (e) => {
      if (!dropdown.contains(e.target) && e.target !== button) {
        dropdown.remove();
        document.removeEventListener('click', closeDropdown);
      }
    };
    setTimeout(() => document.addEventListener('click', closeDropdown), 0);
  }

  /**
   * Create control input element based on type
   */
  createControlInput(controlId, controlDef, context) {
    switch (controlDef.type) {
      case 'slider':
        return this.createSlider(controlId, controlDef, context);
      case 'buttonGroup':
        return this.createButtonGroup(controlId, controlDef, context);
      default:
        console.error(`Unknown control type: ${controlDef.type}`);
        return document.createElement('div');
    }
  }

  /**
   * Create slider input
   */
  createSlider(controlId, controlDef, context) {
    const slider = document.createElement('input');
    slider.type = 'range';
    slider.id = `${context}_${controlId}`;
    slider.className = 'control-slider';
    slider.min = controlDef.min;
    slider.max = controlDef.max;
    slider.step = controlDef.step;
    slider.value = controlDef.default;

    // Event listener
    slider.addEventListener('input', (e) => {
      const value = parseFloat(e.target.value);

      // Update formatted value display
      const valueDisplay = document.getElementById(`${context}_${controlId}_value`);
      if (valueDisplay) {
        valueDisplay.textContent = getFormattedValue(controlId, value);
      }

      this.handleControlChange(controlId, value, context, controlDef);
    });

    this.controlElements.set(`${context}_${controlId}`, slider);
    return slider;
  }

  /**
   * Create button group (density options style)
   */
  createButtonGroup(controlId, controlDef, context) {
    const container = document.createElement('div');
    container.className = 'density-options';
    container.style.gridTemplateColumns = `repeat(${controlDef.options.length}, 1fr)`;

    controlDef.options.forEach((option) => {
      const button = document.createElement('div');
      button.className = 'density-option';
      button.textContent = option.label;
      button.dataset.value = option.value;

      if (option.value === controlDef.default) {
        button.classList.add('active');
      }

      button.addEventListener('click', () => {
        // Remove active from all buttons
        container.querySelectorAll('.density-option').forEach(b => b.classList.remove('active'));
        button.classList.add('active');
        this.handleControlChange(controlId, option.value, context, controlDef);
      });

      container.appendChild(button);
    });

    this.controlElements.set(`${context}_${controlId}`, container);
    return container;
  }

  /**
   * Create audio reactivity controls (dropdown + intensity slider)
   */
  createAudioControls(controlId, context) {
    const container = document.createElement('div');
    container.className = 'audio-controls';

    // Audio source dropdown
    const dropdown = document.createElement('select');
    dropdown.className = 'audio-source-dropdown';
    dropdown.id = `${context}_${controlId}_audioSource`;

    // Build dropdown options grouped by category
    const categories = {};
    for (const [sourceId, source] of Object.entries(AUDIO_SOURCES)) {
      if (!categories[source.category]) {
        categories[source.category] = [];
      }
      categories[source.category].push({ sourceId, source });
    }

    // Add options with separators
    const categoryOrder = ['basic', 'frequency', 'amplitude', 'rhythm', 'dynamics', 'spectral', 'musical', 'custom'];
    categoryOrder.forEach((category, idx) => {
      if (categories[category]) {
        if (idx > 0) {
          const separator = document.createElement('option');
          separator.disabled = true;
          separator.textContent = `── ${category.toUpperCase()} ──`;
          dropdown.appendChild(separator);
        }

        categories[category].forEach(({ sourceId, source }) => {
          const option = document.createElement('option');
          option.value = sourceId;
          option.textContent = source.label;
          dropdown.appendChild(option);
        });
      }
    });

    // Set current value from theme config
    const themeConfig = THEME_CONFIGS[context];
    const audioConfig = themeConfig?.audioReactivity?.[controlId];
    if (audioConfig) {
      dropdown.value = audioConfig.frequency || 'none';
    } else {
      dropdown.value = 'none';
    }

    dropdown.addEventListener('change', (e) => {
      const sourceId = e.target.value;
      this.handleAudioSourceChange(controlId, context, sourceId);

      // Show/hide intensity slider
      if (sourceId === 'none') {
        intensitySlider.style.display = 'none';
        intensityLabel.style.display = 'none';
      } else {
        intensitySlider.style.display = 'block';
        intensityLabel.style.display = 'block';
      }
    });

    container.appendChild(dropdown);

    // Intensity slider
    const intensityLabel = document.createElement('label');
    intensityLabel.className = 'intensity-label';
    intensityLabel.textContent = 'Intensity:';
    intensityLabel.style.display = dropdown.value !== 'none' ? 'block' : 'none';

    const intensitySlider = document.createElement('input');
    intensitySlider.type = 'range';
    intensitySlider.className = 'intensity-slider';
    intensitySlider.min = 0;
    intensitySlider.max = 2;
    intensitySlider.step = 0.05;
    intensitySlider.value = audioConfig?.intensity || 0.5;
    intensitySlider.style.display = dropdown.value !== 'none' ? 'block' : 'none';

    const intensityValue = document.createElement('span');
    intensityValue.className = 'intensity-value';
    intensityValue.textContent = `${Math.round(intensitySlider.value * 100)}%`;

    intensitySlider.addEventListener('input', (e) => {
      const value = parseFloat(e.target.value);
      intensityValue.textContent = `${Math.round(value * 100)}%`;
      this.handleIntensityChange(controlId, context, value);
    });

    intensityLabel.appendChild(intensitySlider);
    intensityLabel.appendChild(intensityValue);
    container.appendChild(intensityLabel);

    this.audioToggles.set(`${context}_${controlId}`, { dropdown, intensitySlider });
    return container;
  }

  /**
   * Handle control value changes
   */
  handleControlChange(controlId, value, context, controlDef) {
    // Update state
    if (!window.state.settings[context]) {
      window.state.settings[context] = {};
    }
    window.state.settings[context][controlId] = value;

    // Log the change for debugging
    console.log(`🎛️  Control changed: ${context}.${controlId} = ${typeof value === 'number' ? value.toFixed(2) : value}`);

    // Update value display for sliders
    if (controlDef.type === 'slider') {
      const valueDisplay = document.querySelector(`#${context}_${controlId}`)
        ?.closest('.control-group')
        ?.querySelector('.control-value');
      if (valueDisplay) {
        const decimals = controlDef.step < 1 ? (controlDef.step < 0.1 ? 2 : 1) : 0;
        valueDisplay.textContent = `${typeof value === 'number' ? value.toFixed(decimals) : value}${controlDef.unit}`;
      }
    }

    // Trigger reinitialization if required
    if (controlDef.requiresReinit && window.state[context]) {
      window.state[context].initialized = false;
    }

    // Update visibility of dependent controls
    this.updateControlVisibility(context);

    // Send to companion if connected
    if (typeof window.sendStateToMobile === 'function') {
      window.sendStateToMobile();
    }

    console.log(`🎛️ Control changed: ${context}.${controlId} = ${value}`);
  }

  /**
   * Handle audio source selection change
   */
  handleAudioSourceChange(controlId, context, sourceId) {
    if (!window.state.audioReactivity) window.state.audioReactivity = {};
    if (!window.state.audioReactivity[context]) window.state.audioReactivity[context] = {};

    if (sourceId === 'none') {
      // Disable audio reactivity
      if (window.state.audioReactivity[context][controlId]) {
        window.state.audioReactivity[context][controlId].enabled = false;
      }
    } else {
      // Enable audio reactivity with selected source
      if (!window.state.audioReactivity[context][controlId]) {
        window.state.audioReactivity[context][controlId] = {
          enabled: true,
          frequency: sourceId,
          intensity: 0.5,
          mode: 'modulate'
        };
      } else {
        window.state.audioReactivity[context][controlId].enabled = true;
        window.state.audioReactivity[context][controlId].frequency = sourceId;
      }
    }

    console.log(`🎵 Audio source changed: ${context}.${controlId} -> ${sourceId}`);
  }

  /**
   * Handle intensity slider change
   */
  handleIntensityChange(controlId, context, intensity) {
    if (!window.state.audioReactivity?.[context]?.[controlId]) return;
    window.state.audioReactivity[context][controlId].intensity = intensity;

    // Get current audio level and show what the modulation would be
    const audioConfig = window.state.audioReactivity[context][controlId];
    const audioLevel = this.getAudioLevel(audioConfig.frequency, window.state.audioLevels);
    const baseValue = window.state.settings[context]?.[controlId];
    const controlDef = CONTROL_REGISTRY[controlId] || THEME_CONFIGS[context]?.controls[controlId];

    if (controlDef?.type === 'slider' && audioLevel !== undefined && baseValue !== undefined) {
      const range = controlDef.max - controlDef.min;
      const modulation = (audioLevel - 0.5) * range * intensity;
      const modulatedValue = Math.max(controlDef.min, Math.min(controlDef.max, baseValue + modulation));
      console.log(`🎵 Intensity changed: ${context}.${controlId}
   Intensity: ${Math.round(intensity * 100)}%
   Audio Level: ${(audioLevel * 100).toFixed(1)}% (${audioConfig.frequency})
   Base Value: ${baseValue.toFixed(2)}
   Modulation: ${modulation >= 0 ? '+' : ''}${modulation.toFixed(2)}
   Result: ${modulatedValue.toFixed(2)} (range: ${controlDef.min}-${controlDef.max})`);
    } else {
      console.log(`🎵 Intensity changed: ${context}.${controlId} -> ${Math.round(intensity * 100)}%`);
    }
  }

  /**
   * Update visibility of controls based on visibleWhen conditions
   */
  updateControlVisibility(context) {
    const themeConfig = THEME_CONFIGS[context];
    if (!themeConfig) return;

    for (const [controlId, controlConfig] of Object.entries(themeConfig.controls)) {
      if (controlConfig.visibleWhen) {
        const group = document.getElementById(`${context}_${controlId}_group`);
        if (group) {
          const shouldShow = controlConfig.visibleWhen(window.state);
          group.style.display = shouldShow ? 'block' : 'none';
        }
      }
    }
  }

  /**
   * Show theme controls section
   */
  showTheme(themeName) {
    // Hide all sections
    this.sections.forEach(section => {
      section.style.display = 'none';
    });

    // Show requested section
    const section = this.sections.get(themeName);
    if (section) {
      section.style.display = 'block';
      this.updateControlVisibility(themeName);
    }
  }

  /**
   * Initialize all theme controls
   */
  initializeAll() {
    const themes = Object.keys(THEME_CONFIGS);
    themes.forEach(themeName => {
      const section = this.renderThemeControls(themeName);
      if (section && this.container) {
        this.container.appendChild(section);
      }
    });
    console.log('🎛️ Control System UI initialized');
  }

  /**
   * Refresh all control UI elements to reflect current values
   * Used when loading scenes from Beat Pad
   */
  refreshAllControls() {
    if (!window.soundscape) return;

    const currentTheme = window.soundscape.currentTheme;
    if (!currentTheme) return;

    console.log(`🔄 Refreshing controls for theme: ${currentTheme}`);

    // Update all sliders and button groups
    this.controlElements.forEach((element, elementKey) => {
      // Extract controlId from elementKey (format: "themeName_controlId")
      const parts = elementKey.split('_');
      const theme = parts[0];
      const controlId = parts.slice(1).join('_');

      if (theme !== currentTheme) return;

      // Get current value from window.state.settings
      const currentValue = window.state.settings[currentTheme]?.[controlId];
      if (currentValue === undefined) return;

      if (element.type === 'range') {
        element.value = currentValue;

        // Update value display
        const valueDisplay = document.getElementById(`${currentTheme}_${controlId}_value`);
        if (valueDisplay) {
          valueDisplay.textContent = getFormattedValue(controlId, currentValue);
        }

        console.log(`  ✓ Updated slider ${controlId} = ${currentValue}`);
      } else if (element.classList.contains('density-options')) {
        // Update button group
        element.querySelectorAll('.density-option').forEach(btn => {
          btn.classList.remove('active');
          if (btn.dataset.value === currentValue) {
            btn.classList.add('active');
          }
        });

        console.log(`  ✓ Updated button group ${controlId} = ${currentValue}`);
      }
    });

    // Update audio selector buttons and intensity sliders
    if (window.state.audioReactivity && window.state.audioReactivity[currentTheme]) {
      for (const [controlId, audioConfig] of Object.entries(window.state.audioReactivity[currentTheme])) {
        const button = document.getElementById(`${currentTheme}_${controlId}_audioSelector`);
        if (!button) continue;

        const sourceId = audioConfig.frequency || 'none';
        const source = AUDIO_SOURCES[sourceId];
        if (source) {
          const shortLabel = source.label.replace(/\s*\([^)]*\)/g, '').trim();
          button.textContent = shortLabel.toUpperCase();
          button.dataset.audioSource = sourceId;
          button.classList.toggle('static', sourceId === 'none');
        }

        // Update intensity slider
        const intensitySlider = document.getElementById(`${currentTheme}_${controlId}_intensity`);
        if (intensitySlider && audioConfig.intensity !== undefined) {
          intensitySlider.value = audioConfig.intensity;

          // Update intensity value display
          const intensityValue = intensitySlider.parentElement?.querySelector('.intensity-value');
          if (intensityValue) {
            intensityValue.textContent = `${Math.round(audioConfig.intensity * 100)}%`;
          }
        }

        // Show/hide intensity container
        const intensityContainer = document.getElementById(`${currentTheme}_${controlId}_intensityContainer`);
        if (intensityContainer) {
          intensityContainer.style.display = sourceId === 'none' ? 'none' : 'flex';
        }

        console.log(`  ✓ Updated audio selector ${controlId} = ${sourceId} (${Math.round((audioConfig.intensity || 0) * 100)}%)`);
      }
    }

    console.log('🔄 Refreshed all control UI elements');
  }

  /**
   * Update a single control's UI to reflect a new value
   * Used when loading scenes from Beat Pad
   */
  updateControlValue(controlId, value, themeName) {
    const context = themeName || window.soundscape?.currentTheme;
    if (!context) return;

    const elementKey = `${context}_${controlId}`;
    const element = this.controlElements.get(elementKey);

    if (!element) {
      console.warn(`⚠️ Control element not found: ${elementKey}`);
      return;
    }

    // Update slider value
    if (element.type === 'range') {
      element.value = value;

      // Update value display
      const valueDisplay = document.getElementById(`${context}_${controlId}_value`);
      if (valueDisplay) {
        valueDisplay.textContent = getFormattedValue(controlId, value);
      }

      console.log(`🎛️ Updated UI for ${controlId} = ${value}`);
    }
    // Update button group
    else if (element.classList.contains('density-options')) {
      // Remove active from all buttons
      element.querySelectorAll('.density-option').forEach(btn => {
        btn.classList.remove('active');
        if (btn.dataset.value === value) {
          btn.classList.add('active');
        }
      });

      console.log(`🎛️ Updated button group for ${controlId} = ${value}`);
    }
  }
}

// =====================================================
// 5. AUDIO MODULATION ENGINE
// =====================================================

class AudioModulationEngine {
  constructor() {
    this.baseValues = new Map();
  }

  /**
   * Get audio level for a given frequency source
   */
  getAudioLevel(sourceId, audioLevels) {
    // Map legacy frequency names to new source IDs
    const legacyMap = {
      low: 'bass',
      mid: 'mids',
      high: 'highs'
    };

    const mappedId = legacyMap[sourceId] || sourceId;

    // Handle different source types
    switch (mappedId) {
      // Basic
      case 'none':
        return 0;
      case 'allLevels':
        return audioLevels.allLevels || (audioLevels.low + audioLevels.mid + audioLevels.high) / 3;

      // Frequency Bands (7-band analysis)
      case 'subBass':
        return audioLevels.subBass || audioLevels.low;
      case 'bass':
        return audioLevels.bass || audioLevels.low;
      case 'lowMids':
        return audioLevels.lowMids || audioLevels.mid;
      case 'mids':
        return audioLevels.mids || audioLevels.mid;
      case 'highMids':
        return audioLevels.highMids || audioLevels.high;
      case 'highs':
        return audioLevels.highs || audioLevels.high;
      case 'brilliance':
        return audioLevels.brilliance || audioLevels.high;

      // Amplitude Features
      case 'peak':
        return audioLevels.peak || audioLevels.high;
      case 'rms':
        return audioLevels.rms || (audioLevels.low + audioLevels.mid + audioLevels.high) / 3;
      case 'decibels':
        return audioLevels.decibels || (audioLevels.low + audioLevels.mid + audioLevels.high) / 3;

      // Rhythm Features
      case 'beat':
        return audioLevels.beat || 0;
      case 'onset':
        return audioLevels.onset || 0;
      case 'bpm':
        return audioLevels.bpm || 0.5; // Default to 120 BPM (0.5 normalized)

      // Spectral Features (Meyda)
      case 'centroid':
        return audioLevels.centroid || audioLevels.mid;
      case 'flatness':
        return audioLevels.flatness || 0.5;
      case 'rolloff':
        return audioLevels.rolloff || audioLevels.high;
      case 'flux':
        return audioLevels.flux || 0;
      case 'spread':
        return audioLevels.spread || 0.5;

      // Perceptual Features (Meyda)
      case 'loudness':
        return audioLevels.loudness || audioLevels.rms;
      case 'chroma':
        return audioLevels.chroma || 0.5;

      // TODO: Implement dynamics sources (attack, transients, envelope)
      // TODO: Implement musical pitch detection
      default:
        console.warn(`Audio source not yet implemented: ${mappedId}`);
        return audioLevels.mid; // Fallback to mid
    }
  }

  /**
   * Apply audio modulation to all enabled controls
   */
  applyModulation(audioLevels, context) {
    if (!window.state.audioReactivity?.[context]) return;

    for (const [controlId, audioConfig] of Object.entries(window.state.audioReactivity[context])) {
      if (!audioConfig.enabled) continue;

      const baseValue = window.state.settings[context]?.[controlId];
      if (baseValue === undefined) continue;

      const audioLevel = this.getAudioLevel(audioConfig.frequency, audioLevels);
      if (audioLevel === undefined) continue;

      const controlDef = CONTROL_REGISTRY[controlId] || THEME_CONFIGS[context]?.controls[controlId];
      if (!controlDef) continue;

      let modulatedValue;

      if (audioConfig.mode === 'modulate') {
        // Continuous modulation based on audio level
        if (controlDef.type === 'slider') {
          const range = controlDef.max - controlDef.min;
          const modulation = (audioLevel - 0.5) * range * audioConfig.intensity;
          modulatedValue = baseValue + modulation;
          modulatedValue = Math.max(controlDef.min, Math.min(controlDef.max, modulatedValue));
        } else {
          modulatedValue = baseValue;
        }
      } else if (audioConfig.mode === 'trigger') {
        // Trigger at threshold
        const threshold = audioConfig.threshold || 0.5;
        if (audioLevel > threshold) {
          modulatedValue = controlDef.max;
        } else {
          modulatedValue = baseValue;
        }
      }

      // Store modulated value in separate object
      if (!window.state.modulatedValues) window.state.modulatedValues = {};
      if (!window.state.modulatedValues[context]) window.state.modulatedValues[context] = {};
      window.state.modulatedValues[context][controlId] = modulatedValue;
    }
  }

  /**
   * Get the current value for a control (modulated or base)
   */
  getValue(context, controlId) {
    // Check if there's a modulated value
    if (window.state.modulatedValues?.[context]?.[controlId] !== undefined) {
      return window.state.modulatedValues[context][controlId];
    }
    // Fall back to base value
    return window.state.settings[context]?.[controlId];
  }

  /**
   * Set a control value (updates base value in state)
   */
  setValue(context, controlId, value) {
    // Initialize settings for this context if needed
    if (!window.state.settings[context]) {
      window.state.settings[context] = {};
    }

    // Update the base value
    window.state.settings[context][controlId] = value;
    console.log(`🎛️ AudioEngine.setValue: ${context}.${controlId} = ${value}`);
  }

  /**
   * Get all values for a context (modulated where applicable)
   */
  getAll(context) {
    const values = {};
    const baseSettings = window.state.settings[context] || {};

    for (const key in baseSettings) {
      values[key] = this.getValue(context, key);
    }

    return values;
  }
}

// Export for use in main app
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    AUDIO_SOURCES,
    CONTROL_REGISTRY,
    THEME_CONFIGS,
    ControlSystemUI,
    AudioModulationEngine
  };
}
