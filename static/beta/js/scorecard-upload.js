// Getting a scorecard photo into the bucket, whatever the captain hands us.
//
// Two routes, and which one is used depends on the file:
//
//   an image     -> /sign-s3 gives a presigned PUT and the browser uploads straight to
//                   S3. The bytes never pass through our server.
//   a pdf/docx   -> POST it to /api/convert-scorecard-document, which pulls the photo
//                   out and stores THAT. No OCR: the plain photo box must not read the
//                   card, because the form offers the auto-fill box separately and some
//                   captains would rather no machine read theirs.
//
// Extracted here because three inputs on two pages needed it (the new-scorecard photo
// field, the add-a-photo-to-a-filed-fixture field, and the messer form) and the first two
// already held near-identical copies. A third copy is how they drift.
//
// Every path either returns a URL or throws an Error whose message is fit for a captain
// to read. The callers used to swallow these — `catch (error) { console.error(...) }` —
// so a refused upload looked exactly like a successful one and the scorecard was filed
// with no photo. Do not add a caller that does not show what this throws.
(function (global) {
  'use strict';

  var DOCUMENT_RE = /\.(pdf|docx)$/i;

  function isDocument(file) {
    return DOCUMENT_RE.test(file.name || '') ||
           /pdf|wordprocessingml/i.test(file.type || '');
  }

  // The message the server sent, if it sent one. Both endpoints answer JSON on 4xx, and
  // those messages are written for captains — passing them through is the whole point.
  function errorFrom(response, fallback) {
    return response.json().then(function (body) {
      throw new Error((body && body.error) || fallback);
    }, function () {
      throw new Error(fallback);
    });
  }

  function convertDocument(file) {
    var fd = new FormData();
    fd.append('scorecard', file);
    return fetch('/api/convert-scorecard-document', { method: 'POST', body: fd })
      .then(function (res) {
        if (!res.ok) return errorFrom(res, 'That file could not be converted.');
        return res.json();
      })
      .then(function (body) {
        if (!body.url) throw new Error('That file could not be converted.');
        return body.url;
      });
  }

  function uploadImage(file, hint) {
    var query = '/sign-s3?file-name=' + encodeURIComponent(hint) +
                '&file-type=' + encodeURIComponent(file.type);
    return fetch(query)
      .then(function (res) {
        // /sign-s3 says why in JSON — an unaccepted type, most often. Reporting the
        // status instead is what made a refused PDF invisible.
        if (!res.ok) return errorFrom(res, 'That file type is not accepted.');
        return res.json();
      })
      .then(function (signed) {
        return fetch(signed.signedUrl, {
          method: 'PUT',
          body: file,
          headers: { 'Content-Type': file.type },
        }).then(function (put) {
          if (!put.ok) throw new Error('The upload failed (' + put.status + '). Please try again.');
          // The server already knows the object's URL. Rebuilding it by trimming the
          // signature off and rewriting %20 as '+' is what put '+' in 490 stored URLs.
          return signed.url;
        });
      });
  }

  // ── Uploads still in flight ────────────────────────────────────────────────────
  //
  // Submitting the form navigates, and navigating kills any fetch still running — Safari
  // reports it as "Load failed". The photo's URL only reaches `scoresheet-url` when the
  // upload FINISHES, so a captain who picks a photo and presses Submit before it is done
  // files the scorecard with no photo. Draft 2465, 11 Oct: a 3.6MB photo from an iPhone,
  // sixteen seconds into its PUT when Submit was pressed; Sentry has the PUT failing 28ms
  // after the click. Nothing on the form knew an upload was running.
  var pending = [];

  // Register anything the form must not be submitted in the middle of. Returns the same
  // promise, so a caller can wrap and carry on.
  function track(promise) {
    var p = Promise.resolve(promise);
    pending.push(p);
    function done() { pending = pending.filter(function (q) { return q !== p; }); }
    p.then(done, done);
    return p;
  }

  // Resolves once nothing is in flight, to whether everything that was succeeded. Loops,
  // because finishing one job can start another: the auto-fill's analysis is tracked, and
  // its success handler starts the PUT.
  function whenIdle() {
    var ok = true;
    function step() {
      if (!pending.length) return Promise.resolve(ok);
      return Promise.all(pending.map(function (p) {
        return p.then(function () {}, function () { ok = false; });
      })).then(function () {
        // Let the settled promises' own `done` handlers run before looking again.
        return new Promise(function (resolve) { setTimeout(resolve, 0); });
      }).then(step);
    }
    return step();
  }

  // Hold a form's submission until its uploads have finished.
  //
  // Submits by itself once they succeed — the captain already pressed Submit, and asking
  // twice would read as the first press having failed. If one failed, the caller has
  // already said so (every ScorecardUpload caller shows what it throws), so this stops
  // and says what to do next instead: a second press, with nothing in flight, files
  // without the photo. That is a choice the captain makes knowing, not one made for them.
  function guardSubmit(form) {
    if (!form || form.__uploadGuard) return;
    form.__uploadGuard = true;
    var note = document.createElement('small');
    note.className = 'upload-wait-note d-block mt-2';
    note.style.display = 'none';
    var waiting = false;

    form.addEventListener('submit', function (e) {
      if (waiting) { e.preventDefault(); return; }
      if (!pending.length) return;
      e.preventDefault();
      waiting = true;

      var buttons = form.querySelectorAll('button[type="submit"], input[type="submit"]');
      var labels = [];
      buttons.forEach(function (b, i) {
        labels[i] = b.innerHTML;
        b.disabled = true;
        b.textContent = 'Uploading photo…';
      });
      var anchor = buttons[buttons.length - 1];
      if (anchor && !note.parentNode) anchor.insertAdjacentElement('afterend', note);
      note.className = 'upload-wait-note d-block mt-2 text-muted';
      note.textContent = 'Waiting for the photo to finish uploading before sending the scorecard.';
      note.style.display = '';

      whenIdle().then(function (ok) {
        waiting = false;
        buttons.forEach(function (b, i) { b.disabled = false; b.innerHTML = labels[i]; });
        if (ok) {
          note.style.display = 'none';
          // The prototype's submit, not form.submit: a control named "submit" would
          // shadow the method. Unlike requestSubmit it fires no submit event, so this
          // handler cannot run again.
          HTMLFormElement.prototype.submit.call(form);
          return;
        }
        note.className = 'upload-wait-note d-block mt-2 text-danger';
        note.textContent = 'The photo did not upload, so nothing has been sent yet. Choose ' +
          'the photo again, or press Submit to send the scorecard without it.';
      });
    });
  }

  // Resolves to the public URL of the stored photo. `hint` is advisory only — the server
  // generates the key.
  function store(file, hint) {
    return track(isDocument(file) ? convertDocument(file) : uploadImage(file, hint || file.name));
  }

  global.ScorecardUpload = {
    isDocument: isDocument,
    store: store,
    track: track,
    whenIdle: whenIdle,
    guardSubmit: guardSubmit,
    // What the file inputs should accept. One definition, so an input cannot quietly
    // narrow: `accept="image/*"` on the auto-fill box meant the file dialog never offered
    // a captain their own scanner's PDF, and the server-side conversion behind it was
    // unreachable from the page.
    ACCEPT: 'image/*,application/pdf,.pdf,.docx,' +
            'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  };
})(window);
