/* Homing service worker — app-shell cache + offline awareness.
   This app is API-driven (not offline-first), so we only cache the static
   shell. API calls go straight to the network; when they fail the client's
   existing save/status error handling surfaces a friendly message.
   Register via navigator.serviceWorker.register('/sw.js').
*/
const VERSION = 'homing-shell-v1';
const SHELL_CACHE = VERSION;

const SHELL_URLS = [
  '/',
  '/index.html',
  '/manifest.webmanifest',
  '/favicon.svg',
  '/icons/pwa/icon-192.png',
  '/icons/pwa/icon-512.png',
  '/icons/pwa/icon-512-maskable.png',
  '/icons/pwa/apple-touch-icon.png',
];

/* Runtime-cached assets live in this prefix; Vite hashes them for the current
   build, so any mismatch only costs a cache miss → network fetch. */
const ASSET_PREFIX = '/assets/';

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(SHELL_CACHE)
      .then((cache) => cache.addAll(SHELL_URLS))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((k) => k !== SHELL_CACHE).map((k) => caches.delete(k)))
      )
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // Never intercept API traffic — go to network and surface client-side errors.
  if (url.pathname.startsWith('/api/')) return;

  // Hashed, immutable build assets → cache-first.
  if (url.pathname.startsWith(ASSET_PREFIX)) {
    event.respondWith(
      caches.match(request).then(
        (cached) =>
          cached ||
          fetch(request).then((res) => {
            if (res.ok) {
              const clone = res.clone();
              caches.open(SHELL_CACHE).then((c) => c.put(request, clone));
            }
            return res;
          })
      )
    );
    return;
  }

  // Icon / public static files → cache-first with runtime fill.
  if (url.pathname.startsWith('/icons/')) {
    event.respondWith(
      caches.match(request).then(
        (cached) =>
          cached ||
          fetch(request).then((res) => {
            if (res.ok) {
              const clone = res.clone();
              caches.open(SHELL_CACHE).then((c) => c.put(request, clone));
            }
            return res;
          })
      )
    );
    return;
  }

  // Navigations (the SPA shell) → network-first, fall back to cached shell
  // so offline still renders the UI (its inline statuses explain the failures).
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((res) => {
          if (res.ok) {
            const clone = res.clone();
            caches.open(SHELL_CACHE).then((c) => c.put('/', clone));
          }
          return res;
        })
        .catch(() => caches.match('/').then((r) => r || caches.match('/index.html')))
    );
    return;
  }
});
