// The weekly league tables as a Threads carousel, on its own route and scheduler job.

process.env.NODE_ENV = 'test';

jest.mock('../../utils/threadsPublisher', () => ({
  publishCarousel: jest.fn(),
  validateImages: jest.fn(),
}));
// The real `usable` over a mocked `withToken`, so the expiry rule itself is under test.
jest.mock('../../models/socialToken', () => {
  const m = jest.requireActual('../../models/socialToken');
  m.withToken = jest.fn();
  return m;
});
jest.mock('../../models/club', () => ({ getInstagramHandles: jest.fn() }));

const request = require('supertest');
const app = require('../../app');
const threads = require('../../utils/threadsPublisher');
const SocialToken = require('../../models/socialToken');
const Club = require('../../models/club');

const TOKEN = 'social-cron-token-not-real';
const DAY = 24 * 60 * 60 * 1000;
const ROW = { accountId: '28753684917596556', token: 'THAA-stored', expiresAt: new Date(Date.now() + 50 * DAY) };

beforeEach(() => {
  jest.clearAllMocks();
  process.env.SOCIAL_CRON_TOKEN = TOKEN;
  SocialToken.withToken.mockResolvedValue(ROW);
  threads.publishCarousel.mockResolvedValue({ mediaId: 't1', creationId: 'c5' });
  threads.validateImages.mockResolvedValue({ ok: true, refused: [] });
  Club.getInstagramHandles.mockResolvedValue([{ name: 'G.H.A.P', handle: 'ghapbadminton' }]);
});
afterEach(() => { delete process.env.SOCIAL_CRON_TOKEN; });

const post = (qs = '') => request(app).post('/admin/social/weekly-tables/threads' + qs).set('X-Social-Token', TOKEN);

it('refuses an anonymous caller with 403, not a redirect', async () => {
  const res = await request(app).post('/admin/social/weekly-tables/threads');
  expect(res.status).toBe(403);
  expect(res.headers.location).toBeUndefined();
  expect(threads.publishCarousel).not.toHaveBeenCalled();
});

it('posts the four tables as one carousel, with the stored token and account', async () => {
  const res = await post();
  expect(res.status).toBe(200);
  expect(res.body).toMatchObject({ ok: true, posted: [{ target: 'Threads', id: 't1' }], caller: 'scheduler' });

  const [userId, token, payload] = threads.publishCarousel.mock.calls[0];
  expect([userId, token]).toEqual(['28753684917596556', 'THAA-stored']);
  expect(payload.imageUrls).toEqual([
    'https://stockport-badminton.co.uk/league-table-image/Premier.jpg',
    'https://stockport-badminton.co.uk/league-table-image/Division%201.jpg',
    'https://stockport-badminton.co.uk/league-table-image/Division%202.jpg',
    'https://stockport-badminton.co.uk/league-table-image/Division%203.jpg',
  ]);
  expect(JSON.stringify(res.body)).not.toContain('THAA');
});

it('fits Threads: under 500 characters, one tag, no mentions', async () => {
  await post();
  const { text } = threads.publishCarousel.mock.calls[0][2];
  expect([...text].length).toBeLessThanOrEqual(500);
  expect(text.match(/#\w+/g)).toEqual(['#badminton']);
  expect(text).not.toContain('@');
});

it('answers 502 when Threads refuses, so the job goes red', async () => {
  threads.publishCarousel.mockRejectedValue(new Error('Threads refused the publish: nope'));
  const res = await post();
  expect(res.status).toBe(502);
  expect(res.body).toMatchObject({ ok: false, error: 'Threads refused the publish: nope' });
});

it('answers 503, not a quiet success, with no account connected', async () => {
  SocialToken.withToken.mockResolvedValue(null);
  const res = await post();
  expect(res.status).toBe(503);
  expect(res.body.error).toMatch(/\/admin\/threads/);
  expect(threads.publishCarousel).not.toHaveBeenCalled();
});

it('answers 503 on an expired token rather than trying it', async () => {
  SocialToken.withToken.mockResolvedValue({ ...ROW, expiresAt: new Date(Date.now() - DAY) });
  const res = await post();
  expect(res.status).toBe(503);
  expect(threads.publishCarousel).not.toHaveBeenCalled();
});

it('with ?dry=1 checks the images and publishes nothing', async () => {
  const res = await post('?dry=1');
  expect(res.status).toBe(200);
  expect(res.body.dry).toBe(true);
  expect(threads.validateImages).toHaveBeenCalledWith('28753684917596556', 'THAA-stored', expect.any(Array));
  expect(threads.publishCarousel).not.toHaveBeenCalled();
});
