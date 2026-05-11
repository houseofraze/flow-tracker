// FLOW Tracker — Service Worker
// ──────────────────────────────────────────────────────────────────────────
// Bump CACHE_VERSION on every deploy. The "install" handler will create a
// fresh cache under the new name; the "activate" handler then deletes the
// old caches so the new shell takes over. The waiting/skipWaiting pattern
// lets the client show "Update available" before reloading.
// ──────────────────────────────────────────────────────────────────────────

const CACHE_VERSION = 'v1';
const CACHE_NAME = `flow-tracker-${CACHE_VERSION}`;

// Files that make up the app shell — everything needed to render an empty
// usable app offline. Listed with relative paths so the SW works regardless
// of whether the app is at /flow-tracker/, /, or any sub-path.
const APP_SHELL = [
  './',
  './index.html',
  './manifest.json',
  './icon.svg',
  './icon-192.png',
  './icon-512.png',
  './icon-512-maskable.png',
  './apple-touch-icon.png',
  './apple-touch-icon-167.png',
  './apple-touch-icon-152.png'
];

// ─── INSTALL ────────────────────────────────────────────────────────────
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => {
      // addAll is atomic — if any one URL fails to fetch, the whole install
      // fails. For app shell that's what we want: don't claim "installed" if
      // any required file is missing.
      return cache.addAll(APP_SHELL);
    })
  );
  // We do NOT skipWaiting() here — that lets the client decide when to
  // activate the new SW (via the update banner).
});

// ─── ACTIVATE ───────────────────────────────────────────────────────────
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys
          .filter(k => k.startsWith('flow-tracker-') && k !== CACHE_NAME)
          .map(k => caches.delete(k))
      )
    ).then(() => self.clients.claim())
  );
});

// ─── MESSAGE: SKIP WAITING ──────────────────────────────────────────────
// Client sends this when user taps "Update now" in the update banner.
self.addEventListener('message', event => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

// ─── FETCH ──────────────────────────────────────────────────────────────
// Routing:
//   • Same-origin GET → cache-first, fall back to network, populate cache.
//     On total failure (offline + not cached), serve index.html for HTML
//     navigations so the SPA boots and renders its offline UI.
//   • Google Fonts → stale-while-revalidate (font CSS + woff2 files).
//   • Everything else (other origins) → network only, no caching.
//
// Non-GET requests are passed through untouched (the SW only caches GETs).
self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);

  // Same-origin: app shell — cache-first
  if (url.origin === self.location.origin) {
    event.respondWith(
      caches.match(req).then(cached => {
        if (cached) return cached;
        return fetch(req).then(res => {
          // Only cache successful, basic-type responses (not opaque cross-origin)
          if (res && res.ok && res.type === 'basic') {
            const clone = res.clone();
            caches.open(CACHE_NAME).then(c => c.put(req, clone));
          }
          return res;
        }).catch(() => {
          // Offline + not cached: for HTML navigations, fall back to the shell
          if (req.mode === 'navigate' || (req.headers.get('accept') || '').includes('text/html')) {
            return caches.match('./index.html');
          }
          // For other resource types, fail gracefully (browser shows the
          // generic offline error for that single asset, doesn't crash the
          // page).
          return new Response('Offline', { status: 503, statusText: 'Offline' });
        });
      })
    );
    return;
  }

  // Google Fonts: stale-while-revalidate so the app loads instantly with
  // cached fonts but fresh versions update in the background.
  if (url.host === 'fonts.googleapis.com' || url.host === 'fonts.gstatic.com') {
    event.respondWith(
      caches.open(CACHE_NAME).then(cache =>
        cache.match(req).then(cached => {
          const fetchPromise = fetch(req).then(res => {
            if (res && res.ok) cache.put(req, res.clone());
            return res;
          }).catch(() => cached); // offline + not cached → cached (may be undefined)
          return cached || fetchPromise;
        })
      )
    );
    return;
  }

  // Other cross-origin (analytics, future APIs): network only, untouched.
});
