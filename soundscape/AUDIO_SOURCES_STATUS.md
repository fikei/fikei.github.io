# Audio Sources Implementation Status

## Current Status: ⚠️ Only Basic Sources Implemented

While the control system UI shows **25+ audio source options**, only **5 are actually functional**. The rest return a fallback value (mids) with a console warning.

---

## ✅ Implemented Audio Sources (5/25)

These audio sources are **fully functional**:

| Source ID | Label | Implementation | Status |
|-----------|-------|----------------|--------|
| `none` | None (Static) | Returns 0 | ✅ Working |
| `allLevels` | All Levels (Combined) | Average of bass/mids/highs | ✅ Working |
| `bass` | Bass (60-250 Hz) | Uses `audioLevels.low` | ✅ Working |
| `mids` | Mids (500-2000 Hz) | Uses `audioLevels.mid` | ✅ Working |
| `highs` | Highs (4000-8000 Hz) | Uses `audioLevels.high` | ✅ Working |

### How Basic Audio Analysis Works

The current implementation uses a simple FFT-based frequency band analysis:

```javascript
// In index.html, audio analysis loop:
const bufferLength = analyser.frequencyBinCount;
const dataArray = new Uint8Array(bufferLength);
analyser.getByteFrequencyData(dataArray);

// Split into 3 bands
for (let i = 0; i < bufferLength; i++) {
    if (i < bufferLength * 0.3) lowSum += dataArray[i];        // Bass
    else if (i < bufferLength * 0.7) midSum += dataArray[i];   // Mids
    else highSum += dataArray[i];                              // Highs
}

const lowLevel = lowSum / (bufferLength * 0.3) / 255;
const midLevel = midSum / (bufferLength * 0.4) / 255;
const highLevel = highSum / (bufferLength * 0.3) / 255;
```

---

## ❌ Not Yet Implemented (20 sources)

These sources are **defined in the UI but NOT functional**:

### Frequency Bands (5)
| Source ID | Label | Status |
|-----------|-------|--------|
| `subBass` | Sub-Bass (20-60 Hz) | ❌ Not implemented |
| `lowMids` | Low-Mids (250-500 Hz) | ❌ Not implemented |
| `highMids` | High-Mids (2000-4000 Hz) | ❌ Not implemented |
| `brilliance` | Brilliance (8000-20000 Hz) | ❌ Not implemented |

### Amplitude (3)
| Source ID | Label | Status |
|-----------|-------|--------|
| `peak` | Peak Level | ❌ Not implemented |
| `rms` | RMS (Loudness) | ❌ Not implemented |
| `decibels` | Decibels (dB) | ❌ Not implemented |

### Rhythm (3)
| Source ID | Label | Status |
|-----------|-------|--------|
| `beat` | Beat Detection (Kick) | ❌ Not implemented |
| `onset` | Onset Detection | ❌ Not implemented |
| **`bpm`** | **BPM (Tempo)** | ❌ **Not implemented** |

### Dynamics (3)
| Source ID | Label | Status |
|-----------|-------|--------|
| `attack` | Attack (Sudden Hits) | ❌ Not implemented |
| `transients` | Transients (Percussive) | ❌ Not implemented |
| `envelope` | Envelope Follower | ❌ Not implemented |

### Spectral (4)
| Source ID | Label | Status |
|-----------|-------|--------|
| `centroid` | Spectral Centroid (Brightness) | ❌ Not implemented |
| `flux` | Spectral Flux (Change Rate) | ❌ Not implemented |
| `rolloff` | Spectral Rolloff | ❌ Not implemented |
| `zcr` | Zero Crossing Rate | ❌ Not implemented |

### Musical (2)
| Source ID | Label | Status |
|-----------|-------|--------|
| `pitch` | Pitch Detection | ❌ Not implemented |
| `harmonic` | Harmonic Energy | ❌ Not implemented |

---

## 🔍 Code Location

The TODO is clearly marked in the code:

**File**: `soundscape/control-system.js`
**Function**: `AudioModulationEngine.getAudioLevel()`
**Line**: ~1737

```javascript
getAudioLevel(sourceId, audioLevels) {
    // ... existing code ...

    switch (mappedId) {
      case 'none':
        return 0;
      case 'allLevels':
        return (audioLevels.low + audioLevels.mid + audioLevels.high) / 3;
      case 'bass':
        return audioLevels.low;
      case 'mids':
        return audioLevels.mid;
      case 'highs':
        return audioLevels.high;

      // TODO: Implement other audio sources (spectral, rhythm, etc.)
      default:
        console.warn(`Audio source not yet implemented: ${mappedId}`);
        return audioLevels.mid; // Fallback to mid
    }
}
```

---

## 📋 Implementation Plan for Missing Audio Sources

### Phase 1: Additional Frequency Bands (Easy) - 2 hours
**Complexity**: Low
**Value**: High

Implement more granular frequency analysis:

```javascript
// Split FFT into 7 bands instead of 3
case 'subBass':    // 20-60 Hz (bins 0-5%)
case 'lowMids':    // 250-500 Hz (bins 20-35%)
case 'highMids':   // 2000-4000 Hz (bins 70-80%)
case 'brilliance': // 8000-20000 Hz (bins 90-100%)
```

### Phase 2: Amplitude Features (Easy) - 1 hour
**Complexity**: Low
**Value**: Medium

Calculate from existing frequency data:

