// Audio-source routing catalog.
//
// Each knob in the primitives bus can be bound to one of these sources.
// Per frame the engine resolves each knob as
//   final = clamp(target + normalize(source, viz) * intensity, 0, 1)
// so the source effectively adds a live wobble on top of the LLM/preset-set
// baseline value. A source of "none" (intensity 0) means the knob stays at
// its static target.
//
// Every normalize() must return a value in roughly [-1, +1] so the
// intensity slider has consistent meaning across sources.

export const AUDIO_SOURCES = {
  none: {
    label: "none",
    group: "basic",
    description: "static, no music modulation",
    normalize: () => 0,
  },

  // --- loudness / level -------------------------------------------------
  energy: {
    label: "energy",
    group: "level",
    description: "broadband loudness (RMS)",
    // 0..1 → -1..+1 so the knob is nudged up when louder than average,
    // down when quieter.
    normalize: (v) => (v.energy ?? 0) * 2 - 1,
  },

  // --- frequency bands --------------------------------------------------
  low: {
    label: "bass (low)",
    group: "bands",
    description: "20–250 Hz — kick, sub, bassline",
    normalize: (v) => (v.low ?? 0) * 2 - 1,
  },
  mid: {
    label: "mid",
    group: "bands",
    description: "250 Hz–4 kHz — vocals, body",
    normalize: (v) => (v.mid ?? 0) * 2 - 1,
  },
  high: {
    label: "high",
    group: "bands",
    description: "4 kHz+ — hats, shimmer, air",
    normalize: (v) => (v.high ?? 0) * 2 - 1,
  },

  // --- rhythm / transients ---------------------------------------------
  transient: {
    label: "transient",
    group: "rhythm",
    description: "kick/snare onset envelope (fast decay)",
    // 0..1 envelope; peaks at onsets, decays. Always additive (+), so
    // transient pushes knobs UP on hits and returns to baseline.
    normalize: (v) => v.transient ?? 0,
  },
  beat: {
    label: "beat",
    group: "rhythm",
    description: "sine pulse aligned to detected tempo",
    // Oscillates -1..+1 once per beat. Good for breathing/swing effects.
    normalize: (v) => Math.sin((v.beat_phase ?? 0) * Math.PI * 2),
  },

  // --- spectral ---------------------------------------------------------
  brightness: {
    label: "brightness",
    group: "spectral",
    description: "spectral centroid (bright ↔ dark)",
    normalize: (v) => (v.brightness ?? 0.3) * 2 - 1,
  },
};

// Ordered groups for the dropdown UI.
export const SOURCE_GROUPS = [
  { id: "basic", label: "basic" },
  { id: "level", label: "level" },
  { id: "bands", label: "frequency bands" },
  { id: "rhythm", label: "rhythm" },
  { id: "spectral", label: "spectral" },
];

export function sampleSource(sourceKey, viz = window.viz) {
  const src = AUDIO_SOURCES[sourceKey];
  if (!src) return 0;
  try {
    return src.normalize(viz);
  } catch (e) {
    return 0;
  }
}

// Default per-knob routing — matches the hardcoded routing that engine.js
// used to have, so behavior with zero user config is equivalent to before.
// LLM compiles / preset clicks can override these.
export const DEFAULT_ROUTING = {
  speed:      { source: "beat",       intensity: 0.1 },
  response:   { source: "energy",     intensity: 0.15 },
  density:    { source: "low",        intensity: 0.12 },
  symmetry:   { source: "none",       intensity: 0 },
  softness:   { source: "none",       intensity: 0 },
  noise:      { source: "high",       intensity: 0.2 },
  scale:      { source: "mid",        intensity: 0.1 },
  hue:        { source: "none",       intensity: 0 },
  saturation: { source: "energy",     intensity: 0.1 },
  contrast:   { source: "transient",  intensity: 0.25 },
  feedback:   { source: "none",       intensity: 0 },
};
