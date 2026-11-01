/**
 * sw.js
 * Service Worker for Apex Autoreg PT PWA
 * Provides offline-first App Shell caching + runtime caching for CDN dependencies.
 */

const CACHE_NAME = 'apex-autoreg-pt-v1';

const APP_SHELL_ASSETS = [
  './',
  './index.html',
  './manifest.json',
  './css/styles.css',
  './js/db.js',
  './js/clinical-engine.js',
  './js/charts.js',
  './js/ai-consultant.js',
  './js/app.js',
  './icons/icon.svg',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/apple-touch-icon.png'
];

const CDN_ASSETS = [
  'https://cdn.tailwindcss.com',
  'https://cdn.jsdelivr.net/npm/chart.js@4.4.3/dist/chart.umd.min.js'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE_NAME);
      await cache.addAll(APP_SHELL_ASSETS);

      // Best-effort warm cache for CDN scripts without blocking SW install
      await Promise.allSettled(
        CDN_ASSETS.map(async (url) => {
          const req = new Request(url, { mode: 'no-cors' });
          const res = await fetch(req);
          await cache.put(url, res);
        })
      );

      await self.skipWaiting();
    })()
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(
        keys
          .filter((key) => key !== CACHE_NAME)
          .map((oldKey) => caches.delete(oldKey))
      );
      await self.clients.claim();
    })()
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;

  // Never intercept POST requests or live Gemini API requests
  if (
    request.method !== 'GET' ||
    request.url.includes('generativelanguage.googleapis.com')
  ) {
    return;
  }

  // Navigation fallback to cached index.html when offline
  if (request.mode === 'navigate') {
    event.respondWith(
      (async () => {
        try {
          const networkResponse = await fetch(request);
          const cache = await caches.open(CACHE_NAME);
          cache.put('./index.html', networkResponse.clone());
          return networkResponse;
        } catch {
          const cached = await caches.match('./index.html');
          return cached || Response.error();
        }
      })()
    );
    return;
  }

  // Stale-while-revalidate for static assets & CDN scripts
  event.respondWith(
    (async () => {
      const cache = await caches.open(CACHE_NAME);
      const cachedResponse = await cache.match(request);

      const networkFetch = fetch(request)
        .then((networkResponse) => {
          if (
            networkResponse &&
            (networkResponse.status === 200 || networkResponse.type === 'opaque')
          ) {
            cache.put(request, networkResponse.clone());
          }
          return networkResponse;
        })
        .catch(() => null);

      if (cachedResponse) {
        return cachedResponse;
      }

      const fresh = await networkFetch;
      return fresh || Response.error();
    })()
  );
});
