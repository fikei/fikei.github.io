# MIDI Mapping Specification
## Soundscape Audio-Reactive Visualizer - MIDI Controller Integration

**Version:** 1.0
**Status:** Specification Phase
**Priority:** CRITICAL for Professional VJ Use
**Estimated Implementation:** 1-2 weeks

---

## EXECUTIVE SUMMARY

Enable Soundscape to receive MIDI input from hardware controllers (APC40, Launchpad, MIDI mixers, etc.) and map MIDI messages to any of the 108 parameters. This is a **dealbreaker feature** for professional VJs who rely on tactile hardware control during live performances.

---

## 1. TECHNICAL FOUNDATION

### 1.1 Web MIDI API

**Browser Support:**
- ✅ Chrome/Edge: Full support
- ✅ Opera: Full support
- ⚠️ Firefox: Behind flag (requires user to enable)
- ❌ Safari: No support (WebKit issue)

**Implementation:** Use Web MIDI API with graceful degradation

```javascript
// Basic Web MIDI API structure
if (navigator.requestMIDIAccess) {
    navigator.requestMIDIAccess({ sysex: false })
        .then(onMIDISuccess, onMIDIFailure);
} else {
    console.warn('Web MIDI API not supported in this browser');
    // Show fallback message to user
}
```

### 1.2 MIDI Message Types to Support

| Message Type | Hex Range | Use Case | Priority |
|-------------|-----------|----------|----------|
| **Note On** | 0x90-0x9F | Trigger Beat Pad scenes, toggle buttons | HIGH |
| **Note Off** | 0x80-0x8F | Release triggers | MEDIUM |
| **Control Change (CC)** | 0xB0-0xBF | Map to sliders, knobs (0-127 range) | CRITICAL |
| **Pitch Bend** | 0xE0-0xEF | Smooth crossfader, master intensity | MEDIUM |
| **Program Change** | 0xC0-0xCF | Switch themes directly | LOW |

**Focus:** Control Change (CC) messages are the most important for parameter mapping.

---

## 2. USER WORKFLOWS

### 2.1 MIDI Device Setup

**Step 1: Device Detection**
- Automatically detect connected MIDI devices on page load
- Display list of available MIDI inputs in settings panel
- Show device connection status (connected/disconnected)
- Hot-plug detection (device connected after page load)

**Step 2: Device Selection**
- User selects which MIDI device to use (dropdown or radio buttons)
- Option to use "All MIDI Devices" (merge inputs)
- Per-device enable/disable toggle

### 2.2 MIDI Learn Mode

**User Flow:**
1. User clicks "MIDI Learn" button in UI
2. UI enters learn mode (visual indication: orange border, "Listening for MIDI..." message)
3. User clicks on any control (slider, button, etc.)
4. Control highlights (blue glow, "Move a MIDI control..." prompt)
5. User moves a knob/fader on MIDI controller OR presses pad
6. System detects MIDI message (CC, Note On, etc.)
7. Mapping created automatically
8. Visual confirmation (green checkmark, control label shows MIDI info)
9. Repeat for other controls, or click "Exit MIDI Learn" to finish

**Example:**
```
User clicks "masterIntensity" slider
User turns knob #1 on APC40 (sends CC 48)
→ Mapping created: CC 48 → masterIntensity
Label shows: "Master Intensity (CC48)"
```

### 2.3 Manual MIDI Mapping

**Alternative to MIDI Learn:**
- Advanced users can manually enter MIDI CC numbers
- Click control → "MIDI Settings" button → enter CC number
- Supports MIDI channels (1-16)
- Supports note numbers (0-127)

### 2.4 MIDI Mapping Management

**Features:**
- View all active mappings (table format)
- Delete individual mappings
- Clear all mappings
- Export mappings as JSON
- Import mappings from JSON
- Share mappings with community

---

## 3. MAPPING SYSTEM ARCHITECTURE

### 3.1 MIDIManager Class

