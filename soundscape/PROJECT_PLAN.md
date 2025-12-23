# Soundscape Visualization - Complete Project Plan

## Project Overview

**Goal**: Complete the unified control system with full audio source support and all defined visual controls

**Current Status**:
- Visual Controls: 48/59 implemented (81%)
- Audio Sources: 5/25 implemented (20%)
- Media Manipulation: 100% complete

**Total Estimated Effort**: 60-85 hours

---

## Epic 1: Audio Analysis System 🎵

**Goal**: Implement all 25 audio source types for comprehensive music analysis
**Priority**: HIGH
**Total Effort**: 31-42 hours

---

### Story 1.1: Additional Frequency Band Analysis
**As a** user
**I want** more granular frequency band options
**So that** I can react to specific frequency ranges in the music

**Acceptance Criteria**:
- Sub-Bass (20-60 Hz) implemented
- Low-Mids (250-500 Hz) implemented
- High-Mids (2000-4000 Hz) implemented
- Brilliance (8000-20000 Hz) implemented
- Each band correctly isolates its frequency range
- All bands work with any control

**Effort**: 2 hours
**Priority**: HIGH

#### Tasks:
- [ ] Update FFT analysis to split into 7 bands instead of 3
- [ ] Map frequency bins to Hz ranges based on sample rate
- [ ] Implement `subBass` case in `getAudioLevel()`
- [ ] Implement `lowMids` case in `getAudioLevel()`
- [ ] Implement `highMids` case in `getAudioLevel()`
- [ ] Implement `brilliance` case in `getAudioLevel()`
- [ ] Test with music spanning full frequency spectrum
- [ ] Verify no frequency overlap between bands

---

### Story 1.2: Amplitude & Loudness Features
**As a** user
**I want** different ways to measure audio intensity
**So that** I can choose between peak, average, or perceived loudness

**Acceptance Criteria**:
- Peak level detection working
- RMS (perceived loudness) working
- Decibel conversion working
- Each provides different dynamic response
- Values normalized to 0-1 range

**Effort**: 1 hour
**Priority**: MEDIUM

#### Tasks:
- [ ] Implement `peak` calculation (max value)
- [ ] Implement `rms` calculation (root mean square)
- [ ] Implement `decibels` conversion (20 * log10)
- [ ] Add normalization for dB range
- [ ] Test dynamic range with quiet and loud music
- [ ] Document typical value ranges

---

### Story 1.3: Beat Detection System
**As a** user
**I want** controls to pulse with the beat
**So that** visuals sync tightly with rhythm

**Acceptance Criteria**:
- Kick drum beats detected reliably
- Snare/clap beats detected separately
- False positives minimized
- Works across different music genres
- Beat trigger mode implemented for controls
- Visual indicator shows detected beats

**Effort**: 6-8 hours
**Priority**: VERY HIGH

#### Tasks:
- [ ] Research beat detection algorithms (energy-based vs spectral)
- [ ] Implement `BeatDetector` class with energy history
- [ ] Add adaptive threshold calculation
- [ ] Implement bass-focused beat detection (kick)
- [ ] Implement mid-focused onset detection (snare/clap)
- [ ] Add configurable sensitivity parameter
- [ ] Create `trigger` mode for control modulation
- [ ] Add beat detection debug visualization
- [ ] Test with EDM, rock, classical, hip-hop
- [ ] Tune threshold values per genre
- [ ] Add beat strength output (0-1)
- [ ] Document beat detection parameters

---

### Story 1.4: BPM (Tempo) Detection
**As a** user
**I want** animation speed to match song tempo
**So that** visuals feel synchronized with the music

**Acceptance Criteria**:
- BPM accurately detected (±5 BPM)
- Updates smoothly as tempo changes
- Handles tempo changes in songs
- Works from 60-200 BPM range
- BPM value available as audio source
- BPM displayed in UI

**Effort**: 8-10 hours
**Priority**: VERY HIGH

