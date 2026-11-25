// Moved out of views/elo-backfill.ejs (REARCH-07 step 5), unchanged.
document.addEventListener('click', function (event) {
  var button = event.target instanceof Element ? event.target.closest('[data-backfill]') : null;
  if (button) runBackfill(button.getAttribute('data-backfill'));
});

function runBackfill(type) {
  var url = type === 'all'
    ? '/players/eloBackfillAll'
    : '/players/eloFullRecalc?season=' + document.getElementById('season-select').value;

  var card = document.getElementById('result-card');
  var output = document.getElementById('result-output');

  output.textContent = '';
  card.style.display = 'block';

  fetch(url).then(function(r) {
    var reader = r.body.getReader();
    var decoder = new TextDecoder();
    function read() {
      return reader.read().then(function(chunk) {
        if (chunk.done) return;
        output.textContent += decoder.decode(chunk.value);
        output.scrollTop = output.scrollHeight;
        return read();
      });
    }
    return read();
  }).catch(function(err) {
    output.textContent += '\nError: ' + err.message;
  });
}
