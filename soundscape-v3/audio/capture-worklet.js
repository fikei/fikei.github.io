// Captures raw mono audio samples and posts them back to the main thread
// in fixed-size chunks. Used to feed the 4-second ring buffer that CLAP
// inference draws from.
//
// This runs on the audio thread (128 samples per `process` call) so it must
// never allocate in the hot path.

const CHUNK_SAMPLES = 4800; // ~100ms at 48kHz

class CaptureProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this._buf = new Float32Array(CHUNK_SAMPLES);
    this._pos = 0;
  }

  process(inputs) {
    const ch = inputs[0] && inputs[0][0];
    if (!ch) return true;
    const n = ch.length;
    let i = 0;
    while (i < n) {
      const room = CHUNK_SAMPLES - this._pos;
      const take = Math.min(room, n - i);
      this._buf.set(ch.subarray(i, i + take), this._pos);
      this._pos += take;
      i += take;
      if (this._pos >= CHUNK_SAMPLES) {
        // transfer ownership, allocate a fresh buffer
        this.port.postMessage(this._buf, [this._buf.buffer]);
        this._buf = new Float32Array(CHUNK_SAMPLES);
        this._pos = 0;
      }
    }
    return true;
  }
}

registerProcessor("capture", CaptureProcessor);
