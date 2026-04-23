# SoundScape v3

Prompt-steerable, audio-reactive visuals. Live at **[ctrl.rodeo/soundscape-v3](https://ctrl.rodeo/soundscape-v3/)**.

Source: [github.com/fikei/soundscape](https://github.com/fikei/soundscape)

## What works without any setup

- Fast-path audio features (mic/line-in → energy, transient, beat, brightness) via Web Audio API
- Hydra visuals (two presets: Drift + Pulse)
- Stage 2 CLAP semantic axes (~170 MB model downloads on first run, cached by the browser)
- Draggable axis sliders for manual override
- Source picker with live device switching

## What needs a backend

Stage 3 **prompt compiler** (text + image → axes + palette) calls the Anthropic API, which requires a key — so it can't run fully client-side. Options:

### Local dev

Run the proxy on your machine:

```bash
cd soundscape
ANTHROPIC_API_KEY=sk-ant-... node server/proxy.js
```

Then click **Compile** in the sidebar. Proxy defaults to `http://localhost:8787`.

### Hosted

Point the page at a hosted compile endpoint (Cloudflare Worker / Vercel function wrapping the same `/compile` contract). Once per browser:

```js
localStorage.setItem("ss.proxyUrl", "https://your-worker.workers.dev/compile");
```

Or pass `?proxy=https://...` in the URL.

If no proxy is reachable, Compile shows a descriptive error; everything else keeps working.

## CTRL design system

UI uses tokens from `design-system/tokens.css`. Local `css/app.css` adds component styles following the same language (Space Grotesk + JetBrains Mono, 1px white borders, square corners, black background).
