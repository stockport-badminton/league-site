// Moved out of views/notifications-banner.ejs (REARCH-07 step 5), unchanged.
(function () {
  var KEY = 'notificationsBannerDismissed';
  var banner = document.getElementById('notificationsBanner');
  var dismissed = false;
  try { dismissed = localStorage.getItem(KEY) === '1'; } catch (e) {}
  if (dismissed) return;
  banner.querySelector('[data-role="dismiss"]').addEventListener('click', function () {
    banner.hidden = true;
    try { localStorage.setItem(KEY, '1'); } catch (e) {}
    if (window.sblTrack) sblTrack('notifications_banner_dismissed', {});
  });
  // Shown unless this device is already subscribed. No worker yet (a first visit) counts as
  // not subscribed: the offer is the point of the banner.
  function show(subscribed) { banner.hidden = !!subscribed; }
  if (!('serviceWorker' in navigator) || !navigator.serviceWorker.getRegistration) return show(false);
  navigator.serviceWorker.getRegistration().then(function (reg) {
    if (!reg || !reg.pushManager) return show(false);
    return reg.pushManager.getSubscription().then(show);
  }).catch(function () { show(false); });
})();
