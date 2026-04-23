// Stage 2 — semantic-axis control layer.
//
// Owns three hardcoded CLAP axes (LLM will override in Stage 3). Smooths
// incoming raw axis values with a slow EMA and publishes them to
// `window.viz.axis[name]`. Also exposes the current axis definitions so UI
// can render editable prompts.

export const DEFAULT_AXES = [
  {
    name: "warmth",
    positive: "warm, organic, analog, vintage, wooden",
    negative: "cold, digital, synthetic, metallic, sterile",
  },
  {
    name: "rhythmic",
    positive: "rhythmic, percussive, beat-driven, kick drum, groove",
    negative: "ambient, drone, sustained, atmospheric, stillness",
  },
  {
    name: "density",
    positive: "dense, busy, layered, full, packed arrangement",
    negative: "sparse, minimal, empty, solo instrument, quiet",
  },
];

const ALPHA_SLOW = 0.25; // axis values update at ~1Hz, smoothing is light

export function createAxisBus(initial = DEFAULT_AXES) {
  const axes = initial.map((a) => ({ ...a }));
  const raw = Object.fromEntries(axes.map((a) => [a.name, 0]));
  const smoothed = Object.fromEntries(axes.map((a) => [a.name, 0]));

  // Shared viz.axis object — dynamic presets read it every rAF.
  window.viz = window.viz || {};
  window.viz.axis = window.viz.axis || {};
  for (const a of axes) window.viz.axis[a.name] = 0;

  // Per-axis manual override. While `overrideUntil[name] > now`, CLAP writes
  // are ignored. Users drag a slider -> we pin the value for a couple seconds
  // so CLAP doesn't immediately fight them, then slowly hand control back.
  const overrideValue = {};
  const overrideUntil = {};
  const OVERRIDE_HOLD_MS = 2500;

  function onAxis(name, value) {
    if (overrideUntil[name] && performance.now() < overrideUntil[name]) {
      // during manual hold, ignore CLAP but keep `smoothed` tracking the
      // manual value so the hand-back is continuous
      smoothed[name] = overrideValue[name];
      window.viz.axis[name] = overrideValue[name];
      return;
    }
    raw[name] = value;
    smoothed[name] =
      (1 - ALPHA_SLOW) * smoothed[name] + ALPHA_SLOW * value;
    window.viz.axis[name] = smoothed[name];
  }

  function setManual(name, value) {
    const v = Math.max(-1, Math.min(1, value));
    overrideValue[name] = v;
    overrideUntil[name] = performance.now() + OVERRIDE_HOLD_MS;
    smoothed[name] = v;
    raw[name] = v;
    window.viz.axis[name] = v;
  }

  function get(name) { return smoothed[name] ?? 0; }
  function setAxes(next) {
    const keepNames = new Set(next.map((a) => a.name));
    axes.length = 0;
    for (const a of next) axes.push({ ...a });
    // Prune entries whose axis no longer exists so viz.axis.* doesn't ghost
    // old values into presets.
    for (const k of Object.keys(raw)) if (!keepNames.has(k)) delete raw[k];
    for (const k of Object.keys(smoothed)) if (!keepNames.has(k)) delete smoothed[k];
    for (const k of Object.keys(window.viz.axis)) if (!keepNames.has(k)) delete window.viz.axis[k];
    for (const k of Object.keys(overrideValue)) if (!keepNames.has(k)) delete overrideValue[k];
    for (const k of Object.keys(overrideUntil)) if (!keepNames.has(k)) delete overrideUntil[k];
    for (const a of axes) {
      if (!(a.name in raw)) raw[a.name] = 0;
      if (!(a.name in smoothed)) smoothed[a.name] = 0;
      if (!(a.name in window.viz.axis)) window.viz.axis[a.name] = 0;
    }
  }

  return { axes, onAxis, get, setAxes, setManual };
}
