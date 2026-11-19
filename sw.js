/* Sport — service worker: tiene l'app nel telefono così funziona senza rete */
const VERSION = '0.5.0';           // tenere uguale a VERSION in app.js
const CACHE = 'sport-' + VERSION;
const FILES = ['./', 'index.html', 'app.css', 'app.js', 'manifest.json', 'img/icona-180.png', 'img/icona-512.png'];

self.addEventListener('install', (e) => {
  // cache: 'reload' = prende i file freschi dal sito, non copie vecchie salvate dal browser
  e.waitUntil(caches.open(CACHE)
    .then((c) => c.addAll(FILES.map((f) => new Request(f, { cache: 'reload' }))))
    .then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('sport-') && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// Prima la copia nel telefono, poi la rete
self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;
  e.respondWith(caches.match(e.request, { ignoreSearch: true }).then((r) => r || fetch(e.request)));
});
