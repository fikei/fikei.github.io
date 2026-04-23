// Pulse: reactive preset.
//
// Designed to make musical-part transitions visible. Every visible axis and
// fast param pushes a separate knob, so when the axes shift (ambient → drop,
// sparse → dense, warm → cold) the overall image reconfigures, not just
// nudges. Use this when you want to debug or show off; use drift when you
// want calm.
//
// Knobs mapped:
//   viz.axis.density     → number of repeat tiles            (1 .. 6)
//   viz.axis.rhythmic    → edge hardness + symmetry stacks   (2 .. 6)
//   viz.axis.warmth      → hue temperature across full band
//   viz.energy           → pattern size + color saturation + "alive" gate
//   viz.transient        → per-onset flash / displacement
//   viz.beat_phase       → rotation speed and pulse timing
//   viz.brightness       → baseline luminance
//
// Silence behavior: energy's silence gate (features.js) collapses to 0
// below -50 dBFS. Everything that should quiet in silence multiplies by
// alive() and therefore comes to rest smoothly.

window.loadPulse = function loadPulse() {
  const axis = (n) => viz.axis?.[n] ?? 0;
  const pos = (n) => Math.max(0, axis(n));
  const abs = (n) => Math.abs(axis(n));

  // Smoothed silence gate. Saturates to 1 above ~energy 0.55, falls cleanly
  // to 0 when features.js hard-gates energy to 0 on silence.
  const alive = () => Math.min(1, viz.energy * 1.8);

  // Shape morphs from circle (ambient) -> triangle (rhythmic).
  const sides = () => 3 + (1 - Math.max(0, axis("rhythmic"))) * 45;
  const tileCount = () => Math.max(1, Math.round(1.5 + (axis("density") + 1) * 2.2));
  const kaleidN = () => 2 + Math.floor(pos("rhythmic") * 4);

  // Pseudo-beat: gentle pulse at detected tempo for music without a kick.
  // Scales with alive(), so silence removes it entirely. Real transients
  // dominate when present.
  const pseudoBeat = () => Math.max(0, Math.sin(viz.beat_phase * Math.PI)) * 0.25 * alive();
  const pulseAmt = () => Math.max(viz.transient, pseudoBeat());

  // Rotation and scroll: drive only the *speed* (second arg), scaled by
  // alive(). During silence the continuous motion winds down smoothly. No
  // offset in the first arg, so nothing snaps back to 0.
  const rotSpeed = () => alive() * 0.08;
  const scrollXSpeed = () => alive() * 0.03;
  const scrollYSpeed = () => alive() * 0.025;

  const base = shape(
    sides,
    () => 0.22 + viz.energy * 0.2,
    () => 0.015 + (1 - pos("rhythmic")) * 0.06    // soft when ambient, sharp when rhythmic
  )
    .repeat(tileCount, tileCount)
    .rotate(0, rotSpeed)
    .scrollX(0, scrollXSpeed)
    .scrollY(0, scrollYSpeed)
    .modulate(
      noise(
        () => 1.2 + viz.energy * 2.5,
        () => 0.06 * alive() + pulseAmt() * 0.2
      ),
      () => (0.03 + pulseAmt() * 0.35) * alive()
    )
    .modulateScale(
      noise(() => 1.5 + abs("density") * 1.5, () => 0.05 * alive()),
      () => pulseAmt() * 0.15
    );

  // Color layer. Two modes:
  //  - If the LLM supplied a palette (Stage 3), crossfade between its colors
  //    by beat_phase and energy — the palette becomes the whole hue identity.
  //  - Otherwise fall back to the old warmth-axis-driven gradient.
  const warm = axis("warmth");
  function pal(i, def) {
    const p = viz.paletteRGB;
    if (!p || p.length === 0) return def;
    return p[(i + p.length) % p.length];
  }
  const hasPalette = () => (viz.paletteRGB?.length ?? 0) >= 2;
  const colored = base
    .color(
      () => hasPalette()
        ? pal(0, [0.5, 0, 0])[0] * (0.6 + viz.energy * 0.4) +
          pal(1, [0.5, 0, 0])[0] * (0.2 + Math.sin(viz.beat_phase * Math.PI * 2) * 0.1)
        : 0.5 + warm * 0.4 + viz.brightness * 0.12,
      () => hasPalette()
        ? pal(0, [0, 0.5, 0])[1] * (0.6 + viz.energy * 0.4) +
          pal(1, [0, 0.5, 0])[1] * (0.2 + Math.sin(viz.beat_phase * Math.PI * 2) * 0.1)
        : 0.38 + viz.energy * 0.28 + warm * 0.04,
      () => hasPalette()
        ? pal(0, [0, 0, 0.5])[2] * (0.6 + viz.energy * 0.4) +
          pal(1, [0, 0, 0.5])[2] * (0.2 + Math.sin(viz.beat_phase * Math.PI * 2) * 0.1)
        : 0.55 - warm * 0.45 + (1 - viz.brightness) * 0.2
    )
    .saturate(() => 0.7 + viz.energy * 0.35)
    .contrast(() => 0.95 + pulseAmt() * 0.55 + pos("rhythmic") * 0.2)
    .brightness(() => 0.02 + pulseAmt() * 0.1)
    .kaleid(kaleidN);

  colored
    .blend(o0, () => 0.2 + viz.energy * 0.25)
    .out();
};
