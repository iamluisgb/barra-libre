const CACHE_NAME = 'arete-v84';
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
  './programs/arete.json',
  './programs/kettlebell.json',
  './programs/running/media-maraton-1h40.json',
  './js/ui/running.js',
  './js/ui/running-tracker.js',
  './js/ui/audio.js',
  './js/ui/running-audio.js',
  './js/ui/training-timer.js',
  './js/ui/hr-monitor.js',
  './js/run-store.js',
  './assets/silence.mp3',
  './js/bg-worker.js',
  './js/ui/running-helpers.js',
  './js/ui/running-history.js',
  './js/ui/share-editor.js',
  './js/ui/running-progress.js',
  './js/ui/running-plan.js',
  './js/app.js',
  './js/data.js',
  './js/programs.js',
  './js/utils.js',
  './js/constants.js',
  './js/ui/wizard.js',
  './js/ui/sortable.js',
  './js/ui/nav.js',
  './js/ui/training.js',
  './js/ui/calendar.js',
  './js/ui/history.js',
  './js/ui/progress.js',
  './js/ui/body.js',
  './js/ui/settings.js',
  './js/ui/timer.js',
  './js/ui/toast.js',
  './js/ui/drive-ui.js',
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
          networkFetch.catch(() => {});
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
        tag: 'arete-timer',
        vibrate: [200, 100, 200, 100, 200],
        requireInteraction: true,
      });
      return;
    }
    self.registration.showNotification('Descanso', {
      body: fmtTime(remaining) + ' restantes',
      icon: './assets/icons/icon-192.png',
      badge: './assets/icons/icon-192.png',
      tag: 'arete-timer',
      requireInteraction: true,
      silent: true,
    });
  } else {
    const total = timerState.elapsedBase + elapsed;
    self.registration.showNotification('Cronómetro', {
      body: fmtTime(total),
      icon: './assets/icons/icon-192.png',
      badge: './assets/icons/icon-192.png',
      tag: 'arete-timer',
      requireInteraction: true,
      silent: true,
    });
  }
}

function stopTimerNotification() {
  if (timerInterval) { clearInterval(timerInterval); timerInterval = null; }
  timerState = null;
  self.registration.getNotifications({ tag: 'arete-timer' })
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
      tag: 'arete-timer',
      vibrate: [200, 100, 200, 100, 200],
      requireInteraction: true,
    });
  }
  if (event.data?.type === 'timer-clear') {
    stopTimerNotification();
  }

  // Running GPS heartbeat
  if (event.data?.type === 'run-start-live') {
    runState = { startedAt: event.data.startedAt, distance: event.data.distance || 0 };
    updateRunNotification();
    if (runInterval) clearInterval(runInterval);
    runInterval = setInterval(updateRunNotification, 5000);
  }
  if (event.data?.type === 'run-update') {
    if (runState) runState.distance = event.data.distance || 0;
  }
  if (event.data?.type === 'run-clear') {
    stopRunNotification();
  }
});

// === Live run notification (GPS heartbeat) ===

let runInterval = null;
let runState = null;

function updateRunNotification() {
  if (!runState) return;
  const elapsed = Math.floor((Date.now() - runState.startedAt) / 1000);
  const min = Math.floor(elapsed / 60);
  const sec = elapsed % 60;
  const km = (runState.distance / 1000).toFixed(2);
  self.registration.showNotification('Carrera en curso', {
    body: `${min}:${sec.toString().padStart(2, '0')} · ${km} km`,
    icon: './assets/icons/icon-192.png',
    badge: './assets/icons/icon-192.png',
    tag: 'arete-run',
    requireInteraction: true,
    silent: true,
  });
  // Ping app to request GPS position
  self.clients.matchAll({ type: 'window' }).then(cls => {
    cls.forEach(c => c.postMessage({ type: 'run-gps-poll' }));
  });
}

function stopRunNotification() {
  if (runInterval) { clearInterval(runInterval); runInterval = null; }
  runState = null;
  self.registration.getNotifications({ tag: 'arete-run' })
    .then(ns => ns.forEach(n => n.close()));
}

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
