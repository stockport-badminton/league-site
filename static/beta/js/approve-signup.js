// Moved out of views/approve-signup.ejs (REARCH-07 step 5), unchanged.
(function() {
  var searchInput = document.getElementById('playerSearch');
  var searchResult = document.getElementById('playerSearchResults');
  var playerIdInput = document.getElementById('playerId');
  var selectedPlayerDiv = document.getElementById('selectedPlayer');
  var selectedPlayerName = document.getElementById('selectedPlayerName');
  var clearBtn = document.getElementById('clearPlayer');
  var submitBtn = document.getElementById('submitBtn');
  var searchTimer;

  function runSearch() {
    var q = searchInput.value.trim();
    if (q.length < 2) { searchResult.style.display = 'none'; return; }

    fetch('/api/players/search?q=' + encodeURIComponent(q))
      .then(function(r) { return r.json(); })
      .then(function(players) {
        searchResult.innerHTML = '';
        if (players.length === 0) { searchResult.style.display = 'none'; return; }
        players.forEach(function(p) {
          var item = document.createElement('a');
          item.href = '#';
          item.className = 'list-group-item list-group-item-action py-1 small';
          var strong = document.createElement('strong');
          strong.textContent = p.name;
          var span = document.createElement('span');
          span.className = 'text-muted';
          span.textContent = p.teamName ? ' — ' + p.teamName : '';
          item.appendChild(strong);
          item.appendChild(span);
          item.addEventListener('click', function(e) {
            e.preventDefault();
            playerIdInput.value = p.id;
            selectedPlayerName.textContent = p.name + (p.teamName ? ' (' + p.teamName + ')' : '');
            selectedPlayerDiv.style.display = 'block';
            searchInput.value = '';
            searchResult.style.display = 'none';
            submitBtn.disabled = false;
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

  clearBtn.addEventListener('click', function() {
    playerIdInput.value = '';
    selectedPlayerDiv.style.display = 'none';
    submitBtn.disabled = true;
  });
})();
