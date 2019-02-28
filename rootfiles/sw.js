/** An empty service worker! */
self.addEventListener('fetch', function(event) {
  event.respondWith(
    caches.match(event.request).then(function(response) {
      return response || fetch(event.request);
    })
  );
});

self.addEventListener('install', function(e) {
  e.waitUntil(
    caches.open('the-magic-cache').then(function(cache) {
      return cache.addAll([
        '/',
        '/messer-rules',
        '/info/clubs',
        '/rules',
        '/contact-us',
        '/static/beta/css/custom.css',
        '/static/beta/images/bg/1920.png',
        '/touch-icon-192x192.png',
        '/favicon.ico'
      ]);
    })
  );
});