```javascript
class MIDIManager {
    constructor() {
        this.midiAccess = null;
        this.inputs = new Map();
        this.mappings = new Map(); // Key: "CC48_channel1", Value: { controlId, theme, transformFn }
        this.learnMode = false;
        this.learnTarget = null;
        this.onMappingChange = null; // Callback
    }

    async initialize() {
        // Request MIDI access
        // Enumerate devices
        // Set up input listeners
    }

    onMIDIMessage(event) {
        // Parse MIDI message
        // Check if mapped
        // Apply to control
    }

    enterLearnMode(controlId) {
        // Set learn target
        // Wait for next MIDI message
    }

    createMapping(midiSpec, controlTarget) {
        // Store mapping
        // Save to localStorage
    }

    removeMapping(midiSpec) {
        // Delete mapping
    }

    exportMappings() {
        // Serialize to JSON
    }

    importMappings(json) {
        // Load from JSON
    }
}
```

### 3.2 MIDI Message Parsing

```javascript
function parseMIDIMessage(event) {
    const [status, data1, data2] = event.data;
    const messageType = status & 0xF0; // Upper nibble
    const channel = (status & 0x0F) + 1; // Lower nibble (1-16)

    switch (messageType) {
        case 0x80: // Note Off
            return { type: 'noteOff', note: data1, velocity: data2, channel };
        case 0x90: // Note On
            return { type: 'noteOn', note: data1, velocity: data2, channel };
        case 0xB0: // Control Change
            return { type: 'cc', cc: data1, value: data2, channel };
        case 0xE0: // Pitch Bend
            const bend = (data2 << 7) | data1; // Combine 14-bit value
            return { type: 'pitchBend', value: bend, channel };
        default:
            return null;
    }
}
```

### 3.3 Value Transformation

**MIDI to Parameter Conversion:**

MIDI CC values: 0-127 (7-bit)
Parameter ranges: Vary (0-1, 0-360, -180 to +180, etc.)

**Transformation Functions:**

```javascript
const transformations = {
    // 0-127 → 0-1 (most common)
    normalized: (midiValue) => midiValue / 127,

    // 0-127 → 0-360 (hue)
    hue360: (midiValue) => (midiValue / 127) * 360,

    // 0-127 → -180 to +180 (hue shift)
    hueShift: (midiValue) => ((midiValue / 127) * 360) - 180,

    // 0-127 → 0-200% (master intensity/brightness)
    percentage200: (midiValue) => (midiValue / 127) * 2,

    // 0-127 → min-max range (custom)
    range: (midiValue, min, max) => min + (midiValue / 127) * (max - min),

    // Toggle (note on/off or CC > 64)
    toggle: (midiValue) => midiValue > 64 ? 1 : 0,

    // Button groups (map CC ranges to button options)
    buttonGroup: (midiValue, options) => {
        const index = Math.floor((midiValue / 127) * options.length);
        return options[Math.min(index, options.length - 1)];
    }
};
```

**Auto-detect appropriate transformation** based on control type:
- Sliders: Use min/max from control definition
- Buttons: Toggle transformation
- Button Groups: Map CC ranges to options

---

## 4. UI/UX DESIGN

### 4.1 MIDI Settings Panel

**Location:** New tab in sidebar OR dedicated modal

**Layout:**
```
┌─────────────────────────────────────┐
│  MIDI SETTINGS                     │
├─────────────────────────────────────┤
│  Connected Devices:                 │
│  ● APC40 mkII (Input)              │
│  ○ Launchpad Mini (Disconnected)   │
│                                     │
│  Active Device: [APC40 mkII ▼]     │
│                                     │
│  [🎹 Enter MIDI Learn Mode]        │
│                                     │
│  Active Mappings: (12)              │
│  ┌───────────────────────────────┐ │
│  │ CC48 → Master Intensity    [×]│ │
│  │ CC49 → Master Brightness   [×]│ │
│  │ CC50 → Global Hue Shift    [×]│ │
│  │ Note C3 → Beat Pad Scene 1 [×]│ │
│  │ ...                           │ │
│  └───────────────────────────────┘ │
│                                     │
│  [Clear All] [Export] [Import]     │
└─────────────────────────────────────┘
```

### 4.2 Control Visual Feedback

