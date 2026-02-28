const CACHE_NAME = 'barra-libre-v25';
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
  './js/constants.js',
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

// === Live timer notification ===

let timerInterval = null;
let timerState = null;

function fmtTime(seconds) {
  const m = Math.floor(seconds / 60), s = seconds % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

function updateTimerNotification() {
  if (!timerState) return;
  const now = Date.now();
  const elapsed = Math.floor((now - timerState.startedAt) / 1000);

  if (timerState.mode === 'countdown') {
    const remaining = Math.max(0, timerState.duration - elapsed);
    if (remaining <= 0) {
      clearInterval(timerInterval);
      timerInterval = null;
      timerState = null;
      self.registration.showNotification('¡Tiempo!', {
        body: 'Descanso completado',
        icon: './assets/icons/icon-192.png',
        badge: './assets/icons/icon-192.png',
        tag: 'barra-libre-timer',
        vibrate: [200, 100, 200, 100, 200],
        requireInteraction: true,
      });
      return;
    }
    self.registration.showNotification('Descanso', {
      body: fmtTime(remaining) + ' restantes',
      icon: './assets/icons/icon-192.png',
      badge: './assets/icons/icon-192.png',
      tag: 'barra-libre-timer',
      requireInteraction: true,
      silent: true,
    });
  } else {
    const total = timerState.elapsedBase + elapsed;
    self.registration.showNotification('Cronómetro', {
      body: fmtTime(total),
      icon: './assets/icons/icon-192.png',
      badge: './assets/icons/icon-192.png',
      tag: 'barra-libre-timer',
      requireInteraction: true,
      silent: true,
    });
  }
}

function stopTimerNotification() {
  if (timerInterval) { clearInterval(timerInterval); timerInterval = null; }
  timerState = null;
  self.registration.getNotifications({ tag: 'barra-libre-timer' })
    .then(ns => ns.forEach(n => n.close()));
}

// Listen for messages from the app
self.addEventListener('message', event => {
  if (event.data === 'skipWaiting') { self.skipWaiting(); return; }

  if (event.data?.type === 'timer-start-live') {
    timerState = {
      mode: event.data.mode,
      startedAt: event.data.startedAt,
      duration: event.data.duration,
      elapsedBase: event.data.elapsedBase,
    };
    updateTimerNotification();
    if (timerInterval) clearInterval(timerInterval);
    timerInterval = setInterval(updateTimerNotification, 1000);
  }
  if (event.data?.type === 'timer-alarm') {
    stopTimerNotification();
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
    stopTimerNotification();
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
