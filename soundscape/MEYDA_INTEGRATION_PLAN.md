# Meyda Hybrid Integration - Project Plan

## Strategy: Best of Both Worlds

**Approach**: Keep our superior custom implementations and add Meyda for advanced features we don't have.

---

## Implementation Philosophy

### ✅ **Keep Our Custom Features** (Superior/Unique)
- **Beat Detection** - Our algorithm is excellent, tuned for visual responsiveness
- **BPM Detection** - Our implementation is solid, provides confidence scoring
- **Onset Detection** - Simple and effective
- **7-Band Frequency Analysis** - Fast, optimized, easy to understand
- **Basic Amplitude** (Peak, RMS, dB) - Already working well

### ⭐ **Add Meyda Features** (Professional-grade)
- **Spectral Features** - Centroid, Flux, Rolloff, Flatness, Spread
- **Perceptual Features** - Loudness (perceptual), MFCC (timbre)
- **Musical Features** - Chroma (pitch classes)
- **Advanced Dynamics** - More sophisticated envelope tracking

**Rationale**:
- Our beat/BPM detection is specifically tuned for visual reactivity
- Our frequency bands are simple and performant
- Meyda provides scientifically accurate spectral/perceptual features we lack
- No duplication - each system does what it's best at

---

## Phase 1: Planning & Setup (1 hour)

### Task 1.1: Dependency Integration
**Objective**: Add Meyda library to project

**Steps**:
1. Add Meyda CDN link to `index.html` head:
   ```html
   <script src="https://unpkg.com/meyda@5.6.0/dist/web/meyda.min.js"></script>
   ```
2. Verify library loads correctly
3. Check for any conflicts with existing code
4. Test page still renders

**Acceptance Criteria**:
- Meyda object available in console
- No console errors
- Page loads normally

**Time Estimate**: 15 minutes

---

### Task 1.2: Feature Selection
**Objective**: Choose which Meyda features to extract

