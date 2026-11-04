const CACHE_NAME = 'kolobeznik-dispecink-v1';
const ASSETS_TO_CACHE = [
  './',
  './index.html',
  './style.css',
  './db.js',
  './app.js',
  './manifest.json'
];

// Instalace a uložení souborů do mezipaměti
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      console.log('PWA: Ukládám soubory do offline mezipaměti');
      return cache.addAll(ASSETS_TO_CACHE);
    })
  );
  self.skipWaiting();
});

// Aktivace a vyčištění starých verzí mezipaměti
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.map((key) => {
          if (key !== CACHE_NAME) {
            console.log('PWA: Odstraňuji starou mezipaměť', key);
            return caches.delete(key);
          }
        })
      );
    })
  );
  self.clients.claim();
});

// Obsluha síťových požadavků (Cache first, potom síť)
self.addEventListener('fetch', (event) => {
  event.respondWith(
    caches.match(event.request).then((cachedResponse) => {
      if (cachedResponse) {
        return cachedResponse;
      }
      return fetch(event.request);
    })
  );
});
