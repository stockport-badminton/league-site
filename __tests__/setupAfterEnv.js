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
