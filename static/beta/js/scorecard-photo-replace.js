// The results secretary attaching or replacing a filed scorecard's photo, from the
// confirmation page. Ported from Tameside (a17cbe2).
//
// This used to mean blanking `scoresheet-url` in the database and re-attaching through
// /email-scorecard. Choosing a file uploads it (ScorecardUpload.store: a presigned PUT
// for an image, the server-side conversion for a pdf or docx) and previews it; nothing
// changes on the draft until "Use this file" is pressed.
//
// The upload gets a new, server-generated key, so the photo being replaced stays in the
// bucket. POST /scorecard-photo/:id/replace logs the url it replaced.
(function () {
  'use strict';
  var panel = document.getElementById('scorecard-photo-panel');
  if (!panel || !window.ScorecardUpload) return;
  var id = panel.getAttribute('data-scorecard-id');
  var input = document.getElementById('replace-photo-file');
  var preview = document.getElementById('replace-photo-preview');
  var img = document.getElementById('replace-photo-img');
  var name = document.getElementById('replace-photo-name');
  var save = document.getElementById('replace-photo-save');
  var status = document.getElementById('replace-photo-status');
  var pendingUrl = null;

  input.setAttribute('accept', window.ScorecardUpload.ACCEPT);

  function say(text, kind) {
    status.textContent = text;
    status.className = 'mt-2 mb-0' + (kind ? ' text-' + kind : '');
  }

  input.addEventListener('change', function () {
    var file = input.files[0];
    pendingUrl = null;
    save.disabled = true;
    preview.hidden = true;
    if (!file) return say('');
    var isDoc = window.ScorecardUpload.isDocument(file);
    say(isDoc ? 'Uploading, and pulling the photo out of the file…' : 'Uploading…');

    window.ScorecardUpload.store(file, 'scorecard-' + id).then(function (url) {
      // A document's extracted photo isn't on this page to preview; the stored file is
      // what the confirmation page will show once it is saved.
      if (isDoc) { img.removeAttribute('src'); img.hidden = true; }
      else { img.src = URL.createObjectURL(file); img.hidden = false; }
      name.textContent = file.name;
      preview.hidden = false;
      pendingUrl = url;
      save.disabled = false;
      say('Uploaded. Check it is the right card, then press "Use this file".');
    }, function (e) {
      say('⚠ ' + e.message, 'danger');
    });
  });

  save.addEventListener('click', function () {
    if (!pendingUrl) return;
    save.disabled = true;
    say('Saving…');
    fetch('/scorecard-photo/' + encodeURIComponent(id) + '/replace', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ imgURL: pendingUrl }),
    }).then(function (resp) {
      return resp.json().catch(function () { return {}; }).then(function (data) {
        if (!resp.ok) throw new Error(data.error || 'The scorecard could not be updated.');
      });
    }).then(function () {
      say('✓ Saved.', 'success');
      window.location.reload();
    }, function (e) {
      say('⚠ ' + e.message, 'danger');
      save.disabled = false;
    });
  });
})();
