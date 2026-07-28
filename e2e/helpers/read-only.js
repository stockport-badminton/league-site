// Network guard that makes "these tests don't write to the database" an enforced
// property rather than an intention.
//
// dev.env carries the same DATABASE_URL as .env, so a local dev server is talking
// to the production Supabase instance. A test that submitted a scorecard would
// create real rows in scorecardstore / messer_scorecard / fixture. So instead of
// relying on every test author to avoid that, this aborts any mutating request
// the app makes and records it, and assertNoWrites() then fails the test.
//
// POST /teams is allowed because it is a read-only lookup despite the verb -
// team_search() just SELECTs the teams in a division, and the scorecard form's
// division dropdown depends on it to populate the team dropdowns.

const { expect } = require('@playwright/test');

const READ_METHODS = ['GET', 'HEAD', 'OPTIONS'];

// Same-origin endpoints that use a mutating verb but perform no writes.
const READ_ONLY_POSTS = [
  /^\/teams$/,          // team_search - SELECT of teams in a division
];

/**
 * Install the guard on a page. Returns a handle whose assertNoWrites() should be
 * called at the end of the test.
 */
async function readOnly(page, baseURL) {
  const base = new URL(baseURL);
  const blocked = [];

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

    blocked.push(method + ' ' + url.pathname);
    return route.abort();
  });

  return {
    blocked: blocked,
    assertNoWrites: function () {
      expect(blocked, 'the page attempted a write; these tests must stay read-only '
        + 'because dev.env points at the production database').toEqual([]);
    }
  };
}

module.exports = { readOnly };
