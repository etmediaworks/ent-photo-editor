const CACHE_NAME = 'ent-photo-editor-v1';
const ASSETS = [
  './',
  './index.html',
  './manifest.json',
  './icon-192.png',
  './icon-512.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(ASSETS))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then(keys => Promise.all(keys.map(k => (k!==CACHE_NAME)?caches.delete(k):null)))
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  // Network-first for non-GET requests
  if (req.method !== 'GET') return;
  event.respondWith((async () => {
    try {
      const net = await fetch(req);
      const cache = await caches.open(CACHE_NAME);
      cache.put(req, net.clone());
      return net;
    } catch(e) {
      const cached = await caches.match(req);
      if (cached) return cached;
      // Offline fallback to index.html for navigation requests
      if (req.mode === 'navigate') return caches.match('./index.html');
      throw e;
    }
  })());
});