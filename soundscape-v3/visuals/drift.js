// Drift: default preset.
//
// Slow, particle-like noise field that breathes with the music.
// Reads:
//   viz.energy           overall intensity / density (fast EMA)
//   viz.transient        kick/snare pulses, fast decay
//   viz.beat_phase       0..1 sawtooth between beats
//   viz.brightness       spectral centroid -> hue temperature
//   viz.axis.warmth      -1..1 cold↔warm (CLAP, Stage 2)
//   viz.axis.rhythmic    -1..1 ambient↔rhythmic
//   viz.axis.density     -1..1 sparse↔dense
//
// Every dynamic value must be a function: () => viz.x.
// Axis reads use ?? 0 so they degrade cleanly when CLAP isn't loaded.

window.loadDrift = function loadDrift() {
  // A low, slow noise field. Baseline is dark and calm. Music nudges it —
  // it never shouts. Transients are felt, not flashed. Rotation is a fraction
  // of a radian per beat, not a full revolution. Saturation stays well under 1.

  const base = osc(
    () => 1.2 + viz.energy * 1.8,               // was 4 + energy*10
    () => 0.008 + viz.beat_phase * 0.02,        // was 0.02 + phase*0.08
    () => 0.25 + viz.brightness * 0.3
  )
    .rotate(() => viz.beat_phase * 0.35, 0.01)  // was full 2π per beat
    .modulate(
      noise(
        () => 0.8 + viz.energy * 1.0,
        () => 0.04 + viz.transient * 0.08
      ),
      () => 0.05 + viz.transient * 0.12         // was up to 0.67
    )
    .modulateScale(
      noise(1.2, 0.02),
      () => 0.02 + viz.transient * 0.06
    )
    .color(
      // warmth axis: warm nudges red, cold nudges blue — gentle amount
      () => 0.18 + viz.brightness * 0.35 + (viz.axis?.warmth ?? 0) * 0.12,
      () => 0.22 + viz.energy * 0.18,
      () => 0.42 + (1.0 - viz.brightness) * 0.22 - (viz.axis?.warmth ?? 0) * 0.12
    )
    .saturate(() => 0.55 + viz.energy * 0.2)    // was up to 1.5, now max ~0.75
    // rhythmic axis tightens contrast; ambient softens
    .contrast(() => 0.85 + viz.transient * 0.35 + Math.max(0, viz.axis?.rhythmic ?? 0) * 0.15)
    .brightness(-0.08);                         // darker baseline — meditative

  // Feedback blend softens transients into afterimages. This is the single
  // biggest "quiet" knob: heavier blend = more smear, less intensity.
  base.blend(o0, () => 0.55 + viz.transient * 0.15).out();
};
