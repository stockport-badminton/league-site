const request = require('supertest');

// The health endpoint an uptime monitor polls.
//
// There wasn't one. The site being down was discovered when a member emailed — which
// makes every other failure in the codebase worse, because discovery was the bottleneck
// rather than the fix. A homepage check is not a substitute: it is cached, and it
// renders perfectly happily from a warm instance while Postgres is unreachable, which is
// exactly the outage you want to be told about.

let mockQueryImpl = () => Promise.resolve([[{ '?column?': 1 }]]);

jest.mock('../../db_connect', () => ({
  connect: jest.fn(),
  end: jest.fn().mockResolvedValue(undefined),
  otherConnect: jest.fn(() => Promise.resolve({
    query: jest.fn((...args) => mockQueryImpl(...args))
  })),
  withTransaction: jest.fn(fn => fn({ query: jest.fn(() => Promise.resolve([[]])) })),
  isObject: jest.fn(obj => obj === Object(obj)),
}));

jest.mock('../../middleware/secured', () => (req, res, next) => next());

const app = require('../../app');

beforeEach(() => {
  mockQueryImpl = () => Promise.resolve([[{ '?column?': 1 }]]);
});

describe('GET /healthz', () => {
  it('answers 200 when the database is reachable', async () => {
    const res = await request(app).get('/healthz');
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });

  // The whole point: it has to fail when the database is unreachable, not merely when
  // the process is dead. A process that is up but cannot read fixtures is down as far
  // as anybody using the site is concerned.
  it('answers 503 when the database is unreachable', async () => {
    mockQueryImpl = () => Promise.reject(new Error('ECONNREFUSED'));
    const res = await request(app).get('/healthz');
    expect(res.status).toBe(503);
    expect(res.body.ok).toBe(false);
  });

  it('is never cached', async () => {
    const res = await request(app).get('/healthz');
    expect(res.headers['cache-control']).toMatch(/no-store/);
  });

  // Mounted above globalLimiter deliberately. A monitor polling every minute would
  // otherwise spend the sitewide request budget — the same trap that made the browser
  // suite run out of requests when the limiter sat above the static handlers.
  it('does not consume the sitewide rate limit', async () => {
    for (let i = 0; i < 40; i++) {
      const res = await request(app).get('/healthz');
      expect(res.status).toBe(200);
    }
  });

  // A login redirect or an error page in a sitemap reads as a soft 404, and /healthz is
  // not a page at all.
  it('is not listed in the sitemap', async () => {
    const res = await request(app).get('/sitemap.xml');
    expect(res.text).not.toContain('/healthz');
  });
});
