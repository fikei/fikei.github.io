// Stage 2 — in-browser CLAP.
//
// - Loads Xenova/clap-htsat-unfused via transformers.js (WebGPU, q8).
// - Keeps a rolling 4-second ring buffer of the mic signal via an
//   AudioWorkletNode.
// - Runs audio-feature inference every ~1s.
// - Caches text-feature embeddings per axis; recomputes only on prompt change.
// - Publishes cosine-similarity-based axis values into window.viz.axis.
//
// Graceful degradation: if load or inference fails, axes stay at 0 and the
// fast path continues untouched.

import {
  env,
  AutoTokenizer,
  AutoProcessor,
  ClapTextModelWithProjection,
  ClapAudioModelWithProjection,
} from "https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.0.2/dist/transformers.min.js";

// Do not let transformers.js try to load from local paths — use the HF hub.
env.allowLocalModels = false;
env.useBrowserCache = true;

const MODEL_ID = "Xenova/clap-htsat-unfused";
const RING_SECONDS = 4;
const INFERENCE_PERIOD_MS = 1000;
const CLAP_SAMPLE_RATE = 48000;

function cosine(a, b) {
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  return dot / (Math.sqrt(na) * Math.sqrt(nb) + 1e-9);
}

export async function startClap({
  ctx,
  source,
  axes,             // [{ name, positive, negative }, ...]
  onAxis,           // (name, value ∈ [-1,1]) => void
  onStatus = () => {},
  onProgress = () => {},
} = {}) {
  const state = {
    textModel: null,
    audioModel: null,
    tokenizer: null,
    processor: null,
    textCache: new Map(), // name -> { pos: Float32Array, neg: Float32Array, posKey, negKey }
    ring: new Float32Array(ctx.sampleRate * RING_SECONDS),
    writePtr: 0,
    samplesSeen: 0,
    axes,
    running: false,
    inferenceInFlight: false,
    inferenceCount: 0,
    lastInferenceMs: 0,
    lastRingRms: 0,
    lastRawAxes: {},   // per-axis {sp, sn, raw}
    lastEmbedMag: 0,
  };

  // Expose for live debugging from the browser console:
  //    clapDiag()  -> snapshot
  window.clapDiag = () => ({
    inferenceCount: state.inferenceCount,
    lastInferenceMs: state.lastInferenceMs,
    samplesSeen: state.samplesSeen,
    ringRms: state.lastRingRms,
    embedMag: state.lastEmbedMag,
    raw: state.lastRawAxes,
  });
  window.viz.clap = window.viz.clap || {};

  // ----- attach the capture worklet -----
  onStatus("audio capture…");
  // Relative path so the app works from any subpath (e.g.
  // ctrl.rodeo/soundscape-v3/). Resolved against the module's own URL.
  const workletUrl = new URL("./capture-worklet.js", import.meta.url);
  await ctx.audioWorklet.addModule(workletUrl.href);
  const capture = new AudioWorkletNode(ctx, "capture");
  source.connect(capture);
  // NOTE: we don't connect to destination — we're only tapping the signal.

  capture.port.onmessage = (ev) => {
    const chunk = ev.data; // Float32Array
    const n = chunk.length;
    state.samplesSeen += n;
    const end = state.writePtr + n;
    if (end <= state.ring.length) {
      state.ring.set(chunk, state.writePtr);
    } else {
      const first = state.ring.length - state.writePtr;
      state.ring.set(chunk.subarray(0, first), state.writePtr);
      state.ring.set(chunk.subarray(first), 0);
    }
    state.writePtr = end % state.ring.length;
  };
  // Some browsers only pull through an AudioWorkletNode when its output is
  // connected to an active sink. Route to a muted gain -> destination so the
  // processor actually runs even though we don't want to hear anything.
  const sink = ctx.createGain();
  sink.gain.value = 0;
  capture.connect(sink).connect(ctx.destination);

  // ----- load models -----
  //
  // transformers.js v3 splits CLAP into two projection models — one each
  // for text and audio. Docs:
  //   https://huggingface.co/Xenova/clap-htsat-unfused
  // Each returns { text_embeds } / { audio_embeds } with dims [batch, 512].
  async function loadWithFallback(Cls, tag) {
    try {
      return await Cls.from_pretrained(MODEL_ID, {
        dtype: "q8",
        device: "webgpu",
        progress_callback: (p) => onProgress(p),
      });
    } catch (err) {
      console.warn(`[clap] ${tag} webgpu failed, falling back to wasm:`, err);
      return await Cls.from_pretrained(MODEL_ID, {
        dtype: "q8",
        device: "wasm",
        progress_callback: (p) => onProgress(p),
      });
    }
  }

  onStatus("loading clap…");
  try {
    state.tokenizer = await AutoTokenizer.from_pretrained(MODEL_ID, {
      progress_callback: (p) => onProgress(p),
    });
    state.processor = await AutoProcessor.from_pretrained(MODEL_ID, {
      progress_callback: (p) => onProgress(p),
    });
    state.textModel = await loadWithFallback(ClapTextModelWithProjection, "text");
    state.audioModel = await loadWithFallback(ClapAudioModelWithProjection, "audio");
  } catch (e) {
    console.error("[clap] model load failed:", e);
    onStatus("clap disabled");
    return { state, ready: false };
  }
  onStatus("clap ready");

  // Extracts a flat Float32Array from whatever shape the model returns.
  // transformers.js v3 has returned both `{ audio_embeds: Tensor }` and raw
  // Tensors from CLAP across versions, so be defensive.
  function extractEmbedding(out) {
    if (!out) return null;
    if (out.audio_embeds?.data) return out.audio_embeds.data;
    if (out.text_embeds?.data) return out.text_embeds.data;
    if (out.embeds?.data) return out.embeds.data;
    if (out.last_hidden_state?.data) return out.last_hidden_state.data;
    if (out.data) return out.data;
    // dict-like single key
    const first = Object.values(out)[0];
    if (first?.data) return first.data;
    return null;
  }

  // ----- text embedding cache -----
  async function ensureTextEmbeddings() {
    for (const ax of state.axes) {
      const posKey = ax.positive;
      const negKey = ax.negative;
      const existing = state.textCache.get(ax.name);
      if (existing && existing.posKey === posKey && existing.negKey === negKey) continue;

      const inputs = state.tokenizer([posKey, negKey], {
        padding: true,
        truncation: true,
      });
      const out = await state.textModel(inputs);
      const flat = extractEmbedding(out);
      if (!flat) {
        console.warn("[clap] text features returned unexpected shape:", out);
        continue;
      }
      const dim = flat.length / 2;
      const pos = new Float32Array(flat.slice(0, dim));
      const neg = new Float32Array(flat.slice(dim));
      state.textCache.set(ax.name, { pos, neg, posKey, negKey });
    }
  }

  function snapshotRing() {
    // return contiguous buffer ending at the latest sample
    const out = new Float32Array(state.ring.length);
    const tail = state.ring.length - state.writePtr;
    out.set(state.ring.subarray(state.writePtr), 0);
    out.set(state.ring.subarray(0, state.writePtr), tail);
    return out;
  }

  async function maybeResample(buf, fromSr, toSr) {
    if (fromSr === toSr) return buf;
    const offline = new OfflineAudioContext(
      1,
      Math.ceil((buf.length * toSr) / fromSr),
      toSr,
    );
    const ab = offline.createBuffer(1, buf.length, fromSr);
    ab.getChannelData(0).set(buf);
    const src = offline.createBufferSource();
    src.buffer = ab;
    src.connect(offline.destination);
    src.start();
    const rendered = await offline.startRendering();
    return rendered.getChannelData(0).slice();
  }

  function rms(buf) {
    let s = 0;
    for (let i = 0; i < buf.length; i++) s += buf[i] * buf[i];
    return Math.sqrt(s / buf.length);
  }

  async function inferOnce() {
    if (state.inferenceInFlight) return;
    state.inferenceInFlight = true;
    const t0 = performance.now();
    try {
      await ensureTextEmbeddings();
      const raw = snapshotRing();
      state.lastRingRms = rms(raw);
      // Skip inference if the ring is basically silent — saves compute.
      if (state.lastRingRms < 1e-4) {
        state.inferenceInFlight = false;
        return;
      }
      const audio = await maybeResample(raw, ctx.sampleRate, CLAP_SAMPLE_RATE);
      const audioInputs = await state.processor(audio);
      const audioOut = await state.audioModel(audioInputs);
      const audioEmb = extractEmbedding(audioOut);
      if (!audioEmb) {
        console.warn("[clap] audio features returned unexpected shape:", audioOut);
        state.inferenceInFlight = false;
        return;
      }
      let mag = 0;
      for (let i = 0; i < audioEmb.length; i++) mag += audioEmb[i] * audioEmb[i];
      state.lastEmbedMag = Math.sqrt(mag);

      for (const ax of state.axes) {
        const cached = state.textCache.get(ax.name);
        if (!cached) continue;
        const sp = cosine(audioEmb, cached.pos);
        const sn = cosine(audioEmb, cached.neg);
        const diff = sp - sn;
        // Soft saturation. Native cosine diffs typically range ~[-0.2, +0.2].
        // Gain 4 + tanh gives headroom without railing: diff=0.25 -> ~0.76,
        // diff=0.1 -> ~0.38, diff=0.05 -> ~0.20. Smooth near zero, soft at
        // the extremes instead of a hard clamp.
        const val = Math.tanh(diff * 4);
        state.lastRawAxes[ax.name] = {
          sp: +sp.toFixed(4),
          sn: +sn.toFixed(4),
          diff: +diff.toFixed(4),
          val: +val.toFixed(3),
        };
        onAxis(ax.name, val);
      }
      state.inferenceCount += 1;
      state.lastInferenceMs = performance.now() - t0;
      if (state.inferenceCount <= 3) {
        console.log("[clap] inference ok", state.inferenceCount, "ms=", Math.round(state.lastInferenceMs),
                    "ringRms=", state.lastRingRms.toFixed(4), "embedMag=", state.lastEmbedMag.toFixed(3),
                    "raw=", state.lastRawAxes);
      }
    } catch (e) {
      console.warn("[clap] inference failed:", e);
    } finally {
      state.inferenceInFlight = false;
    }
  }

  // ----- inference loop -----
  state.running = true;
  let nextAt = performance.now() + INFERENCE_PERIOD_MS;
  async function loop() {
    if (!state.running) return;
    const now = performance.now();
    if (now >= nextAt) {
      nextAt = now + INFERENCE_PERIOD_MS;
      await inferOnce();
    }
    setTimeout(loop, 50);
  }
  loop();

  function rewireSource(nextSource) {
    // The source node changed (e.g. user switched input devices). Reconnect
    // the capture worklet to the new source.
    try { source.disconnect(capture); } catch (e) {}
    nextSource.connect(capture);
    source = nextSource;
    // clear the ring so we don't mix inputs
    state.ring.fill(0);
    state.writePtr = 0;
  }

  return {
    state,
    ready: true,
    setAxes(next) { state.axes = next; },
    stop() { state.running = false; },
    rewireSource,
  };
}
