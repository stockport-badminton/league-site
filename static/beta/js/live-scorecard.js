/* The live scorecard page (views/live-scorecard.ejs).
 *
 * One renderer, fed by two sources: the state the server embedded in #live-boot, and
 * GET /api/live-scorecard/:id/state, polled while the page is visible. Every write answers
 * with the new state too, so the phone that made a change sees it at once and the others
 * see it on their next poll.
 *
 * The one rule that matters for a shared card: a redraw never overwrites an input the
 * person holding this phone is in the middle of. A row being edited is "dirty" until it is
 * saved or abandoned, and a poll leaves its inputs alone.
 */
(function () {
  'use strict';

  var boot = JSON.parse(document.getElementById('live-boot').textContent);
  var root = document.getElementById('live-card');
  var state = boot.state;
  var POLL_MS = 4000;
  var dirty = {};          // game number -> true while this phone has unsaved input
  var pollTimer = null;
  var lastOk = Date.now();

  // ---------- helpers ----------

  function $(sel, el) { return (el || root).querySelector(sel); }
  function $all(sel, el) { return Array.prototype.slice.call((el || root).querySelectorAll(sel)); }

  function el(tag, attrs, children) {
    var node = document.createElement(tag);
    Object.keys(attrs || {}).forEach(function (k) {
      if (k === 'text') node.textContent = attrs[k];
      else if (k === 'className') node.className = attrs[k];
      else node.setAttribute(k, attrs[k]);
    });
    (children || []).forEach(function (c) { if (c) node.appendChild(c); });
    return node;
  }

  var names = {};
  ['homeMale', 'homeFemale', 'awayMale', 'awayFemale'].forEach(function (k) {
    boot.players[k].forEach(function (p) { names[p.id] = p.name; });
  });

  function slotLabel(slot) {
    var m = /^(home|away)(Man|Lady)(\d)$/.exec(slot);
    return (m[2] === 'Man' ? 'Man ' : 'Lady ') + m[3];
  }

  function playerName(slot) {
    var id = state.players[slot];
    if (id === 0) return 'No player';
    if (id === undefined || id === null) return slotLabel(slot);
    return names[id] || ('Player ' + id);
  }

  function shortName(slot) {
    var full = playerName(slot);
    var parts = full.split(' ');
    if (parts.length < 2 || state.players[slot] === undefined || state.players[slot] === 0) return full;
    return parts[0] + ' ' + parts[parts.length - 1].charAt(0);
  }

  function time(iso) {
    if (!iso) return '';
    var d = new Date(iso);
    return d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
  }

  // Mirrors utils/liveScorecard.js scoreProblem — the server checks again.
  function scoreProblem(h, a) {
    var ok = function (v) { return Number.isInteger(v) && v >= 0 && v <= 30; };
    if (!ok(h) || !ok(a)) return 'Scores are whole numbers from 0 to 30';
    if (h < 21 && a < 21) return 'One side has to reach 21';
    if (Math.abs(h - a) < 2 && h < 30 && a < 30) return 'The winner needs a two-point lead, unless they reached 30';
    return null;
  }

  var toastTimer = null;
  function toast(msg, kind) {
    var t = $('[data-toast]');
    t.textContent = msg;
    t.className = 'live-toast ' + (kind || '');
    t.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.hidden = true; }, 4000);
  }

  function readOnly() { return state.status !== 'live'; }

  // ---------- network ----------

  function post(path, body) {
    body.t = boot.t;
    if (boot.c) body.c = boot.c;
    return fetch('/api/live-scorecard/' + boot.id + path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify(body)
    }).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (data) {
        if (!r.ok || !data.ok) throw new Error(data.error || ('Could not save (' + r.status + ')'));
        apply(data.state);
        return data.state;
      });
    });
  }

  function poll() {
    clearTimeout(pollTimer);
    if (document.visibilityState === 'hidden') return;
    var url = '/api/live-scorecard/' + boot.id + '/state?t=' + encodeURIComponent(boot.t) +
      '&rev=' + encodeURIComponent(state.rev);
    fetch(url, { headers: { 'Accept': 'application/json' }, credentials: 'same-origin' })
      .then(function (r) {
        if (r.status === 204) return null;
        if (!r.ok) throw new Error('poll ' + r.status);
        return r.json();
      })
      .then(function (data) {
        lastOk = Date.now();
        if (data) apply(data);
        syncStatus(true);
      })
      .catch(function () { syncStatus(false); })
      .then(function () {
        if (!readOnly()) pollTimer = setTimeout(poll, POLL_MS);
      });
  }

  function syncStatus(ok) {
    var dot = $('[data-sync]');
    var txt = $('[data-sync-text]');
    if (readOnly()) { dot.className = 'live-dot done'; txt.textContent = 'Final'; return; }
    if (ok) { dot.className = 'live-dot'; txt.textContent = 'Live'; }
    else {
      dot.className = 'live-dot offline';
      txt.textContent = 'Offline — last updated ' + time(new Date(lastOk).toISOString());
    }
  }

  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'visible') poll();
  });

  // ---------- rendering ----------

  function apply(next) {
    if (!next) return;
    state = next;
    render();
  }

  function render() {
    $('[data-tally="home"]').textContent = state.tally.home;
    $('[data-tally="away"]').textContent = state.tally.away;
    $('[data-tally="played"]').textContent = state.tally.played;
    $('[data-filed]').hidden = !state.filed;
    root.classList.toggle('is-readonly', readOnly());
    renderGames();
    renderPlayers();
    renderSign();
    syncStatus(true);
  }

  // Built once; afterwards only updated in place, so focus and half-typed input survive.
  function buildGames() {
    var list = $('[data-games]');
    boot.games.forEach(function (g) {
      var home = el('input', { type: 'text', inputmode: 'numeric', pattern: '[0-9]*', maxlength: '2',
        className: 'form-control live-in', 'aria-label': 'Game ' + g.n + ' ' + boot.home + ' score', 'data-side': 'h' });
      var away = el('input', { type: 'text', inputmode: 'numeric', pattern: '[0-9]*', maxlength: '2',
        className: 'form-control live-in', 'aria-label': 'Game ' + g.n + ' ' + boot.away + ' score', 'data-side': 'a' });
      var row = el('li', { className: 'live-game', 'data-game': g.n }, [
        el('div', { className: 'live-game-head' }, [
          el('span', { className: 'live-game-n', text: g.n }),
          el('span', { className: 'live-game-type', text: g.label }),
          el('span', { className: 'live-game-next', text: 'Next up' })
        ]),
        el('div', { className: 'live-game-body' }, [
          el('div', { className: 'live-pair live-pair-home', 'data-pair': 'home' }),
          el('div', { className: 'live-game-scores' }, [home, el('span', { className: 'dash', text: '–' }), away]),
          el('div', { className: 'live-pair live-pair-away', 'data-pair': 'away' })
        ]),
        el('div', { className: 'live-game-foot', 'data-foot': '' })
      ]);
      [home, away].forEach(function (input) {
        input.addEventListener('input', function () {
          input.value = input.value.replace(/[^0-9]/g, '');
          dirty[g.n] = true;
          row.classList.remove('has-error');
          // Two digits typed into the home box: move on to the away box.
          if (input === home && input.value.length === 2) away.focus();
        });
        input.addEventListener('change', function () { saveGame(g, row); });
        input.addEventListener('keydown', function (e) {
          if (e.key === 'Enter') { e.preventDefault(); input.blur(); }
        });
      });
      list.appendChild(row);
    });
  }

  function renderGames() {
    var firstOpen = null;
    boot.games.forEach(function (g) {
      var row = $('[data-game="' + g.n + '"]');
      var s = state.games[String(g.n)];
      if (!s && firstOpen === null) firstOpen = g.n;

      $('[data-pair="home"]', row).textContent = g.home.map(shortName).join(' & ');
      $('[data-pair="away"]', row).textContent = g.away.map(shortName).join(' & ');

      var inputs = $all('input', row);
      var editing = dirty[g.n] || inputs.indexOf(document.activeElement) !== -1;
      if (!editing) {
        inputs[0].value = s ? s.h : '';
        inputs[1].value = s ? s.a : '';
      }
      inputs.forEach(function (i) { i.disabled = readOnly(); });

      row.classList.toggle('is-done', !!s);
      row.classList.toggle('home-won', !!s && s.h > s.a);
      row.classList.toggle('away-won', !!s && s.a > s.h);
      if (!row.classList.contains('has-error')) {
        $('[data-foot]', row).textContent = s ? ((s.by ? s.by + ' · ' : '') + time(s.at)) : '';
      }
    });
    $all('.live-game').forEach(function (row) {
      row.classList.toggle('is-next', Number(row.getAttribute('data-game')) === firstOpen && !readOnly());
    });
  }

  function saveGame(g, row) {
    var inputs = $all('input', row);
    var hv = inputs[0].value, av = inputs[1].value;
    var foot = $('[data-foot]', row);
    var existing = state.games[String(g.n)];
    if (hv === '' && av === '') {
      if (!existing) { dirty[g.n] = false; return; }
      if (!window.confirm('Clear the score for game ' + g.n + '?')) {
        dirty[g.n] = false; renderGames(); return;
      }
    } else {
      if (hv === '' || av === '') return; // still typing the other half
      var problem = scoreProblem(Number(hv), Number(av));
      if (problem) {
        row.classList.add('has-error');
        foot.textContent = problem;
        return;
      }
      if (existing && existing.h === Number(hv) && existing.a === Number(av)) { dirty[g.n] = false; return; }
    }
    row.classList.add('is-saving');
    post('/games/' + g.n, { home: hv, away: av, by: whoAmI() })
      .then(function () { dirty[g.n] = false; row.classList.remove('has-error'); renderGames(); })
      .catch(function (err) {
        row.classList.add('has-error');
        foot.textContent = err.message;
        toast(err.message, 'error');
      })
      .then(function () { row.classList.remove('is-saving'); });
  }

  // ---------- players ----------

  function buildPlayers() {
    var wrap = $('[data-players]');
    ['home', 'away'].forEach(function (side) {
      var col = el('div', { className: 'live-players-side' }, [
        el('h3', { text: side === 'home' ? boot.home : boot.away })
      ]);
      ['Man', 'Lady'].forEach(function (kind) {
        [1, 2, 3].forEach(function (n) {
          var slot = side + kind + n;
          var roster = boot.players[side + (kind === 'Man' ? 'Male' : 'Female')];
          var select = el('select', { className: 'form-control form-control-sm', 'data-slot': slot,
            'aria-label': (side === 'home' ? boot.home : boot.away) + ' ' + slotLabel(slot) });
          select.appendChild(el('option', { value: '', text: 'Choose…' }));
          select.appendChild(el('option', { value: '0', text: 'No player' }));
          roster.forEach(function (p) { select.appendChild(el('option', { value: String(p.id), text: p.name })); });
          select.addEventListener('change', function () {
            post('/players', { slot: slot, playerId: select.value })
              .catch(function (err) { toast(err.message, 'error'); renderPlayers(); });
          });
          col.appendChild(el('label', { className: 'live-slot' }, [
            el('span', { text: slotLabel(slot) }), select
          ]));
        });
      });
      wrap.appendChild(col);
    });
  }

  function renderPlayers() {
    $all('select[data-slot]').forEach(function (select) {
      var slot = select.getAttribute('data-slot');
      var side = slot.indexOf('home') === 0 ? 'home' : 'away';
      if (document.activeElement !== select) {
        var v = state.players[slot];
        select.value = (v === undefined || v === null) ? '' : String(v);
      }
      // Somebody already picked elsewhere on this side can't be picked twice.
      var taken = {};
      boot.slots.forEach(function (other) {
        if (other !== slot && other.indexOf(side) === 0 && state.players[other]) taken[state.players[other]] = true;
      });
      Array.prototype.forEach.call(select.options, function (o) {
        o.disabled = !!(o.value && o.value !== '0' && taken[o.value]);
      });
      select.disabled = readOnly();
    });
  }

  // ---------- signing ----------

  function renderSign() {
    var box = $('[data-sign]');
    box.innerHTML = '';
    var sig = state.signatures;
    ['home', 'away'].forEach(function (side) {
      var s = sig[side];
      box.appendChild(el('div', { className: 'live-sig ' + (s ? 'is-signed' : '') }, [
        el('span', { className: 'live-sig-team', text: (side === 'home' ? boot.home : boot.away) + ' captain' }),
        el('span', { className: 'live-sig-state', text: s ? ('Signed by ' + s.by + ' at ' + time(s.at)) : 'Not signed' })
      ]));
    });

    if (state.filed) return;

    if (state.problems.length) {
      box.appendChild(el('div', { className: 'live-problems' }, [
        el('strong', { text: 'Before it can be signed:' }),
        el('ul', {}, state.problems.map(function (p) { return el('li', { text: p }); }))
      ]));
    }

    if (!boot.side) {
      box.appendChild(el('p', { className: 'live-note',
        text: 'Each captain signs from their own captain\'s link. Ask whoever started the card.' }));
      return;
    }

    if (sig[boot.side]) {
      box.appendChild(el('p', { className: 'live-note',
        text: 'You have signed. If anyone changes a score or a player now, both signatures are cleared and you will need to sign again.' }));
      return;
    }

    var name = el('input', { type: 'text', className: 'form-control', maxlength: '80',
      placeholder: 'Your full name', autocomplete: 'name', 'aria-label': 'Your name' });
    name.value = whoAmI();
    var btn = el('button', { type: 'button', className: 'btn btn-success btn-block',
      text: 'Sign as ' + boot.side + ' captain: ' + state.tally.home + '–' + state.tally.away });
    btn.disabled = state.problems.length > 0;
    btn.addEventListener('click', function () {
      if (!name.value.trim()) { name.focus(); toast('Type your name to sign', 'error'); return; }
      btn.disabled = true;
      post('/sign', { name: name.value, version: state.version })
        .then(function (s) { toast(s.filed ? 'Signed and filed. Thank you!' : 'Signed. Waiting for the other captain.', 'ok'); })
        .catch(function (err) { toast(err.message, 'error'); btn.disabled = false; });
    });
    box.appendChild(el('div', { className: 'live-sign-form' }, [
      el('p', { className: 'live-note', text: 'Signing agrees the card exactly as it stands. Any later change clears both signatures.' }),
      name, btn
    ]));
  }

  // ---------- name, tabs ----------

  var whoInput = $('[data-who]');
  function whoAmI() { return (whoInput.value || '').trim(); }
  try { whoInput.value = localStorage.getItem('liveScorecardName') || ''; } catch (e) { /* private mode */ }
  whoInput.addEventListener('change', function () {
    try { localStorage.setItem('liveScorecardName', whoAmI()); } catch (e) { /* private mode */ }
  });

  function showTab(name) {
    $all('[data-tab]').forEach(function (b) { b.setAttribute('aria-selected', String(b.getAttribute('data-tab') === name)); });
    $all('[data-panel]').forEach(function (p) { p.hidden = p.getAttribute('data-panel') !== name; });
  }
  $all('[data-tab]').forEach(function (b) {
    b.addEventListener('click', function () { showTab(b.getAttribute('data-tab')); });
  });

  // Nobody picked yet: the players are the first job. A captain's link with a complete
  // card opens on the signature.
  var anyPlayers = Object.keys(state.players).length > 0;
  if (!anyPlayers && !readOnly()) showTab('players');
  else if (boot.side && !state.problems.length) showTab('sign');

  buildGames();
  buildPlayers();
  render();
  if (!readOnly()) pollTimer = setTimeout(poll, POLL_MS);
})();
