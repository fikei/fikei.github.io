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

  // Sides range 3..60 with softness. **Integer-quantized** because Hydra's
  // `shape(sides)` bakes sides into the fragment shader; feeding it a
  // rapidly-varying float causes the shader to recompile every frame,
  // which stalls the GPU. Stepping it in integer jumps during knob glides
  // is invisible visually but removes the churn.
  const sides = () => {
    const s = k("softness");
    return Math.round(3 + Math.pow(s, 2) * 57);
  };
  // Repeat tiles 1..6 — Hydra expects integers for repeat too.
  const tileCount = () => Math.max(1, Math.round(1 + k("density") * 5));
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

  // Per-band routing is no longer hardcoded — users (and eventually the
  // LLM) route audio sources to specific knobs via the Primitives panel.
  // Each knob's `viz.knob[name]` already reflects baseline + routing,
  // so here we just read k(...) and trust the routing layer. The engine
  // still reads energy / transient / beat_phase directly because they're
  // inherent to the visual language (alive-gate on silence, onset flash).

  const noiseSpeedF = () => 0.04 + speedK() * 0.2;
  const noiseFreqF = () => 1 + k("noise") * 3.5;
  const modAmount = () =>
    k("noise") * 0.4 * alive() + pulseAmt() * 0.25 * responseK();

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

  // Single noise source feeding both modulate and modulateScale. Rendering
  // noise twice per frame was doubling a full-screen pass. Sharing one
  // noise texture as input to both halves the noise-sampling work.
  const sharedNoise = noise(noiseFreqF, noiseSpeedF);

  // Voronoi cell field as an alternate base. `organic` knob crossfades
  // between the shape-based base and the voronoi base via .blend().
  // organic=0 → pure geometric shape, organic=1 → pure cell field,
  // in-between yields a hybrid.
  const voronoiBase = voronoi(
    () => 3 + k("density") * 9,              // cell count follows density
    () => 0.05 + speedK() * 0.25,            // cell drift speed
    () => 0.2 + k("softness") * 0.7,         // blending / edge smoothness
  );

  // Pixelate mapping: knob 0..1 → pixel-count 1024..5 (exponential so low
  // values are near-native and only the top of the range looks blocky).
  const pixelateN = () => Math.pow(2, 10 - k("pixelate") * 7.5);

  // Posterize bins: knob 0..1 → bins 200..2 (also exponential, so the
  // effect doesn't become visible until the top ~40% of the knob range).
  const posterizeBins = () =>
    Math.max(2, Math.round(200 * Math.pow(1 - k("posterize"), 2) + 2));

  shape(sides, patternScale, edgeBlur)
    .repeat(tileCount, tileCount)
    .rotate(0, rotSpeed)
    .scrollX(0, scrollXSpeed)
    .scrollY(0, scrollYSpeed)
    // Blend in voronoi base by the `organic` knob. Value 0 = no voronoi.
    .blend(voronoiBase, () => k("organic"))
    .modulate(sharedNoise, modAmount)
    .modulateScale(
      sharedNoise,
      () => k("noise") * 0.1 * alive() + pulseAmt() * 0.12 * responseK(),
    )
    .color(colorR, colorG, colorB)
    .saturate(saturate)
    .contrast(contrastF)
    .brightness(brightnessAdj)
    // `hue` knob rotates the color wheel post-color. 0.5 = neutral.
    .hue(() => (k("hue") - 0.5) * Math.PI * 2)
    // `posterize` quantizes the color space. Near-invisible below ~0.4
    // on the knob (many bins); becomes hard flat bands above ~0.7.
    .posterize(posterizeBins, 1)
    .kaleid(kaleidN)
    // `pixelate` is the last visual op so blockiness covers everything.
    // Keeping it after kaleid means the blocks line up with the image,
    // not with the kaleid segments.
    .pixelate(pixelateN, pixelateN)
    .blend(o0, feedbackAmt)
    .out();
};
