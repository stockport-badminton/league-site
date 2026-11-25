// Moved out of views/messer-draw-a-section.ejs (REARCH-07 step 5). The section now
// comes from the form's data-section rather than being written into the code.
// Fill the concede modal from the button that opened it. textContent throughout, so a
// team name is never parsed as markup.
$('#concedeModal').on('show.bs.modal', function (e) {
  var b = e.relatedTarget.dataset;
  var conceded = b.conceded;
  document.getElementById('concedeForm').action =
    '/messer-draw/' + encodeURIComponent(document.getElementById('concedeForm').dataset.section)
    + '-section/concede/' + encodeURIComponent(b.match);
  document.getElementById('concedeModalTitle').textContent = conceded ? 'Change or undo the concession' : 'Record a concession';
  document.getElementById('concedeMatch').textContent = b.home + ' v ' + b.away;
  document.querySelector('label[for=concedeHome]').textContent = b.home + ' (home) conceded';
  document.querySelector('label[for=concedeAway]').textContent = b.away + ' (away) conceded';
  document.getElementById('concedeHome').checked = conceded === 'home';
  document.getElementById('concedeAway').checked = conceded === 'away';
  document.getElementById('concedeNone').checked = false;
  document.getElementById('concedeUndoRow').hidden = !conceded;
  document.getElementById('concedeNone').disabled = !conceded;
});
