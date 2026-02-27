const CACHE_NAME = 'barra-libre-v20';
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
  './blog/efecto-kettlebell.html',
  './programs.json',
  './programs/barra-libre.json',
  './programs/kettlebell.json',
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
  './js/ui/toast.js',
  './js/drive.js'
];

// Install: cache all assets and activate immediately
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(ASSETS))
      .then(() => self.skipWaiting())
  );
});

// Activate: clean old caches and take control
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

// Fetch: stale-while-revalidate for same-origin, network-only for external APIs
self.addEventListener('fetch', event => {
  const url = event.request.url;
  if (!url.startsWith('http')) return;

  // Never cache Google API / auth requests
  if (url.includes('accounts.google.com') || url.includes('googleapis.com')) {
    event.respondWith(fetch(event.request));
    return;
  }

  event.respondWith(
    caches.open(CACHE_NAME).then(cache =>
      cache.match(event.request).then(cached => {
        const networkFetch = fetch(event.request).then(response => {
          if (response.ok && event.request.method === 'GET') {
            cache.put(event.request, response.clone());
          }
          return response;
        }).catch(() => null);

        // Return cached immediately, update in background
        if (cached) {
          // Fire-and-forget revalidation
          networkFetch;
          return cached;
        }
        // No cache: wait for network
        return networkFetch.then(r => r || new Response('Offline', { status: 503 }));
      })
    ).catch(() => {
      if (event.request.destination === 'document') {
        return caches.match('./app.html');
      }
    })
  );
});

// Listen for messages from the app
self.addEventListener('message', event => {
  if (event.data === 'skipWaiting') { self.skipWaiting(); return; }

  // Timer notifications
  if (event.data?.type === 'timer-show') {
    self.registration.showNotification(event.data.title, {
      body: event.data.body,
      icon: './assets/icons/icon-192.png',
      badge: './assets/icons/icon-192.png',
      tag: 'barra-libre-timer',
      requireInteraction: true,
      silent: true,
    });
  }
  if (event.data?.type === 'timer-alarm') {
    self.registration.showNotification('¡Tiempo!', {
      body: 'Descanso completado',
      icon: './assets/icons/icon-192.png',
      badge: './assets/icons/icon-192.png',
      tag: 'barra-libre-timer',
      vibrate: [200, 100, 200, 100, 200],
      requireInteraction: true,
    });
  }
  if (event.data?.type === 'timer-clear') {
    self.registration.getNotifications({ tag: 'barra-libre-timer' })
      .then(ns => ns.forEach(n => n.close()));
  }
});

// Tap notification → focus app
self.addEventListener('notificationclick', event => {
  event.notification.close();
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
      if (list.length > 0) { list[0].focus(); return; }
      clients.openWindow('./app.html');
    })
  );
});
