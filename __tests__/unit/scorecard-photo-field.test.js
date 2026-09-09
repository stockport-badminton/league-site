// The scorecard form must carry exactly one `scoresheet-url` field per rendered branch.
//
// Step 13 of the wizard has two states — "upload one here" (#scorecardUploadPrompt) and
// "already uploaded at step 1" (#scorecardUploadDone) — and the JS toggles which is
// visible. Each used to carry its own hidden input, and **`display:none` does not stop a
// hidden input submitting**: both posted, so `req.body['scoresheet-url']` arrived as an
// array, `isPhotoUrl()` rejected it, and every photo attached during submission was
// silently dropped.
//
// It survived for months because the emailed "add a photo" link is a different code path
// and works, so captains got their photo on eventually and nobody saw a bug — only a
// warning in Sentry that recorded the stage but not the value, on a URL that was perfectly
// valid.
//
// Nothing else can catch this. Jest never renders this template, and the browser suite is
// read-only so it never submits the form.

const fs = require('fs');
const path = require('path');

const TEMPLATE = path.join(__dirname, '../../views/index-scorecard.ejs');
const src = fs.readFileSync(TEMPLATE, 'utf8');

// The span of a container div, by matching its opening tag then walking div depth.
function containerBody(html, openingTagPattern) {
  const start = html.search(openingTagPattern);
  if (start < 0) return null;
  let i = html.indexOf('>', start) + 1;
  let depth = 1;
  const from = i;
  while (i < html.length && depth > 0) {
    const nextOpen = html.indexOf('<div', i);
    const nextClose = html.indexOf('</div>', i);
    if (nextClose < 0) break;
    if (nextOpen >= 0 && nextOpen < nextClose) { depth++; i = nextOpen + 4; }
    else { depth--; i = nextClose + 6; }
  }
  return html.slice(from, i);
}

describe('the scorecard photo field', () => {
  it('does not live inside either of step 13\'s toggled states', () => {
    for (const id of ['scorecardUploadPrompt', 'scorecardUploadDone']) {
      const body = containerBody(src, new RegExp('<div[^>]*id="' + id + '"'));
      expect(body).not.toBeNull();
      // A hidden input in a hidden div still submits. Both states must write to one
      // field that sits outside them, not carry one each.
      expect(body).not.toMatch(/name="scoresheet-url"/);
    }
  });

  it('appears once in the step-13 block that holds both states', () => {
    const step13 = containerBody(src, /<div class="modal-body step step-13 ScorecardUpload">/);
    expect(step13).not.toBeNull();
    expect(step13.match(/name="scoresheet-url"/g) || []).toHaveLength(1);
  });

  // Both upload routes stay — the step-1 OCR one that auto-fills the form, and the plain
  // step-13 one for captains who would rather nothing read their scorecard. They just
  // share the single field.
  it('still offers both upload routes', () => {
    expect(src).toMatch(/id="photoUploadCard"/);            // step 1, feeds /api/analyse-scorecard
    expect(src).toMatch(/id="scorecardUploadPrompt"/);       // step 13, plain upload
    expect(src).toMatch(/\/api\/analyse-scorecard/);
  });
});
