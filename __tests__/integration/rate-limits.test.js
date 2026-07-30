const request = require('supertest');

jest.mock('../../models/fixture');
jest.mock('../../models/club');
jest.mock('../../models/division');
jest.mock('../../models/players');
jest.mock('../../models/game');
jest.mock('../../models/teams');
jest.mock('../../models/auth.js');
jest.mock('axios');
jest.mock('../../utils/ses', () => ({ sendEmail: jest.fn().mockResolvedValue({}) }));

const ses = require('../../utils/ses');
const Fixture = require('../../models/fixture');

// The limiters keep counters in module state, so each test file gets its own app
// instance and the limits are real. Requests come from the same test-client address, so
// they land in one bucket — which is the thing being tested.
const app = require('../../app');

beforeEach(() => {
  ses.sendEmail.mockClear();
  Fixture.getReminderRecipients.mockResolvedValue(['captain@example.com']);
  Fixture.getFixtureId.mockResolvedValue([{ id: 1 }]);
});

// Rate limiting is the only control here that caps abuse of endpoints nobody thought
// about, so what matters is that the limit exists, bites, and says so in a way a browser
// and an API client can each use.
describe('public form rate limiting', () => {
  it('lets legitimate use through and then stops the flood', async () => {
    const statuses = [];
    for (let i = 0; i < 14; i++) {
      const res = await request(app).post('/fixture/reminder')
        .send({ homeTeam: 'Mellor A', awayTeam: 'Aerospace A' });
      statuses.push(res.status);
    }

    // 10 an hour on the public form limiter.
    expect(statuses.filter(s => s === 200).length).toBe(10);
    expect(statuses.filter(s => s === 429).length).toBe(4);
    // And crucially: no email sent for the blocked ones.
    expect(ses.sendEmail).toHaveBeenCalledTimes(10);
  });

  it('stops calling the handler at all once limited', async () => {
    // Counters reset per test (see __tests__/setup.js), so exhaust the bucket here.
    const body = { homeTeam: 'Mellor A', awayTeam: 'Aerospace A' };
    for (let i = 0; i < 10; i++) await request(app).post('/fixture/reminder').send(body);
    ses.sendEmail.mockClear();

    const res = await request(app).post('/fixture/reminder').send(body);
    expect(res.status).toBe(429);
    expect(ses.sendEmail).not.toHaveBeenCalled();
  });

  it('answers a browser with a page, not a stack trace', async () => {
    const body = { homeTeam: 'A', awayTeam: 'B' };
    for (let i = 0; i < 10; i++) await request(app).post('/fixture/reminder').send(body);

    const res = await request(app).post('/fixture/reminder').send(body);
    expect(res.status).toBe(429);
    expect(res.text).toContain('Steady on');
    expect(res.text).not.toMatch(/at Object|Error:/);
  });

  it('advertises the limit in standard headers', async () => {
    const res = await request(app).get('/rules');
    expect(res.headers['ratelimit-policy']).toBeDefined();
    expect(res.headers['ratelimit']).toBeDefined();
  });
});

describe('the crawl surface is never rate limited', () => {
  it('exempts /sitemap.xml and /robots.txt from the global limiter', async () => {
    // A 429 to Googlebot on the sitemap costs indexing, and these are cheap GETs.
    const { skipCrawlSurface } = require('../../middleware/rateLimit');
    expect(skipCrawlSurface({ method: 'GET', path: '/sitemap.xml' })).toBe(true);
    expect(skipCrawlSurface({ method: 'GET', path: '/robots.txt' })).toBe(true);
    expect(skipCrawlSurface({ method: 'GET', path: '/' })).toBe(false);
    expect(skipCrawlSurface({ method: 'POST', path: '/sitemap.xml' })).toBe(false);
  });
});

describe('limiter keys', () => {
  it('keys on the resolved client IP, so the limiters and the blocklist agree', () => {
    const { keyGenerator } = require('../../middleware/rateLimit');
    expect(keyGenerator({ ip: '203.0.113.9', headers: {} })).toBe('203.0.113.9');
    // IPv4-over-IPv6 is normalised, or two shapes of the same visitor get two buckets.
    expect(keyGenerator({ ip: '::ffff:203.0.113.9', headers: {} })).toBe('203.0.113.9');
    expect(keyGenerator({ headers: { 'x-forwarded-for': '203.0.113.9, 10.0.0.1' } })).toBe('203.0.113.9');
    expect(keyGenerator({ headers: {} })).toBe('unknown');
  });
});