**Selected Features** (7 total):
1. **spectralCentroid** - Brightness/where frequency energy is centered
2. **spectralFlatness** - Tonality vs noisiness (0=tonal, 1=noise)
3. **spectralRolloff** - Frequency below which 85% of energy lies
4. **spectralFlux** - Rate of spectral change (good for transitions)
5. **spectralSpread** - Variance of spectrum around centroid
6. **loudness** - Perceptual loudness (better than RMS for human perception)
7. **chroma** - 12 pitch class energies (C, C#, D, D#, etc.)

**Not Using** (too advanced/not needed):
- ~~MFCC~~ - Too complex, 13 coefficients, overkill for visuals
- ~~spectralKurtosis/Skewness~~ - Too academic, limited visual value
- ~~complexSpectrum~~ - Raw data, we have our own FFT access
- ~~zcr~~ - Zero crossing rate, marginal value

**Acceptance Criteria**:
- Feature list documented
- Understand what each feature represents
- Know how to normalize each (0-1)

**Time Estimate**: 15 minutes

---

### Task 1.3: Architecture Design
**Objective**: Design how Meyda integrates with existing system

**Architecture**:
```
Audio Input
    ↓
Web Audio API (Analyser Node)
    ↓
FFT Data Array
    ↓
    ├─→ Our Custom Analysis (in audio loop)
    │   ├─ 7-band frequency analysis
    │   ├─ Peak/RMS/dB calculation
    │   ├─ Beat detection
    │   ├─ BPM detection
    │   └─ Onset detection
    │
    └─→ Meyda Analysis (parallel)
        ├─ Spectral features (5)
        └─ Perceptual features (2)
    ↓
Combined audioLevels Object
    ↓
Control System (audioEngine.getAudioLevel())
    ↓
Visual Renderers
```

**Integration Point**: Run Meyda.extract() in parallel with our analysis, merge results into `state.audioLevels`

**Acceptance Criteria**:
- Clear separation of concerns
- No duplication
- Minimal performance impact
- Easy to maintain

**Time Estimate**: 30 minutes

---

## Phase 2: Core Integration (2-3 hours)

### Task 2.1: Meyda Initialization
**Objective**: Set up Meyda analyzer in audio system

**Implementation**:
```javascript
// Add to state initialization
state.meydaAnalyzer = null;

// In setupAudio() after analyser creation
if (typeof Meyda !== 'undefined') {
    state.meydaAnalyzer = Meyda.createMeydaAnalyzer({
        audioContext: state.audioContext,
        source: state.source,
        bufferSize: 512,
        featureExtractors: [
            'spectralCentroid',
            'spectralFlatness',
            'spectralRolloff',
            'spectralFlux',
            'spectralSpread',
            'loudness',
            'chroma'
        ],
        callback: features => {
            state.meydaFeatures = features;
        }
    });

    state.meydaAnalyzer.start();
    console.log('✨ Meyda analyzer initialized');
} else {
    console.warn('⚠️ Meyda library not loaded, advanced features disabled');
}
```

**Acceptance Criteria**:
- Analyzer initializes without errors
- Callback fires regularly
- Features object populated
- Graceful fallback if Meyda unavailable

**Time Estimate**: 45 minutes

---

### Task 2.2: Feature Normalization
**Objective**: Normalize Meyda features to 0-1 range

**Normalization Functions**:
```javascript
function normalizeMeydaFeatures(features) {
    if (!features) return {};

    return {
        // Spectral Centroid: typically 0-10000 Hz
        spectralCentroid: features.spectralCentroid
            ? Math.min(1, features.spectralCentroid / 10000)
            : 0,

        // Spectral Flatness: already 0-1
        spectralFlatness: features.spectralFlatness || 0,

        // Spectral Rolloff: typically 0-20000 Hz
        spectralRolloff: features.spectralRolloff
            ? Math.min(1, features.spectralRolloff / 20000)
            : 0,

        // Spectral Flux: typically 0-100, varies widely
        spectralFlux: features.spectralFlux
            ? Math.min(1, features.spectralFlux / 100)
            : 0,

        // Spectral Spread: typically 0-5000
        spectralSpread: features.spectralSpread
            ? Math.min(1, features.spectralSpread / 5000)
            : 0,

        // Loudness: object with total, specific, relative
        // Use total loudness, typically 0-100
        loudness: features.loudness?.total
            ? Math.min(1, Math.max(0, (features.loudness.total + 60) / 60))
            : 0,

        // Chroma: 12 values, already normalized but average them
        chroma: features.chroma
            ? features.chroma.reduce((sum, val) => sum + val, 0) / 12
            : 0
    };
}
```

**Acceptance Criteria**:
- All values 0-1 range
- No NaN or undefined
- Handles missing features gracefully
- Tested with various audio

**Time Estimate**: 1 hour

---

### Task 2.3: Merge into audioLevels
**Objective**: Add Meyda features to existing audio levels object

**Implementation**:
```javascript
// In animation loop, after our custom analysis
const meydaNormalized = normalizeMeydaFeatures(state.meydaFeatures);

// Store all audio levels for theme renderers and control system
state.audioLevels = {
    // Original 3-band (for backward compatibility)
    low: bassLevel,
    mid: midsLevel,
    high: highsLevel,

    // Our Custom: Expanded 7-band frequency analysis
    subBass: subBassLevel,
    bass: bassLevel,
    lowMids: lowMidsLevel,
    mids: midsLevel,
    highMids: highMidsLevel,
    highs: highsLevel,
    brilliance: brillianceLevel,

    // Our Custom: Amplitude features
    peak: peakLevel,
    rms: rmsLevel,
    decibels: dbLevel,

    // Our Custom: Rhythm features
    beat: beatResult.strength,
    onset: isOnset ? 1.0 : 0.0,
    bpm: bpmValue,

    // Meyda: Spectral features
    centroid: meydaNormalized.spectralCentroid,
    flatness: meydaNormalized.spectralFlatness,
    rolloff: meydaNormalized.spectralRolloff,
    flux: meydaNormalized.spectralFlux,
    spread: meydaNormalized.spectralSpread,

    // Meyda: Perceptual features
    loudness: meydaNormalized.loudness,
    chroma: meydaNormalized.chroma,

    // Combined
    allLevels: (bassLevel + midsLevel + highsLevel) / 3,

    // Metadata (for debugging)
    _bpmActual: state.bpmDetector.getBPM(),
    _bpmConfidence: bpmConfidence,
    _beatDetected: beatResult.isBeat,
    _meydaActive: !!state.meydaAnalyzer
};
```

**Acceptance Criteria**:
- All features available in audioLevels
- No conflicts with existing features
- Fallbacks if Meyda unavailable
- Clean object structure

**Time Estimate**: 30 minutes

---

### Task 2.4: Control System Integration
**Objective**: Update audioEngine to handle Meyda features

**Implementation**:
```javascript
// In control-system.js, getAudioLevel()

// Add to switch statement:

// Spectral Features (Meyda)
case 'centroid':
    return audioLevels.centroid || audioLevels.mid;
case 'flatness':
    return audioLevels.flatness || 0.5;
case 'rolloff':
    return audioLevels.rolloff || audioLevels.high;
case 'flux':
    return audioLevels.flux || 0;
case 'spread':
    return audioLevels.spread || 0.5;

// Perceptual Features (Meyda)
case 'loudness':
    return audioLevels.loudness || audioLevels.rms;
case 'chroma':
    return audioLevels.chroma || 0.5;

// TODO: Implement dynamics sources (attack, transients, envelope)
// TODO: Implement musical pitch detection
default:
    console.warn(`Audio source not yet implemented: ${mappedId}`);
    return audioLevels.mid;
```

**Acceptance Criteria**:
- All 7 Meyda features routable
- Work with all controls
- Work with intensity sliders
- No console warnings for implemented features

**Time Estimate**: 30 minutes

---

## Phase 3: UI Updates (30 minutes)

### Task 3.1: Update Audio Source Labels
**Objective**: Ensure Meyda features have correct labels in UI

**Already Done**: Labels defined in `AUDIO_SOURCES` in control-system.js

**Verify**:
- Spectral Centroid → "Spectral Centroid (Brightness)"
- Spectral Flatness → Already defined
- Spectral Rolloff → Already defined
- Spectral Flux → "Spectral Flux (Change Rate)"
- Spectral Spread → Needs to be added
- Loudness → Needs to distinguish from RMS
- Chroma → Needs to be added

**Add Missing**:
```javascript
// In AUDIO_SOURCES object:

spread: {
    label: 'Spectral Spread (Variance)',
    category: 'spectral',
    description: 'Frequency distribution variance'
},

chroma: {
    label: 'Chroma (Pitch Classes)',
    category: 'musical',
    description: 'Average pitch class energy'
}

// Update existing:
loudness: {
    label: 'Loudness (Perceptual)', // Add 'Perceptual' to distinguish
    category: 'amplitude',
    description: 'Perceived loudness (psychoacoustic)'
}
```

**Acceptance Criteria**:
- All Meyda features appear in dropdowns
- Labels are clear and descriptive
- Categorized correctly

**Time Estimate**: 15 minutes

---

### Task 3.2: Add Meyda Attribution
**Objective**: Credit Meyda library in UI

**Implementation**:
Add to settings panel or about section:
```html
<div class="attribution">
    Advanced audio analysis powered by
    <a href="https://meyda.js.org" target="_blank">Meyda</a>
</div>
```

**Acceptance Criteria**:
- Attribution visible
- Link works
- Styled appropriately

**Time Estimate**: 15 minutes

---

## Phase 4: Testing & Validation (2-3 hours)

### Task 4.1: Feature Validation
**Objective**: Test each Meyda feature with appropriate audio

**Test Cases**:

| Feature | Test Audio | Expected Behavior | Pass/Fail |
|---------|-----------|-------------------|-----------|
| **Centroid** | Pure sine sweep (100-10kHz) | Increases 0→1 as frequency rises | |
| **Flatness** | Pure tone vs white noise | Tone=0, Noise=1 | |
| **Rolloff** | Bass-heavy vs treble-heavy | Bass=low, Treble=high | |
| **Flux** | Static tone vs changing melody | Static=0, Changing=high | |
| **Spread** | Pure tone vs complex chord | Tone=low, Chord=high | |
| **Loudness** | Quiet vs loud passages | Increases with volume | |
| **Chroma** | Musical scales | Changes with pitch | |

**Tools**:
- Tone generator: https://www.szynalski.com/tone-generator/
- White noise generator
- Music with known characteristics

**Acceptance Criteria**:
- All features respond to appropriate stimuli
- Values in expected ranges
- No NaN or crashes

**Time Estimate**: 1.5 hours

---

### Task 4.2: Performance Testing
**Objective**: Ensure Meyda doesn't degrade performance

**Metrics to Measure**:
- FPS with/without Meyda
- CPU usage
- Memory usage
- Feature extraction latency

**Test Scenarios**:
1. All themes with Meyda enabled
2. Multiple controls using Meyda sources
3. Extended run (5+ minutes)
4. Different buffer sizes (256, 512, 1024)

**Acceptance Criteria**:
- Maintains 60 FPS on desktop
- Maintains 30 FPS on mobile
- <5% CPU increase
- <10 MB memory increase
- <16ms extraction time

**Time Estimate**: 1 hour

---

### Task 4.3: Edge Case Testing
**Objective**: Handle edge cases gracefully

**Test Cases**:
1. Meyda fails to load (CDN down)
2. Features return null/undefined
3. Extreme audio values
4. Silence (no audio)
5. Very loud audio (clipping)
6. Rapid audio changes

**Acceptance Criteria**:
- No crashes
- Graceful fallbacks
- User-friendly warnings
- System continues working

**Time Estimate**: 30 minutes

---

## Phase 5: Documentation (1 hour)

### Task 5.1: Update Audio Sources Documentation
**Objective**: Document new features in AUDIO_SOURCES_STATUS.md

**Updates**:
```markdown
## ✅ Implemented Audio Sources (25/25 - 100% COMPLETE!)

### Our Custom Implementation (18):
- 7-band frequency analysis
- 3 amplitude features
- 3 rhythm features (beat, onset, BPM)
- 5 legacy features

### Meyda Integration (7):
- 5 spectral features
- 2 perceptual features

## Spectral Features (via Meyda)

### Spectral Centroid
- **Range**: 0-1 (0-10kHz normalized)
- **Use Cases**: Brightness, timbre
- **Good For**: Color shifting, glow intensity
- **Example**: Map to hue for "bright = warm colors"

[... document each feature similarly ...]
```

**Acceptance Criteria**:
- All 25 features documented
- Usage examples provided
- Implementation source noted
- Performance notes included

**Time Estimate**: 30 minutes

---

### Task 5.2: Update Project Plan
**Objective**: Mark Meyda integration complete, update stats

**Updates**:
- Audio sources: 18/25 → 25/25 (100%)
- Implementation approach documented
- Performance benchmarks
- Known limitations

**Acceptance Criteria**:
- Accurate completion stats
- Clear architecture notes
- Lessons learned captured

**Time Estimate**: 30 minutes

---

## Phase 6: Optional Enhancements (2-4 hours)

### Task 6.1: Feature Visualization (Optional)
**Objective**: Add debug visualization for Meyda features

**Implementation**:
- Spectrum analyzer overlay
- Real-time feature values display
- Chroma circle visualization
- Toggle on/off

**Time Estimate**: 2 hours

---

### Task 6.2: Auto-Configuration (Optional)
**Objective**: Suggest optimal audio sources per control

**Implementation**:
```javascript
const RECOMMENDED_SOURCES = {
    hue: ['centroid', 'chroma', 'flux'], // Color maps well to spectral
    brightness: ['loudness', 'rms', 'peak'], // Brightness to loudness
    glow: ['beat', 'onset', 'flux'], // Pulsing effects
    speed: ['bpm', 'flux'], // Tempo or change rate
    // ...
};
```

**Time Estimate**: 2 hours

---

## Summary Timeline

| Phase | Tasks | Time | Priority |
|-------|-------|------|----------|
| 1. Planning & Setup | 3 tasks | 1h | HIGH |
| 2. Core Integration | 4 tasks | 2-3h | HIGH |
| 3. UI Updates | 2 tasks | 30m | HIGH |
| 4. Testing | 3 tasks | 2-3h | HIGH |
| 5. Documentation | 2 tasks | 1h | MEDIUM |
| 6. Optional | 2 tasks | 2-4h | LOW |
| **TOTAL** | **16 tasks** | **6-12h** | - |

**Recommended**: 8 hours for core implementation + testing

---

## Success Criteria

### Functional
- ✅ All 7 Meyda features working
- ✅ 25/25 audio sources available (100% complete!)
- ✅ No performance degradation
- ✅ Graceful fallbacks if Meyda unavailable

### Technical
- ✅ <5% CPU overhead
- ✅ <10 MB memory overhead
- ✅ 60 FPS maintained
- ✅ <16ms feature extraction

### User Experience
- ✅ All features in UI dropdowns
- ✅ Clear, descriptive labels
- ✅ Works with all themes
- ✅ Works with all controls

### Code Quality
- ✅ Clean separation of concerns
- ✅ Well-documented
- ✅ No duplication
- ✅ Easy to maintain

---

## Risk Mitigation

### Risk 1: Meyda CDN Failure
**Impact**: High
**Mitigation**:
- Add fallback to local copy
- Graceful degradation
- Warning to user

### Risk 2: Performance Issues
**Impact**: Medium
**Mitigation**:
- Benchmark early
- Make Meyda optional toggle
- Reduce buffer size if needed

### Risk 3: Feature Values Out of Range
**Impact**: Low
**Mitigation**:
- Robust normalization
- Clamp values
- Default to safe values

### Risk 4: Browser Compatibility
**Impact**: Low
**Mitigation**:
- Test on Chrome, Firefox, Safari
- Check Meyda compatibility matrix
- Fallback for unsupported browsers

---

## Implementation Notes

### Why This Hybrid Approach Works

**Our Strengths**:
- Beat/BPM detection tuned for visual responsiveness
- Simple, fast frequency analysis
- Full control over algorithms

**Meyda's Strengths**:
- Scientifically accurate spectral analysis
- Battle-tested implementation
- Professional-grade perceptual features

**Combined Result**:
- Best visual reactivity (our beat/BPM)
- Best audio accuracy (Meyda spectral)
- No reinventing complex algorithms
- Minimal overhead (only 7 features extracted)

### Performance Strategy

**Optimizations**:
1. Extract only needed features (not all 27)
2. Use appropriate buffer size (512 = balance)
3. Run in callback (parallel to render loop)
4. Cache normalized values
5. Lazy initialization (only if used)

**Expected Impact**:
- +50 KB file size (one-time)
- +2-3% CPU (negligible)
- +5 MB memory (minimal)
- +7 audio sources (40% increase!)

---

## Post-Integration Possibilities

Once Meyda is integrated, these become trivial to add:

**Advanced Features** (1-2 hours each):
- MFCC (timbre fingerprinting) - 13 values
- Individual chroma values (C, C#, D, etc.) - 12 values
- Spectral Kurtosis/Skewness
- Buffer access for custom analysis

**Future Enhancements**:
- Genre detection (via MFCC patterns)
- Instrument detection (via spectral features)
- Beat strength classification
- Real-time key detection (via chroma)

---

## Final Recommendation

### Phase 1: Complete Visual Controls First
**Time**: 7-10 hours
**Value**: High visible impact
**Priority**: 1

### Phase 2: Integrate Meyda Hybrid
**Time**: 6-8 hours (core + testing)
**Value**: Professional audio analysis
**Priority**: 2

### Phase 3: Polish & Document
**Time**: 2-3 hours
**Value**: Production-ready
**Priority**: 3

**Total Project Time**: 15-21 hours
**Result**: Feature-complete audio-reactive visualization system

---

*Version: 1.0*
*Created: 2025-12-23*
*Status: Queued after visual controls*
