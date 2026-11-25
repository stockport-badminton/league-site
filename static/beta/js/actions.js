/* Behaviour that used to be inline handlers, declared with data attributes instead.
 *
 * Loaded on every page by views/footer.ejs. An inline `onclick="…"` is why
 * `'unsafe-inline'` still has to be in script-src (REARCH-07, absorbing HARD-15); these
 * two patterns covered most of the ones outside the scorecard templates.
 *
 *   <form data-confirm="Delete this?">            asks before it submits
 *   <button data-confirm="Send to everyone?">     asks before the click does anything
 *   <select data-navigate="/admin/teams/create?copyFrom=">
 *                                                  goes to that URL plus the chosen value
 *
 * Delegated from the document, so it works for markup added after load and needs nothing
 * on the element but the attribute. The message is an attribute value, so EJS's <%= %>
 * escaping is all it needs: it is never pasted into a script.
 */
(function () {
  'use strict';

  // Submit, not click, for forms: a form can be submitted with Enter as well.
  document.addEventListener('submit', function (event) {
    var form = event.target;
    if (!(form instanceof HTMLFormElement) || !form.hasAttribute('data-confirm')) return;
    if (!window.confirm(form.getAttribute('data-confirm'))) event.preventDefault();
  }, true);

  document.addEventListener('click', function (event) {
    var el = event.target instanceof Element ? event.target.closest('[data-confirm]') : null;
    if (!el || el instanceof HTMLFormElement) return;
    if (!window.confirm(el.getAttribute('data-confirm'))) {
      event.preventDefault();
      event.stopImmediatePropagation();
    }
  }, true);

  document.addEventListener('change', function (event) {
    var el = event.target;
    if (!(el instanceof HTMLSelectElement) || !el.hasAttribute('data-navigate') || !el.value) return;
    window.location.href = el.getAttribute('data-navigate') + encodeURIComponent(el.value);
  });
})();