#### Tasks:
- [ ] Research BPM detection algorithms (autocorrelation vs comb filter)
- [ ] Implement `BPMDetector` class
- [ ] Track beat intervals over time
- [ ] Implement autocorrelation on intervals
- [ ] Add median filter for stability
- [ ] Handle tempo changes smoothly
- [ ] Add confidence score for BPM estimate
- [ ] Create BPM display in UI
- [ ] Test with constant tempo songs (EDM)
- [ ] Test with variable tempo songs (classical)
- [ ] Test with rubato/tempo changes
- [ ] Add BPM range limits (60-200)
- [ ] Implement tempo smoothing
- [ ] Document BPM detection accuracy

---

### Story 1.5: Attack & Transient Detection
**As a** user
**I want** sudden audio hits to trigger visual effects
**So that** percussive elements create impact

**Acceptance Criteria**:
- Attack rate (energy increase speed) measured
- Transients (percussive hits) detected
- Different from beat detection (more sensitive)
- Works for non-rhythmic sounds
- Envelope follower tracks overall dynamics

**Effort**: 4-5 hours
**Priority**: MEDIUM

#### Tasks:
- [ ] Implement `attack` detection (energy derivative)
- [ ] Implement `transients` detection (spectral flux)
- [ ] Implement `envelope` follower (smoothed amplitude)
- [ ] Add attack time constant configuration
- [ ] Add release time constant configuration
- [ ] Test with percussive instruments
- [ ] Test with sustained notes
- [ ] Compare attack vs transient sensitivity
- [ ] Document use cases for each

---

### Story 1.6: Spectral Analysis Features
**As a** user
**I want** advanced spectral features
**So that** I can react to timbre and texture changes

**Acceptance Criteria**:
- Spectral centroid (brightness) working
- Spectral flux (change rate) working
- Spectral rolloff (frequency cutoff) working
- Zero crossing rate (noisiness) working
- All features normalized 0-1

**Effort**: 6-8 hours
**Priority**: LOW

#### Tasks:
- [ ] Implement spectral centroid calculation
- [ ] Implement spectral flux calculation
- [ ] Implement spectral rolloff (85% energy)
- [ ] Implement zero crossing rate
- [ ] Add spectrum history buffer
- [ ] Normalize all outputs to 0-1
- [ ] Test with different timbres (piano vs synth)
- [ ] Test with noisy vs tonal sounds
- [ ] Document musical interpretation of each
- [ ] Add visualization for debugging

---

### Story 1.7: Pitch & Harmonic Detection
**As a** user
**I want** to detect musical pitch and harmony
**So that** visuals can respond to melody and chords

**Acceptance Criteria**:
- Fundamental frequency (pitch) detected
- Works for monophonic audio
- Harmonic energy level measured
- Pitch displayed in Hz and note name
- Handles polyphonic audio gracefully

**Effort**: 10-12 hours
**Priority**: LOW

#### Tasks:
- [ ] Research pitch detection algorithms (YIN, autocorrelation, HPS)
- [ ] Implement pitch detection algorithm
- [ ] Add frequency to MIDI note conversion
- [ ] Implement harmonic product spectrum
- [ ] Calculate harmonic vs inharmonic ratio
- [ ] Add confidence score for pitch
- [ ] Handle silent/noisy sections
- [ ] Test with vocals
- [ ] Test with instruments
- [ ] Test with chords (polyphonic)
- [ ] Add pitch smoothing
- [ ] Document accuracy limitations

---

### Story 1.8: Meyda Library Integration (Alternative)
**As a** developer
**I want** to use a proven audio analysis library
**So that** I get all features quickly and reliably

**Acceptance Criteria**:
- Meyda library integrated
- All features available via unified interface
- Performance is acceptable (>30 FPS)
- Can toggle between custom and Meyda analysis
- Documentation updated with library info

**Effort**: 3-4 hours
**Priority**: HIGH (Alternative to Stories 1.5-1.7)

