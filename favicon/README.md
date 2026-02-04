# Favicon Generator

> **Playground Project** - AI-powered favicon creator

**Status**: Experimental

---

## What Is This?

An experiment in generating deployment-ready favicons from text prompts, emojis, or uploaded images. Uses AI image generation to create complete favicon packages.

**Key Features:**
- AI generation from text prompts
- Text/emoji to favicon conversion
- Image upload and conversion
- Multi-size output (16x16 to 512x512)
- ICO file encoding
- Complete deployment package with manifest

---

## Try It

1. Open [ctrl.rodeo/favicon](https://ctrl.rodeo/favicon)
2. Choose generation mode (AI, Text/Emoji, or Upload)
3. Configure options
4. Download ZIP package

---

## How It Works

```
Input → Generator → Canvas Renderer → ICO Encoder → ZIP Package
```

| File | Purpose |
|------|---------|
| `js/favicon-generator.js` | Core generation logic |
| `js/ico-encoder.js` | ICO file format encoding |
| `js/app.js` | UI and mode handling |
| `worker/imagen-proxy.js` | AI image generation proxy |

**Output Package:**
- `favicon.ico` (16x16, 32x32, 48x48)
- `favicon-16x16.png`, `favicon-32x32.png`
- `apple-touch-icon.png` (180x180)
- `android-chrome-192x192.png`, `android-chrome-512x512.png`
- `site.webmanifest`

---

## Ideas / TODO

- [ ] SVG output support
- [ ] Batch generation
- [ ] More AI style presets
- [ ] Favicon history/gallery
