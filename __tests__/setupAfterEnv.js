// Runs after the test framework is installed, so beforeEach is available. Env vars are
// set earlier, in setup.js (a `setupFiles` entry).

// Clear the rate-limit counters before every test.
//
// The limiters are real in tests — they should be, one of them is under test — but they
// keep counters in module state, so a suite that posts the same endpoint twenty times
// starts collecting 429s from a limiter it isn't testing. That reads as a regression in
// the thing under test rather than as the limiter doing its job. A test that wants to see
// the limit bite exhausts it within a single case.
beforeEach(() => {
  // Lazy require: most suites never load the middleware, and it should not be pulled in
  // just to reset it.
  let rateLimit;
  try {
    rateLimit = require('../middleware/rateLimit');
  } catch (err) {
    return; // not loadable in this context, so there is nothing to reset
  }
  rateLimit.resetRateLimits();
});

// ---------------------------------------------------------------------------
// Recognise a response that did not come from this application (HARD-20)
// ---------------------------------------------------------------------------
//
// `request(app)` stands up a server on an OS-assigned ephemeral port for every call, so a
// full run binds one about a thousand times. On a developer machine other things are
// listening in that same range — on the machine where this was diagnosed, VS Code helper
// processes on 49436, 49447, 51373, 52383 and 54987, and Postman on 55773 — and when a
// bind collides, *they* answer the request instead.
//
// They answer with plausible-looking HTTP:
//
//     49436 -> 400 "WebSockets request was expected"
//     49447 -> 401 {"error":{"type":"authentication_error"}}  (the Claude Code proxy)
//     51373 / 52383 / 54987 / 55773 -> 404
//
// The exact ports depend on what a given developer is running and will not reproduce
// elsewhere; the mechanism will.
//
// Which is exactly why this cost days. A test asserting 200 reports "expected 200, got
// 401" and every instinct says authorization bug — but there is no 401 anywhere in this
// codebase and production has never logged one. It looks like flakiness, it is not
// reproducible alone (a single suite binds a few dozen ports, a full run a thousand), and
// it happens on a working tree containing nothing but documentation changes.
//
// So the point of this guard is **legibility, not stability**. It cannot stop the
// collision. It replaces a misleading assertion failure with a message naming the cause,
// which is the difference between one re-run and a multi-day investigation.
//
// The signal is a header rather than that body string, because only one of the six ports
// produces the string. `helmet` is mounted at the very top of app.js, above the static
// handlers and the router, so **every** response this app produces carries a CSP header —
// verified against 200s, 404s, 500s and 503s. No test builds its own bare express app, so
// a response without those headers did not come from us.
const supertestTest = (() => {
  try { return require('supertest/lib/test'); } catch (err) { return null; }
})();

if (supertestTest && !supertestTest.prototype.__foreignResponseGuard) {
  const originalAssert = supertestTest.prototype.assert;

  supertestTest.prototype.assert = function (resError, res, fn) {
    const headers = (res && res.headers) || null;
    const foreign = headers &&
      !headers['content-security-policy'] &&
      !headers['content-security-policy-report-only'] &&
      !headers['x-content-type-options'];

    if (foreign) {
      let port = '(unknown)';
      try { port = new URL(this.url).port || '(none)'; } catch (err) { /* leave unknown */ }
      const body = typeof res.text === 'string' ? res.text.slice(0, 120) : '';
      // Pre-empt supertest's own assertion, so this is the failure that gets reported
      // rather than a confusing status mismatch underneath it.
      return fn(new Error(
        'This response did not come from the application.\n\n' +
        '  requested : ' + this.url + '\n' +
        '  status    : ' + res.status + '\n' +
        (body ? '  body      : ' + JSON.stringify(body) + '\n' : '') +
        '\nEvery response from app.js carries a Content-Security-Policy header (helmet is\n' +
        'mounted above everything). This one does not, so another process answered.\n' +
        'supertest binds an ephemeral port per request and something else on this machine\n' +
        'is listening in the same range. Find it with:\n\n' +
        '  lsof -iTCP:' + port + ' -sTCP:LISTEN -P -n\n\n' +
        'This is a local environment collision, not a bug in the code under test — see\n' +
        'docs/hardening/HARD-20-phantom-401.md. Re-run; it will almost certainly pass.'
      ), res);
    }

    return originalAssert.call(this, resError, res, fn);
  };

  supertestTest.prototype.__foreignResponseGuard = true;
}
