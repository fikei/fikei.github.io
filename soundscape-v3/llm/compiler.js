// Stage 3 — prompt compiler client.
//
// Calls the local proxy at /compile (proxied server holds the Anthropic key).
// Caches compiler output by sha256(text + image hashes) in localStorage so
// identical prompts don't re-spend tokens.

// Proxy URL discovery in priority order:
//   1. ?proxy=...                     — one-shot override for testing
//   2. localStorage.ss.proxyUrl       — user override in prod
//   3. window.SS_PROXY_URL            — baked-in override
//   4. If served from localhost       → http://localhost:8787/compile
//   5. Otherwise (e.g. ctrl.rodeo)    → http://127.0.0.1:8787/compile
//      (the local proxy lives on the viewer's machine; chrome permits
//       http://127.0.0.1 / http://localhost from https pages)
function resolveProxyUrl() {
  try {
    const q = new URLSearchParams(location.search).get("proxy");
    if (q) return q;
  } catch (e) {}
  try {
    const stored = localStorage.getItem("ss.proxyUrl");
    if (stored) return stored;
  } catch (e) {}
  if (typeof window !== "undefined" && window.SS_PROXY_URL) return window.SS_PROXY_URL;
  const isLocal =
    location.hostname === "localhost" || location.hostname === "127.0.0.1";
  const host = isLocal ? location.hostname : "127.0.0.1";
  return `http://${host}:8787/compile`;
}
const DEFAULT_PROXY = resolveProxyUrl();
const CACHE_PREFIX = "ss.compile.v1.";

export function getProxyUrl() { return DEFAULT_PROXY; }

async function sha256Hex(str) {
  const enc = new TextEncoder().encode(str);
  const hash = await crypto.subtle.digest("SHA-256", enc);
  return Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

async function cacheKey(text, images) {
  const parts = [(text || "").trim()];
  for (const img of images || []) {
    // Hash the base64 data so the key is stable but compact.
    parts.push(await sha256Hex(img.data).then((h) => h.slice(0, 32)));
  }
  const combined = parts.join("|");
  return (await sha256Hex(combined)).slice(0, 32);
}

export async function compilePrompt({
  text,
  images = [],
  proxyUrl = DEFAULT_PROXY,
  useCache = true,
  nonce = null,   // pass a random string to bypass cache ("refine")
} = {}) {
  if (!text?.trim() && images.length === 0) {
    throw new Error("need text or at least one image");
  }

  const key = await cacheKey((text || "") + (nonce ? "|" + nonce : ""), images);
  if (useCache && !nonce) {
    const cached = localStorage.getItem(CACHE_PREFIX + key);
    if (cached) {
      try {
        return { ...JSON.parse(cached), _cacheHit: true };
      } catch (e) {
        localStorage.removeItem(CACHE_PREFIX + key);
      }
    }
  }

  let res;
  try {
    res = await fetch(proxyUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text, images }),
    });
  } catch (e) {
    // Network failure (proxy not running, CORS, offline). Surface a useful
    // message; this is the common case in a fresh production deploy.
    throw new Error(
      `proxy unreachable at ${proxyUrl} — run server/proxy.js locally, ` +
      `or set localStorage.ss.proxyUrl to a hosted compile endpoint`
    );
  }
  let data;
  try {
    data = await res.json();
  } catch (e) {
    throw new Error(`proxy returned non-JSON (${res.status})`);
  }
  if (!res.ok || !data.ok) {
    const msg = data?.error || `compile failed (${res.status})`;
    const err = new Error(msg);
    err.detail = data?.detail;
    throw err;
  }

  const out = {
    config: data.config,
    model: data.model,
    usage: data.usage,
  };
  try {
    localStorage.setItem(CACHE_PREFIX + key, JSON.stringify(out));
  } catch (e) {
    // quota exceeded — just skip
  }
  return { ...out, _cacheHit: false };
}

// Convenience: read a dropped/selected File into an { media_type, data } image.
export async function fileToImage(file) {
  if (!file.type.startsWith("image/")) {
    throw new Error(`${file.name} is not an image`);
  }
  const ab = await file.arrayBuffer();
  const bytes = new Uint8Array(ab);
  // base64 encode
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  const data = btoa(bin);
  return {
    name: file.name,
    media_type: file.type,
    size: file.size,
    data,
  };
}

export function hexToNormRGB(hex) {
  const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex || "");
  if (!m) return [0.5, 0.5, 0.5];
  return [parseInt(m[1], 16) / 255, parseInt(m[2], 16) / 255, parseInt(m[3], 16) / 255];
}