#### Tasks:
- [ ] Research Meyda API and features
- [ ] Add Meyda via CDN or npm
- [ ] Create MeydaAnalyzer wrapper class
- [ ] Map Meyda features to audio source IDs
- [ ] Implement all amplitude features via Meyda
- [ ] Implement all spectral features via Meyda
- [ ] Implement all rhythm features via Meyda
- [ ] Add feature extraction to audio loop
- [ ] Test performance with all features enabled
- [ ] Add toggle for custom vs Meyda
- [ ] Update documentation
- [ ] Add attribution to UI

**Note**: Implementing Story 1.8 would replace Stories 1.5, 1.6, and 1.7

---

## Epic 2: NEON Theme Enhancements 🌈

**Goal**: Add dynamic color modes and improve animation feel
**Priority**: HIGH
**Total Effort**: 6-8 hours

---

### Story 2.1: Color Change Modes
**As a** user
**I want** different color animation styles
**So that** I can match the vibe of different music

**Acceptance Criteria**:
- Static mode (fixed color)
- Cycle mode (slow hue rotation)
- Pulse mode (oscillate between colors)
- Reactive mode (jump on beats)
- Smooth transitions between colors
- Mode selector in UI

**Effort**: 3-4 hours
**Priority**: HIGH

#### Tasks:
- [ ] Add `colorChangeMode` button group control
- [ ] Implement static mode (current behavior)
- [ ] Implement cycle mode (time-based hue rotation)
- [ ] Add cycle speed parameter
- [ ] Implement pulse mode (sine wave oscillation)
- [ ] Add pulse frequency parameter
- [ ] Implement reactive mode (beat-triggered)
- [ ] Add color palette for reactive mode
- [ ] Add transition smoothing (lerp)
- [ ] Test all modes with audio
- [ ] Update UI with mode selector
- [ ] Document mode behaviors

---

### Story 2.2: Responsiveness Control
**As a** user
**I want** to control how quickly visuals respond to audio
**So that** I can adjust for fast vs slow music

**Acceptance Criteria**:
- Responsiveness slider (0.1x - 2x)
- Affects all audio-reactive parameters
- Visible difference between min and max
- Works with all audio sources
- Doesn't break existing controls

**Effort**: 1-2 hours
**Priority**: MEDIUM

#### Tasks:
- [ ] Add `responsiveness` slider control
- [ ] Apply multiplier to audio modulation intensity
- [ ] Test with slow music (ambient)
- [ ] Test with fast music (drum & bass)
- [ ] Ensure smoothness maintained
- [ ] Document recommended values

---

### Story 2.3: Movement Smoothing
**As a** user
**I want** smoother gradient movement
**So that** animations feel more fluid and polished

**Acceptance Criteria**:
- Smoothing slider (0-95%)
- Uses exponential smoothing
- Affects movement and audio values
- Doesn't cause lag/delay perception
- Works independently of responsiveness

**Effort**: 1-2 hours
**Priority**: MEDIUM

#### Tasks:
- [ ] Add `smoothing` slider control
- [ ] Implement exponential smoothing for audio
- [ ] Implement exponential smoothing for movement
- [ ] Add smoothed value buffers to state
- [ ] Test different smoothing values
- [ ] Find optimal default (0.7)
- [ ] Ensure no performance impact

---

### Story 2.4: Mesh Density Control
**As a** user
**I want** to adjust gradient complexity
**So that** I can balance visual richness vs performance

**Acceptance Criteria**:
- Mesh density slider working
- Regenerates gradient mesh on change
- Range: 4-20 gradient centers
- Performance warning at high values
- Visible quality difference

**Effort**: 1 hour
**Priority**: LOW

#### Tasks:
- [ ] Hook up `meshDensity` control to gradient generation
- [ ] Trigger mesh regeneration on value change
- [ ] Add performance monitoring
- [ ] Test on low-end devices
- [ ] Add recommended value hints

---

## Epic 3: Visual Controls Completion 🎨

**Goal**: Implement all remaining defined controls
**Priority**: MEDIUM
**Total Effort**: 9-12 hours

---

