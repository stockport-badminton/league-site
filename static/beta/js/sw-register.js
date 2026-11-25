// Moved out of views/pwa-head.ejs (REARCH-07 step 5), unchanged.
// After load, not during it: on first install the worker precaches seven pages and the
// shell assets, and doing that while the first page is still loading competes with it
// for the connection (HARD-44).
if ('serviceWorker' in navigator) {
  window.addEventListener('load', function() {
    navigator.serviceWorker.register('/sw.js', { scope: '/' })
      .catch(function(err) { console.warn('SW registration failed:', err); });
  });
}
