
const CACHE_NAME = 'polyglot-v30-gh-fix';

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      // Кэшируем только самое необходимое, остальное подхватится в fetch
      return cache.addAll([
        './',
        'index.html',
        'manifest.json'
      ]);
    })
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((cacheName) => {
          if (cacheName !== CACHE_NAME) {
            return caches.delete(cacheName);
          }
        })
      );
    })
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  // Не кэшируем запросы к API Gemini
  if (event.request.method !== 'GET' || event.request.url.includes('generativelanguage.googleapis.com')) return;

  event.respondWith(
    caches.match(event.request).then((response) => {
      if (response) return response;

      return fetch(event.request).then((networkResponse) => {
        // Если это навигационный запрос (переход по страницам) и мы получили 404
        // возвращаем index.html (для SPA на GitHub Pages)
        if (event.request.mode === 'navigate' && networkResponse.status === 404) {
          return caches.match('./');
        }
        
        return networkResponse;
      }).catch(() => {
        // Оффлайн режим для навигации
        if (event.request.mode === 'navigate') {
          return caches.match('./');
        }
      });
    })
  );
});
