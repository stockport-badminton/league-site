// The share button on each result, moved out of views/fixtures-results.ejs
// (REARCH-07 step 5), unchanged.
document.addEventListener('click', function(e) {
  var btn = e.target.closest('.share-result-btn');
  if (!btn) { return; }
  e.preventDefault();

  var imgUrl = btn.getAttribute('data-img-url');
  var title = btn.getAttribute('data-title');

  if (!navigator.share) {
    window.open(imgUrl, '_blank');
    return;
  }

  fetch(imgUrl)
    .then(function(resp) { return resp.blob(); })
    .then(function(blob) {
      var file = new File([blob], 'result.jpg', { type: 'image/jpeg' });
      if (navigator.canShare && navigator.canShare({ files: [file] })) {
        return navigator.share({ files: [file], title: title, text: title });
      }
      return navigator.share({ title: title, text: title, url: location.origin + imgUrl });
    })
    .catch(function(err) {
      if (err.name !== 'AbortError') { console.warn('Share failed:', err); }
    });
});
