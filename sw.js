// HoneyBeeOS - Service Worker
// OS concept: Offline-first OS caching / background sync
// Browser primitive: Service Worker API

const CACHE_NAME = 'honeybeeos-v1';
const SHELL_FILES = [
  './',
  './index.html',
  './assets/style.css',
  './src/boot.js',
  './src/kernel/hive.js',
  './src/kernel/constants.js',
  './src/kernel/logger.js',
  './src/ipc/pheromones.js',
  './src/bees/bee-runtime.js',
  './src/bees/scheduler.js',
  './src/bees/scout.js',
  './src/storage/honeycomb.js',
  './src/storage/honey.js',
  './src/security/guard.js',
  './src/apps/app-runtime.js',
  './src/apps/honeycomb-explorer.js',
  './src/apps/task-manager.js',
  './src/apps/text-editor.js',
  './src/apps/shell.js',
  './src/apps/observatory.js',
  './src/ui/desktop.js',
  './src/sdk/index.js',
  './workers/bee.worker.js',
  './workers/scout.worker.js'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(SHELL_FILES)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  // Only handle same-origin requests
  if (!event.request.url.startsWith(self.location.origin)) return;

  event.respondWith(
    caches.match(event.request).then(cached => {
      if (cached) return cached;
      return fetch(event.request).then(response => {
        if (response.ok && response.type === 'basic') {
          const clone = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
        }
        return response;
      }).catch(() => {
        // Offline fallback
        if (event.request.headers.get('accept')?.includes('text/html')) {
          return caches.match('./index.html');
        }
      });
    })
  );
});

// Message handling
self.addEventListener('message', (event) => {
  if (event.data === 'skipWaiting') self.skipWaiting();
});
