// SoundScape Stage 1.5 — web-native audio feature extractor.
//
// Reads user mic (or a synthetic loopback source), computes the /viz/ fast
// params, and writes them into window.viz on every animation frame.
//
// Contract (same as PARAMS.md):
//   viz.energy       0..1   RMS, adaptive-gain normalized, fast EMA
//   viz.transient    0..1   onset envelope, τ≈200ms decay
//   viz.beat_phase   0..1   sawtooth between detected beats
//   viz.brightness   0..1   spectral centroid, exponential-scaled
//   viz.bpm          40..220
//
// No server, no Python, no WebSocket. All in-tab.

const ONSET_THRESHOLD_DEFAULT = 0.3;
const ONSET_DEBOUNCE = 0.08;
const TRANSIENT_TAU = 0.2;
const ALPHA_FAST = 0.3;
const ALPHA_SLOW = 0.02;
// Absolute silence floor. Below this raw RMS (roughly -50 dBFS) the fast
// params are forced to decay: adaptive gain alone would chase the noise
// floor down and start reporting "activity" during silence.
const SILENCE_RMS = 0.003;
// Don't let the adaptive-gain reference fall below this: prevents energy ~ 1
// when the room is dead quiet.
const MIN_ENERGY_MAX = 0.02;
const MIN_FLUX_MAX = 0.8;

// Synthetic 120 BPM kick + drone, mirrors audio_worker.py's --loopback mode.
function createLoopbackSource(ctx) {
  const node = ctx.createGain();
  node.gain.value = 1.0;

  // kick: triggered by a periodic pulse
  const kickOsc = ctx.createOscillator();
  kickOsc.type = "sine";
  kickOsc.frequency.value = 60;
  const kickGain = ctx.createGain();
  kickGain.gain.value = 0;
  kickOsc.connect(kickGain).connect(node);
  kickOsc.start();

  // drone
  const drone = ctx.createOscillator();
  drone.type = "sine";
  drone.frequency.value = 220;
  const droneGain = ctx.createGain();
  droneGain.gain.value = 0.15;
  drone.connect(droneGain).connect(node);
  drone.start();

  // 120 BPM = 0.5s per beat. Schedule exponential-decay kick envelopes.
  const bpm = 120;
  const period = 60 / bpm;
  let next = ctx.currentTime + 0.1;
  function schedule() {
    while (next < ctx.currentTime + 1.0) {
      kickGain.gain.setValueAtTime(0.9, next);
      kickGain.gain.exponentialRampToValueAtTime(0.0001, next + 0.25);
      next += period;
    }
  }
  setInterval(schedule, 250);
  schedule();

  return node;
}

export async function listInputDevices() {
  try {
    const devs = await navigator.mediaDevices.enumerateDevices();
    return devs
      .filter((d) => d.kind === "audioinput")
      .map((d) => ({ deviceId: d.deviceId, label: d.label, groupId: d.groupId }));
  } catch (e) {
    return [];
  }
}

