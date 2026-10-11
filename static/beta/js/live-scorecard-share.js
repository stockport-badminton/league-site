/* Copy and Share buttons on the live scorecard's share page. Share uses the Web Share
 * API where the phone has it (WhatsApp, Messages, …) and falls back to copying. */
(function () {
  'use strict';

  function copy(text, button) {
    var done = function () {
      var label = button.textContent;
      button.textContent = 'Copied';
      setTimeout(function () { button.textContent = label; }, 1500);
    };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(done, function () { window.prompt('Copy this link', text); });
    } else {
      window.prompt('Copy this link', text);
    }
  }

  document.querySelectorAll('[data-copy]').forEach(function (b) {
    b.addEventListener('click', function () { copy(b.getAttribute('data-copy'), b); });
  });

  document.querySelectorAll('[data-share]').forEach(function (b) {
    b.addEventListener('click', function () {
      var url = b.getAttribute('data-share');
      if (navigator.share) {
        navigator.share({ title: b.getAttribute('data-title') || 'Live scorecard', url: url }).catch(function () {});
      } else {
        copy(url, b);
      }
    });
  });
})();
