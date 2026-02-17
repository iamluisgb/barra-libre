const CACHE_NAME = 'barra-libre-v11';
const ASSETS = [
  './',
  './app.html',
  './app.css',
  './index.html',
  './style.css',
  './manifest.json',
  './assets/icons/icon-192.png',
  './assets/icons/icon-512.png',
  './blog/filosofia.html',
  './blog/fase1-fuerza.html',
  './blog/fase2-hipertrofia.html',
  './blog/fase3-definicion.html',
  './blog/fase4-ajustes.html',
  './blog/nutricion.html',
  './blog/suplementos.html',
  './programs.json',
  './js/app.js',
  './js/data.js',
  './js/programs.js',
  './js/utils.js',
  './js/ui/nav.js',
  './js/ui/training.js',
  './js/ui/calendar.js',
  './js/ui/history.js',
  './js/ui/progress.js',
  './js/ui/body.js',
  './js/ui/settings.js',
  './js/ui/timer.js',
  './js/drive.js'
];

// Install: cache all assets
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(ASSETS))
      .then(() => self.skipWaiting())
  );
});

// Activate: clean old caches
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

// Fetch: cache-first, fallback to network
self.addEventListener('fetch', event => {
  const url = event.request.url;
  // Only handle http/https requests
  if (!url.startsWith('http')) return;
  // Never cache Google API / auth requests
  if (url.includes('accounts.google.com') || url.includes('googleapis.com')) {
    event.respondWith(fetch(event.request));
    return;
  }
  event.respondWith(
    caches.match(event.request).then(cached => {
      if (cached) return cached;
      return fetch(event.request).then(response => {
        // Cache new successful requests
        if (response.ok && event.request.method === 'GET') {
          const clone = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
        }
        return response;
      });
    }).catch(() => {
      // Offline fallback
      if (event.request.destination === 'document') {
        return caches.match('./app.html');
      }
    })
  );
});
