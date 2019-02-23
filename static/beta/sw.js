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
        '/tables/All',
        '/results/All',
        '/results/Premier',
        '/results/Division-1',
        '/results/Division-2',
        '/results/Division-3',
        '/results/Division-4',
        '/messer-rules',
        '/static/beta/docs/MesserASection1819.pdf',
        '/static/beta/docs/MesserASection1819Results.pdf',
        '/static/beta/docs/MesserBSection1819.pdf',
        '/static/beta/docs/MesserBSection1819Results.pdf',
        '/static/beta/docs/Messer-Score-Sheet.xlsx',
        '/static/beta/docs/OpenEntryForm.doc',
        '/static/beta/docs/OpenLetter.doc',
        '/static/beta/docs/HandicapClubEntryForm.docx',
        '/static/beta/docs/HandicapIndividualEntryForm.docx',
        '/static/beta/docs/OpenResults2018.xlsx',
        '/static/beta/docs/OpenRoundRobinResults2018.docx',
        '/static/beta/docs/Scorecard-20182019.xls',
        '/static/beta/docs/Scorecard-20182019.xlsx',
        '/static/beta/docs/Scorecard-print.pdf',
        '/static/beta/docs/SDBL-Junior-League-2019.docx',
        '/static/beta/docs/stockport-junior-tournament-entry-form-2019.docx',
        '/info/clubs',
        '/rules',
        '/contact-us',
        '/static/beta/css/custom.css',
        '/static/beta/jquery/jquery-1.11.3.min.js',
        '/static/beta/bootstrap/js/bootstrap.min.js'
      ]);
    })
  );
});
