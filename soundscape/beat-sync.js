// =====================================================
// BEAT SYNC ENHANCEMENTS
// =====================================================
// Tap tempo, quantization, beat visualization, and
// clock sync for professional VJ performance

class BeatSyncManager {
  constructor(beatDetector, bpmDetector) {
    this.beatDetector = beatDetector;
    this.bpmDetector = bpmDetector;

    // Tap tempo state
    this.tapTimes = [];
    this.maxTaps = 8;
    this.tapTimeout = 2000; // Reset taps after 2s of inactivity
    this.lastTapTime = 0;
    this.manualBPM = null;
    this.bpmMode = 'auto'; // 'auto' or 'manual'

    // Quantization state
    this.quantizeMode = 'off'; // 'off', 'beat', 'bar', '4bar'
    this.lastBeatTime = 0;
    this.beatCount = 0;
    this.barCount = 0;
    this.timeSignature = 4; // 4/4 time

    // Beat visualization
    this.beatPhase = 0; // 0-3 for quarter notes
    this.beatIntensity = 0; // 0-1, decays over time
    this.flashOnBeat = false;

    // Clock sync (future: Ableton Link, MIDI clock)
    this.externalClock = null;
    this.clockSource = 'internal'; // 'internal', 'link', 'midi'

    console.log('🎵 BeatSyncManager initialized');
  }

  /**
   * Tap tempo - call this when user taps button
   */
  tap() {
    const now = performance.now();

    // Reset taps if too much time has passed
    if (now - this.lastTapTime > this.tapTimeout) {
      this.tapTimes = [];
      this.beatCount = 0;
      console.log('🔄 Tap tempo reset');
    }

    this.tapTimes.push(now);
    this.lastTapTime = now;

    // Need at least 2 taps to calculate BPM
    if (this.tapTimes.length >= 2) {
      this.calculateTapBPM();
    }

    // Limit history
    if (this.tapTimes.length > this.maxTaps) {
      this.tapTimes.shift();
    }

    console.log(`👆 Tap ${this.tapTimes.length}: ${this.manualBPM ? this.manualBPM.toFixed(1) + ' BPM' : 'calculating...'}`);
  }

  /**
   * Calculate BPM from tap times
   */
  calculateTapBPM() {
    if (this.tapTimes.length < 2) return;

    // Calculate intervals between taps
    const intervals = [];
    for (let i = 1; i < this.tapTimes.length; i++) {
      intervals.push(this.tapTimes[i] - this.tapTimes[i - 1]);
    }

    // Average interval
    const avgInterval = intervals.reduce((sum, i) => sum + i, 0) / intervals.length;

    // Convert to BPM
    this.manualBPM = 60000 / avgInterval;

    // Clamp to realistic range
    this.manualBPM = Math.max(60, Math.min(200, this.manualBPM));

    // Switch to manual mode
    this.bpmMode = 'manual';

    console.log(`🎹 Manual BPM set: ${this.manualBPM.toFixed(1)} BPM (from ${this.tapTimes.length} taps)`);
  }

  /**
   * Get current BPM (manual or auto-detected)
   */
  getBPM() {
    if (this.bpmMode === 'manual' && this.manualBPM !== null) {
      return this.manualBPM;
    }
    return this.bpmDetector.getBPM();
  }

  /**
   * Set BPM mode
   */
  setBPMMode(mode) {
    if (mode !== 'auto' && mode !== 'manual') {
      console.warn(`⚠️ Invalid BPM mode: ${mode}`);
      return false;
    }

    this.bpmMode = mode;
    console.log(`🎵 BPM mode: ${mode}`);

    if (mode === 'auto') {
      this.manualBPM = null;
      this.tapTimes = [];
    }

    return true;
  }

  /**
   * Set manual BPM directly
   */
  setManualBPM(bpm) {
    bpm = Math.max(60, Math.min(200, bpm));
    this.manualBPM = bpm;
    this.bpmMode = 'manual';
    console.log(`🎹 Manual BPM set: ${bpm} BPM`);
  }

  /**
   * Set quantize mode
   */
  setQuantizeMode(mode) {
    const validModes = ['off', 'beat', 'bar', '4bar'];
    if (!validModes.includes(mode)) {
      console.warn(`⚠️ Invalid quantize mode: ${mode}`);
      return false;
    }

    this.quantizeMode = mode;
    console.log(`🎯 Quantize mode: ${mode}`);
    return true;
  }

