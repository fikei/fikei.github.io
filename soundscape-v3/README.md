# SoundScape v3

Prompt-steerable, audio-reactive visuals. Live at **[ctrl.rodeo/soundscape-v3](https://ctrl.rodeo/soundscape-v3/)**.

Source: [github.com/fikei/soundscape](https://github.com/fikei/soundscape)

## Architecture in one paragraph

Browser-native: Web Audio API → fast features (energy, transient, beat, brightness, low/mid/high bands) → rAF → a single Hydra engine driven by a bus of **continuous knobs** (speed, response, density, symmetry, softness, noise, scale, saturation, contrast, feedback). Every visual change — LLM compile, preset click, slider drag — is a smooth glide through knob space at a user-selected transition rate. CLAP (`Xenova/clap-htsat-unfused`, ~170 MB) runs in-browser via transformers.js for semantic axes. Stage 3 prompt compiler calls Claude via a small local proxy.

## Works without backend

- Fast-path audio (mic / BlackHole / synthetic test signal)
- Single Hydra engine, smooth transitions between knob presets (Drift / Pulse / Minimal)
- Low / mid / high freq-band energy — see the HUD (`d`)
- Draggable primitive sliders
- Draggable semantic axis sliders
- CLAP semantic axes (downloads once, cached by the browser)

## Needs the local proxy

Stage 3 **prompt compiler** (text + image → knobs + palette + axes + style) calls the Anthropic API, which requires a key. Run the proxy on your own machine:

```bash
cd soundscape
ANTHROPIC_API_KEY=sk-ant-... node server/proxy.js
```

Then click **Compile** in the sidebar. Default points at `http://127.0.0.1:8787`.

To point at a hosted proxy instead (Cloudflare Worker, Vercel function with the same `/compile` contract):

```js
localStorage.setItem("ss.proxyUrl", "https://your-worker.workers.dev/compile");
```

Or pass `?proxy=https://...` in the URL. If no proxy is reachable, Compile shows a descriptive error; everything else keeps working.

## CTRL design system

UI uses Space Grotesk + JetBrains Mono, 1px white borders, square corners, black background. Component styles in `css/app.css`, tokens mirrored from the CTRL design system.
