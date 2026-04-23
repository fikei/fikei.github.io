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
  "organic",      // 0..1  geometric shape ↔ voronoi cell field crossfade
  "pixelate",     // 0..1  0 = native resolution, 1 = hard blocky
  "posterize",    // 0..1  0 = smooth gradients, 1 = flat color bands
  // Appearance
  "hue",          // 0..1  hue rotation; 0.5 = neutral, 0 = -π, 1 = +π
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
  organic: 0,         // 0 = pure shape, 1 = pure voronoi
  pixelate: 0,        // 0 = no pixelation
  posterize: 0,       // 0 = no posterization
  hue: 0.5,
  saturation: 0.55,
  contrast: 0.45,
  feedback: 0.65,
};

// Named starting points. Clicking a preset button in the UI sets these as
// targets — smooth transition, not a hard swap.
export const KNOB_PRESETS = {
  drift: {
    speed: 0.2, response: 0.55, density: 0.3, symmetry: 0.2, softness: 0.92,
    noise: 0.4, scale: 0.55, organic: 0.15, pixelate: 0, posterize: 0,
    hue: 0.5, saturation: 0.5, contrast: 0.4, feedback: 0.78,
  },
  pulse: {
    speed: 0.55, response: 0.8, density: 0.7, symmetry: 0.55, softness: 0.25,
    noise: 0.5, scale: 0.5, organic: 0, pixelate: 0.15, posterize: 0.2,
    hue: 0.5, saturation: 0.68, contrast: 0.65, feedback: 0.4,
  },
  minimal: {
    speed: 0.15, response: 0.45, density: 0.15, symmetry: 0.15, softness: 0.95,
    noise: 0.2, scale: 0.7, organic: 0, pixelate: 0, posterize: 0.1,
    hue: 0.5, saturation: 0.35, contrast: 0.35, feedback: 0.85,
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

import { sampleSource, DEFAULT_ROUTING, AUDIO_SOURCES } from "./sources.js";

const LOCK_STORAGE_KEY = "ss.knobLocks.v1";
const TRANS_STORAGE_KEY = "ss.transition";
const ROUTING_STORAGE_KEY = "ss.knobRouting.v1";

function loadLocks() {
  try {
    const raw = localStorage.getItem(LOCK_STORAGE_KEY);
    if (!raw) return new Set();
    const arr = JSON.parse(raw);
    return new Set(Array.isArray(arr) ? arr : []);
  } catch (e) {
    return new Set();
  }
}
function persistLocks(set) {
  try {
    localStorage.setItem(LOCK_STORAGE_KEY, JSON.stringify([...set]));
  } catch (e) {}
}

function loadRouting() {
  try {
    const raw = localStorage.getItem(ROUTING_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return typeof parsed === "object" ? parsed : null;
  } catch (e) {
    return null;
  }
}
function persistRouting(routing) {
  try {
    localStorage.setItem(ROUTING_STORAGE_KEY, JSON.stringify(routing));
  } catch (e) {}
}

export function createKnobBus(initial = DEFAULT_KNOBS) {
  const current = {};        // final routed value (what engine reads)
  const baseline = {};       // eased-toward-target static value before routing
  const target = {};
  const overrideUntil = {};
  const locked = loadLocks();        // Set<knobName>
  // Per-knob audio-source routing. Each entry is { source, intensity }.
  // Loaded from localStorage if present, else the built-in defaults that
  // mirror the hardcoded reactivity engine.js used to have.
  const routing = Object.fromEntries(
    KNOB_NAMES.map((n) => {
      const d = DEFAULT_ROUTING[n] || { source: "none", intensity: 0 };
      return [n, { source: d.source, intensity: d.intensity }];
    }),
  );
  const stored = loadRouting();
  if (stored) {
    for (const n of KNOB_NAMES) {
      if (!stored[n]) continue;
      if (typeof stored[n].source === "string" && AUDIO_SOURCES[stored[n].source]) {
        routing[n].source = stored[n].source;
      }
      if (typeof stored[n].intensity === "number") {
        routing[n].intensity = Math.max(0, Math.min(1, stored[n].intensity));
      }
    }
  }
  let transitionMode = DEFAULT_TRANSITION;

  window.viz = window.viz || {};
  window.viz.knob = window.viz.knob || {};

  for (const name of KNOB_NAMES) {
    const v = initial[name] ?? 0.5;
    current[name] = v;
    baseline[name] = v;
    target[name] = v;
    window.viz.knob[name] = v;
  }

  // LLM / preset button path. A write is rejected if:
  //   - the knob is explicitly locked, OR
  //   - the user manually dragged it within the override window.
  function setTargets(next) {
    const now = performance.now();
    for (const [name, v] of Object.entries(next || {})) {
      if (!(name in current)) continue;
      if (locked.has(name)) continue;
      if (overrideUntil[name] && overrideUntil[name] > now) continue;
      target[name] = Math.max(0, Math.min(1, v));
    }
  }

  // Manual slider path — always applies, even for locked knobs (a lock
  // without manual control would be useless). Dragging is how you set
  // the held value. Snaps baseline + target so routing wraps around the
  // new set-point on the next tick.
  function setManual(name, v) {
    if (!(name in current)) return;
    const clamped = Math.max(0, Math.min(1, v));
    baseline[name] = clamped;
    current[name] = clamped;
    target[name] = clamped;
    overrideUntil[name] = performance.now() + OVERRIDE_HOLD_MS;
    window.viz.knob[name] = clamped;
  }

  // Baseline = static set-point after target easing but before audio
  // routing. This is what the sidebar slider should display, so the
  // handle reflects "what's set" without jiggling with every kick.
  function getBaseline(name) { return baseline[name] ?? 0; }

  // Lock / unlock individual primitives. Locks persist to localStorage.
  function lock(name) {
    if (!(name in current)) return;
    locked.add(name);
    persistLocks(locked);
  }
  function unlock(name) {
    locked.delete(name);
    persistLocks(locked);
  }
  function toggleLock(name) {
    if (locked.has(name)) locked.delete(name);
    else if (name in current) locked.add(name);
    persistLocks(locked);
    return locked.has(name);
  }
  function isLocked(name) { return locked.has(name); }
  function lockedNames() { return [...locked]; }
  function setAllLocked(shouldLock) {
    if (shouldLock) for (const n of KNOB_NAMES) locked.add(n);
    else locked.clear();
    persistLocks(locked);
  }

  // Call once per animation frame. Two-stage update:
  //   1. baseline eases toward target at the user-selected transition rate
  //      (this is the slow, intent-driven layer — LLM, preset, drag).
  //   2. final = clamp(baseline + audioSource * intensity, 0, 1)
  //      (fast, music-reactive layer — no easing so music response is live).
  // The engine reads window.viz.knob which always contains the final value.
  function tick() {
    const ease = TRANSITION_MODES[transitionMode]?.ease ?? 0.04;
    for (const name of KNOB_NAMES) {
      // Stage 1: baseline
      const b = baseline[name];
      const t = target[name];
      if (Math.abs(t - b) < 1e-4 || ease >= 1) {
        baseline[name] = t;
      } else {
        baseline[name] = b + (t - b) * ease;
      }
      // Stage 2: apply audio-source routing on top
      const r = routing[name] || { source: "none", intensity: 0 };
      const sig = r.intensity > 0 ? sampleSource(r.source) : 0;
      const final = Math.max(
        0,
        Math.min(1, baseline[name] + sig * r.intensity),
      );
      current[name] = final;
      window.viz.knob[name] = final;
    }
  }

  function setTransition(mode) {
    if (TRANSITION_MODES[mode]) transitionMode = mode;
  }
  function getTransition() { return transitionMode; }

  function setSource(name, sourceKey) {
    if (!(name in routing)) return;
    if (!AUDIO_SOURCES[sourceKey]) return;
    routing[name].source = sourceKey;
    persistRouting(routing);
  }
  function setIntensity(name, v) {
    if (!(name in routing)) return;
    routing[name].intensity = Math.max(0, Math.min(1, v));
    persistRouting(routing);
  }
  function getSource(name) { return routing[name]?.source ?? "none"; }
  function getIntensity(name) { return routing[name]?.intensity ?? 0; }

  function get(name) { return current[name] ?? 0; }
  function getTarget(name) { return target[name] ?? 0; }
  function snapshot() { return { ...current }; }

  return {
    setTargets, setManual, tick, get, getTarget, snapshot,
    setTransition, getTransition,
    lock, unlock, toggleLock, isLocked, lockedNames, setAllLocked,
    setSource, setIntensity, getSource, getIntensity,
    getBaseline,
  };
}
