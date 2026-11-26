// The multi-player ELO comparison at /elo-chart, moved out of views/elo-chart.ejs
// (REARCH-07 step 5). Its settings are the page's #elo-chart-config JSON block.
(function() {
  var CONFIG = JSON.parse(document.getElementById('elo-chart-config').textContent);
  var MAX_PLAYERS = CONFIG.maxPlayers;
  var SHOW_STRENGTH = CONFIG.showStrength;
  var selectedPlayers = [];  // [{id, name}]
  var chart = null;
  var lastElo = [], lastPoints = [];
  var modeSelect = document.getElementById('rating-mode');
  function mode() { return modeSelect ? modeSelect.value : 'elo'; }

  // Evenly spaced, distinct hues — works for any count up to MAX_PLAYERS
  // without needing a hand-picked color list.
  function colorFor(index, alpha) {
    var hue = Math.round((index * 360) / MAX_PLAYERS);
    return 'hsla(' + hue + ', 65%, 45%, ' + (alpha == null ? 1 : alpha) + ')';
  }

  // ---- chart init ----
  var ctx = document.getElementById('elo-chart').getContext('2d');
  chart = new Chart(ctx, {
    type: 'line',
    data: { datasets: [] },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      scales: {
        x: {
          type: 'time',
          time: { unit: 'month', tooltipFormat: 'dd MMM yyyy' },
          title: { display: true, text: 'Date' }
        },
        y: { title: { display: true, text: 'ELO Rating' } }
      },
      plugins: {
        // The uncertainty bands are datasets too, but nothing to name or hover.
        legend: { display: true, labels: { filter: function(item, data) { return !data.datasets[item.datasetIndex].band; } } },
        tooltip: {
          mode: 'nearest',
          intersect: false,
          filter: function(item) { return !item.dataset.band; },
          callbacks: {
            label: function(ctx) {
              var se = ctx.raw && ctx.raw.se;
              return ctx.dataset.label + ': ' + ctx.raw.y + (se ? ' (±' + se + ')' : '');
            }
          }
        }
      }
    }
  });

  // ---- seed from URL query (?players=1,2) ----
  var seedIds = CONFIG.selectedIds;
  if (seedIds.length > 0) {
    fetchAndRender(seedIds);
  }

  function fetchAndRender(ids) {
    var points = SHOW_STRENGTH && ids.length
      ? fetch('/api/player-strength?players=' + ids.join(',')).then(function(r){ return r.ok ? r.json() : [] })
      : Promise.resolve([]);
    Promise.all([fetch('/api/player-elo?players=' + ids.join(',')).then(function(r){ return r.json() }), points])
      .then(function(both) {
        var series = both[0];
        selectedPlayers = series.map(function(s){ return { id: s.id, name: s.name } });
        lastElo = series;
        lastPoints = both[1];
        rebuildBadges();
        rebuildChart();
        updateUrl();
      });
  }

  if (modeSelect) modeSelect.addEventListener('change', function() { rebuildChart(); });

  function addPlayer(id, name) {
    if (selectedPlayers.length >= MAX_PLAYERS) return alert('Maximum ' + MAX_PLAYERS + ' players');
    if (selectedPlayers.find(function(p){ return p.id === id })) return;
    selectedPlayers.push({ id: id, name: name });
    fetchAndRender(selectedPlayers.map(function(p){ return p.id }));
  }

  function removePlayer(id) {
    selectedPlayers = selectedPlayers.filter(function(p){ return p.id !== id });
    fetchAndRender(selectedPlayers.map(function(p){ return p.id }));
  }

  function rebuildBadges() {
    var container = document.getElementById('selected-players');
    container.innerHTML = '';
    selectedPlayers.forEach(function(p, i) {
      var badge = document.createElement('div');
      badge.className = 'badge badge-pill rounded-pill d-flex align-items-center justify-content-between mb-1 px-2 py-1';
      badge.style.backgroundColor = colorFor(i);
      badge.style.color = '#fff';
      badge.style.fontSize = '0.8rem';
      badge.style.whiteSpace = 'normal';
      badge.style.wordBreak = 'break-word';
      badge.innerHTML = '<span>' + p.name + '</span><button type="button" class="close ml-1 ms-1" style="color:#fff;font-size:0.9rem;line-height:1;" data-id="' + p.id + '">&times;</button>';
      badge.querySelector('.close').addEventListener('click', function(e){
        removePlayer(parseInt(e.target.getAttribute('data-id'), 10));
      });
      container.appendChild(badge);
    });
  }

  // No line across a gap longer than a summer (2020/21 had no games): a straight line there
  // reads as a slow change that never happened.
  function hideLongGap(ctx) {
    return ctx.p1.parsed.x - ctx.p0.parsed.x > 200 * 86400000 ? 'transparent' : undefined;
  }

  // Each player keeps one colour: the ELO solid, the points rating dashed.
  function rebuildChart() {
    var m = mode(), sets = [];
    lastElo.forEach(function(s, i) {
      var color = colorFor(i);
      if (m !== 'points') sets.push({
        label: s.name + (m === 'both' ? ' (ELO)' : ''),
        data: s.data,
        borderColor: color,
        backgroundColor: color,
        fill: false,
        tension: 0,
        pointRadius: 2,
        pointHoverRadius: 5
      });
      var pts = lastPoints.find(function(p){ return p.id === s.id });
      // The band: the rating ± its standard error, shaded between two invisible lines. Wide
      // where the rating knows little (a player with few recent games), narrow where it knows a lot.
      if (m !== 'elo' && pts) sets.push({
        band: true,
        data: pts.data.map(function(d){ return { x: d.x, y: d.y + d.se } }),
        borderWidth: 0, pointRadius: 0, pointHoverRadius: 0, fill: false, tension: 0,
        segment: { backgroundColor: hideLongGap }
      }, {
        band: true,
        data: pts.data.map(function(d){ return { x: d.x, y: d.y - d.se } }),
        borderWidth: 0, pointRadius: 0, pointHoverRadius: 0, tension: 0,
        fill: '-1',
        backgroundColor: colorFor(i, 0.12),
        segment: { backgroundColor: function(ctx) { return hideLongGap(ctx) || colorFor(i, 0.12); } }
      });
      if (m !== 'elo' && pts) sets.push({
        label: s.name + ' (points)',
        data: pts.data,
        borderColor: color,
        backgroundColor: color,
        borderDash: [6, 4],
        segment: { borderColor: hideLongGap },
        fill: false,
        tension: 0,
        pointRadius: 0,
        pointHoverRadius: 4
      });
    });
    chart.data.datasets = sets;
    chart.options.scales.y.title.text = m === 'elo' ? 'ELO Rating' : m === 'points' ? 'Points rating' : 'Rating';
    chart.update();
  }

  function updateUrl() {
    var ids = selectedPlayers.map(function(p){ return p.id }).join(',');
    var url = ids ? '/elo-chart?players=' + ids : '/elo-chart';
    history.replaceState(null, '', url);
  }

  // ---- filters + player search ----
  var searchInput    = document.getElementById('player-search');
  var searchResult   = document.getElementById('search-results');
  var filterDivision = document.getElementById('filter-division');
  var filterClub     = document.getElementById('filter-club');
  var filterTeam     = document.getElementById('filter-team');
  var filterGender   = document.getElementById('filter-gender');
  var searchTimer    = null;

  function activeFilters() {
    return {
      division: filterDivision.value,
      club: filterClub.value,
      team: filterTeam.value,
      gender: filterGender.value
    };
  }

  function runSearch() {
    var q = searchInput.value.trim();
    var filters = activeFilters();
    var hasFilter = filters.division || filters.club || filters.team || filters.gender;
    if (q.length < 2 && !hasFilter) { searchResult.style.display = 'none'; return; }

    var params = new URLSearchParams({ q: q });
    Object.keys(filters).forEach(function(k) { if (filters[k]) params.set(k, filters[k]); });

    fetch('/api/players/search?' + params.toString())
      .then(function(r){ return r.json() })
      .then(function(players) {
        var selectedIds = selectedPlayers.map(function(p){ return p.id });
        players = players.filter(function(p){ return selectedIds.indexOf(p.id) === -1; });
        searchResult.innerHTML = '';
        if (players.length === 0) { searchResult.style.display = 'none'; return; }
        players.forEach(function(p) {
          var item = document.createElement('a');
          item.href = '#';
          item.className = 'list-group-item list-group-item-action py-1 small';
          item.innerHTML = '<strong>' + p.name + '</strong><br><span class="text-muted">' + (p.teamName || '') + '</span>';
          item.addEventListener('click', function(e) {
            e.preventDefault();
            addPlayer(p.id, p.name);
            // Keep the list open (minus the player just added) so a filter or
            // search can be used to add several players in a row.
            runSearch();
          });
          searchResult.appendChild(item);
        });
        searchResult.style.display = 'block';
      });
  }

  searchInput.addEventListener('input', function() {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(runSearch, 250);
  });

  [filterDivision, filterClub, filterTeam, filterGender].forEach(function(el) {
    el.addEventListener('change', runSearch);
  });

  document.addEventListener('click', function(e) {
    if (!searchInput.contains(e.target) && !searchResult.contains(e.target)) {
      searchResult.style.display = 'none';
    }
  });

  document.getElementById('clear-btn').addEventListener('click', function() {
    selectedPlayers = [];
    lastElo = []; lastPoints = [];
    rebuildBadges();
    rebuildChart();
    updateUrl();
  });
})();
