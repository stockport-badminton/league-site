// The REARCH-04 route-table walker, on a small app whose answers are known.

const express = require('express');
const access = require('../../middleware/access');
const { routeTable } = require('../helpers/routeTable');

const noop = (req, res) => res.end();

function build() {
  const app = express();
  app.get('/health', noop);
  const router = express.Router();
  router.get('/tables', access.public, noop);
  router.post('/admin', access.superadmin, noop);
  router.get('/late', noop, access.member, noop);
  router.get('/twice', access.public, access.member, noop);
  router.route('/both').get(access.member, noop).post(noop);
  app.use(router);
  return app;
}

it('lists app and mounted-router routes in registration order, with their declaration', () => {
  expect(routeTable(build()).map(r => [r.order, r.method, r.path, r.access])).toEqual([
    [1, 'GET', '/health', null],
    [2, 'GET', '/tables', 'public'],
    [3, 'POST', '/admin', 'superadmin'],
    [4, 'GET', '/late', null],
    [5, 'GET', '/twice', 'public'],
    [6, 'GET', '/both', 'member'],
    [7, 'POST', '/both', null],
  ]);
});

it('flags a declaration that is not first, and a route with two', () => {
  const t = routeTable(build());
  expect(t.find(r => r.path === '/late')).toMatchObject({ misplaced: true, declarations: 1 });
  expect(t.find(r => r.path === '/twice')).toMatchObject({ misplaced: false, declarations: 2 });
  expect(t.find(r => r.path === '/tables')).toMatchObject({ misplaced: false, declarations: 1 });
});

it('refuses to guess the prefix of a router mounted below "/"', () => {
  const app = express();
  app.use('/api', express.Router().get('/x', noop));
  expect(() => routeTable(app)).toThrow(/mounted somewhere other than/);
});
