// Moved out of views/notifications-video.ejs (REARCH-07 step 5), unchanged.
(function () {
  var dialog = document.getElementById('notificationsVideo');
  var player = document.getElementById('notificationsVideoPlayer');
  document.querySelectorAll('[data-notifications-video]').forEach(function (el) {
    el.addEventListener('click', function (e) {
      e.preventDefault();
      dialog.showModal();
      player.play().catch(function () {});
      if (window.sblTrack) sblTrack('notifications_video_opened', { from: location.pathname });
    });
  });
  if (window.sblWatchVideo) sblWatchVideo(player, 'notifications_video', function () { return { from: location.pathname }; });
  dialog.addEventListener('close', function () { player.pause(); });
})();
