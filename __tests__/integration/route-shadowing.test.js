// First match wins, so a route registered after a broader pattern can silently never run.
// GET /player/:id did that to GET /player/create for years: the form had never rendered, and
// nothing said so (REARCH-04 step 0). Since the routes are now spread across routes/*.js
// and mounted in an order set by routes/index.js, a reorder can do it too.
//
// For every route this builds URLs its own pattern accepts and checks the route is the
// first to answer them. A deliberate exception goes in KNOWN with its reason.

const { shadowedRoutes } = require('../helpers/routeTable');
const app = require('../../app');

const KNOWN = {
  'GET /admin/results/:division/:season':
    'Unreachable since before REARCH-04: GET /admin/results/* above it has the same handler ' +
    'and the same access, so it answers every URL this would. Harmless; delete it on its own.',
};

it('lets every route answer its own URLs', () => {
  const found = shadowedRoutes(app).filter(s => !KNOWN[s.route]);
  expect(found.map(s => `${s.route} — ${s.url} goes to ${s.answeredBy}`)).toEqual([]);
});

it('still has every known exception, so a fixed one is removed from the list', () => {
  const shadowed = new Set(shadowedRoutes(app).map(s => s.route));
  expect(Object.keys(KNOWN).filter(k => !shadowed.has(k))).toEqual([]);
});
