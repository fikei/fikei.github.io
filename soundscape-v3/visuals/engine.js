// Unified engine — one Hydra chain driven entirely by the knob bus.
//
// No more preset swaps. Every visual shift is a smooth move through knob
// space: click "Drift" → knobs ease to drift targets; LLM sets knobs; user
// drags individual primitives. The engine never tears down.
//
// Music inputs drive the engine too, weighted by the `response` knob so
// the LLM can dial "music-reactive ↔ static" independently of the other
// primitives.
//
// Dynamic values must be functions (Hydra reads them each frame) so knob
// changes take effect continuously.

window.loadEngine = function loadEngine() {
  // Short accessors keep the chain readable.
  const k = (name) => viz.knob?.[name] ?? 0.5;
  const axis = (name) => viz.axis?.[name] ?? 0;

  // Silence gate: features.js forces energy to 0 under ~-50 dBFS, so this
  // smoothly winds down autonomous motion when the room is quiet.
  const alive = () => Math.min(1, viz.energy * 1.8);

  // Pseudo-beat — gentle pulse at detected tempo for music without
  // percussion. Real transients exceed it and take over.
  const pulseAmt = () =>
    Math.max(
      viz.transient,
      Math.max(0, Math.sin(viz.beat_phase * Math.PI)) * 0.25 * alive(),
    );

  // ----- shape parameters ---------------------------------------------------

  // Sides range 3..60 with softness. Exponential mapping so the low end
  // (angular polygons) has more resolution than the high end (circle).
  const sides = () => {
    const s = k("softness");
    return 3 + Math.pow(s, 2) * 57;
  };
  // Repeat tiles 1..6 (continuous, non-integer values work fine with .repeat)
  const tileCount = () => 1 + k("density") * 5;
  // Kaleid stacks 2..8
  const kaleidN = () => Math.max(2, Math.round(2 + k("symmetry") * 6));
  // Pattern size
  const patternScale = () => 0.15 + k("scale") * 0.35;
  // Edge softness (Hydra's shape third arg)
  const edgeBlur = () => 0.005 + k("softness") * 0.1;

  // ----- motion rates -------------------------------------------------------

  // All motion scales by alive() so silence stops it. Music-reactive motion
  // scales by the `response` knob on top of audio signals.
  const speedK = () => k("speed");
  const responseK = () => k("response");

  const rotSpeed = () =>
    alive() * (speedK() * 0.08 + pulseAmt() * 0.06 * responseK());
  const scrollXSpeed = () =>
    alive() * (speedK() * 0.03 + Math.sin(viz.beat_phase * Math.PI * 2) * 0.01 * responseK());
  const scrollYSpeed = () => alive() * speedK() * 0.025;

  // Frequency-band response: bass drives low-freq modulation, highs drive
  // texture detail. Each weighted by `response` so the LLM can turn down
  // music-reactivity without zeroing out the musical information.
  const lowDrive = () => (viz.low ?? 0) * responseK();
  const midDrive = () => (viz.mid ?? 0) * responseK();
  const highDrive = () => (viz.high ?? 0) * responseK();

  // Noise parameters: `noise` knob sets depth; bass modulates speed (slow
  // bass → slow wobble), highs add fine texture.
  const noiseSpeedF = () => 0.04 + speedK() * 0.15 + highDrive() * 0.3;
  const noiseFreqF = () => 1 + k("noise") * 2.5 + lowDrive() * 1.5;
  const modAmount = () =>
    k("noise") * 0.35 * alive() +
    pulseAmt() * 0.25 * responseK() +
    midDrive() * 0.08;

  // ----- color --------------------------------------------------------------

  // Palette blending: when a palette is supplied (Stage 3), crossfade
  // between palette[0] (base) and palette[1] (accent) by beat_phase with
  // mid-band audio. When no palette, fall back to a warmth-axis gradient.
  function channel(i, hasFallback, fallbackFn) {
    const pal = viz.paletteRGB;
    if (!pal || pal.length === 0) return fallbackFn();
    const base = pal[0][i];
    const accent = pal[1 % pal.length][i];
    const deep = (pal[2 % pal.length])[i];
    const beatMix =
      0.5 + Math.sin(viz.beat_phase * Math.PI * 2) * 0.5;    // 0..1
    // base carries most of the image; accent injects by beat; deep anchors
    return (
      base * (0.55 + viz.energy * 0.25) +
      accent * (0.15 + beatMix * 0.15 * responseK()) +
      deep * 0.12
    );
  }
  const warm = () => axis("warmth");
  const colorR = () =>
    channel(0, true, () =>
      0.45 + warm() * 0.4 + viz.brightness * 0.12
    );
  const colorG = () =>
    channel(1, true, () =>
      0.35 + viz.energy * 0.3 + warm() * 0.04
    );
  const colorB = () =>
    channel(2, true, () =>
      0.55 - warm() * 0.45 + (1 - viz.brightness) * 0.2
    );

  const saturate = () => 0.3 + k("saturation") * 1.0;
  const contrastF = () =>
    0.7 + k("contrast") * 0.6 + pulseAmt() * 0.4 * responseK();
  const brightnessAdj = () => -0.05 + pulseAmt() * 0.1 * responseK();
  const feedbackAmt = () => k("feedback") * 0.85;

  // ----- the chain ---------------------------------------------------------
  //
  // One shape field, one noise modulator, one color pass, one feedback
  // blend. Every term reads a knob, an axis, or a music value. No branches,
  // no swaps.

  shape(sides, patternScale, edgeBlur)
    .repeat(tileCount, tileCount)
    .rotate(0, rotSpeed)
    .scrollX(0, scrollXSpeed)
    .scrollY(0, scrollYSpeed)
    .modulate(
      noise(noiseFreqF, noiseSpeedF),
      modAmount,
    )
    .modulateScale(
      noise(() => 1.2 + k("noise") * 1.5, () => 0.03 + speedK() * 0.04),
      () => k("noise") * 0.1 * alive() + pulseAmt() * 0.12 * responseK(),
    )
    .color(colorR, colorG, colorB)
    .saturate(saturate)
    .contrast(contrastF)
    .brightness(brightnessAdj)
    .kaleid(kaleidN)
    .blend(o0, feedbackAmt)
    .out();
};
