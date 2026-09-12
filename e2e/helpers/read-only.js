// Network guard that makes "these tests don't write" an enforced property rather than an
// intention.
//
// The browser suite drives a real server against a real database. Since HARD-13 that
// database is the local one in Docker rather than production — `dev.env`'s DATABASE_URL
// points at 127.0.0.1, and e2e/server-env.js refuses to start the suite's server if
// anything live survives — so a stray write is no longer a catastrophe. It is still a
// test writing rows nobody asked it to, which is how a suite comes to pass only against a
// database that has been through it once. So the rule stands: a test writes when it says
// it writes, and otherwise this aborts the request and fails the test.
//
// (This comment used to say `dev.env` carried the same DATABASE_URL as `.env`, so the dev
// server was talking to production Supabase. True when it was written, false from the
// moment HARD-13 landed, and nobody noticed for days — the same inverted warning CLAUDE.md
// records. A warning that has quietly reversed is worse than none, because it is what a
// careful person checks instead of looking.)
//
// What this CANNOT see is a write the server makes from inside Node — `POST
// /api/analyse-scorecard` storing a converted document, for instance. Nothing in the
// browser goes near it, so nothing here can. That is e2e/server-env.js's job (HARD-33),
// and both layers are needed.
//
// POST /teams is allowed because it is a read-only lookup despite the verb - team_search()
// just SELECTs the teams in a division, and the scorecard form's division dropdown depends
// on it to populate the team dropdowns.

const { expect } = require('@playwright/test');

const READ_METHODS = ['GET', 'HEAD', 'OPTIONS'];

// Same-origin endpoints that use a mutating verb but perform no writes.
const READ_ONLY_POSTS = [
  /^\/teams$/,          // team_search - SELECT of teams in a division
];

/**
 * Install the guard on a page. Returns a handle whose assertNoWrites() should be
 * called at the end of the test.
 *
 * @param {import('@playwright/test').Page} page
 * @param {string} baseURL
 * @param {object} [options]
 * @param {RegExp[]} [options.allowWrites]
 *   Same-origin paths this test DELIBERATELY writes to (HARD-28's submission specs). Each
 *   one has to be named, so "this test writes" stays a statement in the test rather than a
 *   property of the helper — and everything not named is still aborted and still fails
 *   assertNoWrites(). Cross-origin requests are aborted regardless: nothing a spec does
 *   may reach S3, SES or an analytics endpoint.
 *   What was written is recorded in `writes`, so a test can assert on it.
 */
async function readOnly(page, baseURL, options) {
  const base = new URL(baseURL);
  const allowWrites = (options && options.allowWrites) || [];
  const blocked = [];
  const writes = [];

  await page.route('**/*', function (route) {
    const request = route.request();
    const method = request.method();

    if (READ_METHODS.indexOf(method) !== -1) return route.continue();

    let url;
    try { url = new URL(request.url()); } catch (err) { return route.abort(); }

    // Third-party beacons (Google Analytics, Sentry, Hotjar, Facebook) post on
    // their own schedule. Dropped so test runs don't show up in real analytics.
    if (url.host !== base.host) return route.abort();

    if (READ_ONLY_POSTS.some(function (re) { return re.test(url.pathname); })) {
      return route.continue();
    }

    if (allowWrites.some(function (re) { return re.test(url.pathname); })) {
      writes.push(method + ' ' + url.pathname);
      return route.continue();
    }

    blocked.push(method + ' ' + url.pathname);
    return route.abort();
  });

  return {
    blocked: blocked,
    writes: writes,
    assertNoWrites: function () {
      expect(blocked, 'the page attempted a write this test did not ask for; pass it in '
        + 'allowWrites if it is deliberate').toEqual([]);
    }
  };
}

module.exports = { readOnly };
