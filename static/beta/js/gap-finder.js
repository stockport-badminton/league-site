// /admin/gap-finder — renders what gap-finder-core.js decides. The data is embedded in the
// page by controllers/gapFinderController.js.
(function () {
  'use strict';
  var C = window.GapFinderCore;
  var D = JSON.parse(document.getElementById('gf-data').textContent);
  var wantFixture = JSON.parse(document.getElementById('gf-fixture').textContent);
  var ix = C.index(D);
  var win = C.moveWindow(D);

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function el(id) { return document.getElementById(id); }
  var label = function (key) { return ix.teamByKey[key] ? ix.teamByKey[key].name : '?'; };
  var leagueLabel = function (f) { return ix.teamByKey[f.homeKey].leagueLabel; };

  /* ---------- move a match ---------- */
  var opts = { onNightOnly: true, cleanOnly: false };

  // A club's home matches that can still move: on or after today and not yet played.
  function movable(clubKey) {
    var keys = ix.clubByKey[clubKey].teamKeys;
    return D.fixtures.filter(function (f) {
      return keys.indexOf(f.homeKey) >= 0 && (f.status === 'rearranging' || (f.status === 'outstanding' && f.date >= D.today));
    }).sort(function (a, b) { return a.date < b.date ? -1 : a.date > b.date ? 1 : 0; });
  }
  function fillFixtures(clubKey, selectUid) {
    var list = movable(clubKey);
    el('mFix').innerHTML = '<option value="">— select a match —</option>' + list.map(function (f) {
      return '<option value="' + esc(f.uid) + '"' + (f.uid === selectUid ? ' selected' : '') + '>'
        + esc(C.fmt(f.date)) + ' · ' + esc(label(f.homeKey)) + ' v ' + esc(label(f.awayKey))
        + ' [' + esc(leagueLabel(f)) + ']' + (f.status === 'rearranging' ? ' — postponed, needs a date' : '') + '</option>';
    }).join('');
  }

  function slotHTML(r) {
    var wk = r.weeks === 0 ? 'same week' : (Math.abs(r.weeks) + 'wk ' + (r.weeks < 0 ? 'earlier' : 'later'));
    var pill = '<span class="pill ' + r.status + '">' + (r.status === 'free' ? 'free'
      : r.warnings.length + ' warning' + (r.warnings.length > 1 ? 's' : '')) + '</span>';
    var flags = r.warnings.length
      ? r.warnings.map(function (w) { return '<span class="pill warn" title="' + esc(w.s) + '">' + esc(w.t) + '</span>'; }).join('')
      : '<span class="pill free">no conflicts</span>';
    return '<div class="slot ' + r.status + '"><div class="d">' + esc(C.fmt(r.iso)) + '<small>' + wk + '</small></div>'
      + '<div>' + pill + '</div><div class="flags">' + flags + '</div></div>';
  }

  function renderMove() {
    var f = ix.fxByUid[el('mFix').value];
    var out = el('moveOut');
    if (!f) { out.innerHTML = '<p class="text-muted">Pick a match to see the dates it could move to.</p>'; return; }
    var home = ix.teamByKey[f.homeKey], away = ix.teamByKey[f.awayKey];
    var c = C.candidates(ix, f.uid, win.from, win.to);
    var list = C.rank(c.rows, opts);
    var clean = C.rank(c.rows, { onNightOnly: opts.onNightOnly, cleanOnly: true }).length;
    out.innerHTML =
      '<div class="mb-2"><strong>' + esc(home.name) + '</strong> v <strong>' + esc(away.name) + '</strong> '
      + '<span class="pill ' + esc(f.league) + '">' + esc(home.leagueLabel) + '</span> '
      + '<span class="small text-muted">' + (f.status === 'rearranging' ? 'postponed (was ' + esc(C.fmt(f.date)) + ')' : 'currently ' + esc(C.fmt(f.date)))
      + ' · home night ' + esc(c.night) + (c.nightAssumed ? ' (assumed)' : '') + '</span></div>'
      + '<div class="small mb-2">'
      + '<label class="mr-3 me-3 mb-0"><input type="checkbox" id="optNight"' + (opts.onNightOnly ? ' checked' : '') + '> ' + esc(c.night) + 's only</label>'
      + '<label class="mr-3 me-3 mb-0"><input type="checkbox" id="optClean"' + (opts.cleanOnly ? ' checked' : '') + '> hide dates with warnings</label>'
      + '<span class="text-muted">' + clean + ' clean · ' + list.length + ' shown · ' + esc(C.fmt(win.from)) + ' to ' + esc(C.fmt(win.to)) + '</span></div>'
      + (list.length ? list.map(slotHTML).join('')
        : '<p class="text-muted">No dates with these filters — try unticking "' + esc(c.night) + 's only".</p>');
    el('optNight').onchange = function (e) { opts.onNightOnly = e.target.checked; renderMove(); };
    el('optClean').onchange = function (e) { opts.cleanOnly = e.target.checked; renderMove(); };
  }

  /* ---------- club calendar ---------- */
  function fxLine(f, clubKey) {
    var ours = ix.clubByKey[clubKey].teamKeys, homeOurs = ours.indexOf(f.homeKey) >= 0;
    return esc(label(f.homeKey)) + ' v ' + esc(label(f.awayKey)) + ' ' + (homeOurs ? '(H)' : '(A)')
      + (C.holdsNight(f.status) ? '' : ' — ' + esc(f.status));
  }
  function renderCal() {
    var clubKey = el('cClub').value, keys = ix.clubByKey[clubKey].teamKeys;
    var fxs = D.fixtures.filter(function (f) { return keys.indexOf(f.homeKey) >= 0 || keys.indexOf(f.awayKey) >= 0; });
    var byDate = {};
    fxs.forEach(function (f) { if (C.holdsNight(f.status)) (byDate[f.date] = byDate[f.date] || []).push(f); });

    var first = D.playWindow.start, last = D.playWindow.end;
    var y = Number(first.slice(0, 4)), m = Number(first.slice(5, 7)) - 1;
    var ey = Number(last.slice(0, 4)), em = Number(last.slice(5, 7)) - 1;
    var html = '<div class="cal">';
    while (y < ey || (y === ey && m <= em)) {
      var lead = (new Date(Date.UTC(y, m, 1)).getUTCDay() + 6) % 7, days = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
      html += '<div class="month"><h3>' + C.MON[m] + ' ' + y + '</h3><div class="mgrid">'
        + ['M', 'T', 'W', 'T', 'F', 'S', 'S'].map(function (w) { return '<div class="wd">' + w + '</div>'; }).join('');
      for (var i = 0; i < lead; i++) html += '<div class="day"></div>';
      for (var d = 1; d <= days; d++) {
        var iso = y + '-' + String(m + 1).padStart(2, '0') + '-' + String(d).padStart(2, '0');
        var fx = byDate[iso], today = iso === D.today ? ' today' : '';
        if (!fx) { html += '<div class="day' + today + '">' + d + '</div>'; continue; }
        var leagues = {};
        fx.forEach(function (f) { leagues[f.league] = true; });
        var cls = Object.keys(leagues).length > 1 ? 'both' : Object.keys(leagues)[0];
        var title = fx.map(function (f) { return label(f.homeKey) + ' v ' + label(f.awayKey); }).join('\n');
        html += '<div class="day ' + cls + (fx.length > 1 ? ' multi' : '') + today + '" title="' + esc(title) + '">' + d + '</div>';
      }
      html += '</div></div>';
      if (++m > 11) { m = 0; y++; }
    }
    html += '</div>';

    var club = ix.clubByKey[clubKey];
    html += '<h3 class="h6 mt-4">' + esc(club.name) + ' — ' + fxs.length + ' fixtures across '
      + club.leagues.length + ' league' + (club.leagues.length > 1 ? 's' : '') + '</h3>';
    html += fxs.slice().sort(function (a, b) { return a.date < b.date ? -1 : 1; }).map(function (f) {
      return '<div class="fx' + (f.date < D.today ? ' past' : '') + '"><span class="fxd">' + esc(C.fmt(f.date)) + '</span>'
        + '<span class="pill ' + esc(f.league) + '">' + esc(leagueLabel(f)) + '</span><span>' + fxLine(f, clubKey) + '</span></div>';
    }).join('');
    el('calOut').innerHTML = html;
  }

  /* ---------- wiring ---------- */
  var clubOptions = D.clubs.map(function (c) {
    return '<option value="' + esc(c.key) + '">' + esc(c.name) + (c.leagues.length > 1 ? ' (both leagues)' : '') + '</option>';
  }).join('');
  el('mClub').innerHTML = clubOptions;
  el('cClub').innerHTML = clubOptions;

  var start = wantFixture && ix.fxByUid[wantFixture];
  var startClub = start ? ix.teamByKey[start.homeKey].clubKey : D.clubs[0] && D.clubs[0].key;
  el('mClub').value = startClub;
  el('cClub').value = startClub;
  fillFixtures(startClub, start ? start.uid : null);
  // A linked fixture that is no longer movable (played, or not a home match listed here)
  // still opens: add it to the list rather than silently showing nothing.
  if (start && el('mFix').value !== start.uid) {
    var opt = document.createElement('option');
    opt.value = start.uid;
    opt.textContent = C.fmt(start.date) + ' · ' + label(start.homeKey) + ' v ' + label(start.awayKey) + ' (' + start.status + ')';
    el('mFix').appendChild(opt);
    el('mFix').value = start.uid;
  }

  el('mClub').onchange = function () { fillFixtures(el('mClub').value); el('cClub').value = el('mClub').value; renderMove(); };
  el('mFix').onchange = renderMove;
  el('cClub').onchange = renderCal;
  // Bootstrap's tab plugin fires shown.bs.tab through jQuery.
  if (window.jQuery) window.jQuery('#tab-cal').on('shown.bs.tab', renderCal);
  renderMove();
  renderCal();
})();
