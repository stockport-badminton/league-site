const request = require('supertest');

// Handlers must report a failure as a failure.
//
// Eleven of them answered `res.send(err)`, which serialises an Error to `{}` and sends
// it with Express's default status — **HTTP 200, empty body**. The visitor gets a blank
// page, Sentry hears nothing because as far as Express is concerned the request
// succeeded, and a crawler files it as a real page with no content. That is what
// rendered 48 /event/ pages as a two-byte 200.
//
// The most reachable were the fixture read paths, which is why they are the ones
// exercised here. `__tests__/unit/no-res-send-err.test.js` is the cheap guard that stops
// the pattern returning; these prove the handlers now behave.

jest.mock('../../models/fixture');
jest.mock('../../models/players');
jest.mock('../../models/teams');
jest.mock('../../models/club');
jest.mock('../../models/division');

jest.mock('../../db_connect', () => ({
  connect: jest.fn(),
  end: jest.fn().mockResolvedValue(undefined),
  otherConnect: jest.fn(() => Promise.resolve({
    query: jest.fn(() => Promise.resolve([[]]))
  })),
  withTransaction: jest.fn(fn => fn({ query: jest.fn(() => Promise.resolve([[]])) })),
  isObject: jest.fn(obj => obj === Object(obj)),
}));

jest.mock('../../middleware/secured', () => (req, res, next) => next());

const Fixture = require('../../models/fixture');
const app = require('../../app');

beforeEach(() => {
  jest.clearAllMocks();
});

describe('a failing fixture read', () => {
  // The three that are reachable without a token. `fixture_detail` shares the fault but
  // sits behind checkJwt, so it is covered by the repo-level guard instead.
  const cases = [
    { name: 'fixture list', path: '/fixtures', model: 'getAll' },
    { name: 'fixture id by team ids', path: '/fixture/homeId-1/awayId-2', model: 'getFixtureId' },
    { name: 'fixture id by team names', path: '/fixture/home-Shell%20A/away-Mellor%20A', model: 'getFixtureIdFromTeamNames' },
  ];

  cases.forEach(({ name, path, model }) => {
    describe(name, () => {
      it('answers 500, not 200', async () => {
        Fixture[model].mockRejectedValue(new Error('database on fire'));
        const res = await request(app).get(path);

        // The whole point. 200 was the bug.
        expect(res.status).toBe(500);
      });

      it('never returns an empty body with a success status', async () => {
        Fixture[model].mockRejectedValue(new Error('database on fire'));
        const res = await request(app).get(path);
        expect(res.status).not.toBe(200);
        expect(res.text.length).toBeGreaterThan(2);
      });

      it('does not leak the error text to the visitor', async () => {
        Fixture[model].mockRejectedValue(new Error('relation "fixture" does not exist'));
        const res = await request(app).get(path);
        // A pg error message carries SQL and column names. FAIL-4/HARD-06 covers the
        // page itself; this asserts the handler hands the error to the central handler
        // rather than printing it directly, which is what res.send(err) did.
        expect(res.text).not.toContain('relation "fixture" does not exist');
      });
    });
  });
});