**When MIDI-Mapped:**
- Add small MIDI icon (🎹) next to control label
- Show MIDI info on hover: "CC48 on Channel 1"
- Control updates in real-time when MIDI received (visual feedback)

**During MIDI Learn:**
- Active target: Blue glowing border
- All controls: Slightly dimmed except target
- Header message: "Move a MIDI control to map to [Control Name]"
- Escape key to cancel

### 4.3 MIDI Activity Indicator

**Visual Feedback:**
- Small MIDI icon in top-right corner (next to fullscreen/record buttons)
- Flashes green when MIDI message received
- Shows last received message: "CC48: 64"
- Click to open MIDI settings

---

## 5. BEAT PAD MIDI INTEGRATION

### 5.1 Scene Triggering via MIDI

**Note Mapping:**
- MIDI Note 60 (C3) → Scene 1
- MIDI Note 61 (C#3) → Scene 2
- MIDI Note 62 (D3) → Scene 3
- ... up to Note 68 (G#3) → Scene 9

**OR:**

**Velocity-Sensitive Rows:**
- Row 1 (Scenes 1-3): Notes 60-62
- Row 2 (Scenes 4-6): Notes 64-66
- Row 3 (Scenes 7-9): Notes 68-70

**Velocity Mapping:**
- Velocity 0-42: CUT transition
- Velocity 43-84: CROSSFADE transition
- Velocity 85-127: MORPH transition

### 5.2 Quantization with MIDI

**Behavior:**
- MIDI Note On triggers scene
- If quantize mode enabled: Scene waits for next beat/bar
- Visual feedback: Scene pad flashes/pulses while waiting
- Countdown timer shows beats remaining

---

## 6. ADVANCED FEATURES

### 6.1 MIDI Feedback (Output)

**Send MIDI to Controller:**
- Update controller LEDs to match UI state
- Motorized faders track parameter values
- Beat flash sends MIDI clock pulse

**Use Cases:**
- APC40/Launchpad pad LEDs show active scene
- Controller faders snap to current parameter values
- Beat indicator lights on controller

**Implementation:**
```javascript
function sendMIDIFeedback(controlId, value) {
    if (!midiManager.outputs.size) return;

    const mapping = midiManager.getMappingForControl(controlId);
    if (!mapping) return;

    const midiValue = Math.round(value * 127); // Convert to MIDI range
    const message = [0xB0 | (mapping.channel - 1), mapping.cc, midiValue];

    midiManager.outputs.forEach(output => {
        output.send(message);
    });
}
```

### 6.2 Multi-Device Support

**Scenario:** User has APC40 (main controller) + Launchpad (Beat Pad triggers)

**Features:**
- Map different devices to different functions
- Device 1: Control parameters
- Device 2: Trigger scenes
- Merge all inputs (default behavior)

### 6.3 MIDI Macros

**Power User Feature:**
- Create custom MIDI mappings that control multiple parameters
- Example: "One knob controls both hue and saturation"
- Ratio/offset controls between linked parameters

### 6.4 Profile System

**Save/Load MIDI Configurations:**
- "APC40 VJ Setup"
- "Launchpad Beat Pad"
- "Generic MIDI Controller"
- Auto-load profile when device detected

---

## 7. DATA PERSISTENCE

### 7.1 localStorage Schema

```javascript
const midiConfig = {
    version: '1.0',
    lastUsedDevice: 'APC40 mkII',
    mappings: [
        {
            id: 'mapping_001',
            midi: {
                type: 'cc',
                cc: 48,
                channel: 1
            },
            target: {
                controlId: 'masterIntensity',
                theme: 'global', // or specific theme
                min: 0,
                max: 2,
                transform: 'percentage200'
            }
        },
        {
            id: 'mapping_002',
            midi: {
                type: 'noteOn',
                note: 60,
                channel: 1
            },
            target: {
                type: 'beatPad',
                sceneIndex: 0
            }
        }
        // ... more mappings
    ],
    profiles: {
        'APC40 VJ Setup': { mappings: [...] },
        'Launchpad Beat Pad': { mappings: [...] }
    }
};
```

### 7.2 Export/Import Format

**JSON Export:**
- Human-readable
- Includes metadata (device name, creation date, author)
- Share with community via GitHub/forums

**Example:**
```json
{
    "name": "Soundscape APC40 VJ Setup",
    "author": "DJ Example",
    "created": "2025-12-26",
    "device": "APC40 mkII",
    "mappings": [...]
}
```

---

## 8. ERROR HANDLING & EDGE CASES

### 8.1 Device Disconnection

**Behavior:**
- Detect device disconnect event
- Show warning notification: "MIDI device disconnected"
- Retain mappings (don't delete)
- Auto-reconnect when device plugged back in

### 8.2 Conflicting Mappings

**Scenario:** User maps CC48 to two different controls

**Resolution:**
- Warn user: "CC48 is already mapped to [Control]. Replace?"
- Allow duplicate mappings with priority system
- Last-mapped takes precedence

### 8.3 Browser Compatibility

**Fallback for Unsupported Browsers:**
- Detect Web MIDI API support
- Show message: "MIDI not supported in Safari. Use Chrome/Edge."
- Hide MIDI controls in UI
- Graceful degradation (app still works without MIDI)

### 8.4 Permission Denied

**If user denies MIDI access:**
- Show instruction: "Grant MIDI permission in browser settings"
- Provide troubleshooting link
- Retry button

---

## 9. TESTING PLAN

### 9.1 Unit Tests

- ✅ Parse MIDI messages correctly (all types)
- ✅ Transform MIDI values to parameter ranges
- ✅ Create/delete mappings
- ✅ Export/import JSON correctly
- ✅ Handle device connect/disconnect

### 9.2 Integration Tests

- ✅ MIDI Learn workflow (end-to-end)
- ✅ Real-time parameter updates from MIDI
- ✅ Beat Pad triggering via MIDI notes
- ✅ Multiple device inputs
- ✅ localStorage persistence

### 9.3 Hardware Tests

**Test with Real Controllers:**
- APC40 mkII (48 knobs, 40 buttons, 8 faders)
- Launchpad Mini (64 pads)
- Generic USB MIDI keyboard
- MIDI mixer (Behringer X-Touch, etc.)

**Verify:**
- Low latency (<10ms)
- No dropped messages
- Smooth parameter updates
- LED feedback (if supported)

---

## 10. PERFORMANCE CONSIDERATIONS

### 10.1 MIDI Message Rate

**Typical CC Messages:** 100-200 messages/second when turning knob quickly

**Optimization:**
- Throttle parameter updates (max 60 updates/sec = 60 FPS)
- Use requestAnimationFrame for smooth updates
- Debounce rapid messages

**Implementation:**
```javascript
let updateQueue = new Map();
let animationFrameId = null;

function onMIDIMessage(event) {
    const msg = parseMIDIMessage(event);
    const mapping = getMappingForMIDI(msg);

    if (mapping) {
        updateQueue.set(mapping.controlId, msg.value);

        if (!animationFrameId) {
            animationFrameId = requestAnimationFrame(flushUpdates);
        }
    }
}

function flushUpdates() {
    updateQueue.forEach((value, controlId) => {
        updateControl(controlId, value);
    });
    updateQueue.clear();
    animationFrameId = null;
}
```

### 10.2 Memory Usage

- ✅ Store only active mappings (not full MIDI message history)
- ✅ Limit mapping count (max 256 mappings)
- ✅ Clean up event listeners on device disconnect

---

## 11. IMPLEMENTATION ROADMAP

### Phase 1: Foundation (Week 1, Days 1-3)

**Day 1:**
- ✅ Create MIDIManager class
- ✅ Implement Web MIDI API initialization
- ✅ Device detection and listing
- ✅ Basic MIDI message parsing

**Day 2:**
- ✅ Create mapping data structure
- ✅ Implement value transformation functions
- ✅ localStorage persistence
- ✅ Basic control update from MIDI

**Day 3:**
- ✅ MIDI Learn mode UI
- ✅ Manual mapping UI
- ✅ Mapping list/management

### Phase 2: Integration (Week 1, Days 4-5)

**Day 4:**
- ✅ Integrate with control system
- ✅ Beat Pad MIDI triggering
- ✅ Visual feedback (MIDI icons, activity indicator)

**Day 5:**
- ✅ Export/import mappings
- ✅ Error handling
- ✅ Browser compatibility checks

### Phase 3: Polish & Testing (Week 2)

**Day 6-7:**
- ✅ Hardware testing with real controllers
- ✅ Performance optimization
- ✅ Bug fixes

**Day 8-9:**
- ✅ Documentation (user guide)
- ✅ Example mappings for popular controllers
- ✅ Video tutorials

**Day 10:**
- ✅ Community feedback integration
- ✅ Final QA

---

## 12. USER DOCUMENTATION

### 12.1 Quick Start Guide

**"Connect Your MIDI Controller in 3 Steps"**

1. **Plug in your MIDI controller** (USB or MIDI interface)
2. **Click "MIDI Learn"** in Soundscape settings
3. **Click a control, move your controller** - Done!

### 12.2 Example Mappings

**Provide pre-made mappings for:**
- Akai APC40 mkII (full VJ setup)
- Novation Launchpad (Beat Pad grid)
- Generic MIDI keyboard (scene triggers)
- Behringer X-Touch (faders + knobs)

### 12.3 Troubleshooting

**Common Issues:**
- "No MIDI devices detected" → Check USB connection, try different port
- "MIDI not working in Safari" → Use Chrome/Edge instead
- "Controller not responding" → Check MIDI channel, re-enter learn mode
- "Mappings not saved" → Check localStorage not full, browser permissions

---

## 13. SUCCESS METRICS

### 13.1 Functional Requirements

✅ Detect and list MIDI devices
✅ Map MIDI CC to any parameter
✅ MIDI Learn workflow <30 seconds per control
✅ Real-time updates <10ms latency
✅ Persistent mappings across sessions
✅ Export/import mappings
✅ Beat Pad triggering via MIDI notes

### 13.2 User Experience Goals

✅ Professional VJs can use hardware controllers
✅ Setup time <5 minutes for experienced users
✅ Intuitive MIDI Learn (no manual required)
✅ Stable (no crashes from rapid MIDI input)
✅ Community sharing of mappings (JSON exchange)

---

## 14. COMPETITIVE ANALYSIS

| Feature | Soundscape (Planned) | Resolume | VDMX | MilkDrop |
|---------|---------------------|----------|------|----------|
| Web MIDI API | ✅ | ❌ (native app) | ❌ (native app) | ❌ |
| MIDI Learn | ✅ | ✅ | ✅ | ✅ |
| Per-Control Mapping | ✅ (108 params) | ✅ | ✅ | ⚠️ (limited) |
| MIDI Feedback (Output) | ⚠️ (Phase 2) | ✅ | ✅ | ❌ |
| Profile System | ✅ | ✅ | ✅ | ❌ |
| Browser-Based | ✅ (unique!) | ❌ | ❌ | ❌ |

**Competitive Advantage:** Only web-based VJ tool with full MIDI support.

---

## 15. FUTURE ENHANCEMENTS (Post-1.0)

- **MIDI Output** - Send feedback to controllers (LED updates, motorized faders)
- **MIDI Clock Sync** - Lock BPM to external MIDI clock source
- **MPE Support** - Multi-dimensional polyphonic expression (advanced controllers)
- **OSC Bridge** - Convert MIDI to OSC for integration with other tools
- **Ableton Link** - Sync with Ableton Live, Traktor, etc.
- **MIDI Recording** - Record MIDI automation, playback later

---

## CONCLUSION

MIDI mapping is the **#1 requested feature** for professional VJ use. With this implementation, Soundscape will be competitive with commercial VJ software while maintaining its unique web-based, free, and open-source advantages.

**Estimated Effort:** 1-2 weeks (60-80 hours)
**Impact:** Transforms Soundscape from "interesting creative tool" to "professional performance software"
**Priority:** CRITICAL - This is the difference between hobby project and gig-ready tool.

---

**Document Version:** 1.0
**Last Updated:** 2025-12-26
**Next Review:** After Phase 1 implementation
