// service-worker.js — Journal Sync offline cache
// Strategy: cache-first for static shell assets, network-passthrough for API calls.

const CACHE_NAME = 'journal-sync-v1';

// All static files that make the app shell usable offline
const STATIC_ASSETS = [
  './',
  './index.html',
  './styles.css',
  './app.js',
  './db.js',
  './sync.js',
  './manifest.json',
  './icons/icon.svg',
];

// ── Install: pre-cache the app shell ─────────────────────────────────────────
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(STATIC_ASSETS))
      .then(() => self.skipWaiting())   // activate immediately, don't wait for tabs to close
      .catch(err => console.error('[SW] Pre-cache failed:', err))
  );
});

// ── Activate: clean up stale caches from previous versions ───────────────────
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then(keys =>
        Promise.all(
          keys
            .filter(key => key !== CACHE_NAME)
            .map(key => {
              console.log('[SW] Deleting old cache:', key);
              return caches.delete(key);
            })
        )
      )
      .then(() => self.clients.claim())  // take control of existing tabs
  );
});

// ── Fetch: serve cached assets, let API calls pass through ───────────────────
self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Let the browser handle:
  //   • Non-GET requests (POST to Apps Script, etc.)
  //   • Cross-origin requests (CDNs, fonts, Google APIs)
  if (request.method !== 'GET' || url.origin !== self.location.origin) {
    return;
  }

  event.respondWith(
    caches.match(request).then(cached => {
      // Return from cache immediately if available
      if (cached) return cached;

      // Otherwise fetch from network and opportunistically cache
      return fetch(request)
        .then(response => {
          // Only cache valid same-origin responses
          if (response.ok && response.type === 'basic') {
            const toCache = response.clone();
            caches.open(CACHE_NAME).then(cache => cache.put(request, toCache));
          }
          return response;
        })
        .catch(() => {
          // Network failed and nothing cached — fall back to index.html for
          // navigation requests so the app still loads offline
          if (request.mode === 'navigate') {
            return caches.match('./index.html');
          }
          // For other resources just signal unavailable
          return new Response('Offline', {
            status: 503,
            statusText: 'Service Unavailable',
          });
        });
    })
  );
});
