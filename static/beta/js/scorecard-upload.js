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

  // Resolves to the public URL of the stored photo. `hint` is advisory only — the server
  // generates the key.
  function store(file, hint) {
    return isDocument(file) ? convertDocument(file) : uploadImage(file, hint || file.name);
  }

  global.ScorecardUpload = {
    isDocument: isDocument,
    store: store,
    // What the file inputs should accept. One definition, so an input cannot quietly
    // narrow: `accept="image/*"` on the auto-fill box meant the file dialog never offered
    // a captain their own scanner's PDF, and the server-side conversion behind it was
    // unreachable from the page.
    ACCEPT: 'image/*,application/pdf,.pdf,.docx,' +
            'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  };
})(window);
