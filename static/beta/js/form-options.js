// The <option> lists behind the scorecard wizard's cascading dropdowns.
//
// This replaces client-side EJS. `static/beta/formOption.ejs` and
// `playerFormOptions.ejs` were fetched over the network and rendered in the browser with
// `ejs.render`, and EJS compiles a template by building a function from a string — i.e.
// `new Function`, which is exactly what CSP's `'unsafe-eval'` gates. That was the ONLY
// thing on the site requiring it: with this in place `script-src` no longer needs
// `unsafe-eval`, and `CSP_ENFORCE=true` stops breaking the wizard.
//
// Both templates only ever built a list of <option> elements, so there is nothing here a
// template engine was needed for.
//
// Four details are load-bearing. Changing any of them breaks the form quietly:
//
//  1. **The leading placeholder has no `value` attribute.** Per the HTML spec
//     `option.value` then falls back to the option's *text*, which is what makes an
//     untouched dropdown fail validation instead of submitting a real-looking id, and
//     what `e2e/helpers/selects.js` relies on to skip it. Setting `value=""` would look
//     equivalent and is not — see the gotcha in CLAUDE.md.
//  2. **"No Player Home Team" and "No Player Away Team" both carry `value="0"`.** Zero is
//     the sentinel a game row takes for a missing player; the two labels exist so a
//     captain can say *which* side turned up short, not to distinguish two values.
//  3. **They now sit above the player list**, not below it. They are how a short-handed
//     team is recorded, so they belong where someone can find them rather than after
//     thirty names. `selects.js` already skips `value === '0'`, so the e2e specs still
//     pick a real player.
//  4. **Text is set with `textContent`, never `innerHTML`.** The EJS version was safe
//     because `<%= %>` escapes; this is safe by construction, so a player named with
//     markup cannot become markup.
//
// Nodes are built fresh per target select. The old code rendered one HTML string and
// handed it to several selects, which is fine for a string and wrong for DOM nodes —
// appending the same node moves it. Hence a fill* function rather than a build* one.

(function (global) {
  'use strict';

  // No value attribute. See note 1 — this is deliberate, do not "fix" it.
  function placeholder() {
    var o = document.createElement('option');
    o.disabled = true;
    o.selected = true;
    o.textContent = 'Choose...';
    return o;
  }

  function option(value, text) {
    var o = document.createElement('option');
    o.value = String(value);
    o.textContent = text;
    return o;
  }

  // Accepts a jQuery object, a NodeList, an array or a selector string, so call sites can
  // fill several selects at once the way `$('#a, #b')` already did.
  function eachTarget(targets, fn) {
    if (!targets) return;
    if (typeof targets === 'string') targets = document.querySelectorAll(targets);
    var list = targets.length !== undefined ? targets : [targets];
    for (var i = 0; i < list.length; i++) {
      var el = list[i];
      if (el && el.nodeType === 1) fn(el);
    }
  }

  function replaceOptions(select, build) {
    var frag = document.createDocumentFragment();
    frag.appendChild(placeholder());
    build(frag);
    select.replaceChildren
      ? select.replaceChildren(frag)
      : (select.innerHTML = '', select.appendChild(frag));
  }

  function playerName(row) {
    // Names are stored as two columns and joined with a single space everywhere on the
    // site. Trimmed so a stray space cannot render as a double one — 375 rows carried
    // exactly that until 1 Sep 2026, and three still do.
    return [row.first_name, row.family_name]
      .map(function (p) { return String(p == null ? '' : p).trim(); })
      .filter(function (p) { return p; })
      .join(' ');
  }

  global.FormOptions = {
    // Division -> teams. Replaces static/beta/formOption.ejs.
    fillTeams: function (targets, rows) {
      eachTarget(targets, function (select) {
        replaceOptions(select, function (frag) {
          (rows || []).forEach(function (r) { frag.appendChild(option(r.id, r.name)); });
        });
      });
    },

    // Team + gender -> eligible players. Replaces static/beta/playerFormOptions.ejs.
    fillPlayers: function (targets, rows) {
      eachTarget(targets, function (select) {
        replaceOptions(select, function (frag) {
          frag.appendChild(option(0, 'No Player Home Team'));
          frag.appendChild(option(0, 'No Player Away Team'));
          (rows || []).forEach(function (r) { frag.appendChild(option(r.id, playerName(r))); });
        });
      });
    },
  };
})(window);
