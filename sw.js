// Network-first service worker: always try to get the latest page and data.json,
// fall back to the cached copy only when offline. (v1 was cache-first, which kept
// showing an old version of the page/data after updates.)
const CACHE_NAME = 'tutor-schedule-v4';
const ASSETS = ['./', './index.html', './js/core.js', './js/card.js', './data.json', './manifest.json', './icon-192.png', './icon-512.png'];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS)).catch(() => {}));
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // GitHub API, fonts, CDN: straight to network

  event.respondWith(
    fetch(req, { cache: 'no-store' })
      .then((res) => {
        if (res.ok) {
          const copy = res.clone();
          // store without the cache-busting query so offline lookups match
          const key = url.pathname.endsWith('data.json') ? new Request(url.origin + url.pathname) : req;
          caches.open(CACHE_NAME).then((c) => c.put(key, copy));
        }
        return res;
      })
      .catch(() => caches.match(req, { ignoreSearch: true }))
  );
});
