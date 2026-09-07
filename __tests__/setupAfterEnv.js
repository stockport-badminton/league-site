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
// Make supertest bind a port nothing else can answer on (HARD-14 / HARD-20)
// ---------------------------------------------------------------------------
//
// `request(app)` stands up a server on an OS-assigned ephemeral port for every call, so a
// full run binds one about six hundred times. Other processes on a developer machine
// listen in that same range — on the machine where this was diagnosed, seven VS Code
// helpers — and those collisions were answering our requests. A quarter of full runs
// failed because of it, in ten different suites, and it was read as ten different bugs.
//
// The collision was never a coincidence to be tolerated. It was the wrong bind.
// supertest calls `app.listen(0)` with no host, which binds the WILDCARD address, while
// addressing its own requests to 127.0.0.1. On macOS a wildcard bind SUCCEEDS on a port
// another process already holds on 127.0.0.1 specifically — the two are different
// addresses — and a connection to 127.0.0.1 is then delivered to the more specific of the
// two bindings, i.e. to them. Demonstrated directly against a VS Code helper:
//
//     bind wildcard *:49436  -> SUCCEEDED (:::49436)
//     GET 127.0.0.1:49436    -> 400 "WebSockets request was expected"   (not ours)
//     bind 127.0.0.1:49436   -> REFUSED EADDRINUSE
//
// So asking for the loopback address is a fix rather than a mitigation: the kernel will
// not hand out a port already taken ON THAT ADDRESS, and it is the address supertest was
// connecting to all along. A foreign listener on the wildcard is covered by the same
// change — our bind is then the one refused, and the kernel picks another port.
//
// Do not "simplify" this back to app.listen(0).
const tls = require('tls');
const net = require('net');
const { isForeignResponse, STAMP_HEADER } = require('./helpers/foreign-response');

const supertestTest = (() => {
  try { return require('supertest/lib/test'); } catch (err) { return null; }
})();

let serverSeq = 0;

// Bind a port on 127.0.0.1 only, and do it SYNCHRONOUSLY.
//
// Synchronously is the awkward part. supertest builds the request URL inside its
// constructor, so it needs the port there and then, and every public form that takes a
// host — listen(0, '127.0.0.1'), listen({port: 0, host}) — resolves the host through
// dns.lookup and so does not have an address until the 'listening' event a tick later.
// Only the wildcard listen(0) is synchronous, and the wildcard is the bug.
//
// net._createServerHandle binds immediately and returns a handle server.listen() accepts,
// which keeps serverAddress synchronous and changes nothing else about the timing. It is
// underscore-prefixed and therefore not API, so if it ever stops working we fall back to
// upstream's wildcard bind: the collision comes back, but the guard below still names it
// rather than letting it read as a bug in the code under test.
function listenOnLoopback(server) {
  try {
    const handle = net._createServerHandle('127.0.0.1', 0, 4 /* AF_INET */);
    // A uv errno comes back as a number rather than a handle.
    if (handle && typeof handle !== 'number') {
      server.listen(handle);
      if (server.address()) return server;
    }
  } catch (err) {
    // fall through
  }
  return server.listen(0);
}

if (supertestTest && !supertestTest.prototype.__loopbackBind) {
  // Upstream's serverAddress, with the bind address changed and the server stamped.
  supertestTest.prototype.serverAddress = function (app, path) {
    if (!app.address()) this._server = listenOnLoopback(app);
    const port = app.address().port;
    const protocol = app instanceof tls.Server ? 'https' : 'http';

    // Give this server an identity and have it stamp its own responses, so the guard
    // below can prove a response came from it rather than infer it. The id carries the
    // pid because workers are separate processes.
    if (this._server && !this._server.__stampedId) {
      const id = process.pid + ':' + (++serverSeq);
      this._server.__stampedId = id;
      this.__expectedServerId = id;
      const handlers = this._server.listeners('request');
      this._server.removeAllListeners('request');
      this._server.on('request', (req, res) => {
        try { res.setHeader(STAMP_HEADER, id); } catch (err) { /* headers already sent */ }
        for (const handler of handlers) handler.call(this._server, req, res);
      });
    }

    return protocol + '://127.0.0.1:' + port + path;
  };

  supertestTest.prototype.__loopbackBind = true;
}

// ---------------------------------------------------------------------------
// Recognise a response that did not come from this application (HARD-20)
// ---------------------------------------------------------------------------
//
// The bind above should make this unreachable. It is kept as a backstop, because the
// failure it explains cost days twice: a colliding listener answers with a plausible 400,
// 401 or 404 and every instinct reads it as an authorization bug in our own code.
//
// The rule lives in __tests__/helpers/foreign-response.js so it can be tested directly —
// and because the rule it replaced was subtly wrong in a way no amount of re-running would
// have shown. See the comment there.
if (supertestTest && !supertestTest.prototype.__foreignResponseGuard) {
  const originalAssert = supertestTest.prototype.assert;

  supertestTest.prototype.assert = function (resError, res, fn) {
    const headers = (res && res.headers) || null;

    if (isForeignResponse(headers, this.__expectedServerId)) {
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
        '\nEvery server this suite stands up stamps its own responses with a per-server\n' +
        'id. This response carries none, or the wrong one, so something else answered.\n' +
        'supertest binds an ephemeral port per request; something on this machine is\n' +
        'listening in the same range. Find it with:\n\n' +
        '  lsof -iTCP:' + port + ' -sTCP:LISTEN -P -n\n\n' +
        'This should no longer be possible — the bind was moved to 127.0.0.1 exactly so\n' +
        'that the kernel cannot hand us a port someone else holds. If you are seeing this,\n' +
        'that fix has regressed or the listener is bound in a way it does not cover.\n' +
        'See docs/hardening/HARD-14-flaky-authorization-test.md.'
      ), res);
    }

    return originalAssert.call(this, resError, res, fn);
  };

  supertestTest.prototype.__foreignResponseGuard = true;
}
