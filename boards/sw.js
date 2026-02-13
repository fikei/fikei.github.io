// Service Worker for Boards PWA
// Enables: installability, share target handling, basic offline support

const CACHE_NAME = 'boards-v1';
const PRECACHE_URLS = [
  '/boards/',
  '/boards/index.html',
  '/boards/pwa-share.html'
];

// Install — cache core pages
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(PRECACHE_URLS))
      .then(() => self.skipWaiting())
  );
});

// Activate — clean old caches
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

// Fetch — network-first with cache fallback
self.addEventListener('fetch', (event) => {
  // Handle share target navigation
  const url = new URL(event.request.url);
  if (url.pathname === '/boards/pwa-share.html') {
    // Let the share page handle the redirect
    event.respondWith(fetch(event.request).catch(() => caches.match('/boards/pwa-share.html')));
    return;
  }

  // For HTML navigation requests: network-first
  if (event.request.mode === 'navigate') {
    event.respondWith(
      fetch(event.request).catch(() => caches.match(event.request))
    );
    return;
  }

  // For other requests: network only (don't cache API calls, etc.)
  event.respondWith(fetch(event.request));
});
