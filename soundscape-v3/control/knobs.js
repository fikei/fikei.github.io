// Knob bus — continuous, smoothed, manually-overridable parameters.
//
// Every knob is a 0..1 float with a `current` value (what the engine reads)
// and a `target` value (what the LLM / preset / user wants it to be).
// Each rAF tick, current eases toward target. All transitions between
// compile calls, preset clicks, or manual drags flow through this single
// bus, so nothing ever snaps.
//
// Knobs are also published on window.viz.knob[name] so visual presets can
// read them without importing this module.

export const KNOB_NAMES = [
  // Motion
  "speed",        // 0..1  overall rate of autonomous + beat-driven motion
  "response",     // 0..1  how strongly music modulates the image
  // Structure
  "density",      // 0..1  number of repeat tiles
  "symmetry",     // 0..1  kaleid stacks
  "softness",     // 0..1  shape edge smoothness (0 = sharp polygon, 1 = circle)
  "noise",        // 0..1  noise modulation depth
  "scale",        // 0..1  pattern size
  // Appearance
  "saturation",   // 0..1
  "contrast",     // 0..1
  "feedback",     // 0..1  persistence / frame blend
];

// Starting values — a middle-ground that reads as a calm drift. Preset
// buttons and LLM compile override these via setTargets.
export const DEFAULT_KNOBS = {
  speed: 0.25,
  response: 0.6,
  density: 0.35,
  symmetry: 0.25,
  softness: 0.85,
  noise: 0.35,
  scale: 0.55,
  saturation: 0.55,
  contrast: 0.45,
  feedback: 0.65,
};

// Named starting points. Clicking a preset button in the UI sets these as
// targets — smooth transition, not a hard swap.
export const KNOB_PRESETS = {
  drift: {
    speed: 0.2, response: 0.55, density: 0.3, symmetry: 0.2, softness: 0.92,
    noise: 0.4, scale: 0.55, saturation: 0.5, contrast: 0.4, feedback: 0.78,
  },
  pulse: {
    speed: 0.55, response: 0.8, density: 0.7, symmetry: 0.55, softness: 0.25,
    noise: 0.5, scale: 0.5, saturation: 0.68, contrast: 0.65, feedback: 0.4,
  },
  minimal: {
    speed: 0.15, response: 0.45, density: 0.15, symmetry: 0.15, softness: 0.95,
    noise: 0.2, scale: 0.7, saturation: 0.35, contrast: 0.35, feedback: 0.85,
  },
};

// Transition modes. Maps to per-frame ease rate at 60 Hz. User-selectable
// via the sidebar. `smooth` is the default — fast enough to feel live,
// slow enough to avoid cuts.
export const TRANSITION_MODES = {
  cut:    { label: "cut",    ease: 1.0,   approxMs: 0 },     // instant snap
  fast:   { label: "fast",   ease: 0.12,  approxMs: 180 },
  smooth: { label: "smooth", ease: 0.04,  approxMs: 500 },   // default
  slow:   { label: "slow",   ease: 0.012, approxMs: 1800 },
  glide:  { label: "glide",  ease: 0.005, approxMs: 4500 },  // ambient mood drift
};
export const DEFAULT_TRANSITION = "smooth";
// Manual override: while active, ignore LLM/preset writes to this knob.
const OVERRIDE_HOLD_MS = 2500;

export function createKnobBus(initial = DEFAULT_KNOBS) {
  const current = {};
  const target = {};
  const overrideUntil = {};
  let transitionMode = DEFAULT_TRANSITION;

  window.viz = window.viz || {};
  window.viz.knob = window.viz.knob || {};

  for (const name of KNOB_NAMES) {
    current[name] = initial[name] ?? 0.5;
    target[name] = initial[name] ?? 0.5;
    window.viz.knob[name] = current[name];
  }

  // LLM / preset button path — respects manual override hold.
  function setTargets(next) {
    const now = performance.now();
    for (const [name, v] of Object.entries(next || {})) {
      if (!(name in current)) continue;
      if (overrideUntil[name] && overrideUntil[name] > now) continue;
      target[name] = Math.max(0, Math.min(1, v));
    }
  }

  // Manual slider path — snaps current to the value and holds.
  function setManual(name, v) {
    if (!(name in current)) return;
    const clamped = Math.max(0, Math.min(1, v));
    current[name] = clamped;
    target[name] = clamped;
    overrideUntil[name] = performance.now() + OVERRIDE_HOLD_MS;
    window.viz.knob[name] = clamped;
  }

  // Call once per animation frame. Eases every knob toward its target
  // at the currently selected transition rate.
  function tick() {
    const ease = TRANSITION_MODES[transitionMode]?.ease ?? 0.04;
    for (const name of KNOB_NAMES) {
      const c = current[name];
      const t = target[name];
      if (Math.abs(t - c) < 1e-4 || ease >= 1) {
        current[name] = t;
      } else {
        current[name] = c + (t - c) * ease;
      }
      window.viz.knob[name] = current[name];
    }
  }

  function setTransition(mode) {
    if (TRANSITION_MODES[mode]) transitionMode = mode;
  }
  function getTransition() { return transitionMode; }

  function get(name) { return current[name] ?? 0; }
  function getTarget(name) { return target[name] ?? 0; }
  function snapshot() { return { ...current }; }

  return {
    setTargets, setManual, tick, get, getTarget, snapshot,
    setTransition, getTransition,
  };
}