  /**
   * Update beat tracking (call this in animation loop)
   */
  update(beatDetected, timestamp) {
    if (beatDetected) {
      this.lastBeatTime = timestamp;
      this.beatCount++;
      this.beatPhase = this.beatCount % this.timeSignature;
      this.beatIntensity = 1.0;

      // Track bars (4 beats per bar in 4/4 time)
      if (this.beatCount % this.timeSignature === 0) {
        this.barCount++;
      }

      console.log(`🥁 Beat ${this.beatCount} (phase ${this.beatPhase}, bar ${this.barCount})`);
    }

    // Decay beat intensity
    this.beatIntensity *= 0.9;
  }

  /**
   * Check if action should be triggered based on quantization
   * Returns true if action should fire NOW
   */
  shouldTrigger(timestamp) {
    if (this.quantizeMode === 'off') {
      // No quantization - trigger immediately
      return true;
    }

    const bpm = this.getBPM();
    const beatInterval = 60000 / bpm; // ms per beat
    const timeSinceLastBeat = timestamp - this.lastBeatTime;

    // Define quantization window (allow triggering within this many ms of the beat)
    const quantizeWindow = beatInterval * 0.1; // 10% of beat interval

    switch (this.quantizeMode) {
      case 'beat':
        // Trigger on any beat
        return timeSinceLastBeat < quantizeWindow;

      case 'bar':
        // Trigger on downbeat (first beat of bar)
        return this.beatPhase === 0 && timeSinceLastBeat < quantizeWindow;

      case '4bar':
        // Trigger every 4 bars
        return this.beatPhase === 0 &&
               (this.barCount % 4 === 0) &&
               timeSinceLastBeat < quantizeWindow;

      default:
        return true;
    }
  }

  /**
   * Get time until next quantized trigger point (in ms)
   */
  getTimeUntilNextTrigger() {
    if (this.quantizeMode === 'off') {
      return 0;
    }

    const bpm = this.getBPM();
    const beatInterval = 60000 / bpm;
    const timeSinceLastBeat = performance.now() - this.lastBeatTime;

    switch (this.quantizeMode) {
      case 'beat':
        // Next beat
        return beatInterval - timeSinceLastBeat;

      case 'bar':
        // Next downbeat
        const beatsUntilBar = this.timeSignature - this.beatPhase;
        return (beatsUntilBar * beatInterval) - timeSinceLastBeat;

      case '4bar':
        // Next 4-bar boundary
        const barsUntil4Bar = 4 - (this.barCount % 4);
        const beatsUntil4Bar = (barsUntil4Bar * this.timeSignature) - this.beatPhase;
        return (beatsUntil4Bar * beatInterval) - timeSinceLastBeat;

      default:
        return 0;
    }
  }

  /**
   * Get beat indicator states (for 4 quarter notes)
   */
  getBeatIndicators() {
    return [0, 1, 2, 3].map(i => ({
      phase: i,
      active: i === this.beatPhase,
      intensity: i === this.beatPhase ? this.beatIntensity : 0
    }));
  }

  /**
   * Get current state for UI
   */
  getState() {
    return {
      bpm: this.getBPM(),
      bpmMode: this.bpmMode,
      confidence: this.bpmMode === 'auto' ? this.bpmDetector.getConfidence() : 1.0,
      quantizeMode: this.quantizeMode,
      beatPhase: this.beatPhase,
      beatCount: this.beatCount,
      barCount: this.barCount,
      beatIntensity: this.beatIntensity,
      beatIndicators: this.getBeatIndicators(),
      tapCount: this.tapTimes.length
    };
  }

  /**
   * Reset beat tracking
   */
  reset() {
    this.beatCount = 0;
    this.barCount = 0;
    this.beatPhase = 0;
    this.beatIntensity = 0;
    this.lastBeatTime = 0;
    console.log('🔄 Beat tracking reset');
  }

  /**
   * Reset tap tempo
   */
  resetTap() {
    this.tapTimes = [];
    this.lastTapTime = 0;
    console.log('🔄 Tap tempo cleared');
  }
}

// Export for use in main app
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { BeatSyncManager };
}
