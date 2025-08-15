const CACHE_NAME = 'ent-photo-editor-v1-0-0';
const ASSETS = [
  './',
  './index.html',
  './styles.css',
  './app.js',
  './manifest.json',
  './icon-192.png',
  './icon-512.png',
  './splash-1024.png',
  './splash-2048.png',
  './heic2any.js',
  'https://cdn.jsdelivr.net/npm/heic2any/dist/heic2any.min.js'
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then(cache => cache.addAll(ASSETS)));
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then(keys => Promise.all(keys.map(k => k===CACHE_NAME?null:caches.delete(k))))
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  event.respondWith((async () => {
    const cache = await caches.open(CACHE_NAME);
    const cached = await cache.match(req);
    if (cached) return cached;
    try {
      const net = await fetch(req);
      if (net && net.status === 200 && (req.url.startsWith(self.location.origin) || req.url.includes('jsdelivr.net'))) {
        cache.put(req, net.clone());
      }
      return net;
    } catch(e) {
      if (req.mode === 'navigate') return cache.match('./index.html');
      throw e;
    }
  })());
});