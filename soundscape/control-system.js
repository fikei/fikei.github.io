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
    label: 'None (Static)',
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

  // Spectral
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
  zcr: {
    label: 'Zero Crossing Rate',
    category: 'spectral',
    description: 'Noisiness/percussiveness measure'
  },

  // Musical
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

  centerShiftRate: {
    type: 'slider',
    label: 'CENTER SHIFT',
    min: 0,
    max: 5,
    step: 0.1,
    default: 1.0,
    unit: '',
    category: 'motion',
    audioReactive: true,
    description: 'Center position shift rate'
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
      points: { default: 8 },
      spread: { default: 100 },
      amplitude: { default: 1.0 },
      lineWidth: { default: 3 },

      // Color
      hue: { default: 280 },
      saturation: { default: 70 },
      opacity: { default: 0.6 }
    },
    audioReactivity: {
      // Original: Amplitude responds to overall audio (physics-based)
      amplitude: { enabled: true, frequency: 'allLevels', intensity: 0.7, mode: 'modulate' },

      // All other controls default to Static (None)
      points: { enabled: false, frequency: 'none', intensity: 0.4, mode: 'modulate' },
      spread: { enabled: false, frequency: 'none', intensity: 0.5, mode: 'modulate' },
      lineWidth: { enabled: false, frequency: 'none', intensity: 0.3, mode: 'modulate' },
      hue: { enabled: false, frequency: 'none', intensity: 0.6, mode: 'modulate' },
      saturation: { enabled: false, frequency: 'none', intensity: 0.3, mode: 'modulate' },
      opacity: { enabled: false, frequency: 'none', intensity: 0.4, mode: 'modulate' }
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

      // Color
      warmCool: { default: 1.0 },
      hue: { default: 280 },
      saturation: { default: 70 },
      lightness: { default: 50 },

      // Geometry
      burstSize: { default: 1.0 },
      meshDensity: { default: 8 },
      movement: { default: 1.0 },

      // Effects
      glow: { default: 1.5 },
      blur: { default: 0 }
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
      lightness: { enabled: false, frequency: 'none', intensity: 0.4, mode: 'modulate' },
      meshDensity: { enabled: false, frequency: 'none', intensity: 0.3, mode: 'modulate' },
      blur: { enabled: false, frequency: 'none', intensity: 0.3, mode: 'modulate' }
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

      // Motion
      rotation: { default: 1.0 },

      // Effects
      glitchIntensity: { default: 1.0 },
      contrast: { default: 1.0 },
      channelOffset: { default: 5 },
      displacement: { default: 10 },
      scanlines: { default: 0 },
      noise: { default: 0 },
      pixelation: { default: 1 }
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
      pixelation: { enabled: false, frequency: 'none', intensity: 0.7, mode: 'modulate' }
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
      hue: { default: 44 },
      saturation: { default: 12 },

      // Motion
      speed: { default: 1.0 },
      zSpeed: { default: 0 },
      centerShiftRate: { default: 1.0 },
      smoothing: { default: 0.5 },

      // Appearance
      brightness: { default: 0.8 },
      minOpacity: { default: 0.2 },
      maxOpacity: { default: 1.0 },
      diameter: { default: 1.0 },

      // Effects
      twinkleRate: { default: 20 },
      trailLength: { default: 0 },
      bloom: { default: 0 },

      // Geometry
      count: { default: 1200 },
      perspective: { default: 1.0 },

      // Audio
      audioBoost: { default: 3.0 }
    },
    audioReactivity: {
      // Original: Speed (bass) and brightness (mids)
      speed: { enabled: true, frequency: 'bass', intensity: 0.7, mode: 'modulate' },
      brightness: { enabled: true, frequency: 'mids', intensity: 0.3, mode: 'modulate' },

      // All other controls default to Static (None)
      hue: { enabled: false, frequency: 'none', intensity: 0.6, mode: 'modulate' },
      saturation: { enabled: false, frequency: 'none', intensity: 0.3, mode: 'modulate' },
      zSpeed: { enabled: false, frequency: 'none', intensity: 0.4, mode: 'modulate' },
      centerShiftRate: { enabled: false, frequency: 'none', intensity: 0.4, mode: 'modulate' },
      minOpacity: { enabled: false, frequency: 'none', intensity: 0.3, mode: 'modulate' },
      maxOpacity: { enabled: false, frequency: 'none', intensity: 0.3, mode: 'modulate' },
      diameter: { enabled: false, frequency: 'none', intensity: 0.4, mode: 'modulate' },
      twinkleRate: { enabled: false, frequency: 'none', intensity: 0.4, mode: 'modulate' },
      trailLength: { enabled: false, frequency: 'none', intensity: 0.5, mode: 'modulate' },
      bloom: { enabled: false, frequency: 'none', intensity: 0.6, mode: 'modulate' },
      count: { enabled: false, frequency: 'none', intensity: 0.4, mode: 'modulate' },
      perspective: { enabled: false, frequency: 'none', intensity: 0.3, mode: 'modulate' }
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
        visibleWhen: (state) => {
          const mode = state.settings?.wave?.visualMode || 'planes';
          return ['grids', 'dots'].includes(mode);
        }
      },

      // Color
      hue: { default: 280 },
      saturation: { default: 70 },

      // Geometry
      amplitude: { default: 1.2 },
      wavelength: { default: 50 },
      lineWidth: { default: 3 },

      // Motion
      rotationX: { default: 0.3 },
      rotationY: { default: 0.3 },
      speed: { default: 1.0 },

      // Effects
      glow: { default: 0 },
      perspective: { default: 1.0 },
      depth: { default: 1.0 },
      turbulence: { default: 0 },
      phaseShift: { default: 0 }
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
      phaseShift: { enabled: false, frequency: 'none', intensity: 0.3, mode: 'modulate' }
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
   * Create a control group (label + input + optional audio dropdown)
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

    // Control label and value display
    const labelRow = document.createElement('div');
    labelRow.className = 'control-label';

    const labelSpan = document.createElement('span');
    labelSpan.textContent = controlDef.label;
    labelRow.appendChild(labelSpan);

    // Value display for sliders
    if (controlDef.type === 'slider') {
      const valueSpan = document.createElement('span');
      valueSpan.className = 'control-value';
      valueSpan.textContent = `${controlDef.default}${controlDef.unit}`;
      labelRow.appendChild(valueSpan);
    }

    group.appendChild(labelRow);

    // Control input (slider, select, etc.)
    const input = this.createControlInput(controlId, controlDef, context);
    group.appendChild(input);

    // Audio reactivity dropdown (if applicable)
    if (controlDef.audioReactive) {
      const audioControls = this.createAudioControls(controlId, context);
      group.appendChild(audioControls);
    }

    return group;
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
    console.log(`🎵 Intensity changed: ${context}.${controlId} -> ${Math.round(intensity * 100)}%`);
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
      case 'none':
        return 0;
      case 'allLevels':
        return (audioLevels.low + audioLevels.mid + audioLevels.high) / 3;
      case 'bass':
        return audioLevels.low;
      case 'mids':
        return audioLevels.mid;
      case 'highs':
        return audioLevels.high;
      // TODO: Implement other audio sources (spectral, rhythm, etc.)
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
