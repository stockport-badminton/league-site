/* Team management editor — reordering, moves, and the add/transfer flow.
 *
 * Used by views/roster-edit.ejs.
 *
 * What this replaces, and why it's built this way:
 *
 * - The old page bound only dragstart/dragover/drop. Mobile browsers don't
 *   synthesise those from touch, so on a phone there was no way to reorder anyone
 *   at all, and no fallback: Move Up / Move Down were in the menu but their
 *   handlers were bound by position (`button:nth-child(1)` and `(2)`), so items 3
 *   and 4 never got a listener. Pointer events cover mouse, touch and pen from one
 *   code path, and the arrow keys work on a focused handle.
 *
 * - Each drop wrote straight to the database, one fetch per gesture, with the DOM
 *   already moved and the error path only calling console.error — so a failed save
 *   looked exactly like a successful one. Here the DOM is the working copy, the
 *   Save bar shows what's pending, and a failed save re-renders from the server's
 *   answer rather than leaving the screen lying.
 *
 * - Team and section were re-derived by walking up four parentElements and reading
 *   positional indices (`children[0].attributes[1].nodeValue`). Every list carries
 *   data-team / data-gender / data-section instead.
 */
(function () {
  'use strict';

  var root = document.getElementById('roster-editor');
  if (!root) return;

  var CLUB_URL = root.dataset.clubUrl;
  var saveBar = document.getElementById('roster-savebar');
  var saveMsg = document.getElementById('roster-savebar-msg');
  var toastEl = document.getElementById('roster-toast');

  // The server's state, so Discard can restore it and the Save bar can count what
  // actually differs rather than counting gestures.
  var baseline = new Map();
  // Which section a row started in, so a row dragged out and back reads as clean.
  var pending = { moveRow: null, addContext: null, lastSearch: [] };

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  function lists() {
    return Array.prototype.slice.call(root.querySelectorAll('.roster-list'));
  }

  function rowsIn(list) {
    return Array.prototype.slice.call(list.children).filter(function (el) {
      return el.classList.contains('roster-row');
    });
  }

  function listKey(list) {
    return list.dataset.team + ':' + list.dataset.gender + ':' + list.dataset.section;
  }

  function snapshot() {
    var state = new Map();
    lists().forEach(function (list) {
      state.set(listKey(list), rowsIn(list).map(function (r) { return r.dataset.playerId; }));
    });
    return state;
  }

  function captureBaseline() {
    baseline = snapshot();
  }

  function toast(message, kind, action) {
    toastEl.textContent = '';
    toastEl.className = 'roster-toast show' + (kind === 'error' ? ' error' : '');
    toastEl.appendChild(document.createTextNode(message));
    if (action) {
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.textContent = action.label;
      btn.addEventListener('click', function () {
        hideToast();
        action.onClick();
      });
      toastEl.appendChild(btn);
    }
    clearTimeout(toastEl._timer);
    // An error, or anything with an action on it, stays up long enough to read and
    // act on. The old page used alert() for all of this.
    toastEl._timer = setTimeout(hideToast, action ? 12000 : kind === 'error' ? 8000 : 3200);
  }

  function hideToast() {
    toastEl.className = 'roster-toast';
  }

  // ---------------------------------------------------------------------------
  // Rendering
  // ---------------------------------------------------------------------------

  // Rank labels and the changed-since-load markers. Positions are recomputed from
  // the DOM every time rather than tracked incrementally, which is what let the old
  // code drift out of step with what the server held.
  function refresh() {
    var changedTeams = new Set();

    lists().forEach(function (list) {
      var isReserve = list.dataset.section === 'reserve';
      var rows = rowsIn(list);
      var before = baseline.get(listKey(list)) || [];

      rows.forEach(function (row, i) {
        row.querySelector('.rank').textContent = isReserve ? 'R' + (i + 1) : String(i + 1);
        row.classList.toggle('is-reserve', isReserve);
        var moved = before[i] !== row.dataset.playerId;
        row.classList.toggle('moved', moved);
        if (moved) changedTeams.add(list.dataset.team);
      });

      // A list emptied by a drag still needs to be a drop target.
      list.classList.toggle('is-empty-target', rows.length === 0);

      var label = list.previousElementSibling;
      if (label && label.classList.contains('roster-section-label')) {
        var counter = label.lastElementChild;
        if (counter) counter.textContent = String(rows.length);
      }
    });

    // Card headline counts.
    root.querySelectorAll('.roster-card').forEach(function (card) {
      var nominated = 0;
      var reserve = 0;
      card.querySelectorAll('.roster-list').forEach(function (list) {
        var n = rowsIn(list).length;
        if (list.dataset.section === 'reserve') reserve += n; else nominated += n;
      });
      var el = card.querySelector('.team-count');
      if (el) {
        el.textContent = nominated + ' nominated' + (reserve ? ' · ' + reserve + ' reserve' : '');
      }
    });

    updateSaveBar(changedTeams);
    return changedTeams;
  }

  function changedTeamIds() {
    var changed = new Set();
    lists().forEach(function (list) {
      var now = rowsIn(list).map(function (r) { return r.dataset.playerId; });
      var before = baseline.get(listKey(list)) || [];
      if (now.length !== before.length || now.some(function (id, i) { return id !== before[i]; })) {
        changed.add(list.dataset.team);
      }
    });
    return changed;
  }

  function updateSaveBar(changedTeams) {
    var teams = changedTeams || changedTeamIds();
    if (!teams.size) {
      saveBar.hidden = true;
      return;
    }
    var movedRows = root.querySelectorAll('.roster-row.moved').length;
    saveMsg.textContent = movedRows + (movedRows === 1 ? ' player moved' : ' players moved') +
      ' in ' + teams.size + (teams.size === 1 ? ' team' : ' teams');
    saveBar.hidden = false;
  }

  // ---------------------------------------------------------------------------
  // Reordering: pointer (mouse, touch, pen)
  // ---------------------------------------------------------------------------

  var drag = null;

  function onHandleDown(e) {
    if (e.button !== undefined && e.button !== 0) return;
    var row = e.currentTarget.closest('.roster-row');
    if (!row) return;

    // Stops the page scrolling under the finger. Paired with touch-action: none on
    // the handle in roster.css — one without the other doesn't work on iOS.
    e.preventDefault();
    closeMenu();

    var handle = e.currentTarget;
    handle.setPointerCapture(e.pointerId);
    drag = { row: row, handle: handle, y: e.clientY, from: row.parentElement };
    row.classList.add('grabbed');
    // Only the lists this row may legally be dropped into: same team, same gender.
    // Cross-team and cross-gender moves go through the move dialog, because the
    // destination is usually off-screen and ranks are numbered per gender.
    drag.targets = lists().filter(function (list) {
      return list.dataset.team === drag.from.dataset.team &&
             list.dataset.gender === drag.from.dataset.gender;
    });
    drag.targets.forEach(function (l) { l.classList.add('drop-active'); });

    handle.addEventListener('pointermove', onHandleMove);
    handle.addEventListener('pointerup', onHandleUp);
    handle.addEventListener('pointercancel', onHandleUp);
  }

  function onHandleMove(e) {
    if (!drag) return;
    e.preventDefault();
    var row = drag.row;
    row.style.transform = 'translateY(' + (e.clientY - drag.y) + 'px)';

    for (var i = 0; i < drag.targets.length; i++) {
      var list = drag.targets[i];
      var others = rowsIn(list).filter(function (r) { return r !== row; });
      var box = list.getBoundingClientRect();

      // Insert above the first row whose midpoint the pointer is past.
      for (var j = 0; j < others.length; j++) {
        var r = others[j].getBoundingClientRect();
        if (e.clientY < r.top + r.height / 2) {
          if (others[j] !== row.nextElementSibling || row.parentElement !== list) {
            list.insertBefore(row, others[j]);
            settle(e.clientY);
          }
          return;
        }
      }

      // Past every row in this list, but still within its band: append.
      var lastBottom = others.length
        ? others[others.length - 1].getBoundingClientRect().bottom
        : box.top;
      if (e.clientY >= lastBottom - 2 && e.clientY <= box.bottom + 24) {
        if (row.parentElement !== list || row !== list.lastElementChild) {
          list.appendChild(row);
          settle(e.clientY);
        }
        return;
      }
    }
  }

  // Re-baselines the finger offset after a DOM move so the row doesn't jump.
  function settle(y) {
    drag.y = y;
    drag.row.style.transform = 'translateY(0px)';
    refresh();
  }

  function onHandleUp() {
    if (!drag) return;
    drag.handle.removeEventListener('pointermove', onHandleMove);
    drag.handle.removeEventListener('pointerup', onHandleUp);
    drag.handle.removeEventListener('pointercancel', onHandleUp);
    drag.targets.forEach(function (l) { l.classList.remove('drop-active'); });
    drag.row.style.transform = '';
    drag.row.classList.remove('grabbed');
    drag = null;
    refresh();
  }

  // ---------------------------------------------------------------------------
  // Reordering: keyboard and menu
  // ---------------------------------------------------------------------------

  // Moves a row one place, crossing the nominated/reserve boundary within the same
  // team and gender when it runs off either end — the same reach the drag has.
  function step(row, direction) {
    var list = row.parentElement;
    if (direction < 0) {
      if (row.previousElementSibling) {
        list.insertBefore(row, row.previousElementSibling);
      } else if (list.dataset.section === 'reserve') {
        var nominated = siblingList(list, 'nominated');
        if (nominated) nominated.appendChild(row);
      } else {
        return false;
      }
    } else {
      if (row.nextElementSibling) {
        list.insertBefore(row.nextElementSibling, row);
      } else if (list.dataset.section === 'nominated') {
        var reserve = siblingList(list, 'reserve');
        if (reserve) reserve.insertBefore(row, reserve.firstChild);
      } else {
        return false;
      }
    }
    refresh();
    return true;
  }

  function siblingList(list, section) {
    return root.querySelector('.roster-list[data-team="' + list.dataset.team +
      '"][data-gender="' + list.dataset.gender + '"][data-section="' + section + '"]');
  }

  function onHandleKey(e) {
    if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
    e.preventDefault();
    var handle = e.currentTarget;
    var row = handle.closest('.roster-row');
    if (step(row, e.key === 'ArrowUp' ? -1 : 1)) {
      // The row moved in the DOM, which blurs its button; put focus back so the
      // key can be pressed again.
      row.querySelector('.drag-handle').focus();
    }
  }

  // ---------------------------------------------------------------------------
  // Row menu
  // ---------------------------------------------------------------------------

  var openMenuEl = null;

  function closeMenu() {
    if (!openMenuEl) return;
    var btn = openMenuEl.parentElement.querySelector('.row-menu-btn');
    if (btn) btn.setAttribute('aria-expanded', 'false');
    openMenuEl.remove();
    openMenuEl = null;
  }

  function openMenu(row, button) {
    closeMenu();
    var list = row.parentElement;
    var name = row.dataset.playerName;
    var isReserve = list.dataset.section === 'reserve';

    var menu = document.createElement('div');
    menu.className = 'roster-menu';

    function item(label, onClick, opts) {
      var b = document.createElement('button');
      b.type = 'button';
      b.textContent = label;
      if (opts && opts.danger) b.className = 'danger';
      if (opts && opts.disabled) b.disabled = true;
      else b.addEventListener('click', function () { closeMenu(); onClick(); });
      menu.appendChild(b);
    }

    var rows = rowsIn(list);
    var index = rows.indexOf(row);
    item('Move up', function () { step(row, -1); },
      { disabled: index === 0 && !isReserve });
    item('Move down', function () { step(row, 1); },
      { disabled: index === rows.length - 1 && isReserve });
    item(isReserve ? 'Make nominated' : 'Make reserve', function () {
      var target = siblingList(list, isReserve ? 'nominated' : 'reserve');
      if (!target) return;
      if (isReserve) target.appendChild(row); else target.insertBefore(row, target.firstChild);
      refresh();
    });
    item('Move to another team…', function () { openMoveDialog(row); });
    menu.appendChild(document.createElement('hr'));
    item('Edit details', function () {
      window.open('/player/' + row.dataset.playerId + '/update', '_blank', 'noopener');
    });
    item('Remove from team', function () { confirmRelease(row, name); }, { danger: true });

    row.style.position = 'relative';
    row.appendChild(menu);
    button.setAttribute('aria-expanded', 'true');
    openMenuEl = menu;
    menu.querySelector('button:not(:disabled)').focus();
  }

  // ---------------------------------------------------------------------------
  // Writes
  // ---------------------------------------------------------------------------

  function postJson(url, body) {
    return fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify(body || {})
    }).then(readJson);
  }

  // A failed request has to fail loudly — the old code's
  // `.then(r => { r.json() })` had no return, so `data` was always undefined and
  // "Success:" logged whatever happened.
  function readJson(response) {
    return response.text().then(function (text) {
      var data = null;
      try { data = text ? JSON.parse(text) : null; } catch (e) { /* not JSON */ }
      if (!response.ok) {
        var message = (data && (data.error || data.message)) ||
          (response.status === 403 ? 'You don\'t have permission to change that.' :
           response.status === 401 ? 'Your session has expired — reload and sign in again.' :
           'Save failed (' + response.status + ').');
        var err = new Error(message);
        err.status = response.status;
        throw err;
      }
      return data;
    });
  }

  function save() {
    var teams = changedTeamIds();
    if (!teams.size) return;

    var saveBtn = document.getElementById('roster-save');
    saveBtn.disabled = true;
    saveMsg.textContent = 'Saving…';

    var requests = Array.from(teams).map(function (teamId) {
      var sections = lists()
        .filter(function (l) { return l.dataset.team === teamId; })
        .map(function (l) {
          return {
            gender: l.dataset.gender,
            section: l.dataset.section,
            playerIds: rowsIn(l).map(function (r) { return parseInt(r.dataset.playerId, 10); })
          };
        });
      return postJson('/api/teams/' + teamId + '/order', { sections: sections });
    });

    Promise.all(requests).then(function () {
      captureBaseline();
      refresh();
      toast(teams.size === 1 ? 'Order saved.' : 'Order saved for ' + teams.size + ' teams.');
    }).catch(function (err) {
      // Some of the requests may have landed. Reloading is the only honest way to
      // show what the database actually holds now.
      toast(err.message + ' Reloading to show the saved state.', 'error');
      setTimeout(function () { window.location.reload(); }, 2500);
    }).finally(function () {
      saveBtn.disabled = false;
      updateSaveBar();
    });
  }

  function discard() {
    // Put every row back in the list and order the server last told us about.
    var byId = new Map();
    root.querySelectorAll('.roster-row').forEach(function (row) {
      byId.set(row.dataset.playerId, row);
    });
    lists().forEach(function (list) {
      (baseline.get(listKey(list)) || []).forEach(function (id) {
        var row = byId.get(id);
        if (row) list.appendChild(row);
      });
    });
    refresh();
    toast('Changes discarded.');
  }

  function confirmRelease(row, name) {
    if (!window.confirm('Remove ' + name + ' from this team?\n\n' +
        'They stay registered with their match history, and can be added to another team later.')) {
      return;
    }
    postJson('/api/players/' + row.dataset.playerId + '/release').then(function () {
      var list = row.parentElement;
      row.remove();
      // Applied server-side straight away, so the baseline moves with it — this
      // isn't a pending change to be saved.
      baseline.set(listKey(list), rowsIn(list).map(function (r) { return r.dataset.playerId; }));
      refresh();
      toast(name + ' removed from the team.');
    }).catch(function (err) {
      toast(err.message, 'error');
    });
  }

  // ---------------------------------------------------------------------------
  // Move dialog
  // ---------------------------------------------------------------------------

  function openMoveDialog(row) {
    pending.moveRow = row;
    document.getElementById('rosterMoveWho').textContent =
      row.dataset.playerName + ' is currently in ' +
      row.closest('.roster-card').dataset.teamName + '.';
    // Default to somewhere other than where they already are.
    var select = document.getElementById('rosterMoveTeam');
    var current = row.parentElement.dataset.team;
    for (var i = 0; i < select.options.length; i++) {
      if (select.options[i].value !== current) { select.selectedIndex = i; break; }
    }
    $('#rosterMoveModal').modal('show');
  }

  function doMove() {
    var row = pending.moveRow;
    if (!row) return;
    var teamId = document.getElementById('rosterMoveTeam').value;
    var section = document.getElementById('rosterMoveSection').value;
    var name = row.dataset.playerName;

    // An unsaved reorder in either team would be clobbered by the server's
    // renumbering, so bank it first.
    if (!saveBar.hidden) {
      toast('Save your pending changes before moving someone between teams.', 'error');
      return;
    }

    postJson('/api/players/' + row.dataset.playerId + '/move',
      { teamId: parseInt(teamId, 10), section: section }
    ).then(function (data) {
      $('#rosterMoveModal').modal('hide');
      // The destination team's ranks are now the server's business; reload so both
      // cards show what it decided rather than a guess.
      toast(name + ' moved to ' + (data.team || 'the new team') + '.');
      setTimeout(function () { window.location.reload(); }, 900);
    }).catch(function (err) {
      toast(err.message, 'error');
    });
  }

  // ---------------------------------------------------------------------------
  // Add / transfer
  // ---------------------------------------------------------------------------

  function openAddDialog(button) {
    pending.addContext = {
      teamId: button.dataset.team,
      teamName: button.dataset.teamName,
      gender: button.dataset.gender
    };
    document.getElementById('rosterAddTarget').textContent =
      'Adding to ' + pending.addContext.teamName + ' as a reserve ' +
      (pending.addContext.gender === 'Male' ? 'man' : 'lady') + '.';
    document.getElementById('rosterAddSearch').value = '';
    document.getElementById('rosterNewFirst').value = '';
    document.getElementById('rosterNewFamily').value = '';
    document.getElementById('rosterAddResults').textContent = '';
    $('#rosterAddModal').modal('show');
    setTimeout(function () { document.getElementById('rosterAddSearch').focus(); }, 300);
  }

  function searchCandidates() {
    var term = document.getElementById('rosterAddSearch').value.trim();
    var out = document.getElementById('rosterAddResults');
    if (term.length < 2) {
      out.textContent = '';
      out.appendChild(msgEl('Type at least two letters to search.'));
      return;
    }
    out.textContent = '';
    out.appendChild(msgEl('Searching…'));

    fetch('/api/roster/club-' + CLUB_URL + '/candidates?term=' + encodeURIComponent(term), {
      credentials: 'same-origin'
    }).then(readJson).then(function (data) {
      renderCandidates(data);
    }).catch(function (err) {
      out.textContent = '';
      out.appendChild(msgEl(err.message));
    });
  }

  function msgEl(text) {
    var p = document.createElement('p');
    p.className = 'empty';
    p.textContent = text;
    return p;
  }

  // Three groups, three labelled actions. The old modal put all of these in one
  // <select> and decided which branch to take by reading `selectedPlayer.class` — a
  // property it had set on the option object, which never became a class attribute.
  function renderCandidates(data) {
    var out = document.getElementById('rosterAddResults');
    out.textContent = '';
    var gender = pending.addContext.gender;

    var unattached = (data.unattached || []).filter(function (p) { return p.gender === gender; });
    var others = (data.otherClubs || []).filter(function (p) { return p.gender === gender; });

    out.appendChild(group('Registered to no club — add them directly', unattached,
      function (p) { return { label: 'Add', className: 'btn-success', onClick: function () { attach(p); } }; },
      'Nobody unattached matches that name.'));

    out.appendChild(group('Already at another club — needs a transfer', others,
      function (p) { return { label: 'Request transfer', className: 'btn-outline-warning', onClick: function () { requestTransfer(p); } }; },
      'Nobody at another club matches that name.'));

    if (!unattached.length && !others.length) {
      var hint = document.createElement('p');
      hint.className = 'text-muted small mb-0';
      hint.textContent = 'No existing player matches. Create a new one below.';
      out.appendChild(hint);
    }
  }

  function group(title, people, actionFor, emptyText) {
    var wrap = document.createElement('div');
    wrap.className = 'result-group';
    var h = document.createElement('h6');
    h.textContent = title;
    wrap.appendChild(h);

    if (!people.length) {
      wrap.appendChild(msgEl(emptyText));
      return wrap;
    }

    people.forEach(function (person) {
      var rowEl = document.createElement('div');
      rowEl.className = 'candidate';

      var who = document.createElement('div');
      who.className = 'who';
      who.appendChild(document.createTextNode(person.name));
      var sub = document.createElement('small');
      sub.textContent = [person.clubName, person.teamName].filter(Boolean).join(' · ') || 'No club';
      who.appendChild(sub);
      rowEl.appendChild(who);

      var action = actionFor(person);
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'btn btn-sm ' + action.className;
      btn.textContent = action.label;
      btn.addEventListener('click', function () {
        btn.disabled = true;
        action.onClick();
      });
      rowEl.appendChild(btn);
      wrap.appendChild(rowEl);
    });
    return wrap;
  }

  function attach(person) {
    postJson('/api/roster/club-' + CLUB_URL + '/attach', {
      playerId: person.playerId,
      teamId: parseInt(pending.addContext.teamId, 10),
      section: 'reserve'
    }).then(function () {
      $('#rosterAddModal').modal('hide');
      toast(person.name + ' added to ' + pending.addContext.teamName + '.');
      setTimeout(function () { window.location.reload(); }, 800);
    }).catch(function (err) {
      toast(err.message, 'error');
    });
  }

  function requestTransfer(person) {
    postJson('/api/roster/club-' + CLUB_URL + '/transfer', {
      playerId: person.playerId,
      teamId: parseInt(pending.addContext.teamId, 10)
    }).then(function (data) {
      $('#rosterAddModal').modal('hide');
      toast(data.message);
      if (data.applied) setTimeout(function () { window.location.reload(); }, 900);
    }).catch(function (err) {
      toast(err.message, 'error');
    });
  }

  function createPlayer() {
    var first = document.getElementById('rosterNewFirst').value.trim();
    var family = document.getElementById('rosterNewFamily').value.trim();
    if (!first || !family) {
      toast('Both a first name and a family name are needed.', 'error');
      return;
    }
    var btn = document.getElementById('rosterCreateBtn');
    btn.disabled = true;

    postJson('/api/roster/club-' + CLUB_URL + '/players', {
      firstName: first,
      familyName: family,
      gender: pending.addContext.gender,
      teamId: parseInt(pending.addContext.teamId, 10),
      section: 'reserve'
    }).then(function () {
      $('#rosterAddModal').modal('hide');
      toast(first + ' ' + family + ' created and added as a reserve.');
      setTimeout(function () { window.location.reload(); }, 800);
    }).catch(function (err) {
      toast(err.message, 'error');
    }).finally(function () {
      btn.disabled = false;
    });
  }

  // ---------------------------------------------------------------------------
  // Wiring
  // ---------------------------------------------------------------------------

  root.querySelectorAll('.drag-handle').forEach(function (handle) {
    handle.addEventListener('pointerdown', onHandleDown);
    handle.addEventListener('keydown', onHandleKey);
  });

  root.addEventListener('click', function (e) {
    var menuBtn = e.target.closest('.row-menu-btn');
    if (menuBtn) {
      e.stopPropagation();
      var row = menuBtn.closest('.roster-row');
      if (openMenuEl && openMenuEl.parentElement === row) closeMenu();
      else openMenu(row, menuBtn);
      return;
    }
    var addBtn = e.target.closest('.roster-add-btn');
    if (addBtn) openAddDialog(addBtn);
  });

  document.addEventListener('click', function (e) {
    if (openMenuEl && !openMenuEl.contains(e.target)) closeMenu();
  });
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') closeMenu();
  });

  document.getElementById('roster-save').addEventListener('click', save);
  document.getElementById('roster-discard').addEventListener('click', discard);
  document.getElementById('rosterMoveConfirm').addEventListener('click', doMove);
  document.getElementById('rosterAddSearchBtn').addEventListener('click', searchCandidates);
  document.getElementById('rosterCreateBtn').addEventListener('click', createPlayer);
  document.getElementById('rosterAddSearch').addEventListener('keydown', function (e) {
    if (e.key === 'Enter') { e.preventDefault(); searchCandidates(); }
  });

  var clubSwitch = document.getElementById('club-switch');
  if (clubSwitch) {
    clubSwitch.addEventListener('change', function () {
      if (!saveBar.hidden &&
          !window.confirm('You have unsaved changes. Leave without saving?')) {
        clubSwitch.value = root.dataset.clubUrl;
        return;
      }
      window.location.href = '/manage-players/club-' + clubSwitch.value + '/edit';
    });
  }

  // Closing the tab mid-edit is the one case the Save bar can't warn about on its
  // own, and every drag used to be an immediate live write.
  window.addEventListener('beforeunload', function (e) {
    if (!saveBar.hidden) {
      e.preventDefault();
      e.returnValue = '';
    }
  });

  captureBaseline();
  refresh();
})();
