// The gap-finder's rules, shared by the page (static/beta/js/gap-finder.js, as
// window.GapFinderCore) and the server (utils/gapFinder.js, through require) so the
// tests in __tests__/unit/gap-finder.test.js exercise the code the browser runs.
//
// Constraint model, agreed with Neil (Jul 2026), unchanged from tools/gap-finder:
//   hard  — either team is already playing that night, in either league. The date is out.
//   soft  — shown, never hidden unless asked: another team from either club is out that
//           night (common and intended for big clubs), the home club plays the night
//           before or after, the date is not the home team's usual night, a weekend, or a
//           holiday break.
// Ranked fewest warnings first, then nearest the original date.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.GapFinderCore = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  var MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  // A fixture with one of these statuses is in the data (it can be the match being moved)
  // but does not take up anybody's night. `rearranged` and `void` never reach the page.
  var FREES_NIGHT = { rearranging: true, conceded: true };
  function holdsNight(status) { return !FREES_NIGHT[status]; }

  function isoAdd(iso, days) {
    var d = new Date(iso + 'T00:00:00Z');
    d.setUTCDate(d.getUTCDate() + days);
    return d.toISOString().slice(0, 10);
  }
  function dowOf(iso) { return DOW[new Date(iso + 'T00:00:00Z').getUTCDay()]; }
  function weeksBetween(a, b) {
    return Math.round((Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / 6048e5);
  }
  function fmt(iso) {
    var d = new Date(iso + 'T00:00:00Z');
    return DOW[d.getUTCDay()] + ' ' + d.getUTCDate() + ' ' + MON[d.getUTCMonth()] + ' ' + String(d.getUTCFullYear()).slice(2);
  }

  // Easter Sunday (Anonymous Gregorian algorithm), as YYYY-MM-DD.
  function easter(y) {
    var a = y % 19, b = Math.floor(y / 100), c = y % 100, d = Math.floor(b / 4), e = b % 4;
    var f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3);
    var h = (19 * a + b - d - g + 15) % 30, i = Math.floor(c / 4), k = c % 4;
    var l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451);
    var month = Math.floor((h + l - 7 * m + 114) / 31), day = ((h + l - 7 * m + 114) % 31) + 1;
    return y + '-' + String(month).padStart(2, '0') + '-' + String(day).padStart(2, '0');
  }

  // Neither league records its breaks, so these are approximations: 19 Dec – 4 Jan, and
  // the week either side of Easter. `year` is the calendar year the season starts in.
  function breaksFor(year) {
    var e = easter(year + 1);
    return [
      { name: 'Xmas', start: year + '-12-19', end: (year + 1) + '-01-04' },
      { name: 'Easter', start: isoAdd(e, -6), end: isoAdd(e, 8) },
    ];
  }

  // Lookups over the payload utils/gapFinder.js builds.
  function index(data) {
    var ix = {
      data: data,
      teamByKey: {}, clubByKey: {}, fxByUid: {},
      committed: {},      // teamKey -> date -> [uid] (night-holding fixtures only)
      clubDateTeams: {},  // clubKey -> date -> { teamKey: true }
      breaks: breaksFor(Number(String(data.window.start).slice(0, 4))),
    };
    data.teams.forEach(function (t) { ix.teamByKey[t.key] = t; });
    data.clubs.forEach(function (c) { ix.clubByKey[c.key] = c; });
    data.fixtures.forEach(function (f) {
      ix.fxByUid[f.uid] = f;
      if (!holdsNight(f.status)) return;
      [[f.homeKey, f.homeClubKey], [f.awayKey, f.awayClubKey]].forEach(function (side) {
        var tk = side[0], ck = side[1];
        var byDate = ix.committed[tk] = ix.committed[tk] || {};
        (byDate[f.date] = byDate[f.date] || []).push(f.uid);
        if (ck) {
          var cd = ix.clubDateTeams[ck] = ix.clubDateTeams[ck] || {};
          (cd[f.date] = cd[f.date] || {})[tk] = true;
        }
      });
    });
    return ix;
  }

  function teamsOut(ix, clubKey, iso, exclude) {
    var s = ix.clubDateTeams[clubKey] && ix.clubDateTeams[clubKey][iso];
    if (!s) return [];
    return Object.keys(s).filter(function (tk) { return exclude.indexOf(tk) === -1; });
  }
  function busyWith(ix, teamKey, iso, exceptUid) {
    var u = (ix.committed[teamKey] && ix.committed[teamKey][iso]) || [];
    return u.filter(function (x) { return x !== exceptUid; }).map(function (uid) {
      var f = ix.fxByUid[uid];
      var home = f.homeKey === teamKey;
      var other = ix.teamByKey[home ? f.awayKey : f.homeKey];
      return (other ? other.name : '?') + (home ? ' (H)' : ' (A)');
    });
  }
  function inBreak(ix, iso) {
    for (var i = 0; i < ix.breaks.length; i++) {
      if (iso >= ix.breaks[i].start && iso <= ix.breaks[i].end) return ix.breaks[i];
    }
    return null;
  }

  // Every date from `from` to `to` (inclusive) assessed for moving fixture `uid`. Rows are
  // unsorted and include the hard-blocked ones (status 'busy'); rank() orders them.
  function candidates(ix, uid, from, to) {
    var f = ix.fxByUid[uid];
    var home = ix.teamByKey[f.homeKey], away = ix.teamByKey[f.awayKey];
    var night = home.homeNight || f.dow;
    var exclude = [f.homeKey, f.awayKey];
    var rows = [];
    for (var iso = from; iso <= to; iso = isoAdd(iso, 1)) {
      // Its own date is not a move; a postponed match's old date is open again, though.
      if (iso === f.date && holdsNight(f.status)) continue;
      var wd = dowOf(iso), onNight = wd === night;
      var homeBusy = busyWith(ix, f.homeKey, iso, uid), awayBusy = busyWith(ix, f.awayKey, iso, uid);
      var warnings = [];
      if (!onNight) warnings.push({ t: 'off night', s: 'not ' + home.name + "'s usual " + night });
      if ((wd === 'Sat' || wd === 'Sun') && !onNight) warnings.push({ t: 'weekend', s: wd });
      var b = inBreak(ix, iso);
      if (b) warnings.push({ t: b.name + ' break', s: 'holiday period (approximate)' });
      var hc = teamsOut(ix, home.clubKey, iso, exclude);
      if (hc.length) warnings.push({ t: home.club + ' ×' + hc.length, s: 'other club teams out: ' + names(ix, hc) });
      if (away.clubKey !== home.clubKey) {
        var ac = teamsOut(ix, away.clubKey, iso, exclude);
        if (ac.length) warnings.push({ t: away.club + ' ×' + ac.length, s: 'other club teams out: ' + names(ix, ac) });
      }
      var adj = teamsOut(ix, home.clubKey, isoAdd(iso, -1), []).length + teamsOut(ix, home.clubKey, isoAdd(iso, 1), []).length;
      if (adj) warnings.push({ t: 'adjacent night', s: home.club + ' plays the night before or after' });
      var busy = homeBusy.length || awayBusy.length;
      rows.push({
        iso: iso, wd: wd, onNight: onNight, warnings: warnings,
        status: busy ? 'busy' : (warnings.length ? 'warn' : 'free'),
        busyReason: homeBusy.length ? home.name + ' already playing ' + homeBusy.join(', ')
          : awayBusy.length ? away.name + ' already playing ' + awayBusy.join(', ') : '',
        weeks: weeksBetween(f.date, iso),
      });
    }
    return { rows: rows, night: night, nightAssumed: !home.homeNight };
  }
  function names(ix, keys) { return keys.map(function (k) { return ix.teamByKey[k].name; }).join(', '); }

  // Hard-blocked dates out; optionally only the usual night and only clean dates; fewest
  // warnings first, then nearest the original date, then earlier.
  function rank(rows, opts) {
    var list = rows.filter(function (r) {
      return r.status !== 'busy' && (!opts.onNightOnly || r.onNight) && (!opts.cleanOnly || r.status === 'free');
    });
    return list.sort(function (a, b) {
      return a.warnings.length - b.warnings.length || Math.abs(a.weeks) - Math.abs(b.weeks) || (a.iso < b.iso ? -1 : 1);
    });
  }

  // The window a move can land in: from tomorrow (or the first fixture, if later) to three
  // weeks after the last fixture of the season, so empty pre/post-season nights don't
  // read as free.
  function moveWindow(data) {
    var start = isoAdd(data.today, 1);
    if (data.playWindow.start > start) start = data.playWindow.start;
    return { from: start, to: isoAdd(data.playWindow.end, 21) };
  }

  return {
    DOW: DOW, MON: MON, holdsNight: holdsNight, isoAdd: isoAdd, dowOf: dowOf, fmt: fmt,
    easter: easter, breaksFor: breaksFor, index: index, candidates: candidates, rank: rank,
    moveWindow: moveWindow, teamsOut: teamsOut,
  };
});