```javascript
case 'peak':
    return Math.max(...dataArray) / 255;

case 'rms':
    const sumSquares = dataArray.reduce((sum, val) => sum + val*val, 0);
    return Math.sqrt(sumSquares / dataArray.length) / 255;

case 'decibels':
    const rms = /* calculate RMS */;
    return 20 * Math.log10(rms);
```

### Phase 3: Beat & Onset Detection (Medium) - 4-6 hours
**Complexity**: Medium
**Value**: Very High

Implement beat tracking:

```javascript
// Beat detection algorithm
class BeatDetector {
    constructor() {
        this.energyHistory = [];
        this.threshold = 1.3;
    }

    detectBeat(currentEnergy) {
        const avgEnergy = this.energyHistory.reduce((a,b) => a+b, 0) / this.energyHistory.length;
        const isBeat = currentEnergy > avgEnergy * this.threshold;

        this.energyHistory.push(currentEnergy);
        if (this.energyHistory.length > 43) this.energyHistory.shift(); // ~1 second at 43 FPS

        return isBeat ? 1.0 : 0.0;
    }
}
```

### Phase 4: BPM Detection (Hard) - 6-8 hours
**Complexity**: High
**Value**: Very High

Implement tempo tracking:

**Approach**: Use autocorrelation on beat intervals

```javascript
class BPMDetector {
    constructor() {
        this.beatTimes = [];
    }

    addBeat(timestamp) {
        this.beatTimes.push(timestamp);
        if (this.beatTimes.length > 100) this.beatTimes.shift();
    }

    calculateBPM() {
        if (this.beatTimes.length < 8) return 120; // Default

        // Calculate intervals between beats
        const intervals = [];
        for (let i = 1; i < this.beatTimes.length; i++) {
            intervals.push(this.beatTimes[i] - this.beatTimes[i-1]);
        }

        // Find most common interval (mode)
        const avgInterval = median(intervals);
        return 60000 / avgInterval; // Convert ms to BPM
    }
}
```

### Phase 5: Spectral Features (Hard) - 8-10 hours
**Complexity**: High
**Value**: Medium

Implement advanced audio analysis:

**Spectral Centroid** (brightness):
```javascript
let weightedSum = 0, sum = 0;
for (let i = 0; i < dataArray.length; i++) {
    weightedSum += dataArray[i] * i;
    sum += dataArray[i];
}
const centroid = weightedSum / sum;
```

**Spectral Flux** (change rate):
```javascript
if (!this.prevSpectrum) this.prevSpectrum = new Float32Array(dataArray);
let flux = 0;
for (let i = 0; i < dataArray.length; i++) {
    const diff = dataArray[i] - this.prevSpectrum[i];
    flux += diff > 0 ? diff : 0;
}
this.prevSpectrum.set(dataArray);
```

### Phase 6: Musical Features (Very Hard) - 10-15 hours
**Complexity**: Very High
**Value**: Medium-High

**Pitch Detection**: Use autocorrelation or YIN algorithm
**Harmonic Detection**: Use harmonic product spectrum

**Recommendation**: Consider using a library like [Meyda](https://meyda.js.org/) which provides all these features out-of-the-box.

---

## 📊 Implementation Priority

| Priority | Features | Complexity | Time | Impact |
|----------|----------|------------|------|--------|
| 🔴 **HIGH** | Beat Detection | Medium | 4-6h | Very High |
| 🔴 **HIGH** | BPM Detection | High | 6-8h | Very High |
| 🟡 **MEDIUM** | Additional Freq Bands | Low | 2h | High |
| 🟡 **MEDIUM** | Amplitude Features | Low | 1h | Medium |
| 🟢 **LOW** | Spectral Features | High | 8-10h | Medium |
| 🟢 **LOW** | Musical Features | Very High | 10-15h | Medium |

**Recommended Order**:
1. Additional Frequency Bands (quick win)
2. Amplitude Features (quick win)
3. Beat Detection (high user value)
4. BPM Detection (high user value)
5. Consider using [Meyda](https://meyda.js.org/) library for remaining features

---

## 🚀 Quick Implementation with Meyda

**Fastest Path**: Integrate the Meyda audio analysis library

```bash
npm install meyda
# or
<script src="https://unpkg.com/meyda/dist/web/meyda.min.js"></script>
```

Meyda provides **instant access** to all these features:
- ✅ RMS, Energy, Loudness
- ✅ Spectral Centroid, Flux, Rolloff, Flatness
- ✅ Zero Crossing Rate
- ✅ Chroma (pitch classes)
- ✅ MFCC (timbre features)

**Integration time**: 2-3 hours instead of 30+ hours for manual implementation

---

## 📝 Current User Experience

**What Users See**: 25+ audio source options in dropdowns
**What Actually Works**: 5 basic sources (bass, mids, highs, all levels, none)
**What Happens**: Selecting unimplemented sources shows console warning and defaults to mids

**Console Output**:
```
⚠️ Audio source not yet implemented: bpm
⚠️ Audio source not yet implemented: beat
⚠️ Audio source not yet implemented: centroid
```

---

## ✅ Recommendation

**For immediate use**:
- Stick to: Bass, Mids, Highs, All Levels
- These are stable and well-tested

**For future development**:
1. **Quick win** (3 hours): Add more frequency bands + amplitude features
2. **High value** (10-14 hours): Add beat & BPM detection
3. **Complete solution** (2-3 hours): Integrate Meyda library

**Best approach**: Use Meyda for professional-grade audio analysis instead of reinventing the wheel.

---

*Last Updated: 2025-12-23*
*Status: Only 5/25 audio sources functional*