export async function startAudio({
  loopback = false,
  deviceId = null,
  onsetThreshold = ONSET_THRESHOLD_DEFAULT,
  onStatus = () => {},
} = {}) {
  const Ctx = window.AudioContext || window.webkitAudioContext;
  const ctx = new Ctx({ latencyHint: "interactive" });

  let source;
  let currentStream = null;
  if (loopback) {
    onStatus("loopback — synthetic 120 BPM kick");
    source = createLoopbackSource(ctx);
  } else {
    onStatus("requesting mic…");
    const constraints = {
      audio: {
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false,
        channelCount: 1,
      },
    };
    if (deviceId && deviceId !== "default") {
      constraints.audio.deviceId = { exact: deviceId };
    }
    currentStream = await navigator.mediaDevices.getUserMedia(constraints);
    const track = currentStream.getAudioTracks()[0];
    const label = track?.label || "default input";
    onStatus(`${label} @ ${ctx.sampleRate} Hz`);
    source = ctx.createMediaStreamSource(currentStream);
  }

  const analyser = ctx.createAnalyser();
  analyser.fftSize = 1024;
  analyser.smoothingTimeConstant = 0.0; // we smooth ourselves
  source.connect(analyser);

  // Audio graph demand: OscillatorNode (loopback) and AudioWorkletNode
  // (CLAP capture) only process samples when something downstream pulls.
  // Route the source through a permanently-muted gain to ctx.destination
  // so the graph always runs, regardless of whether CLAP is active.
  const mute = ctx.createGain();
  mute.gain.value = 0;
  source.connect(mute).connect(ctx.destination);

  // Browsers create AudioContexts in a suspended state until a user gesture.
  // Start was clicked so this should succeed.
  if (ctx.state !== "running") {
    try { await ctx.resume(); } catch (e) { console.warn("[audio] resume failed:", e); }
  }

  // Expose for debugging.
  window.__ctx = ctx;
  window.__source = source;
  window.__analyser = analyser;

  const bins = analyser.frequencyBinCount; // 512
  const freqBuf = new Float32Array(bins); // dB
  const magBuf = new Float32Array(bins);
  const prevMag = new Float32Array(bins);
  const timeBuf = new Float32Array(analyser.fftSize);

  const nyq = ctx.sampleRate / 2;
  const freqs = new Float32Array(bins);
  for (let i = 0; i < bins; i++) freqs[i] = (i / bins) * nyq;
  const logNyq = Math.log1p(nyq);

  const state = {
    energy: 0,
    energy_slow: 0,
    transient: 0,
    beat_phase: 0,
    brightness: 0.3,
    brightness_slow: 0.3,
    bpm: 120,
    lastOnsetTime: 0,
    lastBeatTime: performance.now() / 1000,
    beatInterval: 0.5,
    fluxRunningMax: 1e-6,
    energyRunningMax: 1e-6,
    onsetTimes: [],
    prevCallTime: performance.now() / 1000,
  };

  function tick() {
    const now = performance.now() / 1000;
    const dt = Math.max(0.001, now - state.prevCallTime);
    state.prevCallTime = now;

    analyser.getFloatTimeDomainData(timeBuf);
    analyser.getFloatFrequencyData(freqBuf);

    // --- RMS energy with adaptive gain ------------------------------------
    let ssq = 0;
    for (let i = 0; i < timeBuf.length; i++) ssq += timeBuf[i] * timeBuf[i];
    const rms = Math.sqrt(ssq / timeBuf.length);
    const isSilent = rms < SILENCE_RMS;
    // Running max decays slowly but never below MIN_ENERGY_MAX, so in silence
    // we don't divide by noise floor and fake activity.
    state.energyRunningMax = Math.max(
      MIN_ENERGY_MAX,
      Math.max(state.energyRunningMax * 0.9995, rms)
    );
    const energyNorm = isSilent
      ? 0
      : Math.min(1, (rms - SILENCE_RMS) / (state.energyRunningMax + 1e-9));

    // --- Spectral centroid + flux ----------------------------------------
    let total = 0;
    let centroidAcc = 0;
    let flux = 0;
    for (let i = 0; i < bins; i++) {
      // dB → linear
      const m = Math.pow(10, freqBuf[i] / 20);
      magBuf[i] = m;
      total += m;
      centroidAcc += freqs[i] * m;
      const d = m - prevMag[i];
      if (d > 0) flux += d;
      prevMag[i] = m;
    }
    const centroid = total > 1e-9 ? centroidAcc / total : 0;
    const bright = Math.max(0, Math.min(1, Math.log1p(centroid) / logNyq));

    state.fluxRunningMax = Math.max(
      MIN_FLUX_MAX,
      Math.max(state.fluxRunningMax * 0.999, flux)
    );
    const fluxNorm = flux / (state.fluxRunningMax + 1e-9);

    // --- Onset detect ----------------------------------------------------
    // Gate onset firing on absolute silence so we don't interpret noise-floor
    // spectral flicker as kicks.
    const onsetFired =
      !isSilent &&
      fluxNorm > onsetThreshold &&
      now - state.lastOnsetTime > ONSET_DEBOUNCE;

    if (onsetFired) {
      state.lastOnsetTime = now;
      state.transient = Math.max(state.transient, Math.min(1, fluxNorm));

      // Feed into simple inter-onset-interval beat tracker.
      state.onsetTimes.push(now);
      const cutoff = now - 8;
      while (state.onsetTimes.length && state.onsetTimes[0] < cutoff) {
        state.onsetTimes.shift();
      }
      if (state.onsetTimes.length >= 4) {
        const iois = [];
        for (let i = 1; i < state.onsetTimes.length; i++) {
          iois.push(state.onsetTimes[i] - state.onsetTimes[i - 1]);
        }
        iois.sort((a, b) => a - b);
        let med = iois[Math.floor(iois.length / 2)];
        // fold to sensible BPM range (60..200)
        while (med > 1.0) med /= 2;
        while (med < 0.3) med *= 2;
        const newBpm = 60 / med;
        if (newBpm >= 40 && newBpm <= 220) {
          state.bpm = state.bpm * 0.7 + newBpm * 0.3;
          state.beatInterval = 60 / state.bpm;
          state.lastBeatTime = now;
        }
      }
    }

    // transient decay
    state.transient *= Math.exp(-dt / TRANSIENT_TAU);

    // EMAs
    state.energy = (1 - ALPHA_FAST) * state.energy + ALPHA_FAST * energyNorm;
    state.energy_slow =
      (1 - ALPHA_SLOW) * state.energy_slow + ALPHA_SLOW * energyNorm;
    state.brightness = (1 - ALPHA_FAST) * state.brightness + ALPHA_FAST * bright;
    state.brightness_slow =
      (1 - ALPHA_SLOW) * state.brightness_slow + ALPHA_SLOW * bright;

    // beat phase
    if (state.beatInterval > 0.05) {
      state.beat_phase =
        ((now - state.lastBeatTime) / state.beatInterval) % 1;
    }

    // publish
    const viz = window.viz;
    viz.energy = state.energy;
    viz.transient = state.transient;
    viz.beat_phase = state.beat_phase;
    viz.brightness = state.brightness;
    viz.bpm = state.bpm;

    requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);

  // Live source switching: tear down the old MediaStreamSource, build a new
  // one from the requested input device, and return the new source node so
  // downstream consumers (CLAP capture worklet) can re-wire themselves.
  async function switchDevice(newDeviceId) {
    if (loopback) throw new Error("cannot switch device while in loopback");
    const nextConstraints = {
      audio: {
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false,
        channelCount: 1,
      },
    };
    if (newDeviceId && newDeviceId !== "default") {
      nextConstraints.audio.deviceId = { exact: newDeviceId };
    }
    const nextStream = await navigator.mediaDevices.getUserMedia(nextConstraints);
    const nextSource = ctx.createMediaStreamSource(nextStream);
    // swap connections
    try { source.disconnect(); } catch (e) {}
    try { currentStream?.getTracks().forEach((t) => t.stop()); } catch (e) {}
    currentStream = nextStream;
    nextSource.connect(analyser);
    nextSource.connect(mute).connect(ctx.destination);
    source = nextSource;
    window.__source = nextSource;
    const label = nextStream.getAudioTracks()[0]?.label || "default input";
    onStatus(`${label} @ ${ctx.sampleRate} Hz`);
    // consumers can call returned.getSource() to get the latest node
    return nextSource;
  }

  return { ctx, source, state, switchDevice, getSource: () => source };
}
