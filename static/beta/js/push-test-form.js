// Moved out of views/admin/push.ejs (REARCH-07 step 5), unchanged.
// "To this browser" needs this browser's subscription endpoint, which only the page knows.
(function () {
  var field = document.querySelector('#push-test-form input[name="endpoint"]');
  if (!('serviceWorker' in navigator)) return;
  navigator.serviceWorker.ready
    .then(function (reg) { return reg.pushManager.getSubscription(); })
    .then(function (sub) { if (sub) field.value = sub.endpoint; })
    .catch(function () {});
})();