### Story 3.1: LINEAR Theme - Points & Spread
**As a** user
**I want** to customize the wave grid
**So that** I can create different densities and patterns

**Acceptance Criteria**:
- Points control changes grid line count
- Spread control adjusts point spacing
- Grid regenerates on change
- No performance issues
- Works with all visualModes

**Effort**: 2-3 hours
**Priority**: MEDIUM

#### Tasks:
- [ ] Hook up `points` control to `setupWaveGrid()`
- [ ] Add `requiresReinit: true` to points
- [ ] Hook up `spread` control to point positioning
- [ ] Calculate spacing from spread value
- [ ] Test with different density settings
- [ ] Test with all visualModes (FLOW/HOLE/CRUNCH)
- [ ] Optimize for high point counts
- [ ] Document performance limits

---

### Story 3.2: WAVE Theme - 3D Perspective
**As a** user
**I want** realistic 3D depth perception
**So that** waves feel three-dimensional

**Acceptance Criteria**:
- Perspective slider working
- FOV adjusts with perspective value
- Depth perception visible
- No rendering artifacts
- Works with all visualModes

**Effort**: 2-3 hours
**Priority**: MEDIUM

#### Tasks:
- [ ] Implement perspective projection math
- [ ] Hook up `perspective` control
- [ ] Calculate FOV from perspective value
- [ ] Apply Z-depth scaling to points
- [ ] Implement proper occlusion (painter's algorithm)
- [ ] Test with PLANES mode
- [ ] Test with GRIDS mode
- [ ] Test with DOTS mode
- [ ] Handle edge cases (perspective = 0)

---

### Story 3.3: WAVE Theme - Depth Control
**As a** user
**I want** to control Z-axis range
**So that** I can adjust layer separation

**Acceptance Criteria**:
- Depth slider working
- Layers spread across Z-axis
- Opacity varies with depth
- Size varies with depth
- Works with perspective

**Effort**: 1-2 hours
**Priority**: MEDIUM

#### Tasks:
- [ ] Hook up `depth` control
- [ ] Calculate Z-position per layer
- [ ] Apply depth-based opacity
- [ ] Apply depth-based size scaling
- [ ] Test with different layer counts
- [ ] Ensure compatibility with perspective

---

### Story 3.4: WAVE Theme - Turbulence
**As a** user
**I want** chaotic wave distortion
**So that** I can create organic, flowing patterns

**Acceptance Criteria**:
- Turbulence slider working
- Uses Perlin or Simplex noise
- Affects wave amplitude
- Can be audio-reactive
- Performance acceptable

**Effort**: 2-3 hours
**Priority**: LOW

#### Tasks:
- [ ] Research noise algorithms (Perlin vs Simplex)
- [ ] Implement or import noise function
- [ ] Hook up `turbulence` control
- [ ] Apply noise to wave calculation
- [ ] Add time evolution to noise
- [ ] Test performance impact
- [ ] Add audio reactivity option
- [ ] Optimize if needed

---

### Story 3.5: WAVE Theme - Phase Shift
**As a** user
**I want** offset between wave layers
**So that** I can create complex interference patterns

**Acceptance Criteria**:
- Phase shift slider working
- Each layer offset correctly
- Creates visual separation
- Works in all modes
- Can be audio-reactive

**Effort**: 1 hour
**Priority**: LOW

#### Tasks:
- [ ] Hook up `phaseShift` control
- [ ] Apply phase offset to wave calculation
- [ ] Test with multiple layers
- [ ] Verify in GRIDS mode
- [ ] Verify in DOTS mode
- [ ] Test audio reactivity

---

### Story 3.6: STARS Theme - Smoothing
**As a** user
**I want** smoother star movement
**So that** motion feels fluid rather than jittery

**Acceptance Criteria**:
- Smoothing slider working
- Star positions interpolated
- Responsiveness maintained
- No perceived lag
- Works with audio reactivity

**Effort**: 1 hour
**Priority**: LOW

#### Tasks:
- [ ] Hook up `smoothing` control
- [ ] Add smoothed position buffers to stars
- [ ] Implement exponential smoothing
- [ ] Test with different audio sources
- [ ] Find optimal default value
- [ ] Document recommended range

---

### Story 3.7: STARS Theme - Motion Trails
**As a** user
**I want** trails behind moving stars
**So that** I can see motion paths

**Acceptance Criteria**:
- Trail length slider working
- Trails fade over time
- Performance acceptable (many stars)
- Works with all movement modes
- Can be audio-reactive

**Effort**: 2-3 hours
**Priority**: LOW

#### Tasks:
- [ ] Add trail history buffer to stars
- [ ] Hook up `trailLength` control
- [ ] Render trail segments
- [ ] Implement opacity fade
- [ ] Limit trail points for performance
- [ ] Test with 1200+ stars
- [ ] Optimize rendering
- [ ] Add audio reactivity option

---

### Story 3.8: STARS Theme - Bloom Effect
**As a** user
**I want** bright stars to glow
**So that** the visual has more depth and atmosphere

**Acceptance Criteria**:
- Bloom slider working
- Bright stars glow more
- SVG filter applied correctly
- Performance acceptable
- Can be audio-reactive

**Effort**: 1-2 hours
**Priority**: LOW

#### Tasks:
- [ ] Create SVG bloom filter
- [ ] Hook up `bloom` control
- [ ] Tie bloom to star brightness
- [ ] Test filter performance
- [ ] Add audio reactivity option
- [ ] Optimize if needed

---

## Epic 4: Testing & Quality Assurance ✅

**Goal**: Ensure all features work correctly across platforms
**Priority**: HIGH
**Total Effort**: 8-12 hours

---

### Story 4.1: Audio Source Validation
**As a** developer
**I want** all audio sources tested
**So that** users get reliable results

**Acceptance Criteria**:
- All 25 sources tested individually
- Test with multiple music genres
- Test with edge cases (silence, noise)
- No console errors
- All return 0-1 values

**Effort**: 3-4 hours
**Priority**: HIGH

#### Tasks:
- [ ] Create test suite for audio sources
- [ ] Test basic sources (bass/mids/highs)
- [ ] Test frequency bands with tone generator
- [ ] Test amplitude features
- [ ] Test beat detection with metronome
- [ ] Test BPM with known-tempo songs
- [ ] Test spectral features
- [ ] Test musical features
- [ ] Validate value ranges (0-1)
- [ ] Check for NaN/undefined
- [ ] Test silence handling
- [ ] Test clipping (loud audio)

---

### Story 4.2: Control Integration Testing
**As a** QA tester
**I want** all controls tested with all audio sources
**So that** any combination works correctly

**Acceptance Criteria**:
- Every control tested with 5+ audio sources
- Audio reactivity working for all
- Intensity sliders effective
- No visual glitches
- Smooth performance

**Effort**: 3-4 hours
**Priority**: HIGH

#### Tasks:
- [ ] Create control test matrix
- [ ] Test LINEAR controls with audio
- [ ] Test NEON controls with audio
- [ ] Test GLITCH controls with audio
- [ ] Test STARS controls with audio
- [ ] Test WAVE controls with audio
- [ ] Test control combinations
- [ ] Test extreme values
- [ ] Check for conflicts
- [ ] Validate smooth transitions

---

### Story 4.3: Performance Optimization
**As a** user
**I want** smooth visuals even with all effects enabled
**So that** I have a good experience

**Acceptance Criteria**:
- Maintains 30+ FPS with all effects
- 60 FPS on desktop with default settings
- No memory leaks
- Efficient on mobile devices
- Graceful degradation

**Effort**: 2-4 hours
**Priority**: HIGH

#### Tasks:
- [ ] Profile with Chrome DevTools
- [ ] Identify performance bottlenecks
- [ ] Optimize audio analysis loop
- [ ] Optimize render loops
- [ ] Optimize expensive effects (turbulence, trails)
- [ ] Add performance monitoring
- [ ] Test on mobile devices
- [ ] Test on low-end hardware
- [ ] Add quality settings if needed
- [ ] Document performance requirements

---

## Epic 5: Documentation & Polish 📚

**Goal**: Complete documentation and user experience
**Priority**: MEDIUM
**Total Effort**: 4-6 hours

---

### Story 5.1: User Guide
**As a** new user
**I want** clear instructions
**So that** I can use all features effectively

**Acceptance Criteria**:
- Quick start guide created
- All controls explained
- Audio sources explained
- Example configurations provided
- Troubleshooting section included

**Effort**: 2-3 hours
**Priority**: MEDIUM

#### Tasks:
- [ ] Write quick start guide
- [ ] Document each theme
- [ ] Document all controls
- [ ] Document audio sources
- [ ] Create example presets
- [ ] Add troubleshooting section
- [ ] Include screenshots/GIFs
- [ ] Add keyboard shortcuts reference

---

### Story 5.2: Developer Documentation
**As a** developer
**I want** technical documentation
**So that** I can extend or maintain the system

**Acceptance Criteria**:
- Architecture documented
- Code structure explained
- API reference created
- Extension guide written
- Contributing guidelines added

**Effort**: 2-3 hours
**Priority**: LOW

#### Tasks:
- [ ] Document system architecture
- [ ] Document control system API
- [ ] Document audio engine API
- [ ] Create extension guide
- [ ] Write contributing guidelines
- [ ] Add code examples
- [ ] Document performance considerations
- [ ] Add JSDoc comments

---

## Summary & Roadmap

### Total Effort Breakdown

| Epic | Effort | Priority |
|------|--------|----------|
| 1. Audio Analysis | 31-42h | HIGH |
| 2. NEON Enhancements | 6-8h | HIGH |
| 3. Visual Controls | 9-12h | MEDIUM |
| 4. Testing & QA | 8-12h | HIGH |
| 5. Documentation | 4-6h | MEDIUM |
| **TOTAL** | **58-80h** | - |

### Recommended Phases

#### Phase 1: Foundation (14-18 hours)
- Story 1.1: Additional Frequency Bands
- Story 1.2: Amplitude Features
- Story 1.3: Beat Detection
- Story 1.4: BPM Detection
- Story 4.1: Audio Source Validation

**Value**: Core audio features working

#### Phase 2: User Experience (12-16 hours)
- Story 2.1: Color Change Modes
- Story 2.2: Responsiveness
- Story 2.3: Smoothing
- Story 3.1: LINEAR Points & Spread
- Story 4.2: Control Testing

**Value**: Polished user experience

#### Phase 3: Advanced Features (14-20 hours)
- Story 1.5: Attack & Transients
- Story 1.6: Spectral Features
- Story 3.2-3.8: All remaining visual controls
- Story 4.3: Performance Optimization

**Value**: Complete feature set

#### Phase 4: Polish (6-9 hours)
- Story 2.4: Mesh Density
- Story 5.1: User Guide
- Story 5.2: Developer Docs

**Value**: Production-ready

### Alternative: Fast Track with Meyda (22-30 hours)

Replace Stories 1.5, 1.6, 1.7 with Story 1.8:
- Story 1.1-1.4: Basic audio (18-22h)
- Story 1.8: Meyda Integration (3-4h)
- Story 2: NEON (6-8h)
- Story 3: Visual (9-12h)
- Story 4: Testing (8-12h)
- Story 5: Docs (4-6h)

**Total**: 48-64 hours (25% faster)

---

## Success Metrics

- ✅ All 25 audio sources functional
- ✅ All 59 visual controls implemented
- ✅ 60 FPS on desktop, 30 FPS on mobile
- ✅ <100ms latency for beat detection
- ✅ ±5 BPM accuracy for tempo detection
- ✅ Zero console errors in production
- ✅ Complete user documentation
- ✅ 90%+ test coverage for audio analysis

---

*Version: 1.0*
*Last Updated: 2025-12-23*
